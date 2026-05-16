// Public entry for the BLE module.
//
// Side-effect import of `./manager` constructs the singleton BleManager
// at module load time — this MUST happen before React mounts so iOS
// state restoration works when the OS cold-starts the app in the
// background. Apps that defer manager construction to a useEffect / hook
// miss the restoration callback entirely.
//
// Today the active `bleClient` export is the stub. When Aleksas's firmware
// GATT service ships, change the export to `realBleClient` — the stub
// stays as a development fallback for Expo Go.
import './manager';
import { stubBleClient } from './stub';

export * from './types';
export { stubBleClient } from './stub';
export { realBleClient } from './real';
export { checkBleAvailability, openSettingsForBluetooth } from './permissions';
export type { BleAvailability } from './permissions';

// The single line that changes when we go from stub to real BLE.
// Keep at the bottom of the file so anyone looking for "the switch"
// finds it immediately.
export const bleClient = stubBleClient;
