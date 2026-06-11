import assert from 'node:assert/strict';

import { classifyResume, DEVICE_REBOOT_GAP_MS } from '../src/lib/ble/packet';

// First packet of a session — no prior baseMs to compare against.
assert.equal(classifyResume(null, 0), 'accept');

// Strictly newer baseMs — the normal forward progression of a session.
assert.equal(classifyResume(1000, 2000), 'accept');

// Equal baseMs is a dup (matches the old `<=` gate).
assert.equal(classifyResume(2000, 2000), 'dup');

// Older but within the reboot threshold — a replayed packet on reconnect.
assert.equal(classifyResume(2000, 1500), 'dup');

// Boundary: a backward jump of EXACTLY 60000 is NOT > 60000 → still a dup.
assert.equal(classifyResume(60_000, 0), 'dup');

// Boundary: a backward jump just over the threshold → reboot.
assert.equal(classifyResume(60_001, 0), 'reboot');

// 8 h uptime then the firmware clock resets to ~0 (brownout/watchdog) → reboot.
assert.equal(classifyResume(28_800_000, 5), 'reboot');

// Sanity-check the exported threshold constant.
assert.equal(DEVICE_REBOOT_GAP_MS, 60_000);

console.log('ALL BLE REBOOT ASSERTIONS PASSED');
