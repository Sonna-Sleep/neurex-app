import assert from 'node:assert/strict';

import {
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_STALL_TICKS,
  freshWatchdogState,
  stallTick,
} from '../src/lib/ble/watchdog';

// Constants are sane.
assert.equal(WATCHDOG_INTERVAL_MS, 10_000);
assert.equal(WATCHDOG_STALL_TICKS, 2);

// Fresh state has no baseline.
assert.deepEqual(freshWatchdogState(), { lastPackets: -1, frozenTicks: 0 });

// First connected tick only records a baseline; never fires.
let t = stallTick(freshWatchdogState(), 100, false);
assert.equal(t.forceReconnect, false);
assert.deepEqual(t.state, { lastPackets: 100, frozenTicks: 0 });

// Packets progressing → frozenTicks stays 0, never fires.
t = stallTick(t.state, 200, false);
assert.equal(t.forceReconnect, false);
assert.deepEqual(t.state, { lastPackets: 200, frozenTicks: 0 });

// Stall: two consecutive frozen ticks → forceReconnect, baseline reset.
t = stallTick({ lastPackets: 200, frozenTicks: 0 }, 200, false); // frozen #1
assert.equal(t.forceReconnect, false);
assert.deepEqual(t.state, { lastPackets: 200, frozenTicks: 1 });
t = stallTick(t.state, 200, false); // frozen #2 → fire
assert.equal(t.forceReconnect, true);
assert.deepEqual(t.state, { lastPackets: -1, frozenTicks: 0 });

// After firing, the reset baseline must NOT immediately re-fire.
t = stallTick({ lastPackets: -1, frozenTicks: 0 }, 200, false);
assert.equal(t.forceReconnect, false);
assert.deepEqual(t.state, { lastPackets: 200, frozenTicks: 0 });

// While reconnecting: never a stall; baseline resets so the fresh link gets a
// full grace period before it can be judged frozen.
t = stallTick({ lastPackets: 200, frozenTicks: 1 }, 200, true);
assert.equal(t.forceReconnect, false);
assert.deepEqual(t.state, { lastPackets: -1, frozenTicks: 0 });

// A packet-count DROP across a reconnect (5000 → 0, fresh stats object) counts
// as progress, not a stall.
t = stallTick({ lastPackets: 5000, frozenTicks: 1 }, 0, false);
assert.equal(t.forceReconnect, false);
assert.deepEqual(t.state, { lastPackets: 0, frozenTicks: 0 });

console.log('ALL BLE WATCHDOG ASSERTIONS PASSED');
