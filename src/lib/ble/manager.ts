// Singleton BleManager. Created at module-load time so the instance
// exists BEFORE React mounts — necessary for iOS state preservation:
// when the OS cold-starts the app in the background after a peripheral
// advertises, the JS runtime initializes, modules are loaded, and the
// BleManager construction MUST happen before the restoration callback
// can fire.
//
// `react-native-ble-plx` is a native module that is unavailable in Expo Go
// (which doesn't bundle the native code). Construction is wrapped in
// try/catch so the Expo Go flow degrades to `manager = null` and the
// rest of the app still loads. EAS development builds get the real
// BleManager.

import { onIosStateRestored } from './wakeHandler';
import { NEUREX_BLE_RESTORE_IDENTIFIER } from './constants';

type Manager = import('react-native-ble-plx').BleManager;
type RestoredState = import('react-native-ble-plx').BleRestoredState;

let manager: Manager | null = null;

try {
  // Lazy require so Expo Go (no native module) doesn't crash at import time.
  // The require throws if the native side isn't linked; we swallow and
  // leave manager null. Callers must tolerate null.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BleManager } = require('react-native-ble-plx');
  manager = new BleManager({
    restoreStateIdentifier: NEUREX_BLE_RESTORE_IDENTIFIER,
    restoreStateFunction: (restoredState: RestoredState | null) => {
      // iOS invoked us in the background because a previously-connected
      // peripheral advertised. Hand off to the wake handler — keep this
      // function tiny because iOS gives us only a few hundred ms here
      // before judging whether the app is well-behaved.
      onIosStateRestored(restoredState);
    },
  });
} catch (e) {
  // Expected on Expo Go. In a dev build this would mean a build issue.
  if (__DEV__) {
    console.warn(
      '[ble/manager] BleManager not constructed — likely Expo Go ' +
        '(no native module). The app will run in stub mode.',
      e,
    );
  }
}

/**
 * Returns the singleton BleManager, or null when running in an environment
 * that doesn't include the native module (Expo Go). Callers MUST handle the
 * null case — typically by falling back to the stub BleClient.
 */
export function getBleManager(): Manager | null {
  return manager;
}
