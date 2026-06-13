// Public entry for the BLE module.
//
// Importing `getBleManager` constructs the singleton BleManager
// at module load time — this MUST happen before React mounts so iOS
// state restoration works when the OS cold-starts the app in the
// background. Apps that defer manager construction to a useEffect / hook
// miss the restoration callback entirely.

import { getBleManager } from './manager';
import { realBleClient } from './real';
import { stubBleClient } from './stub';
import { ALLOW_DEV_BYPASS } from '../config';
import type { BleClient } from './types';

export * from './types';
export { stubBleClient } from './stub';
export { realBleClient } from './real';
export { checkBleAvailability, openSettingsForBluetooth } from './permissions';
export type { BleAvailability } from './permissions';

const manager = getBleManager();

const unavailableBleClient: BleClient = {
  scan() {
    return () => {};
  },
  async connect() {
    throw new Error('Bluetooth module unavailable in this app build.');
  },
};

// Pick real on dev-client / production builds (native module loaded). The stub
// is allowed only in dev/test-bypass builds; production must fail closed instead
// of silently generating synthetic EEG if the native BLE module is missing.
export const isBleStubMode = !manager && ALLOW_DEV_BYPASS;
export const bleClient = manager ? realBleClient : isBleStubMode ? stubBleClient : unavailableBleClient;
