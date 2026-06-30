/**
 * Spotify OAuth 2.0 — Authorization Code + PKCE.
 *
 * PKCE (no client secret on device) is the only safe flow for a public
 * native client: the `AuthRequest` generates a `codeVerifier`/`codeChallenge`
 * pair, the user authorizes in a browser, and we exchange the returned code
 * (+ verifier) for an access/refresh token. Tokens are persisted in
 * `expo-secure-store` (Keychain on iOS) — it is already a dependency and an
 * Expo plugin, so no fallback to AsyncStorage is needed. If SecureStore were
 * ever unavailable, swap `tokenStore` below for AsyncStorage (tokens would
 * then live in plain app storage — acceptable for short-lived OAuth tokens
 * but less ideal than the Keychain).
 *
 * Scopes: `user-modify-playback-state` (set volume / pause) +
 * `user-read-playback-state` (read the active device).
 *
 * Requires a Spotify **Premium** account for playback control.
 */
import {
  AuthRequest,
  exchangeCodeAsync,
  refreshAsync,
  makeRedirectUri,
  ResponseType,
  type AuthSessionResult,
} from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const SPOTIFY_SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
];

/** Spotify's OAuth endpoints (no auto-discovery — they are stable). */
const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const STORE_KEY = 'lull.spotify.tokens.v1';

/** Persisted token bundle. `expiresAt` is epoch-seconds (issuedAt + expiresIn). */
export interface SpotifyTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch seconds at which the access token expires. */
  expiresAt: number;
  scope?: string;
}

/** Treat a token as expired this many seconds early to avoid edge-of-expiry races. */
const EXPIRY_MARGIN_SEC = 60;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Resolve the Spotify client ID from `app.json` -> `expo.extra.spotifyClientId`. */
export function getClientId(): string {
  const extra =
    Constants.expoConfig?.extra ??
    // Fallback for bare/manifest2 runtimes where expoConfig may be null.
    (Constants as unknown as { manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } } })
      .manifest2?.extra?.expoClient?.extra ??
    {};
  const clientId = (extra as Record<string, unknown>).spotifyClientId;
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new Error(
      'Missing spotifyClientId in app.json -> expo.extra.spotifyClientId',
    );
  }
  return clientId;
}

/** The redirect URI registered on the Spotify Developer Dashboard. */
export function getRedirectUri(): string {
  return makeRedirectUri({ scheme: 'neurex', path: 'spotify-callback' });
}

// --- token storage -----------------------------------------------------------

const tokenStore = {
  async save(tokens: SpotifyTokens): Promise<void> {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(tokens));
  },
  async load(): Promise<SpotifyTokens | null> {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SpotifyTokens;
    } catch {
      return null;
    }
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(STORE_KEY);
  },
};

function toTokens(
  resp: { accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string },
  prev?: SpotifyTokens | null,
): SpotifyTokens {
  const expiresIn = resp.expiresIn ?? 3600;
  return {
    accessToken: resp.accessToken,
    // Spotify only returns a refresh token on the initial exchange; reuse the
    // prior one across refreshes if the response omits it.
    refreshToken: resp.refreshToken ?? prev?.refreshToken,
    expiresAt: nowSec() + expiresIn,
    scope: resp.scope ?? prev?.scope,
  };
}

// --- public API --------------------------------------------------------------

/**
 * Run the interactive Authorization Code + PKCE flow. Opens the Spotify
 * consent screen, exchanges the code for tokens, and persists them.
 * Returns the stored tokens on success, or null if the user cancelled.
 */
export async function authorize(): Promise<SpotifyTokens | null> {
  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  const request = new AuthRequest({
    clientId,
    redirectUri,
    scopes: SPOTIFY_SCOPES,
    responseType: ResponseType.Code,
    usePKCE: true, // AuthRequest generates codeVerifier/codeChallenge (S256).
  });

  const result: AuthSessionResult = await request.promptAsync(DISCOVERY);

  if (result.type !== 'success' || !result.params.code) {
    return null;
  }

  const tokenResponse = await exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      // The verifier the AuthRequest generated for this PKCE flow.
      extraParams: request.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : {},
    },
    DISCOVERY,
  );

  const tokens = toTokens(tokenResponse);
  await tokenStore.save(tokens);
  return tokens;
}

/** Force a refresh using the stored refresh token. Returns the new tokens. */
export async function refreshAccessToken(): Promise<SpotifyTokens> {
  const stored = await tokenStore.load();
  if (!stored?.refreshToken) {
    throw new Error('No Spotify refresh token; call authorize() first.');
  }
  const clientId = getClientId();
  const tokenResponse = await refreshAsync(
    { clientId, refreshToken: stored.refreshToken },
    DISCOVERY,
  );
  const tokens = toTokens(tokenResponse, stored);
  await tokenStore.save(tokens);
  return tokens;
}

/**
 * Return a valid access token, refreshing transparently if the stored one is
 * expired (or within the safety margin). Throws if not connected.
 */
export async function getAccessToken(): Promise<string> {
  const stored = await tokenStore.load();
  if (!stored) {
    throw new Error('Not connected to Spotify; call authorize() first.');
  }
  if (stored.expiresAt - EXPIRY_MARGIN_SEC > nowSec()) {
    return stored.accessToken;
  }
  const refreshed = await refreshAccessToken();
  return refreshed.accessToken;
}

/** True if a token bundle is persisted (the user has connected Spotify). */
export async function isConnected(): Promise<boolean> {
  const stored = await tokenStore.load();
  return stored !== null && !!stored.accessToken;
}

/** Forget all stored Spotify tokens (disconnect). */
export async function disconnect(): Promise<void> {
  await tokenStore.clear();
}
