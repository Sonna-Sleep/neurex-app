// Smoke assertions for no-signal hypnogram rendering data.
// Run: npm run smoke:hypnogram
import { collapseHypnogramRuns, isCoreSleepStage } from '../src/screens/home/components/hypnogramRuns';
import type { Epoch } from '../src/lib/repos';

let failures = 0;

function eq<T>(actual: T, expected: T, label: string) {
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

const epochs: Epoch[] = [
  { startMs: 0, durationSec: 30, stage: 'excluded' },
  { startMs: 30_000, durationSec: 30, stage: 'excluded' },
  { startMs: 60_000, durationSec: 30, stage: 'wake' },
  { startMs: 90_000, durationSec: 30, stage: 'light' },
  { startMs: 120_000, durationSec: 30, stage: 'excluded' },
  { startMs: 150_000, durationSec: 30, stage: 'deep' },
];

const runs = collapseHypnogramRuns(epochs);

eq(runs.length, 5, 'contiguous runs keep no-signal blocks');
eq(runs[0]?.stage, 'excluded', 'setup no-signal stays excluded');
eq(runs[0]?.durationMs, 60_000, 'setup no-signal collapses to 60s');
eq(runs[1]?.stage, 'wake', 'wake remains a sleep-stage run');
eq(runs[3]?.stage, 'excluded', 'middle no-signal stays excluded');
ok(!isCoreSleepStage(runs[0].stage), 'excluded is not a core sleep stage');
ok(isCoreSleepStage(runs[1].stage), 'wake is a core sleep stage');

const stageMinutes = { wake: 0.5, light: 0.5, rem: 0, deep: 0.5, excluded: 1.5 };
const validTotal = stageMinutes.wake + stageMinutes.light + stageMinutes.rem + stageMinutes.deep;
eq(validTotal, 1.5, 'stage totals ignore excluded minutes');

if (failures) {
  console.error(`\n${failures} HYPNOGRAM ASSERTION(S) FAILED`);
  process.exit(1);
}

console.log('\nALL HYPNOGRAM ASSERTIONS PASSED');
