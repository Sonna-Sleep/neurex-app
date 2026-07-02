// Real BleClient — talks to the Cerelog single-board tracker over BLE.
//
// Flow:
//   1. scan(): scoped by NEUREX_SERVICE_UUID (Apple-compliant for background BLE).
//   2. connect(deviceId, { autoConnect: true }): MTU bump to fit one full packet.
//   3. startStream(sessionId, cb): subscribe to the notify characteristic and
//      append the device-described EEG/EOG raw integer stream to RAW.BIN under
//      FileSystem.documentDirectory/sessions/<sessionId>/.
//
// Best-effort, lossy by design: BLE drops are unavoidable. Drops surface as
// onDrop callbacks + StreamStats counters; reconnect resumes the same files
// and dedups by baseMs so late packets cannot corrupt the timeline.

import { File, Directory, Paths } from 'expo-file-system';
import type { Subscription } from 'react-native-ble-plx';

import { getBleManager } from './manager';
import { withTimeout } from './connectTimeout';
import { useSession } from '../../state/session';
import {
  BATTERY_LEVEL_CHAR_UUID,
  BATTERY_SERVICE_UUID,
  EEG_SAMPLE_INTERVAL_MS,
  NEUREX_ACK_INTERVAL_MS,
  NEUREX_ACK_WRITE_UUID,
  NEUREX_IMU_NOTIFY_UUID,
  NEUREX_RAW_NOTIFY_UUID,
  NEUREX_SCALE_INFO_UUID,
  NEUREX_SERVICE_UUID,
  TIME_GAP_REPORT_THRESHOLD_MS,
} from './constants';
import {
  encodeImuNotification,
  imuHeader,
  IMU_BIN_NAME,
  IMU_HEADER_BYTES,
  IMU_MAGIC,
  IMU_MAX_NOTIFY_BYTES,
  IMU_META_NAME,
  IMU_RECORD_HEADER_BYTES,
  IMU_SCHEMA_VER,
} from './imuRecord';
import { classifyResume, parsePacket } from './packet';
import { encodeRawPacket, rawHeader, rawRecordBytes } from './rawRecord';
import { activeChannels, parseScaleInfo, scaleProvenance } from './scale';
import type { ActiveChannel, DeviceScaleInfo } from './scale';
import { RecordingManifestTracker, readRecordingManifest } from './recordingManifest';
import type {
  BleClient,
  ConnectedDevice,
  ConnectOpts,
  FoundDevice,
  StreamCallbacks,
  StreamHandle,
  StreamStats,
} from './types';

// ── helpers ────────────────────────────────────────────────────────────────

// Hermes (RN 0.81 default) provides global atob; fall back to a manual decoder
// only in environments that don't (e.g. older Jest runners).
function b64ToBytes(b64: string): Uint8Array {
  const g = globalThis as any;
  const bin: string = typeof g.atob === 'function' ? g.atob(b64) : manualAtob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function manualAtob(b64: string): string {
  const clean = b64.replace(/=+$/, '');
  let out = '';
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_ALPHABET.indexOf(clean[i]);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buf >> bits) & 0xff);
    }
  }
  return out;
}

// ble-plx writes characteristic values as base64. The ACK payload is 2 bytes
// {gen, seq}; encode without pulling in a Buffer polyfill.
function bytesToB64(bytes: Uint8Array): string {
  const g = globalThis as { btoa?: (s: string) => string };
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof g.btoa === 'function') return g.btoa(bin);
  return manualBtoa(bytes);
}

function manualBtoa(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(triple >> 18) & 0x3f];
    out += B64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

