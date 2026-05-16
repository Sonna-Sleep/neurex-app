// Fake BLE implementation. Used by the Pair screen + future BLE-driven
// flows until Aleksas's firmware GATT service is implemented and a real
// BleClient ships under the same interface.

import type { BleClient, ConnectedDevice, FoundDevice } from './types';

const FAKE_DEVICE: FoundDevice = {
  deviceId: 'fake-deviceid-NRX-ABC123',
  serial: 'NRX-ABC123',
  rssi: -52,
};

export const stubBleClient: BleClient = {
  scan(onFound) {
    const t = setTimeout(() => onFound(FAKE_DEVICE), 1800);
    return () => clearTimeout(t);
  },

  async connect(deviceId): Promise<ConnectedDevice> {
    // Mimic a brief connect handshake before returning.
    await new Promise((r) => setTimeout(r, 700));
    return {
      deviceId,
      async pull(opts) {
        // Pretend to stream chunks over 1.5 s, then return a fake URI.
        // Real impl will write each chunk to expo-file-system as it arrives.
        const totalBytes = 4_300_000;
        for (let i = 1; i <= 10; i++) {
          await new Promise((r) => setTimeout(r, 150));
          opts?.onProgress?.({
            bytesReceived: Math.floor((totalBytes / 10) * i),
            totalBytes,
          });
        }
        return {
          eegUri: 'file:///dev/null/fake-eeg.bin',
        };
      },
      async disconnect() {},
    };
  },
};
