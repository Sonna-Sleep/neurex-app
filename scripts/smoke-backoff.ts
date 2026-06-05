// Smoke assertions for the reconnect backoff schedule. Run: npm run smoke:backoff
import { nextBackoffMs } from '../src/lib/ble/backoff';

function assertEq(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`ok ${label} = ${actual}`);
}

// attempt is 1-based: 1st retry waits 2s, doubling, capped at 30s.
assertEq(nextBackoffMs(1), 2000, 'attempt 1');
assertEq(nextBackoffMs(2), 4000, 'attempt 2');
assertEq(nextBackoffMs(3), 8000, 'attempt 3');
assertEq(nextBackoffMs(4), 16000, 'attempt 4');
assertEq(nextBackoffMs(5), 30000, 'attempt 5 capped');
assertEq(nextBackoffMs(99), 30000, 'attempt 99 capped');
assertEq(nextBackoffMs(0), 2000, 'attempt 0 floored to first');

console.log('ALL BACKOFF ASSERTIONS PASSED');
