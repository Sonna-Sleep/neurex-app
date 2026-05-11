import { BleManager } from 'react-native-ble-plx';

let manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (manager) return manager;
  manager = new BleManager({
    restoreStateIdentifier: 'neurex-ble-restore',
    restoreStateFunction: () => {
      // iOS calls this when relaunching the app after a BLE wake.
      // Real reattach + resume-sync logic lands once the firmware contract is locked.
    },
  });
  return manager;
}
