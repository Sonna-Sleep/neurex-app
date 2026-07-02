// Smoke assertions for crash-recovery timing math (reconstructing a killed
// night's start/end from its byte count + mtime + optional meta.json).
// Run: npm run smoke:recovery
import {
  durationMsFromBytes,
  reconstructTiming,
  isStageableDurationMs,
  MIN_STAGING_MIN,
  MIN_STAGING_SEC,
  RECOVERY_RESTORE_GRACE_MS,
  RAW_BYTES_PER_SAMPLE,
  RAW_HEADER_BYTES,
} from '../src/lib/cloud/recoveryMath';

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

ok(RAW_HEADER_BYTES === 16, 'RAW_HEADER_BYTES is 16');
ok(RAW_BYTES_PER_SAMPLE === 40, 'RAW_BYTES_PER_SAMPLE is 40');

// 16-byte header + 250 samples × 40 bytes = 1 s at 250 Hz.
eq(durationMsFromBytes(10_016, 250), 1000, '10016B @250Hz = 1000ms');
eq(durationMsFromBytes(0, 250), 0, '0 bytes = 0ms');
eq(durationMsFromBytes(10_016, 0), 0, '0 Hz guarded = 0ms');
eq(durationMsFromBytes(-5, 250), 0, 'negative bytes guarded = 0ms');
// One real hour: 16-byte header + 250 Hz × 3600 s × 40 B.
eq(durationMsFromBytes(36_000_016, 250), 3_600_000, '1h of bytes = 3,600,000ms');

// meta.json start present → start is authoritative, end = start + duration.
{
  const { startedAtMs, endMs } = reconstructTiming({
    sizeBytes: 10_016,
    sampleRateHz: 250,
    modificationTimeMs: 9_999_999,
    metaStartedAtMs: 1000,
    nowMs: 5_000_000,
  });
  eq(startedAtMs, 1000, 'meta start used (authoritative)');
  eq(endMs, 2000, 'end = metaStart + duration');
}

// No meta, mtime present → start = mtime − duration, end = mtime.
{
  const { startedAtMs, endMs } = reconstructTiming({
    sizeBytes: 10_016,
    sampleRateHz: 250,
    modificationTimeMs: 50_000,
    metaStartedAtMs: null,
    nowMs: 0,
  });
  eq(startedAtMs, 49_000, 'no meta: start = mtime − duration');
  eq(endMs, 50_000, 'no meta: end = mtime');
}

// No meta, no mtime → fall back to nowMs as the end reference.
{
  const { startedAtMs, endMs } = reconstructTiming({
    sizeBytes: 10_016,
    sampleRateHz: 250,
    modificationTimeMs: null,
    metaStartedAtMs: null,
    nowMs: 80_000,
  });
  eq(startedAtMs, 79_000, 'no meta/mtime: start = now − duration');
  eq(endMs, 80_000, 'no meta/mtime: end = now');
}

// ── staging-length floor (shared with the live RecordingCard sync gate) ─────
eq(MIN_STAGING_MIN, 10, 'MIN_STAGING_MIN is 10 minutes');
eq(MIN_STAGING_SEC, 600, 'MIN_STAGING_SEC is 10 minutes');
eq(RECOVERY_RESTORE_GRACE_MS, 30_000, 'restore grace is 30s');
ok(isStageableDurationMs(600_000) === true, 'exactly 10 min is stageable');
ok(isStageableDurationMs(599_999) === false, 'just under 10 min is NOT stageable');
ok(isStageableDurationMs(0) === false, 'zero-length is NOT stageable');
ok(isStageableDurationMs(3_600_000) === true, '1 h is stageable');
// A 1-second orphan must be skipped by recovery.
ok(isStageableDurationMs(durationMsFromBytes(10_016, 250)) === false, '1 s orphan skipped');
// A 10-minute recording is recovered.
ok(isStageableDurationMs(durationMsFromBytes(6_000_016, 250)) === true, '10 min orphan recovered');

if (failures) {
  console.error(`\n${failures} RECOVERY ASSERTION(S) FAILED`);
  process.exit(1);
}
console.log('\nALL RECOVERY ASSERTIONS PASSED');
