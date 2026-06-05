// Public entry for the BLE module.
//
// Side-effect import of `./manager` constructs the singleton BleManager
// at module load time — this MUST happen before React mounts so iOS
// state restoration works when the OS cold-starts the app in the
// background. Apps that defer manager construction to a useEffect / hook
// miss the restoration callback entirely.

import './manager';
import { getBleManager } from './manager';
import { realBleClient } from './real';
import { stubBleClient } from './stub';

export * from './types';
export { stubBleClient } from './stub';
export { realBleClient } from './real';
export { checkBleAvailability, openSettingsForBluetooth } from './permissions';
export type { BleAvailability } from './permissions';

// Pick real on dev-client / production builds (native module loaded);
// fall back to the stub on Expo Go + web (no native BleManager). The
// stub still writes real EEG.BIN/EOG.BIN to documentDirectory so the
// upload + Supabase path is exercisable without hardware.
export const bleClient = getBleManager() ? realBleClient : stubBleClient;
