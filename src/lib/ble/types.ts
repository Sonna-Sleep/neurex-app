// Public contract for talking to the Neurex device over BLE.
//
// Live-stream model: scan → connect → startStream(sessionId, callbacks).
// The firmware notifies 226-byte packets at ~31.25 Hz (8 samples/packet @ 250
// Hz). The app persists decoded FP1-active / FP2-reference samples in the
// canonical 8-byte sample format. New recordings default to rolling
// segments/eeg/segNNNN.bin files; the legacy local EEG.BIN writer remains as an
// emergency fallback and old-recording recovery path.

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
  fp1_uV: number;
};

/** One decoded 226-byte BLE notification, all 8 samples included. */
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
};

export type StreamCallbacks = {
  /** Fired for each well-formed packet — drives the live UI. */
  onPacket?: (packet: ParsedPacket, stats: StreamStats) => void;
  /** Fired when a packet fails validation (bad markers / checksum / etc.). */
  onDrop?: (reason: 'markers' | 'checksum' | 'size' | 'gap', stats: StreamStats) => void;
  /** Fired on a fatal stream error (connection lost mid-session, file I/O, etc.). */
  onError?: (err: Error) => void;
  /** Fired when a recording segment is finalized — rolled at the chunk boundary
   * or flushed on stop. Carries the segment's monotonic index, file URI, and
   * byte length. Only the legacy local EEG.BIN fallback does not emit it. */
  onSegmentClosed?: (seg: SegmentClosed) => void;
};

/** A finalized recording segment ready to be hashed, uploaded, and (after the
 * server confirms an exact byte+hash match) deleted to reclaim on-device space. */
export type SegmentClosed = {
  /** Monotonic index within the session — the segNNNN.bin name + upload seq. */
  index: number;
  /** file:// URI of the closed segment. */
  uri: string;
  /** Exact bytes in the segment (whole packets, lossless boundary). */
  byteLength: number;
};

export type StreamHandle = {
  /** Path to the per-session directory under FileSystem.documentDirectory. */
  sessionDir: string;
  /** file:// URI for sharing/debug: current segment by default, EEG.BIN in fallback mode. */
  eegUri: string;
  /** Stop notifications, flush + close file handles. Idempotent. */
  stop(): Promise<StreamStats>;
};

export type StreamResumeOpts = {
  /** On reconnect, drop replayed packets with baseMs <= this value. */
  resumeFromBaseMs?: number | null;
};

export type ConnectedDevice = {
  deviceId: string;
  /**
   * The device's self-describing amplitude scale, read once at connect (µV/LSB,
   * gain, firmware build, and — schema v2+ — variantKnown). FALLBACK_SCALE when
   * the unit predates the Scale characteristic or the read failed. Exposed so a
   * caller can refuse to record on an unconfigured board (variantKnown === 0)
   * before any data is written.
   */
  scale: DeviceScaleInfo;
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
