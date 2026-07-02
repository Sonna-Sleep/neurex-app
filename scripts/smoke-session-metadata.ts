import assert from 'node:assert/strict';

import type { DeviceScaleInfo } from '../src/lib/ble/scale';
import {
  buildSessionMetadata,
  colorFromSerial,
  isTesterLogComplete,
} from '../src/lib/cloud/sessionMetadata';

// ── colorFromSerial: "Neurex Yellow" -> "YELLOW" ──
assert.equal(colorFromSerial('Neurex Yellow'), 'YELLOW');
assert.equal(colorFromSerial('Neurex-EEG-AB12'), 'UNKNOWN'); // unrecognized fallback name
assert.equal(colorFromSerial(null), 'UNKNOWN');
assert.equal(colorFromSerial('something else'), 'UNKNOWN');
assert.equal(colorFromSerial('neurex blue'), 'BLUE'); // case-insensitive

// ── buildSessionMetadata: device + scale + app version + tester log ──
const scale: DeviceScaleInfo = {
  schemaVer: 2,
  pgaGain: 1,
  adcBits: 24,
  vrefV: 4.5,
  uvPerLsb: 0.536,
  sampleRateHz: 250,
  nChannels: 4,
  fp1Index: 0,
  fwBuildId: 0xa1b2c3d4,
  variantKnown: 1,
  channelRole: [1, 2, 3, 4, 0, 0, 0, 0],
};

const m = buildSessionMetadata({
  deviceId: 'DID-1',
  serial: 'Neurex Green',
  scale,
  testerLog: {
    electrodeType: 'dry AgAgCl v4',
    electrodeBatch: 'b#12',
    montage: 'Fpz-A1',
    referenceSite: 'A1',
    tester: 'alex',
  },
});

assert.equal(m.device_id, 'DID-1');
assert.equal(m.device_color, 'GREEN');
assert.equal(m.firmware_build_id, 'a1b2c3d4'); // uint32 -> hex
assert.equal(m.uv_per_lsb, 0.536);
assert.equal(m.pga_gain, 1);
assert.equal(m.vref_v, 4.5);
assert.equal(m.adc_bits, 24);
assert.equal(m.sample_rate_hz, 250);
assert.equal(m.channel_count, 4);
assert.equal(m.fp1_index, 0);
assert.equal(m.variant_known, true); // 1 -> true (boolean column)
assert.equal(typeof m.app_version, 'string'); // from app.json
assert.equal(m.electrode_type, 'dry AgAgCl v4');
assert.equal(m.electrode_batch, 'b#12');
assert.equal(m.montage, 'Fpz-A1');
assert.equal(m.reference_site, 'A1');
assert.equal(m.tester, 'alex');

// No scale -> still emits device + app version, no scale fields. The BLE
// recording path requires scale before this finalization metadata is built.
const mNoScale = buildSessionMetadata({ deviceId: 'x', serial: 'Neurex Yellow' });
assert.equal(mNoScale.device_color, 'YELLOW');
assert.equal('uv_per_lsb' in mNoScale, false);

// Blank tester-log fields are omitted (so metadata_status sees them as missing)
const mBlank = buildSessionMetadata({ deviceId: 'x', serial: 'Neurex Yellow', testerLog: { tester: '   ' } });
assert.equal('tester' in mBlank, false);

// ── isTesterLogComplete: all required tester fields non-blank ──
assert.equal(isTesterLogComplete(null), false);
assert.equal(isTesterLogComplete({}), false);
assert.equal(
  isTesterLogComplete({
    electrodeType: 'dry',
    electrodeBatch: 'b#1',
    montage: 'Fpz-A1',
    referenceSite: 'A1',
    tester: 'alex',
  }),
  true,
);
// notes + biasSite are optional → still complete without them
assert.equal(
  isTesterLogComplete({
    electrodeType: 'dry',
    electrodeBatch: 'b#1',
    montage: 'Fpz-A1',
    referenceSite: 'A1',
    tester: 'alex',
    notes: '',
  }),
  true,
);
// one required field blank → incomplete
assert.equal(
  isTesterLogComplete({
    electrodeType: 'dry',
    electrodeBatch: 'b#1',
    montage: 'Fpz-A1',
    referenceSite: 'A1',
    tester: '  ',
  }),
  false,
);

console.log('ALL SESSION METADATA ASSERTIONS PASSED');
