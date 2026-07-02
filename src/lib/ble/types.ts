// Public contract for talking to the Neurex device over BLE.
//
// Live-stream model: scan -> connect -> startStream(sessionId, callbacks).
// The firmware notifies raw ADS1299 EEG/EOG frames batched at 250 Hz. RAW.BIN
// persists the device-described biosignal stream, later decoded by backend
// metadata into Fp1/Fp2/EOG-L/EOG-R. Optional IMU notifications are recorded
// separately as IMU.BIN when firmware exposes that characteristic.

import type { DeviceScaleInfo } from './scale';

export type FoundDevice = {
  /** Platform-stable identifier — UUID on iOS, MAC address on Android. */
  deviceId: string;
  /** Human-readable name; usually the advertised local name "Neurex-EEG". */
  serial: string;
  /** Signal strength at the moment of discovery. Lower (more negative) = farther. */
  rssi: number;
};

/** One decoded sample (250 Hz). All values in true µV. */
export type EegSample = {
  ms: number;
  /**
   * Convenience copy of the Fp1 channel in µV for live consumers. Equals
   * channels['Fp1'] when montage metadata exists.
   */
  fp1_uV: number;
  /**
   * Every active montage channel, keyed by role label, in µV:
   *   'Fp1' | 'Fp2' | 'EOG-L' | 'EOG-R' for the 4-channel montage.
   */
  channels: Record<string, number>;
};

/** One decoded BLE notification, with all samples from that packet included. */
export type ParsedPacket = {
  /** Monotonic counter that increments on every seq wrap (0xFF → 0x00). */
  generation: number;
  /** Rolling 0..255 sequence from byte [2] of the packet. */
  seq: number;
  /** Big-endian uint32 timestamp from bytes [3..6] — ms-since-boot of sample 0. */
  baseMs: number;
  samples: EegSample[];
};

export type StreamStats = {
  packets: number;
  samples: number;
  /** Packets dropped due to bad markers / bad checksum / seq gap. */
  drops: number;
  /** Packets skipped as duplicates on resume (baseMs <= lastBaseMs). */
  dupSkips: number;
  lastSeq: number | null;
  generation: number;
  /** Highest packet baseMs written so far — used to dedup on resume. null until first write. */
  lastBaseMs: number | null;
  /** Device-time gaps >= TIME_GAP_REPORT_THRESHOLD_MS between accepted packets. */
  timeGapCount: number;
  /** Sum of device-time gaps beyond expected packet cadence, in ms. */
  totalTimeGapMs: number;
  /** Largest device-time gap beyond expected packet cadence, in ms. */
  maxTimeGapMs: number;
  /** Times the firmware clock reset (brownout/watchdog reboot) mid-session; each
   * is a new epoch we detected (baseMs jumped far backward) and kept recording
   * across instead of discarding the rest of the night as duplicates. */
  deviceReboots: number;
  /** EEG/EOG raw is required for every new successful recording. */
  rawRequired: boolean;
  /** EEG/EOG RAW.BIN was opened and accepted the header. */
  rawOpened: boolean;
  /** Bytes handed to the EEG/EOG RAW.BIN sink, including the 16-byte header. */
  rawBytesWritten: number;
  /** EEG/EOG RAW.BIN was flushed/closed successfully. */
  rawClosed: boolean;
  /** EEG/EOG RAW.BIN was uploaded and confirmed as segments/raw. */
  rawUploaded: boolean;
  /** Whole EEG/EOG RAW.BIN SHA-256 declared to the backend, or null until uploaded. */
  rawSha256: string | null;
  /** Fatal raw failure reason, if any. */
  rawFailureReason: string | null;
  /** Optional IMU notify characteristic was present on this device connection. */
  imuAvailable: boolean;
  /** IMU.BIN was opened and accepted the header. */
  imuOpened: boolean;
  /** BLE IMU notifications written to IMU.BIN. */
  imuNotifications: number;
  /** Bytes handed to the IMU.BIN sink, including the 16-byte header. */
  imuBytesWritten: number;
  /** IMU.BIN was flushed/closed successfully. */
  imuClosed: boolean;
  /** IMU.BIN was uploaded and confirmed as segments/imu. */
  imuUploaded: boolean;
  /** Whole IMU.BIN SHA-256, or null until uploaded. */
  imuSha256: string | null;
  /** Non-fatal IMU failure reason, if any. */
  imuFailureReason: string | null;
};

export type StreamCallbacks = {
  /** Fired for each well-formed packet — drives the live UI. */
  onPacket?: (packet: ParsedPacket, stats: StreamStats) => void;
  /** Fired when a packet fails validation (bad markers / checksum / etc.). */
  onDrop?: (reason: 'markers' | 'checksum' | 'size' | 'gap', stats: StreamStats) => void;
  /** Fired on a fatal stream error (connection lost mid-session, file I/O, etc.). */
  onError?: (err: Error) => void;
};

export type StreamHandle = {
  /** Path to the per-session directory under FileSystem.documentDirectory. */
  sessionDir: string;
  /** file:// URI for the required EEG/EOG RAW.BIN sample stream. */
  rawUri: string;
  /** file:// URI for optional IMU.BIN, null when firmware has no IMU stream. */
  imuUri?: string | null;
  /** Stop notifications, flush + close file handles. Idempotent. */
  stop(): Promise<StreamStats>;
};

export type StreamResumeOpts = {
  /** On reconnect, drop replayed packets with baseMs <= this value. */
  resumeFromBaseMs?: number | null;
};

export type ConnectedDevice = {
  deviceId: string;
  /** The device's schema-v4 scale/montage, read once at connect. */
  scale: DeviceScaleInfo;
  /** True when this connection exposed the optional IMU notify characteristic. */
  imuAvailable?: boolean;
  /** Subscribe to the notify characteristic and start writing samples to disk. */
  startStream(
    sessionId: string,
    cb: StreamCallbacks,
    opts?: StreamResumeOpts,
  ): Promise<StreamHandle>;
  disconnect(): Promise<void>;
};

export type ConnectOpts = {
  /**
   * Reject the connect if the device hasn't connected within this many ms.
   * Used for USER-INITIATED session starts so a device that's off/out of range
   * fails fast with an error instead of an infinite spinner. OMIT it for the
   * background reconnect loop — there we want the untimed `autoConnect` pending
   * connection so iOS/Android can complete the link whenever the device comes
   * back in range (even while backgrounded).
   */
  timeoutMs?: number;
};

export type BleClient = {
  /** Starts a scan. Returns a stop-fn the caller must invoke to release the radio. */
  scan(onFound: (device: FoundDevice) => void): () => void;
  connect(deviceId: string, opts?: ConnectOpts): Promise<ConnectedDevice>;
};
