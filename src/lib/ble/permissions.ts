// Permission + Bluetooth-state checks. The UI uses the returned state to
// branch between "ready to scan" and "show me a 'turn on Bluetooth' screen"
// (silent BLE failures are an App Store rejection trigger — Apple wants
// users informed when a permission is missing).

import { Linking, Platform } from 'react-native';
import type { BleManager } from 'react-native-ble-plx';

export type BleAvailability =
  | { state: 'ready' }
  | { state: 'bluetooth-off' }
  | { state: 'unauthorized' }
  | { state: 'unsupported' }
  | { state: 'unknown' };

/**
 * Maps react-native-ble-plx's BLE state enum into the cases the UI cares
 * about. Returns 'unknown' when the manager is null (no native module,
 * e.g. Expo Go without a development build).
 */
export async function checkBleAvailability(
  manager: BleManager | null,
): Promise<BleAvailability> {
  if (!manager) return { state: 'unknown' };
  const s = await manager.state();
  switch (s) {
    case 'PoweredOn':
      return { state: 'ready' };
    case 'PoweredOff':
      return { state: 'bluetooth-off' };
    case 'Unauthorized':
      return { state: 'unauthorized' };
    case 'Unsupported':
      return { state: 'unsupported' };
    case 'Resetting':
    case 'Unknown':
    default:
      return { state: 'unknown' };
  }
}

/**
 * Deep-link the user to the Settings app so they can grant Bluetooth
 * permission / turn Bluetooth on. On iOS this opens the app's settings
 * panel; on Android the Bluetooth settings page.
 */
export async function openSettingsForBluetooth(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openURL('app-settings:');
  } else {
    await Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS');
  }
}
