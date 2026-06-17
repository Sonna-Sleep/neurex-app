// Global upload mutex with a stuck-holder timeout — NO Expo/RN imports, so it's
// unit-testable in plain Node (scripts/smoke-upload-lock.ts), exactly like
// backoff.ts / connectTimeout.ts / recoveryMath.ts. cloudSync.ts consumes it to
// serialize segment-upload loops.
//
// Why a timeout: the lock chains each upload behind the previous one's promise.
// If one transmission STALLS forever (network black hole, a never-resolving
// native call), the tail promise never settles and EVERY future upload queues
// behind it permanently — one wedged night silently blocks all future syncs.
// Bounding the WAIT on the predecessor fixes that: a queued upload abandons a
// stuck predecessor after the timeout, bumps a surfaced counter, and proceeds.

// How long a queued upload waits on the one ahead of it before giving up on it.
// A full night is ~115 EEG segments and a slow mobile uplink legitimately takes
// minutes, so this is generous — it only trips on a genuinely STUCK transmission,
// not a slow-but-live one.
export const UPLOAD_LOCK_TIMEOUT_MS = 10 * 60_000; // 10 minutes

// Count of times a queued upload had to abandon a stuck predecessor to proceed.
// Surfaced (never silent) via uploadLockStats() so a wedged-upload night shows up
// instead of silently serializing forever. Mirrors the "every dropped/forced
// event increments a visible counter" rule used by the stream watchdog.
let uploadLockTimeouts = 0;

export function uploadLockStats(): { timeouts: number } {
  return { timeouts: uploadLockTimeouts };
}

/** Test-only: reset the surfaced counter so smoke assertions start from zero. */
export function __resetUploadLockStats(): void {
  uploadLockTimeouts = 0;
}

let uploadTail: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` under the global upload mutex: it starts only after the previous
 * caller releases — OR after `timeoutMs` elapses waiting on a stuck predecessor,
 * whichever comes first. On a timeout we bump the surfaced counter, log, and
 * proceed anyway so one hung upload can't permanently starve the queue. Order
 * among HEALTHY uploads is preserved; only a genuinely stuck one is bypassed.
 *
 * The stuck predecessor's own work is NOT cancelled (we can't abort an in-flight
 * native call) — we simply stop WAITING on it so the next upload can run.
 */
export function withUploadLock<T>(
  fn: () => Promise<T>,
  timeoutMs: number = UPLOAD_LOCK_TIMEOUT_MS,
  onTimeout?: (timeouts: number) => void,
): Promise<T> {
  const predecessor = uploadTail;
  // Wait for the predecessor, but never longer than the timeout. This gate never
  // rejects (the predecessor's errors are swallowed) — it resolves true when the
  // predecessor releases, false when we time out on it.
  const gate =
    timeoutMs > 0
      ? new Promise<boolean>((resolve) => {
          let done = false;
          const timer = setTimeout(() => {
            if (done) return;
            done = true;
            uploadLockTimeouts += 1;
            onTimeout?.(uploadLockTimeouts);
            resolve(false);
          }, timeoutMs);
          const settle = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(true);
          };
          predecessor.then(settle, settle);
        })
      : predecessor.then(
          () => true,
          () => true,
        );

  const run = gate.then(fn);
  // The next caller chains on us. catch(() => {}) so our rejection doesn't make
  // the chain reject for everyone after us.
  uploadTail = run.catch(() => {});
  return run;
}
