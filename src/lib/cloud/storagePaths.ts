// Readable storage-path builders. Pure (only depends on the colour map) so they
// are unit-testable without a device — see scripts/smoke-storage-prefix.ts.
//
// Layout (replaces the old {uid}/{date_time_len_id} scheme):
//   {handle}/{device}/{night}   e.g. aleksas/white/2026-06-26_0111
// account = the person's auto-derived handle (server-side, stable),
// device  = the board colour, night = local date_HHMM.

import { colorFromSerial } from './sessionMetadata';

/** Night folder label: local YYYY-MM-DD_HHMM (date + start time disambiguates
 *  multiple recordings in one night). */
export function nightLabel(startMs: number): string {
  const d = new Date(startMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Device folder slug from the BLE serial: "Neurex White" -> "white"; unknown
 *  boards -> "unknown-device". Reuses the colour map the metadata column uses. */
export function deviceSlug(serial?: string | null): string {
  const color = colorFromSerial(serial); // YELLOW/RED/BLUE/GREEN/WHITE/LT or UNKNOWN
  return color === 'UNKNOWN' ? 'unknown-device' : color.toLowerCase();
}

/** Readable storage prefix: {handle}/{device}/{night}. */
export function storagePrefix(handle: string, serial: string | undefined, startMs: number): string {
  return `${handle}/${deviceSlug(serial)}/${nightLabel(startMs)}`;
}
