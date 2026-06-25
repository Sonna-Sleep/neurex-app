// Capture-gate decision for the diagnostic raw-bit stream.
//
// The app cannot read the device MAC on iOS, so a "fleet MAC allowlist" isn't
// reliable; instead the BUILD TYPE is the fleet-vs-prod discriminator (internal
// fleet builds set DIAGNOSTIC_CAPTURE_DEFAULT on). The per-user setting overrides:
//   'on'   → always capture
//   'off'  → never capture
//   'auto' → follow the build default (fleet on, prod off)
//
// Pure (no store import) so it's unit-testable in plain node. The caller (real.ts'
// startStream) reads the persisted setting from the diagnostics store and passes it.

import type { DiagnosticCaptureSetting } from '../../state/diagnostics';
import { DIAGNOSTIC_CAPTURE_DEFAULT } from '../config';

export function shouldCaptureRaw(
  setting: DiagnosticCaptureSetting,
  buildDefault: boolean = DIAGNOSTIC_CAPTURE_DEFAULT,
): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return buildDefault;
}
