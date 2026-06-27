import assert from 'node:assert/strict';

import { deviceSlug, nightLabel, storagePrefix } from '../src/lib/cloud/storagePaths';

// 2026-06-26 01:11 local time
const ms = new Date(2026, 5, 26, 1, 11, 0).getTime();

// ── nightLabel: local YYYY-MM-DD_HHMM ──
assert.equal(nightLabel(ms), '2026-06-26_0111');

// ── deviceSlug: BLE serial -> device folder ──
assert.equal(deviceSlug('Neurex White'), 'white');
assert.equal(deviceSlug('Neurex Yellow'), 'yellow');
assert.equal(deviceSlug('Neurex-EEG-1234'), 'unknown-device'); // unrecognized name
assert.equal(deviceSlug(undefined), 'unknown-device');
assert.equal(deviceSlug(null), 'unknown-device');

// ── storagePrefix: {handle}/{device}/{night} ──
assert.equal(storagePrefix('aleksas', 'Neurex White', ms), 'aleksas/white/2026-06-26_0111');
assert.equal(storagePrefix('goda', undefined, ms), 'goda/unknown-device/2026-06-26_0111');

console.log('PASS smoke-storage-prefix');
