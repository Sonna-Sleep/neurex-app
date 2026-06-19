import assert from 'node:assert/strict';

import {
  abandonShouldStop,
  batteryShouldStop,
  BATTERY_STOP_PCT,
  DEVICE_ABANDONED_MS,
} from '../src/lib/ble/autoStop';

// battery: at/under cutoff stops; unknown/invalid never stops
assert.equal(batteryShouldStop(5), true);
assert.equal(batteryShouldStop(4), true);
assert.equal(batteryShouldStop(0), true);
assert.equal(batteryShouldStop(6), false);
assert.equal(batteryShouldStop(50), false);
assert.equal(batteryShouldStop(null), false);
assert.equal(batteryShouldStop(undefined), false);
assert.equal(batteryShouldStop(101), false, 'invalid high reading never stops');
assert.equal(batteryShouldStop(-1), false, 'invalid low reading never stops');
assert.equal(batteryShouldStop(10, 15), true, 'custom threshold');
assert.equal(BATTERY_STOP_PCT, 5);

// abandon: only after the window elapses
assert.equal(abandonShouldStop(DEVICE_ABANDONED_MS), true);
assert.equal(abandonShouldStop(DEVICE_ABANDONED_MS + 1), true);
assert.equal(abandonShouldStop(DEVICE_ABANDONED_MS - 1), false);
assert.equal(abandonShouldStop(0), false);
assert.equal(abandonShouldStop(5_000, 2_000), true, 'custom window');
assert.equal(DEVICE_ABANDONED_MS, 30_000, '30s reconnect grace before auto-stop');

console.log('ALL AUTO-STOP ASSERTIONS PASSED');
