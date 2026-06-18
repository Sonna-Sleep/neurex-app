// Auto-stop rules: end an overnight recording when the headband turns off or its
// battery dies, instead of reconnecting forever. Pure + unit-testable; the wiring
// (battery subscription + abandon timer + finalize) lives in streamController.
//
// Two triggers:
//   - graceful: battery level (0x2A19) drops to/under BATTERY_STOP_PCT → stop while
//     there's still time to flush the last chunk.
//   - abrupt: the link is lost and can't be re-established for DEVICE_ABANDONED_MS
//     (device powered off / out of range for good) → stop. Long enough that a brief
//     overnight blip still doesn't kill the night.

export const BATTERY_STOP_PCT = 5;
export const DEVICE_ABANDONED_MS = 10 * 60_000; // 10 min unrecoverable → device gone

/** True when a valid battery reading is at/under the cutoff. Unknown/invalid
 *  readings (null / out of 0–100) never trigger a stop. */
export function batteryShouldStop(
  level: number | null | undefined,
  threshold: number = BATTERY_STOP_PCT,
): boolean {
  return typeof level === 'number' && level >= 0 && level <= 100 && level <= threshold;
}

/** True when a reconnect has been failing for at least the abandoned window. */
export function abandonShouldStop(
  lostElapsedMs: number,
  windowMs: number = DEVICE_ABANDONED_MS,
): boolean {
  return lostElapsedMs >= windowMs;
}
