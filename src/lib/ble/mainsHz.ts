// Power-line frequency for the live mains-hum check, auto-derived from the device
// timezone (no native dependency). The Americas run 60 Hz; the rest of the world
// 50 Hz. Hum is a SECONDARY band input (railing + RMS dominate), so a mis-detect
// only blunts the hum term — it can never break the ring. Set MAINS_HZ_OVERRIDE to
// force a value (e.g. for QA), or wire a settings toggle to it later.

export type MainsHz = 50 | 60;

/** Force a value; null = auto-detect from the timezone. */
export const MAINS_HZ_OVERRIDE: MainsHz | null = null;

const SIXTY_HZ_PREFIXES = ['America/'];
const SIXTY_HZ_ZONES = new Set<string>([
  'Pacific/Honolulu',
  'Pacific/Guam',
  'Pacific/Saipan',
  'Asia/Manila',
  'Asia/Seoul',
]);

/** Pure mapping of an IANA timezone → mains frequency. Defaults to 50 for unknown
 *  / empty (the global majority). */
export function mainsHzFromTimezone(tz: string | null | undefined): MainsHz {
  if (!tz) return 50;
  if (SIXTY_HZ_PREFIXES.some((p) => tz.startsWith(p)) || SIXTY_HZ_ZONES.has(tz)) return 60;
  return 50;
}

/** The device's mains frequency: override if set, else from the timezone, else 50. */
export function detectMainsHz(): MainsHz {
  if (MAINS_HZ_OVERRIDE != null) return MAINS_HZ_OVERRIDE;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return mainsHzFromTimezone(tz);
  } catch {
    return 50;
  }
}
