// Bounded cloud calls for the phone-side sync path.
//
// React Native fetch/native networking can occasionally leave a promise pending
// forever when the radio path gets wedged. A pending promise is worse than a
// normal failure here: it leaves the UI saying "Syncing" forever and keeps the
// local recording hostage. Timeouts turn that state into a retryable error.

export const CLOUD_REQUEST_TIMEOUT_MS = 45_000;
export const CLOUD_UPLOAD_TIMEOUT_MS = 90_000;

export class CloudTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)}s. Check connection and retry.`);
    this.name = 'CloudTimeoutError';
  }
}

export function withCloudTimeout<T>(
  label: string,
  work: PromiseLike<T>,
  timeoutMs = CLOUD_REQUEST_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(work);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CloudTimeoutError(label, timeoutMs));
    }, timeoutMs);

    Promise.resolve(work).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
