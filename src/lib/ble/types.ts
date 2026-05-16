// Public contract for talking to the Neurex headband over BLE.
//
// The shape here is deliberately the smallest interface that lets the app
// "wake up → find headband → pull last night's recording → upload" work
// end-to-end. When Aleksas's firmware GATT service ships, we add a real
// implementation under this interface in `real.ts` and swap the export in
// `index.ts`. No screens or upload code need to change.

export type FoundDevice = {
  /** Platform-stable identifier — UUID on iOS, MAC address on Android. */
  deviceId: string;
  /** Human-readable serial advertised in the device name, e.g. "NRX-A12B34". */
  serial: string;
  /** Signal strength at the moment of discovery. Lower (more negative) = farther. */
  rssi: number;
};

export type PullProgress = {
  bytesReceived: number;
  /** May be null if the device advertises an unknown total — keep the UI tolerant. */
  totalBytes: number | null;
};

export type PullOptions = {
  onProgress?: (progress: PullProgress) => void;
};

export type PulledRecording = {
  /** file:// URI, ready to pass straight to uploadRecording(). */
  eegUri: string;
  /** Optional companion files if firmware ships them in the same transfer. */
  epochsUri?: string;
  stimsUri?: string;
};

export type ConnectedDevice = {
  deviceId: string;
  pull(opts?: PullOptions): Promise<PulledRecording>;
  disconnect(): Promise<void>;
};

export type BleClient = {
  /** Starts a scan. Returns a stop-fn the caller must invoke to release the radio. */
  scan(onFound: (device: FoundDevice) => void): () => void;
  connect(deviceId: string): Promise<ConnectedDevice>;
};
