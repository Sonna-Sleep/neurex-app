// Real BleClient — talks to the Cerelog single-board tracker over BLE.
//
// Flow:
//   1. scan(): scoped by NEUREX_SERVICE_UUID (Apple-compliant for background BLE).
//   2. connect(deviceId, { autoConnect: true }): MTU bump to fit a 226 B packet.
//   3. startStream(sessionId, cb): subscribe to the notify characteristic,
//      decode each 226-byte packet, append FP1 samples to EEG.BIN under
//      FileSystem.documentDirectory/sessions/<sessionId>/.
//
// On-disk format is byte-identical to tools/capture/ble_stream_recv.py in the
// algorithms repo, so the existing neurex_qc / neurex_stage / to_edf pipelines
// consume it without changes.
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
  NEUREX_EEG_NOTIFY_UUID,
  NEUREX_SCALE_INFO_UUID,
  NEUREX_SERVICE_UUID,
  SAMPLES_PER_PACKET,
} from './constants';
import { classifyResume, parsePacket } from './packet';
import { FALLBACK_SCALE, parseScaleInfo, scaleProvenance } from './scale';
import type { DeviceScaleInfo } from './scale';
import type {
  BleClient,
  ConnectedDevice,
  ConnectOpts,
  FoundDevice,
  ParsedPacket,
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

// ── ACK contiguous-frontier tracker (Plan 02) ───────────────────────────────
//
// Mirrors the Recorder contig logic in tools/capture/ble_stream_recv.py. ACKs
// report the last contiguous (gen, seq) the app received, giving firmware a
// conservative frontier for stream accounting. ACKing past a gap would make
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

// ── on-disk encoder (matches Python struct '<If') ─────────────────────────

const EEG_RECORD_BYTES = 8; // uint32 ms + float32 fp1_uV

function encodePacketEeg(packet: ParsedPacket): Uint8Array {
  const buf = new ArrayBuffer(SAMPLES_PER_PACKET * EEG_RECORD_BYTES);
  const view = new DataView(buf);
  for (let i = 0; i < SAMPLES_PER_PACKET; i++) {
    const s = packet.samples[i];
    view.setUint32(i * EEG_RECORD_BYTES + 0, s.ms, true);
    view.setFloat32(i * EEG_RECORD_BYTES + 4, s.fp1_uV, true);
  }
  return new Uint8Array(buf);
}

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

// ── BleClient implementation ───────────────────────────────────────────────

class NotReadyError extends Error {
  constructor(stage: string) {
    super(`BLE ${stage} unavailable — native module not loaded (Expo Go?)`);
    this.name = 'NotReadyError';
  }
}

/** Thrown when appending decoded samples to disk fails (storage full / I/O
 * error). FATAL — the recording stops; whatever was already flushed stays on
 * disk and is still uploadable. */
export class StorageWriteError extends Error {
  constructor(detail?: string) {
    super(`Storage full — recording stopped${detail ? ` (${detail})` : ''}.`);
    this.name = 'StorageWriteError';
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
      // ("Neurex Yellow"/"Neurex-EEG-XXXX"/…) OR it advertises our stable
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
    // Larger MTU fits a 226-byte packet in one PDU instead of fragmenting it.
    await device.requestMTU(247).catch((e) => {
      if (__DEV__) console.warn('[ble/real] requestMTU(247) failed:', e);
    });
    await device.discoverAllServicesAndCharacteristics();

    // Read the device's self-describing amplitude scale ONCE (µV-per-LSB, gain,
    // VREF, firmware build id). The app converts raw ADS codes → µV with THIS
    // value instead of a hardcoded constant, so a future PGA-gain change can't
    // silently mis-scale recordings. Units that predate the Scale characteristic
    // (older firmware), or a read failure, fall back to the gain-1 scale —
    // byte-identical to the previous behavior.
    let deviceScale: DeviceScaleInfo = FALLBACK_SCALE;
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
      } else if (__DEV__) {
        console.log('[ble/real] no/invalid Scale characteristic — fallback gain-1 scale');
      }
    } catch (e) {
      if (__DEV__) console.warn('[ble/real] scale read failed; using fallback:', e);
    }

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

        const eeg = AppendingFile.open(sessionDir, 'EEG.BIN');

        // Self-describing SCALE sidecar — scale.json, DELIBERATELY distinct from
        // recovery.ts's meta.json (which owns startedAtMs/serial for crash
        // recovery; reusing that name would clobber it). Written once at stream
        // start so the cloud QC/staging knows the EXACT µV-per-LSB (and gain /
        // firmware build) this recording used. Uploaded alongside the segments
        // (cloudSync). Old recordings without it fall back to the gain-1 scale.
        try {
          const scaleMeta = {
            schemaVer: 1,
            sessionId,
            sampleRateHz: deviceScale.sampleRateHz,
            sampleIntervalMs: EEG_SAMPLE_INTERVAL_MS,
            eegRecordBytes: EEG_RECORD_BYTES,
            scale: scaleProvenance(deviceScale),
          };
          const scaleFile = new File(sessionDir, 'scale.json');
          if (scaleFile.exists) scaleFile.delete();
          scaleFile.create();
          scaleFile.write(JSON.stringify(scaleMeta));
        } catch (e) {
          if (__DEV__) console.warn('[ble/real] scale.json write failed (non-fatal):', e);
        }

        const stats: StreamStats = {
          packets: 0,
          samples: 0,
          drops: 0,
          dupSkips: 0,
          lastSeq: null,
          generation: 0,
          lastBaseMs: opts?.resumeFromBaseMs ?? null,
          deviceReboots: 0,
        };
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
          const result = parsePacket(bytes, stats.generation, deviceScale.uvPerLsb);
          if (!result.ok) {
            stats.drops++;
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
            stats.lastSeq = null;
            stats.generation = 0;
            pkt.generation = 0;
            contig.reset();
            // fall through to persist + advance below; the existing flow re-sets
            // lastBaseMs to this epoch's baseMs and restarts gap/wrap tracking.
          } else if (resume === 'dup') {
            stats.dupSkips++;
            cb.onPacket?.(pkt, stats);
            return;
          }

          // Persist FIRST. Only count a sample once its bytes are handed to the
          // file buffer — the old order bumped packets/samples BEFORE writing,
          // so a storage-full failure looked like a healthy, climbing sample
          // count while nothing reached disk (silent loss + misleading "green").
          try {
            eeg.appendChunk(encodePacketEeg(pkt));
          } catch (e) {
            // Fatal: storage full / I/O error. Stop processing further packets
            // and surface it. Do NOT advance lastBaseMs (so a resume can retry
            // this packet) and do NOT keep ticking the counters.
            fatal = true;
            cb.onError?.(new StorageWriteError((e as Error)?.message));
            return;
          }

          // Bytes are on the way to disk — now advance counters + ACK frontier.
          // Detect seq wrap → generation bump.
          if (stats.lastSeq !== null) {
            const gap = (pkt.seq - stats.lastSeq - 1) & 0xff;
            if (gap > 0) {
              stats.drops += gap;
              cb.onDrop?.('gap', stats);
            }
            if (pkt.seq < stats.lastSeq) {
              stats.generation++;
              pkt.generation = stats.generation;
            }
          }
          stats.lastSeq = pkt.seq;
          stats.packets++;
          stats.samples += SAMPLES_PER_PACKET;
          stats.lastBaseMs = pkt.baseMs;

          // Advance the ACK frontier only over in-order packets. The tracker
          // parks on a gap instead of pretending dropped data arrived.
          contig.feed(pkt.seq);

          cb.onPacket?.(pkt, stats);
        };

        subscription = manager.monitorCharacteristicForDevice(
          deviceId,
          NEUREX_SERVICE_UUID,
          NEUREX_EEG_NOTIFY_UUID,
          onValue,
        );

        return {
          sessionDir: sessionDir.uri,
          eegUri: eeg.uri,
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
              eeg.close();
            } catch (e) {
              if (__DEV__) console.warn('[ble/real] EEG close failed:', e);
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
