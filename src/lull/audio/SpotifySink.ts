/**
 * Spotify Web API audio sink.
 *
 * Controls the user's **active** Spotify device (the soundscape plays in the
 * Spotify app; our app only sends control calls, so it needs no audio
 * background mode of its own). Implements the {@link AudioSink} contract the
 * Lull engine drives.
 *
 * - `setVolume(v01)` -> `PUT /v1/me/player/volume?volume_percent=round(v01*100)`,
 *   throttled to ~1 call / 1.5 s (leading edge fires immediately; a trailing
 *   flush guarantees the final volume lands). Volume control requires Premium.
 * - `mute()` -> `PUT /v1/me/player/pause`. `stop()` is an alias for `mute()`.
 *
 * Error handling (calls never throw on expected playback errors):
 * - 401 -> refresh the token once and retry the same request.
 * - 403 (`VOLUME_CONTROL_DISALLOWED`) -> the active device forbids remote
 *   volume control (common on phones/desktop). Set `volumeDisallowed` and
 *   stop sending volume calls; the engine should fall back to pause-at-onset.
 * - 404 -> no active Spotify device. Set `noActiveDevice` and no-op.
 *
 * @see https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback
 */
import type { AudioSink } from './AudioSink';
import { getAccessToken, refreshAccessToken } from './spotifyAuth';

const API_BASE = 'https://api.spotify.com/v1';
const THROTTLE_MS = 1500;

/** Minimal token accessor seam so tests can inject a fake. */
export interface SpotifyAuthProvider {
  getAccessToken(): Promise<string>;
  refreshAccessToken(): Promise<{ accessToken: string }>;
}

const defaultAuth: SpotifyAuthProvider = {
  getAccessToken,
  refreshAccessToken,
};

export interface SpotifySinkOptions {
  /** Override the throttle window (ms). Defaults to 1500. */
  throttleMs?: number;
  /** Inject a custom auth provider (used by tests). */
  auth?: SpotifyAuthProvider;
  /** Optional callback when a state flag flips (for UI hints). */
  onStateChange?: (state: SpotifySinkState) => void;
}

export interface SpotifySinkState {
  /** Device returned 403 VOLUME_CONTROL_DISALLOWED — volume calls suppressed. */
  volumeDisallowed: boolean;
  /** No active Spotify device (404). */
  noActiveDevice: boolean;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class SpotifySink implements AudioSink {
  private readonly throttleMs: number;
  private readonly auth: SpotifyAuthProvider;
  private readonly onStateChange?: (state: SpotifySinkState) => void;

  // Throttle state.
  private lastSentAt = 0;
  private pendingVolume: number | null = null;
  private trailingTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  // Surfaced flags.
  volumeDisallowed = false;
  noActiveDevice = false;

  constructor(opts: SpotifySinkOptions = {}) {
    this.throttleMs = opts.throttleMs ?? THROTTLE_MS;
    this.auth = opts.auth ?? defaultAuth;
    this.onStateChange = opts.onStateChange;
  }

  get state(): SpotifySinkState {
    return {
      volumeDisallowed: this.volumeDisallowed,
      noActiveDevice: this.noActiveDevice,
    };
  }

  private emitState(): void {
    this.onStateChange?.(this.state);
  }

  /**
   * Set the active device's volume. Throttled: the first call in a window
   * fires immediately; subsequent calls within `throttleMs` are coalesced and
   * the most-recent value is flushed when the window elapses.
   */
  async setVolume(v01: number): Promise<void> {
    if (this.volumeDisallowed) return; // device refused volume control already.

    const target = clamp01(v01);
    const elapsed = Date.now() - this.lastSentAt;

    if (elapsed >= this.throttleMs) {
      // Leading edge — send right away.
      await this.sendVolume(target);
      return;
    }

    // Within the throttle window: remember the latest target and schedule a
    // single trailing flush so the final value still lands.
    this.pendingVolume = target;
    if (this.trailingTimer === null) {
      const wait = Math.max(0, this.throttleMs - elapsed);
      this.trailingTimer = setTimeout(() => {
        this.trailingTimer = null;
        const v = this.pendingVolume;
        this.pendingVolume = null;
        if (v !== null) void this.sendVolume(v);
      }, wait);
    }
  }

  private async sendVolume(target: number): Promise<void> {
    this.lastSentAt = Date.now();
    const pct = Math.round(target * 100);
    await this.request('PUT', `/me/player/volume?volume_percent=${pct}`);
  }

  /** Pause playback (silence without tearing down the Spotify session). */
  async mute(): Promise<void> {
    // Cancel any pending volume flush — pausing supersedes it.
    if (this.trailingTimer !== null) {
      clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
      this.pendingVolume = null;
    }
    await this.request('PUT', '/me/player/pause');
  }

  /** Stop = pause (Spotify keeps the session; we just silence it). */
  async stop(): Promise<void> {
    await this.mute();
  }

  /**
   * Issue an authenticated Spotify Web API call. Handles 401 (refresh once),
   * 403 VOLUME_CONTROL_DISALLOWED, and 404 no-active-device without throwing.
   */
  private async request(
    method: string,
    path: string,
    retryOn401 = true,
  ): Promise<void> {
    let token: string;
    try {
      token = await this.auth.getAccessToken();
    } catch {
      // Not connected — nothing to do; let the engine handle auth via the UI.
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // Network error — drop this control call silently (next tick retries).
      return;
    }

    if (res.ok || res.status === 204) {
      // A successful call clears the no-device flag (a device is active again).
      if (this.noActiveDevice) {
        this.noActiveDevice = false;
        this.emitState();
      }
      return;
    }

    if (res.status === 401 && retryOn401) {
      try {
        await this.auth.refreshAccessToken();
      } catch {
        return;
      }
      await this.request(method, path, false); // retry once with fresh token.
      return;
    }

    if (res.status === 403) {
      // VOLUME_CONTROL_DISALLOWED (or another forbidden control). Stop trying
      // to drive volume; the engine falls back to pause-at-onset.
      if (!this.volumeDisallowed) {
        this.volumeDisallowed = true;
        this.emitState();
      }
      return;
    }

    if (res.status === 404) {
      // No active device — no-op and flag it.
      if (!this.noActiveDevice) {
        this.noActiveDevice = true;
        this.emitState();
      }
      return;
    }

    // 429 (rate-limited) and anything else: swallow — control calls are
    // best-effort and the next window will retry.
  }
}
