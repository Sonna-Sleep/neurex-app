/**
 * Unit tests for {@link SpotifySink} with a mocked `fetch` and injected auth.
 *
 * These are pure unit tests (no React Native / native modules): the sink's
 * auth provider is injected, and `global.fetch` is stubbed, so the test runs
 * under plain ts-jest with no Expo runtime.
 */
import { SpotifySink, type SpotifyAuthProvider } from '../SpotifySink';

// Mock the auth module so SpotifySink's static import of it does NOT pull in
// expo-auth-session / expo-constants / expo-secure-store (native modules that
// can't load under plain ts-jest). `jest.mock` is hoisted above the import by
// the transform, so the mock is in place before SpotifySink loads. The sink
// uses an injected auth provider in these tests; this mock just needs to be
// importable.
jest.mock('../spotifyAuth', () => ({
  getAccessToken: jest.fn(async () => 'default-token'),
  refreshAccessToken: jest.fn(async () => ({ accessToken: 'default-token-2' })),
}));

const fakeAuth: SpotifyAuthProvider = {
  getAccessToken: jest.fn(async () => 'access-token-abc'),
  refreshAccessToken: jest.fn(async () => ({ accessToken: 'access-token-xyz' })),
};

function okResponse(status = 204): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}
function errResponse(status: number): Response {
  return { ok: false, status } as Response;
}

function lastFetchUrl(mock: jest.Mock): string {
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as string;
}
function lastFetchMethod(mock: jest.Mock): string {
  const calls = mock.mock.calls;
  return (calls[calls.length - 1][1] as RequestInit).method as string;
}

describe('SpotifySink', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => okResponse(204));
    // @ts-expect-error - install the fetch mock on the global.
    global.fetch = fetchMock;
    jest.clearAllMocks();
    (fakeAuth.getAccessToken as jest.Mock).mockResolvedValue('access-token-abc');
    (fakeAuth.refreshAccessToken as jest.Mock).mockResolvedValue({
      accessToken: 'access-token-xyz',
    });
  });

  it('setVolume(0.5) sends volume_percent=50 via PUT with a Bearer token', async () => {
    const sink = new SpotifySink({ auth: fakeAuth });
    await sink.setVolume(0.5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.spotify.com/v1/me/player/volume?volume_percent=50',
    );
    expect((init as RequestInit).method).toBe('PUT');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer access-token-abc',
    });
  });

  it('rounds volume to the nearest percent', async () => {
    const sink = new SpotifySink({ auth: fakeAuth });
    await sink.setVolume(0.237); // -> 24
    expect(lastFetchUrl(fetchMock)).toContain('volume_percent=24');
  });

  it('clamps out-of-range volumes to [0,100]', async () => {
    const sink = new SpotifySink({ auth: fakeAuth, throttleMs: 0 });
    await sink.setVolume(1.7);
    expect(lastFetchUrl(fetchMock)).toContain('volume_percent=100');
    await sink.setVolume(-0.4);
    expect(lastFetchUrl(fetchMock)).toContain('volume_percent=0');
  });

  it('throttles rapid setVolume calls to far fewer than the call count', async () => {
    jest.useFakeTimers();
    const sink = new SpotifySink({ auth: fakeAuth, throttleMs: 1500 });

    // 10 rapid calls within the same throttle window.
    for (let i = 0; i < 10; i++) {
      await sink.setVolume(i / 10);
    }
    // Only the leading-edge call should have fired so far.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastFetchUrl(fetchMock)).toContain('volume_percent=0'); // first value

    // Advance past the throttle window to flush the trailing (latest) value.
    await jest.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastFetchUrl(fetchMock)).toContain('volume_percent=90'); // last value (0.9)

    jest.useRealTimers();
  });

  it('mute() calls PUT /me/player/pause', async () => {
    const sink = new SpotifySink({ auth: fakeAuth });
    await sink.mute();
    expect(lastFetchUrl(fetchMock)).toBe('https://api.spotify.com/v1/me/player/pause');
    expect(lastFetchMethod(fetchMock)).toBe('PUT');
  });

  it('stop() also pauses (alias for mute)', async () => {
    const sink = new SpotifySink({ auth: fakeAuth });
    await sink.stop();
    expect(lastFetchUrl(fetchMock)).toBe('https://api.spotify.com/v1/me/player/pause');
  });

  it('403 (VOLUME_CONTROL_DISALLOWED) does not throw and sets the disallowed flag', async () => {
    fetchMock.mockResolvedValue(errResponse(403));
    const sink = new SpotifySink({ auth: fakeAuth });

    await expect(sink.setVolume(0.5)).resolves.toBeUndefined();
    expect(sink.volumeDisallowed).toBe(true);

    // Once disallowed, further volume calls are suppressed (no new fetch).
    const callsAfterFirst = fetchMock.mock.calls.length;
    await sink.setVolume(0.2);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('404 (no active device) does not throw and sets the noActiveDevice flag', async () => {
    fetchMock.mockResolvedValue(errResponse(404));
    const sink = new SpotifySink({ auth: fakeAuth });
    await expect(sink.setVolume(0.5)).resolves.toBeUndefined();
    expect(sink.noActiveDevice).toBe(true);
  });

  it('401 refreshes the token once and retries the request', async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(401)) // first call: unauthorized
      .mockResolvedValueOnce(okResponse(204)); // retry: success
    const sink = new SpotifySink({ auth: fakeAuth });

    await sink.setVolume(0.5);

    expect(fakeAuth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sink.volumeDisallowed).toBe(false);
    expect(sink.noActiveDevice).toBe(false);
  });

  it('emits a state change when a flag flips', async () => {
    fetchMock.mockResolvedValue(errResponse(403));
    const onStateChange = jest.fn();
    const sink = new SpotifySink({ auth: fakeAuth, onStateChange });
    await sink.setVolume(0.5);
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ volumeDisallowed: true }),
    );
  });
});
