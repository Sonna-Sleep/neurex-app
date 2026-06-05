// Public contract for talking to the Neurex headband over BLE.
//
// Live-stream model: scan → connect → startStream(sessionId, callbacks).
// The firmware notifies 118-byte packets at ~62.5 Hz (4 samples/packet @ 250
// Hz). We append the decoded samples to per-session EEG.BIN / EOG.BIN files
// in the canonical on-disk format the existing analysis pipelines expect.

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
  fpz_uV: number;
  eog_l_uV: number;
  eog_r_uV: number;
};

/** One decoded 118-byte BLE notification, all 4 samples included. */
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
  /** file:// URI of the EEG.BIN file being written. */
  eegUri: string;
  /** file:// URI of the EOG.BIN file being written. */
  eogUri: string;
  /** Stop notifications, flush + close file handles. Idempotent. */
  stop(): Promise<StreamStats>;
};

/** Lightweight preview handle — same notify stream as startStream but
 * NO file I/O. Used by the Home signal-quality preview before a real
 * recording starts. */
export type PreviewHandle = {
  stop(): Promise<void>;
};

export type PreviewCallbacks = {
  /** Fired for each well-formed packet. Stats are not aggregated. */
  onPacket: (packet: ParsedPacket) => void;
  /** Fatal stream error. */
  onError?: (err: Error) => void;
};

export type StreamResumeOpts = {
  /** On reconnect, drop replayed packets with baseMs <= this value. */
  resumeFromBaseMs?: number | null;
};

export type ConnectedDevice = {
  deviceId: string;
  /** Subscribe to the notify characteristic and start writing samples to disk. */
  startStream(
    sessionId: string,
    cb: StreamCallbacks,
    opts?: StreamResumeOpts,
  ): Promise<StreamHandle>;
  /** Subscribe to the notify characteristic for live signal preview.
   * Does NOT write to disk — caller drives whatever UI/analysis it wants. */
  startPreview(cb: PreviewCallbacks): Promise<PreviewHandle>;
  disconnect(): Promise<void>;
};

export type BleClient = {
  /** Starts a scan. Returns a stop-fn the caller must invoke to release the radio. */
  scan(onFound: (device: FoundDevice) => void): () => void;
  connect(deviceId: string): Promise<ConnectedDevice>;
};
