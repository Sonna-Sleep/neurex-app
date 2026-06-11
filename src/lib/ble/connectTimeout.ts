// Pure connect-timeout helper — NO React Native / Expo imports, so it's
// unit-testable in plain Node (scripts/smoke-connect-timeout.ts), exactly like
// backoff.ts / boundedPool.ts. real.ts consumes it for the user-initiated
// connect path.

/** Thrown when a user-initiated connect exceeds its timeout (device off / out of
 * range) so the UI can show an error + retry instead of an infinite spinner. */
export class BleTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Couldn't reach your Neurex device (timed out after ${Math.round(ms / 1000)}s). ` +
        `Make sure it's on and nearby, then try again.`,
    );
    this.name = 'BleTimeoutError';
  }
}

/**
 * Race a promise against a timeout. On timeout, runs `onTimeout` (e.g. cancel
 * the still-pending connection) and rejects with BleTimeoutError. Both handlers
 * are attached to `p`, so a late settlement after the timeout is handled (and
 * ignored) rather than surfacing as an unhandled rejection. A non-positive `ms`
 * means "no timeout" — the original promise is returned untouched.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  if (!(ms > 0)) return p;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      reject(new BleTimeoutError(ms));
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