function sameUuid(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

async function hasCharacteristic(
  device: {
    characteristicsForService?: (
      serviceUuid: string,
    ) => Promise<{ uuid?: string | null }[]>;
  },
  serviceUuid: string,
  characteristicUuid: string,
): Promise<boolean> {
  if (typeof device.characteristicsForService !== 'function') return false;
  try {
    const chars = await device.characteristicsForService(serviceUuid);
    return chars.some((c) => sameUuid(c.uuid, characteristicUuid));
  } catch {
    return false;
  }
}

// ── ACK contiguous-frontier tracker (Plan 02) ───────────────────────────────
//
// ACKs report the last contiguous (gen, seq) the app received, giving firmware
// a conservative frontier for stream accounting. ACKing past a gap would make
// device-side health/backpressure telemetry lie about what reached the phone.
//
// gen is the receiver's observed generation: bumped on every 0xFF→0x00 seq
// transition, exactly as the firmware producer bumps it. contig advances only
// on an exact +1 from the current frontier; a gap parks it until the stream
// becomes contiguous again.
class ContigTracker {
  private lastSeq: number | null = null;
  private obsGen = 0;
  private contigGen = 0;
  private contigSeq = 0;
  private valid = false;
  private dirty = false;

  // Feed every VALID packet's seq (checksum + markers already verified).
  feed(seq: number): void {
    if (this.lastSeq !== null && this.lastSeq === 0xff && seq === 0x00) {
      this.obsGen = (this.obsGen + 1) & 0xff;
    }
    this.lastSeq = seq;

    if (!this.valid) {
      this.contigGen = this.obsGen;
      this.contigSeq = seq;
      this.valid = true;
      this.dirty = true;
      return;
    }
    const expectedSeq = (this.contigSeq + 1) & 0xff;
    const expectedGen =
      this.contigSeq === 0xff ? (this.contigGen + 1) & 0xff : this.contigGen;
    if (seq === expectedSeq && this.obsGen === expectedGen) {
      this.contigGen = expectedGen;
      this.contigSeq = expectedSeq;
      this.dirty = true;
    }
  }

  // Returns the 2-byte {gen, seq} ACK payload if the frontier advanced since
  // the last call, else null (so the ACK loop can debounce idle writes).
  takeAck(): Uint8Array | null {
    if (!this.valid || !this.dirty) return null;
    this.dirty = false;
    return new Uint8Array([this.contigGen, this.contigSeq]);
  }

  // Restore to the just-constructed state. Called when the device reboots
  // mid-session (a new epoch): firmware restarts its own gen/seq from scratch,
  // so the ACK frontier must too, or we'd ACK a frontier the device never had.
  reset(): void {
    this.lastSeq = null;
    this.obsGen = 0;
    this.contigGen = 0;
    this.contigSeq = 0;
    this.valid = false;
    this.dirty = false;
  }
}

// ── packet parser ──────────────────────────────────────────────────────────

// ── append-only file wrapper ───────────────────────────────────────────────
//
// Wraps the SDK-54 modular FileHandle. We buffer ~1 second's worth of bytes
// in JS and flush in one writeBytes() call so we're not doing a native bridge
// hop per packet (~62 packets/sec).

type FileHandleLike = {
  offset: number;
  // SDK types size as number | null (null for an edge-state handle). We seek to
  // it for append, so guard the null rather than assume non-null.
  size: number | null;
  writeBytes(bytes: Uint8Array): void;
  close(): void;
};

// Wall-clock flush ceiling: buffered samples never sit in JS longer than this
// before hitting disk, even at a low packet rate. Bounds the data a crash/kill
// can lose to at most this window (the byte threshold flushes sooner at full
// rate). Event-driven (checked on each append), so it works while backgrounded.
const FLUSH_INTERVAL_MS = 3000;

class AppendingFile {
  readonly uri: string;
  private handle: FileHandleLike;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private readonly flushThresholdBytes: number;
  private lastFlushAtMs: number;

  private constructor(uri: string, handle: FileHandleLike, flushThresholdBytes: number) {
    this.uri = uri;
    this.handle = handle;
    this.flushThresholdBytes = flushThresholdBytes;
    this.lastFlushAtMs = Date.now();
  }

  static open(dir: Directory, filename: string, flushBytes = 2048): AppendingFile {
    const file = new File(dir, filename);
    if (!file.exists) file.create();
    const handle = (file as any).open() as FileHandleLike;
    handle.offset = handle.size ?? 0; // seek to end (append); 0 if size unknown
    return new AppendingFile(file.uri, handle, flushBytes);
  }

  appendChunk(chunk: Uint8Array): void {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    // Flush on size OR age — whichever comes first. The age bound caps how much
    // recent data a crash can lose when the packet rate is low.
    if (
      this.pendingBytes >= this.flushThresholdBytes ||
      Date.now() - this.lastFlushAtMs >= FLUSH_INTERVAL_MS
    ) {
      this.flush();
    }
  }

  flush(): void {
    this.lastFlushAtMs = Date.now();
    if (this.pending.length === 0) return;
    const merged = new Uint8Array(this.pendingBytes);
    let off = 0;
    for (const c of this.pending) {
      merged.set(c, off);
      off += c.length;
    }
    this.handle.writeBytes(merged);
    this.pending = [];
    this.pendingBytes = 0;
  }

  close(): void {
    this.flush();
    this.handle.close();
  }
}

// startStream writes required EEG/EOG RAW.BIN plus optional IMU.BIN.

// ── BleClient implementation ───────────────────────────────────────────────

class NotReadyError extends Error {
  constructor(stage: string) {
    super(`BLE ${stage} unavailable — native module not loaded (Expo Go?)`);
    this.name = 'NotReadyError';
  }
}

export class RawStorageWriteError extends Error {
  constructor(detail?: string) {
    super(`EEG/EOG raw recording failed${detail ? ` (${detail})` : ''}.`);
    this.name = 'RawStorageWriteError';
  }
}

export const realBleClient: BleClient = {
  scan(onFound: (device: FoundDevice) => void): () => void {
    const manager = getBleManager();
    if (!manager) {
      if (__DEV__) console.warn('[ble/real] scan called with no BleManager');
      return () => {};
    }
    // Scan ALL advertisers (UUID filter passed as null) and match by name
    // client-side. The 128-bit service UUID doesn't fit the 31-byte
    // advertising packet alongside the "Neurex <Color>" name + flags, so the
    // firmware puts the UUID in the SCAN RESPONSE instead (so iOS background
    // discovery still works). Android foreground scanning here matches the
    // name in the advertising packet — simpler than a two-packet UUID filter
    // and still excludes earbuds/phones/watches/etc, so the user only sees
    // Neurex devices in the Pair UI.
    //
    // No dedupe here: every advertisement fires onFound so the UI can
    // refresh RSSI for ranking when multiple Neurex devices are in range.
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        if (__DEV__) console.warn('[ble/real] scan error:', error);
        return;
      }
      if (!device) return;
      const name = device.name ?? device.localName;
      // Accept a device if EITHER its name carries the "Neurex" prefix
      // ("Neurex Yellow"/"Neurex-Raw-XXXX"/...) OR it advertises our stable
      // service UUID. Matching the UUID means renamed devices and any future
      // naming scheme still appear in the Pair UI without shipping an app
      // update; the name check still catches units whose UUID only rides in a
      // scan response some stacks drop. Either is enough, and both still keep
      // earbuds/phones/watches out of the Pair UI.
      const matchesName = !!name && name.startsWith('Neurex');
      const matchesUuid = (device.serviceUUIDs ?? []).some(
        (u) => u?.toLowerCase() === NEUREX_SERVICE_UUID,
      );
      if (!matchesName && !matchesUuid) return;
      onFound({
        deviceId: device.id,
        serial: name ?? 'Neurex device',
        rssi: device.rssi ?? -127,
      });
    });
    return () => manager.stopDeviceScan();
  },

  async connect(deviceId: string, opts?: ConnectOpts): Promise<ConnectedDevice> {
    const manager = getBleManager();
    if (!manager) throw new NotReadyError('connect');

    // autoConnect: true → iOS maintains the connection across app suspensions
    // and the native side reconnects when the peripheral comes back in range.
    // With autoConnect there is NO native timeout, so a user-initiated connect
    // passes opts.timeoutMs to fail fast (device off) instead of hanging forever;
    // the background reconnect loop omits it to keep the pending-connect that
    // lets iOS/Android finish the link whenever the device reappears.
    const connecting = manager.connectToDevice(deviceId, { autoConnect: true });
    // withTimeout no-ops when timeoutMs is 0/undefined (the reconnect path),
    // and otherwise cancels the pending connect + rejects on expiry.
    const device = await withTimeout(connecting, opts?.timeoutMs ?? 0, () => {
      manager.cancelDeviceConnection(deviceId).catch(() => undefined);
    });
    // Request the max ATT MTU (512) so raw packets fit one notify PDU instead
    // of fragmenting/truncating. The peer negotiates down if needed.
    await device.requestMTU(512).catch((e) => {
      if (__DEV__) console.warn('[ble/real] requestMTU(512) failed:', e);
    });
    await device.discoverAllServicesAndCharacteristics();
    const imuAvailable = await hasCharacteristic(
      device,
      NEUREX_SERVICE_UUID,
      NEUREX_IMU_NOTIFY_UUID,
    );
    if (__DEV__)
      console.log(`[ble/real] IMU stream ${imuAvailable ? 'available' : 'not present'}`);

    // Read the device's self-describing amplitude scale ONCE: µV-per-LSB, gain,
    // VREF, firmware build id, montage, and stream channel count. The app
    // converts raw ADS codes -> µV with THIS value and requires the
    // four-channel montage before recording.
    let deviceScale: DeviceScaleInfo | null = null;
    try {
      const sc = await device.readCharacteristicForService(
        NEUREX_SERVICE_UUID,
        NEUREX_SCALE_INFO_UUID,
      );
      const parsed = sc?.value ? parseScaleInfo(b64ToBytes(sc.value)) : null;
      if (parsed) {
        deviceScale = parsed;
        if (__DEV__)
          console.log(
            `[ble/real] device scale ${parsed.uvPerLsb.toFixed(4)} µV/LSB ` +
              `(gain ${parsed.pgaGain}, schema ${parsed.schemaVer}, fw ${parsed.fwBuildId.toString(16)})`,
          );
      }
    } catch (e) {
      if (__DEV__) console.warn('[ble/real] scale read failed:', e);
    }
    if (!deviceScale) {
      throw new Error('Neurex firmware must expose schema-v4 scale/montage before recording.');
    }
    const scale = deviceScale;

    // Resolve the device montage once: which physical channel carries which role
    // (channel_role[] -> Fp1/Fp2/EOG-L/EOG-R). Passed to parsePacket so
    // every sample carries the full montage in sample.channels.
    const montage: ActiveChannel[] = activeChannels(scale);
    const roles = new Set(montage.map((c) => c.role));
    const hasFourChannelMontage =
      scale.nChannels === 4 &&
      montage.length === 4 &&
      roles.has('Fp1') &&
      roles.has('Fp2') &&
      roles.has('EOG-L') &&
      roles.has('EOG-R');
    if (!hasFourChannelMontage) {
      throw new Error('Neurex firmware must expose Fp1/Fp2/EOG-L/EOG-R as a four-channel montage.');
    }
    if (__DEV__)
      console.log(
        `[ble/real] montage ${montage
          .map((c) => `S${(c.streamIndex ?? c.index) + 1}/CH${c.index + 1}=${c.role}`)
          .join(' ')} streamChannels=${scale.streamChannelCount}`,
      );

    // Subscribe to the standard Battery Service. Firmware notifies every
    // ~5 s; we mirror straight into the Zustand session store so the
    // StatusPill and RecordingCard tick live without prop drilling. Read
    // once upfront so the UI shows a value before the first notify lands.
    const pushBattery = (b64?: string | null) => {
      if (!b64) return;
      const bin =
        typeof (globalThis as { atob?: (s: string) => string }).atob === 'function'
          ? (globalThis as { atob: (s: string) => string }).atob(b64)
          : '';
      if (bin.length === 0) return;
      const pct = bin.charCodeAt(0);
      if (pct >= 0 && pct <= 100) useSession.getState().setDeviceBattery(pct);
    };
    device
      .readCharacteristicForService(BATTERY_SERVICE_UUID, BATTERY_LEVEL_CHAR_UUID)
      .then((c) => pushBattery(c?.value))
      .catch((e) => {
        if (__DEV__) console.warn('[ble/real] battery read failed:', e);
      });
    const batterySub = manager.monitorCharacteristicForDevice(
      deviceId,
      BATTERY_SERVICE_UUID,
      BATTERY_LEVEL_CHAR_UUID,
      (error, characteristic) => {
        if (error) {
          if (__DEV__) console.warn('[ble/real] battery monitor:', error);
          return;
        }
        pushBattery(characteristic?.value);
      },
    );

    return {
      deviceId,
      imuAvailable,
      // Expose the scale read above so the session controller can refuse to
      // record on an unconfigured board (deviceScale.variantKnown === 0).
      scale,

      async startStream(
        sessionId: string,
        cb: StreamCallbacks,
        opts?: import('./types').StreamResumeOpts,
      ): Promise<StreamHandle> {
        // Per-session directory under documents.
        const sessionsDir = new Directory(Paths.document, 'sessions');
        if (!sessionsDir.exists) sessionsDir.create({ intermediates: true });
        const sessionDir = new Directory(sessionsDir, sessionId);
        if (!sessionDir.exists) sessionDir.create();
        const manifestStartedAtMs = readRecordingManifest(sessionId)?.startedAtMs || Date.now();
        const recordBytes = rawRecordBytes(scale.streamChannelCount);
        const manifest = new RecordingManifestTracker({
          sessionId,
          startedAtMs: manifestStartedAtMs,
          sampleRateHz: scale.sampleRateHz,
          rawRecordBytes: recordBytes,
        });

        if (__DEV__)
          console.log(
            `[ble/real] writer=RAW.BIN sr=${scale.sampleRateHz} ` +
              `streamChannels=${scale.streamChannelCount} recordBytes=${recordBytes}`,
          );

        // Self-describing SCALE sidecar — scale.json, DELIBERATELY distinct from
        // recovery.ts's meta.json (which owns startedAtMs/serial for crash
        // recovery; reusing that name would clobber it). Written once at stream
        // start so the cloud QC/staging knows the EXACT µV-per-LSB (and gain /
        // firmware build) this recording used. Uploaded alongside the segments
        // (cloudSync). Write failure is non-fatal here so RAW.BIN capture is
        // never interrupted by sidecar I/O.
        try {
          const scaleMeta = {
            schemaVer: 1,
            sessionId,
            sampleRateHz: scale.sampleRateHz,
            sampleIntervalMs: EEG_SAMPLE_INTERVAL_MS,
            rawRecordBytes: recordBytes,
            scale: scaleProvenance(scale),
          };
          const scaleFile = new File(sessionDir, 'scale.json');
          if (scaleFile.exists) scaleFile.delete();
          scaleFile.create();
          scaleFile.write(JSON.stringify(scaleMeta));
        } catch (e) {
          if (__DEV__) console.warn('[ble/real] scale.json write failed (non-fatal):', e);
        }

        // RAW.BIN — the immutable EEG/EOG raw integer stream, written lockstep
        // with accepted packets. Raw open/write failure is fatal because every
        // successful recording must contain recoverable Fp1/Fp2/EOG-L/EOG-R data.
        const rawBinFile = new File(sessionDir, 'RAW.BIN');
        const rawFresh = !rawBinFile.exists || (rawBinFile.size ?? 0) === 0;
        const stats: StreamStats = manifest.stats();
        stats.rawRequired = true;
        stats.rawOpened = false;
        stats.rawBytesWritten = 0;
        stats.rawClosed = false;
        stats.rawUploaded = false;
        stats.rawSha256 = null;
        stats.rawFailureReason = null;
        stats.imuAvailable = imuAvailable;
        stats.imuOpened = false;
        stats.imuNotifications = 0;
        stats.imuBytesWritten = 0;
        stats.imuClosed = false;
        stats.imuUploaded = false;
        stats.imuSha256 = null;
        stats.imuFailureReason = null;
        let raw: AppendingFile;
        try {
          raw = AppendingFile.open(sessionDir, 'RAW.BIN');
          if (rawFresh) {
            const header = rawHeader(scale.sampleRateHz, scale.streamChannelCount);
            raw.appendChunk(header);
            stats.rawBytesWritten += header.length;
          } else {
            stats.rawBytesWritten = rawBinFile.size ?? 0;
          }
          stats.rawOpened = true;
        } catch (e) {
          const detail = (e as Error)?.message ?? String(e);
          stats.rawFailureReason = `raw init failed: ${detail}`;
          throw new RawStorageWriteError(detail);
        }
        if (stats.lastBaseMs == null && opts?.resumeFromBaseMs != null) {
          stats.lastBaseMs = opts.resumeFromBaseMs;
        }
        let imu: AppendingFile | null = null;
        let imuSubscription: Subscription | null = null;
        if (imuAvailable) {
          const imuFile = new File(sessionDir, IMU_BIN_NAME);
          const imuFresh = !imuFile.exists || (imuFile.size ?? 0) === 0;
          try {
            imu = AppendingFile.open(sessionDir, IMU_BIN_NAME);
            if (imuFresh) {
              const header = imuHeader();
              imu.appendChunk(header);
              stats.imuBytesWritten += header.length;
            } else {
              stats.imuBytesWritten = imuFile.size ?? 0;
            }
            stats.imuOpened = true;
          } catch (e) {
            const detail = (e as Error)?.message ?? String(e);
            stats.imuFailureReason = `imu init failed: ${detail}`;
            if (__DEV__) console.warn('[ble/real] IMU open failed (non-fatal):', e);
            imu = null;
          }
          try {
            const imuMeta = {
              schemaVer: 1,
              sessionId,
              stream: 'imu',
              file: IMU_BIN_NAME,
              source: 'ble',
              serviceUuid: NEUREX_SERVICE_UUID,
              characteristicUuid: NEUREX_IMU_NOTIFY_UUID,
              container: {
                magic: IMU_MAGIC,
                schemaVer: IMU_SCHEMA_VER,
                headerBytes: IMU_HEADER_BYTES,
                recordHeaderBytes: IMU_RECORD_HEADER_BYTES,
                maxNotifyBytes: IMU_MAX_NOTIFY_BYTES,
                record: 'receivedAtMs u64le + payloadBytes u16le + exact BLE notification payload',
              },
              payloadFormat: {
                status: 'firmware-defined',
                note: 'The app preserves IMU notification bytes exactly; firmware/backend own payload decoding.',
              },
              createdAtMs: Date.now(),
            };
            const imuMetaFile = new File(sessionDir, IMU_META_NAME);
            if (imuMetaFile.exists) imuMetaFile.delete();
            imuMetaFile.create();
            imuMetaFile.write(JSON.stringify(imuMeta));
          } catch (e) {
            if (__DEV__) console.warn('[ble/real] imu.json write failed (non-fatal):', e);
          }
        }
        let stopped = false;
        // Set on a fatal write failure (storage full). Distinct from `stopped`
        // (user/teardown) so stop() can still flush+close what fits. Once set,
        // further packets are ignored instead of throwing on every notify.
        let fatal = false;
        let subscription: Subscription | null = null;

        // Track the contiguous frontier and write it to the firmware every
        // NEUREX_ACK_INTERVAL_MS so device-side stream accounting advances
        // only over packets the app actually received.
        const contig = new ContigTracker();
        let ackInFlight = false;
        const ackTimer = setInterval(() => {
          if (stopped || ackInFlight) return;
          const payload = contig.takeAck();
          if (!payload) return;
          ackInFlight = true;
          manager
            .writeCharacteristicWithoutResponseForDevice(
              deviceId,
              NEUREX_SERVICE_UUID,
              NEUREX_ACK_WRITE_UUID,
              bytesToB64(payload),
            )
            .catch((e) => {
              // Transient (mid-disconnect). The frontier stays put; next
              // advance re-marks dirty and we retry on the following tick.
              if (__DEV__) console.warn('[ble/real] ack write failed:', e);
            })
            .finally(() => {
              ackInFlight = false;
            });
        }, NEUREX_ACK_INTERVAL_MS);

        const onValue = (
          error: unknown,
          characteristic: { value?: string | null } | null,
        ) => {
          if (stopped || fatal) return;
          if (error) {
            cb.onError?.(error as Error);
            return;
          }
          const b64 = characteristic?.value;
          if (!b64) return;

          const bytes = b64ToBytes(b64);
          const result = parsePacket(
            bytes,
            stats.generation,
            scale.uvPerLsb,
            montage,
            scale.streamChannelCount,
          );
          if (!result.ok) {
            stats.drops++;
            manifest.markDrop();
            cb.onDrop?.(result.reason, stats);
            return;
          }
          const pkt = result.packet;

          // Resume dedup vs device-reboot survival. baseMs is firmware ms-since
          // boot, so a packet at/below lastBaseMs is normally a replayed dup on
          // reconnect (drop it to keep files monotonic). BUT a brownout/watchdog
          // reboot resets the firmware clock to ~0, so EVERY post-reboot packet
          // is "<= lastBaseMs" — the old gate silently discarded the rest of the
          // night while the link still looked connected. A large backward jump
          // is therefore a NEW epoch: reset dedup + seq/gen tracking and accept.
          const resume = classifyResume(stats.lastBaseMs, pkt.baseMs);
          if (resume === 'reboot') {
            if (__DEV__)
              console.warn(
                `[ble/real] device reboot #${stats.deviceReboots + 1} ` +
                  `(baseMs ${stats.lastBaseMs}→${pkt.baseMs}); kept recording`,
              );
            stats.deviceReboots++;
            manifest.markReboot();
            stats.lastSeq = null;
            stats.generation = 0;
            pkt.generation = 0;
            contig.reset();
            // fall through to persist + advance below; the existing flow re-sets
            // lastBaseMs to this epoch's baseMs and restarts gap/wrap tracking.
          } else if (resume === 'dup') {
            stats.dupSkips++;
            manifest.markDuplicate();
            cb.onPacket?.(pkt, stats);
            return;
          }

          // Persist FIRST. Only count a sample once the EEG/EOG raw stream bytes
          // are handed to the file buffer. Raw is required: a failed append stops
          // the stream instead of silently degrading the night.
          try {
            const rawChunk = encodeRawPacket(
              bytes,
              pkt.baseMs,
              pkt.seq,
              scale.streamChannelCount,
            );
            raw.appendChunk(rawChunk);
            stats.rawBytesWritten += rawChunk.length;
          } catch (e) {
            const detail = (e as Error)?.message ?? String(e);
            stats.rawFailureReason = `raw write failed: ${detail}`;
            fatal = true;
            cb.onError?.(new RawStorageWriteError(detail));
            return;
          }

          // Bytes are on the way to disk — now advance counters + ACK frontier.
          if (stats.lastBaseMs !== null) {
            // Expected next baseMs = last + (this packet's sample count)×interval.
            // The parsed packet length is the right stride for the current
            // device-declared stream width.
            const timeGapMs =
              pkt.baseMs - (stats.lastBaseMs + pkt.samples.length * EEG_SAMPLE_INTERVAL_MS);
            if (timeGapMs >= TIME_GAP_REPORT_THRESHOLD_MS) {
              stats.timeGapCount++;
              stats.totalTimeGapMs += timeGapMs;
              stats.maxTimeGapMs = Math.max(stats.maxTimeGapMs, timeGapMs);
              manifest.markTimeGap(timeGapMs);
            }
          }
          // Detect seq wrap → generation bump.
          if (stats.lastSeq !== null) {
            const gap = (pkt.seq - stats.lastSeq - 1) & 0xff;
            if (gap > 0) {
              stats.drops += gap;
              manifest.markDrop(gap);
              cb.onDrop?.('gap', stats);
            }
            if (pkt.seq < stats.lastSeq) {
              stats.generation++;
              pkt.generation = stats.generation;
            }
          }
          stats.lastSeq = pkt.seq;
          stats.packets++;
          stats.samples += pkt.samples.length;
          stats.lastBaseMs = pkt.baseMs;
          manifest.markPacketWritten({
            seq: pkt.seq,
            generation: stats.generation,
            lastBaseMs: pkt.baseMs,
            samples: pkt.samples.length,
            bytesWritten: pkt.samples.length * recordBytes,
          });

          // Advance the ACK frontier only over in-order packets. The tracker
          // parks on a gap instead of pretending dropped data arrived.
          contig.feed(pkt.seq);

          cb.onPacket?.(pkt, stats);
        };

        subscription = manager.monitorCharacteristicForDevice(
          deviceId,
          NEUREX_SERVICE_UUID,
          NEUREX_RAW_NOTIFY_UUID,
          onValue,
        );

        if (imuAvailable && imu) {
          imuSubscription = manager.monitorCharacteristicForDevice(
            deviceId,
            NEUREX_SERVICE_UUID,
            NEUREX_IMU_NOTIFY_UUID,
            (error, characteristic) => {
              if (stopped) return;
              if (error) {
                stats.imuFailureReason = (error as Error)?.message ?? String(error);
                if (__DEV__) console.warn('[ble/real] IMU monitor:', error);
                return;
              }
              const b64 = characteristic?.value;
              if (!b64 || !imu) return;
              try {
                const record = encodeImuNotification(b64ToBytes(b64));
                imu.appendChunk(record);
                stats.imuNotifications += 1;
                stats.imuBytesWritten += record.length;
              } catch (e) {
                const detail = (e as Error)?.message ?? String(e);
                stats.imuFailureReason = `imu write failed: ${detail}`;
                if (__DEV__) console.warn('[ble/real] IMU write failed; stopping IMU stream:', e);
                try {
                  imuSubscription?.remove();
                } catch {
                  /* ignore */
                }
                imuSubscription = null;
              }
            },
          );
        }

        return {
          sessionDir: sessionDir.uri,
          rawUri: raw.uri,
          imuUri: imu?.uri ?? null,
          async stop(): Promise<StreamStats> {
            if (stopped) return stats;
            stopped = true;
            clearInterval(ackTimer);
            try {
              subscription?.remove();
            } catch {
              /* ignore */
            }
            try {
              imuSubscription?.remove();
            } catch {
              /* ignore */
            }
            try {
              raw?.close();
              stats.rawClosed = true;
            } catch (e) {
              const detail = (e as Error)?.message ?? String(e);
              stats.rawFailureReason = `raw close failed: ${detail}`;
              if (__DEV__) console.warn('[ble/real] RAW close failed:', e);
            }
            if (imu) {
              try {
                imu.close();
                stats.imuClosed = true;
              } catch (e) {
                const detail = (e as Error)?.message ?? String(e);
                stats.imuFailureReason = `imu close failed: ${detail}`;
                if (__DEV__) console.warn('[ble/real] IMU close failed:', e);
              }
            }
            try {
              manifest.flush();
            } catch (e) {
              if (__DEV__) console.warn('[ble/real] manifest flush failed:', e);
            }
            return stats;
          },
        };
      },

      async disconnect() {
        try {
          batterySub.remove();
        } catch {
          /* ignore */
        }
        useSession.getState().setDeviceBattery(null);
        await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
      },
    };
  },
};
