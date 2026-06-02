// Reconnect backoff schedule for the overnight recording watchdog.
// 1-based attempt: 2s, 4s, 8s, 16s, then steady 30s. Indefinite retries
// (until the user stops the session) are correct for an all-night run.

const BASE_MS = 2000;
const CAP_MS = 30000;

export function nextBackoffMs(attempt: number): number {
  const n = attempt < 1 ? 1 : attempt;
  const ms = BASE_MS * 2 ** (n - 1);
  return ms > CAP_MS ? CAP_MS : ms;
}
