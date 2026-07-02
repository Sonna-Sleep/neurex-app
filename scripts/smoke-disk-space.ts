// Smoke assertions for the pre-flight disk-space guard: before an overnight
// recording starts we estimate the bytes a full night needs and refuse to start
// when there isn't enough free space (so raw capture can't silently halt at 3am
// when the disk fills). Run: npm run smoke:disk-space
//
// Preloads the expo-file-system stub so diskSpace.ts's `import { Paths }` loads
// under plain node — the pure math under test never reads Paths.
import './_expo-fs-stub';
import {
  bytesPerHour,
  estimateNightBytes,
  requiredFreeBytes,
  evaluateDiskSpace,
  InsufficientStorageError,
  NIGHT_HOURS,
  SAFETY_FACTOR,
  MIN_FREE_FLOOR_BYTES,
} from '../src/lib/ble/diskSpace';

let failures = 0;
function eq(actual: number, expected: number, label: string) {
  if (actual === expected) console.log(`ok ${label} = ${actual}`);
  else {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    failures++;
  }
}
function ok(cond: boolean, label: string) {
  if (cond) console.log(`ok ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failures++;
  }
}

const MB = 1024 * 1024;

// ── byte math (derived from the real on-disk format) ───────────────────────
// Pre-connect guard uses the worst-case legacy RAW.BIN size: 40 B/sample at 250 Hz.
// 250 × 40 × 3600 = 36,000,000 B/h.
eq(bytesPerHour(), 36_000_000, '1 recorded hour = 36,000,000 B');
eq(NIGHT_HOURS, 8, 'night sizing uses 8 hours');
eq(estimateNightBytes(8), 288_000_000, '8 h night = 288,000,000 B');
eq(estimateNightBytes(1), 36_000_000, '1 h night = 36,000,000 B');
eq(estimateNightBytes(0), 0, '0 h = 0 B');
eq(estimateNightBytes(-5), 0, 'negative hours guarded to 0');

// ── required headroom: max(estimate × safety factor, floor) ────────────────
eq(SAFETY_FACTOR, 2, 'safety factor is 2×');
eq(MIN_FREE_FLOOR_BYTES, 150 * MB, 'floor is 150 MB');
// 8 h × 2 = 576,000,000 B > the 150 MB floor → estimate×2 wins.
eq(requiredFreeBytes(8), 576_000_000, '8 h requirement = estimate × 2');
// A long night (40 h) also uses estimate×2.
eq(requiredFreeBytes(40), 40 * 36_000_000 * 2, '40 h requirement = estimate × 2');

// ── verdict: blocks when below requirement, allows when above ───────────────
{
  const req = requiredFreeBytes(8);
  ok(evaluateDiskSpace(req, 8).ok === true, 'exactly the requirement is allowed');
  ok(evaluateDiskSpace(req + 1, 8).ok === true, 'just above requirement is allowed');
  ok(evaluateDiskSpace(req - 1, 8).ok === false, 'just below requirement is BLOCKED');
  ok(evaluateDiskSpace(0, 8).ok === false, 'zero free is BLOCKED');
  ok(evaluateDiskSpace(10 * MB, 8).ok === false, '10 MB free is BLOCKED');
  ok(evaluateDiskSpace(2 * 1024 * MB, 8).ok === true, '2 GB free is allowed');
}

// ── unreadable free space must NOT block (flaky API ≠ blocked recording) ────
ok(evaluateDiskSpace(Number.POSITIVE_INFINITY).ok === true, 'Infinity free → allowed (unreadable)');
ok(evaluateDiskSpace(NaN).ok === true, 'NaN free → allowed (unreadable)');
ok(evaluateDiskSpace(-1).ok === true, 'negative free → allowed (unreadable)');

// verdict carries the numbers the UI / error message use
{
  const v = evaluateDiskSpace(5 * MB, 8);
  eq(v.freeBytes, 5 * MB, 'verdict reports freeBytes');
  eq(v.requiredBytes, 576_000_000, 'verdict reports requiredBytes');
}

// ── the user-facing error names the shortfall ──────────────────────────────
{
  const err = new InsufficientStorageError(40 * MB, 150 * MB);
  ok(err instanceof Error, 'InsufficientStorageError is an Error');
  ok(err.name === 'InsufficientStorageError', 'error name set');
  ok(err.freeBytes === 40 * MB, 'error keeps freeBytes');
  ok(err.requiredBytes === 150 * MB, 'error keeps requiredBytes');
  ok(/40 MB free/.test(err.message), 'message states free MB');
  ok(/150 MB/.test(err.message), 'message states required MB');
}

if (failures) {
  console.error(`\n${failures} DISK-SPACE ASSERTION(S) FAILED`);
  process.exit(1);
}
console.log('\nALL DISK-SPACE ASSERTIONS PASSED');
