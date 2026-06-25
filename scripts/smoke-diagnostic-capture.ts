import assert from 'node:assert/strict';

import { shouldCaptureRaw } from '../src/lib/ble/diagnosticCapture';

// Explicit 'on'/'off' always win, regardless of the build default.
assert.equal(shouldCaptureRaw('on', false), true);
assert.equal(shouldCaptureRaw('on', true), true);
assert.equal(shouldCaptureRaw('off', true), false);
assert.equal(shouldCaptureRaw('off', false), false);

// 'auto' follows the build default: ON for the internal/dev fleet build, OFF for
// a production build (so prod users don't get ~3.7x raw upload they didn't opt into).
assert.equal(shouldCaptureRaw('auto', true), true);
assert.equal(shouldCaptureRaw('auto', false), false);

console.log('ALL DIAGNOSTIC CAPTURE ASSERTIONS PASSED');
