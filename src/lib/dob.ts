// Pure date-of-birth helpers shared by the onboarding DOB input. Kept
// framework-free so the validation + age math can be unit-tested without a
// React renderer — see scripts/smoke-dob.ts.
//
// The age math here matches ageFromDob() in ./profile.ts (month/day aware): a
// year-only subtraction is wrong by up to a year near the birthday and would
// mis-gate a user who turns 13 (or 121) later in the current year.

export const MIN_DOB_AGE = 13;
export const MAX_DOB_AGE = 120;

export type DobParts = { d: string; m: string; y: string };

/** Strip non-digits and cap length — what a numeric DOB segment may contain. */
export function cleanSegment(text: string, maxLen: number): string {
  return text.replace(/\D/g, '').slice(0, maxLen);
}

/** Whole years old on `now` for a Y/M/D, counting the birthday month + day. */
export function ageOn(yy: number, mm: number, dd: number, now: Date): number {
  let age = now.getFullYear() - yy;
  const beforeBirthday =
    now.getMonth() + 1 < mm || (now.getMonth() + 1 === mm && now.getDate() < dd);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Build ISO 'YYYY-MM-DD' iff D/M/Y form a real, in-range, age-valid date. */
export function isoFromParts(
  d: string,
  m: string,
  y: string,
  now: Date = new Date(),
): string | null {
  const dd = Number(d);
  const mm = Number(m);
  const yy = Number(y);
  if (!dd || !mm || !yy || y.length !== 4) return null;
  // Reject impossible dates (e.g. 31 June, 29 Feb on a non-leap year): JS rolls
  // them over, so a mismatch after construction means the input wasn't real.
  const dt = new Date(yy, mm - 1, dd);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) {
    return null;
  }
  const age = ageOn(yy, mm, dd, now);
  if (age < MIN_DOB_AGE || age > MAX_DOB_AGE) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Split an ISO 'YYYY-MM-DD' into editable segments; empty strings when null. */
export function partsFromIso(iso: string | null): DobParts {
  return {
    d: iso ? iso.slice(8, 10) : '',
    m: iso ? iso.slice(5, 7) : '',
    y: iso ? iso.slice(0, 4) : '',
  };
}
