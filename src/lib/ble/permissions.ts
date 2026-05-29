// Permission + Bluetooth-state checks. The UI uses the returned state to
// branch between "ready to scan" and "show me a 'turn on Bluetooth' screen"
// (silent BLE failures are an App Store rejection trigger — Apple wants
// users informed when a permission is missing).

import { Linking, PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';
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
 * Android 12+ (API 31) requires runtime grants for BLUETOOTH_SCAN and
 * BLUETOOTH_CONNECT. Older Android (≤ 11) needs ACCESS_FINE_LOCATION because
 * BLE scan results can leak location. iOS handles permission prompts inside
 * react-native-ble-plx via the Info.plist strings, so this is a no-op there.
 *
 * Returns true when all required runtime permissions are granted. The caller
 * (Pair screen) should refuse to start scanning when this returns false and
 * surface a "open settings" button via openSettingsForBluetooth().
 */
export async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const apiLevel =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);

  const required: Permission[] =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const granted = await PermissionsAndroid.requestMultiple(required);
  return required.every(
    (p) => granted[p] === PermissionsAndroid.RESULTS.GRANTED,
  );
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
