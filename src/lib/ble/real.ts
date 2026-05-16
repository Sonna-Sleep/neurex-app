// Real BleClient implementation that talks to the singleton BleManager
// via getBleManager(). The structure (scan with service UUID, connect,
// pull recording in chunks, return a file:// URI) is App-Store-correct
// and matches Apple's guidance.
//
// CURRENT STATE: methods throw "firmware GATT not ready" because the
// service + characteristic UUIDs in constants.ts are placeholders.
// When Aleksas's firmware ships:
//   1. Replace the PLACEHOLDER_* constants in constants.ts with real UUIDs
//   2. Implement the chunk-pull body of pull() — read characteristic,
//      assemble bytes, write to expo-file-system, return URI
//   3. Swap `bleClient` export in index.ts from stubBleClient to realBleClient
// No other files need to change.

import { getBleManager } from './manager';
import { PLACEHOLDER_SERVICE_UUID } from './constants';
import type {
  BleClient,
  ConnectedDevice,
  FoundDevice,
  PullOptions,
  PulledRecording,
} from './types';

class NotReadyError extends Error {
  constructor(stage: string) {
    super(
      `BLE ${stage} unavailable — firmware GATT spec hasn't shipped. ` +
        'Replace PLACEHOLDER_* constants in src/lib/ble/constants.ts ' +
        'with Aleksas\'s real UUIDs and implement real.ts.',
    );
    this.name = 'NotReadyError';
  }
}

export const realBleClient: BleClient = {
  scan(onFound: (device: FoundDevice) => void): () => void {
    const manager = getBleManager();
    if (!manager) {
      // Expo Go or environment without native BLE — return immediately.
      if (__DEV__) console.warn('[ble/real] scan called with no BleManager');
      return () => {};
    }

    // Service-UUID-scoped scan is REQUIRED by Apple for background BLE;
    // we also use it in the foreground for consistency. The current UUID
    // is a placeholder until firmware ships — the scan will find nothing.
    const subscription = manager.startDeviceScan(
      [PLACEHOLDER_SERVICE_UUID],
      null,
      (error, device) => {
        if (error) {
          if (__DEV__) console.warn('[ble/real] scan error:', error);
          return;
        }
        if (!device) return;
        onFound({
          deviceId: device.id,
          serial: device.name ?? device.localName ?? device.id,
          rssi: device.rssi ?? -127,
        });
      },
    );

    return () => {
      manager.stopDeviceScan();
      // startDeviceScan returns void in v3.x; subscription handle isn't
      // used directly, but the stopDeviceScan call cancels the scan.
      void subscription;
    };
  },

  async connect(deviceId: string): Promise<ConnectedDevice> {
    const manager = getBleManager();
    if (!manager) throw new NotReadyError('connect');

    // autoConnect: true tells iOS to maintain the connection across app
    // suspensions and reconnect when the peripheral comes back in range.
    // Required for the background-wake flow.
    const device = await manager.connectToDevice(deviceId, { autoConnect: true });
    await device.discoverAllServicesAndCharacteristics();

    return {
      deviceId,
      async pull(_opts?: PullOptions): Promise<PulledRecording> {
        throw new NotReadyError('pull');
      },
      async disconnect() {
        await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
      },
    };
  },
};
