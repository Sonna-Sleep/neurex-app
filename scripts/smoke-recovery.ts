// Smoke assertions for crash-recovery timing math (reconstructing a killed
// night's start/end from its byte count + mtime + optional meta.json).
// Run: npm run smoke:recovery
import {
  durationMsFromBytes,
  reconstructTiming,
  EEG_BYTES_PER_SAMPLE,
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

ok(EEG_BYTES_PER_SAMPLE === 8, 'EEG_BYTES_PER_SAMPLE is 8');

// 250 samples × 8 bytes = 2000 bytes = 1 s at 250 Hz.
eq(durationMsFromBytes(2000, 250), 1000, '2000B @250Hz = 1000ms');
eq(durationMsFromBytes(0, 250), 0, '0 bytes = 0ms');
eq(durationMsFromBytes(2000, 0), 0, '0 Hz guarded = 0ms');
eq(durationMsFromBytes(-5, 250), 0, 'negative bytes guarded = 0ms');
// One real hour: 250 Hz × 3600 s × 8 B = 7,200,000 B.
eq(durationMsFromBytes(7_200_000, 250), 3_600_000, '1h of bytes = 3,600,000ms');

// meta.json start present → start is authoritative, end = start + duration.
{
  const { startedAtMs, endMs } = reconstructTiming({
    sizeBytes: 2000,
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
    sizeBytes: 2000,
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
    sizeBytes: 2000,
    sampleRateHz: 250,
    modificationTimeMs: null,
    metaStartedAtMs: null,
    nowMs: 80_000,
  });
  eq(startedAtMs, 79_000, 'no meta/mtime: start = now − duration');
  eq(endMs, 80_000, 'no meta/mtime: end = now');
}

if (failures) {
  console.error(`\n${failures} RECOVERY ASSERTION(S) FAILED`);
  process.exit(1);
}
console.log('\nALL RECOVERY ASSERTIONS PASSED');
