// Public entry for the BLE module.
//
// Importing `getBleManager` constructs the singleton BleManager
// at module load time — this MUST happen before React mounts so iOS
// state restoration works when the OS cold-starts the app in the
// background. Apps that defer manager construction to a useEffect / hook
// miss the restoration callback entirely.

import { getBleManager } from './manager';
import { realBleClient } from './real';
import type { BleClient } from './types';

export * from './types';
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

// Pick the real BLE client only. If the native module is missing, fail closed
// instead of generating synthetic EEG or showing a fake device.
export const bleClient = manager ? realBleClient : unavailableBleClient;
