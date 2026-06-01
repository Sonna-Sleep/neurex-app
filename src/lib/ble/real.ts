// Real BleClient — talks to the Cerelog single-board tracker over BLE.
//
// Flow:
//   1. scan(): scoped by NEUREX_SERVICE_UUID (Apple-compliant for background BLE).
//   2. connect(deviceId, { autoConnect: true }): MTU bump to fit 118 B in one PDU.
//   3. startStream(sessionId, cb): subscribe to the notify characteristic,
//      decode each 118-byte packet, append samples to EEG.BIN + EOG.BIN
//      under FileSystem.documentDirectory/sessions/<sessionId>/.
//
// On-disk format is byte-identical to tools/capture/ble_stream_recv.py in the
// algorithms repo, so the existing neurex_qc / neurex_stage / to_edf pipelines
// consume it without changes.
//
// Best-effort, lossy by design: BLE drops are unavoidable. Drops surface as
// onDrop callbacks + StreamStats counters; the firmware ACK loop (Phase B B4)
// is what actually closes the loss gap.

import { File, Directory, Paths } from 'expo-file-system';
import type { Subscription } from 'react-native-ble-plx';

import { getBleManager } from './manager';
import { useSession } from '../../state/session';
import {
  BATTERY_LEVEL_CHAR_UUID,
  BATTERY_SERVICE_UUID,
  BYTES_PER_FRAME,
  CH_EOG_L,
  CH_EOG_R,
  CH_FPZ,
  EEG_SAMPLE_INTERVAL_MS,
  EEG_UV_PER_LSB,
  NEUREX_ACK_INTERVAL_MS,
  NEUREX_ACK_WRITE_UUID,
  NEUREX_EEG_NOTIFY_UUID,
  NEUREX_SERVICE_UUID,
  PACKET_END_HI,
  PACKET_END_LO,
  PACKET_SIZE,
  PACKET_START_HI,
  PACKET_START_LO,
  PKT_IDX_CHECKSUM,
  PKT_IDX_DATA,
  PKT_IDX_SEQ,
  PKT_IDX_TS,
  SAMPLES_PER_PACKET,
} from './constants';
import type {
  BleClient,
  ConnectedDevice,
  EegSample,
  FoundDevice,
  ParsedPacket,
  PreviewCallbacks,
  PreviewHandle,
  StreamCallbacks,
  StreamHandle,
  StreamStats,
} from './types';

// ── helpers ────────────────────────────────────────────────────────────────

// Hermes (RN 0.81 default) provides global atob; fall back to a manual decoder
// only in environments that don't (e.g. older Jest runners).
function b64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function i24be(bytes: Uint8Array, offset: number): number {
  const v = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
  return v & 0x800000 ? v - 0x1000000 : v;
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
// Mirrors the Recorder contig logic in tools/capture/ble_stream_recv.py. The
// firmware frees ring/flash slots only up to the (gen, seq) we ACK, and ONLY
// the last *contiguous* packet may be ACKed — ACKing past a gap would free
// packets we never stitched, defeating the replay-on-reconnect guarantee.
//
// gen is the receiver's observed generation: bumped on every 0xFF→0x00 seq
// transition, exactly as the firmware producer bumps it. contig advances only
// on an exact +1 from the current frontier; a gap parks it until the missing
// packet arrives (via firmware replay), then it walks forward again.
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
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

// ── packet parser ──────────────────────────────────────────────────────────

type ParseOutcome =
  | { ok: true; packet: ParsedPacket }
  | { ok: false; reason: 'markers' | 'checksum' | 'size' };

function parsePacket(bytes: Uint8Array, generation: number): ParseOutcome {
  if (bytes.length !== PACKET_SIZE) return { ok: false, reason: 'size' };
  if (
    bytes[0] !== PACKET_START_HI ||
    bytes[1] !== PACKET_START_LO ||
    bytes[PKT_IDX_CHECKSUM + 1] !== PACKET_END_HI ||
    bytes[PKT_IDX_CHECKSUM + 2] !== PACKET_END_LO
  ) {
    return { ok: false, reason: 'markers' };
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + bytes[i]) & 0xff;
  if (sum !== bytes[PKT_IDX_CHECKSUM]) return { ok: false, reason: 'checksum' };

  const seq = bytes[PKT_IDX_SEQ];
  const baseMs = u32be(bytes, PKT_IDX_TS);
  const samples: EegSample[] = new Array(SAMPLES_PER_PACKET);
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
    const ms = (baseMs + s * EEG_SAMPLE_INTERVAL_MS) >>> 0; // wrap as uint32
    samples[s] = {
      ms,
      fpz_uV: i24be(bytes, o + CH_FPZ * 3) * EEG_UV_PER_LSB,
      eog_l_uV: i24be(bytes, o + CH_EOG_L * 3) * EEG_UV_PER_LSB,
      eog_r_uV: i24be(bytes, o + CH_EOG_R * 3) * EEG_UV_PER_LSB,
    };
  }
  return { ok: true, packet: { generation, seq, baseMs, samples } };
}

// ── on-disk encoders (match Python struct '<If' and '<Iff') ────────────────

const EEG_RECORD_BYTES = 8; // uint32 ms + float32 fpz_uV
const EOG_RECORD_BYTES = 12; // uint32 ms + float32 eog_l + float32 eog_r

function encodePacketEeg(packet: ParsedPacket): Uint8Array {
  const buf = new ArrayBuffer(SAMPLES_PER_PACKET * EEG_RECORD_BYTES);
  const view = new DataView(buf);
  for (let i = 0; i < SAMPLES_PER_PACKET; i++) {
    const s = packet.samples[i];
    view.setUint32(i * EEG_RECORD_BYTES + 0, s.ms, true);
    view.setFloat32(i * EEG_RECORD_BYTES + 4, s.fpz_uV, true);
  }
  return new Uint8Array(buf);
}

function encodePacketEog(packet: ParsedPacket): Uint8Array {
  const buf = new ArrayBuffer(SAMPLES_PER_PACKET * EOG_RECORD_BYTES);
  const view = new DataView(buf);
  for (let i = 0; i < SAMPLES_PER_PACKET; i++) {
    const s = packet.samples[i];
    view.setUint32(i * EOG_RECORD_BYTES + 0, s.ms, true);
    view.setFloat32(i * EOG_RECORD_BYTES + 4, s.eog_l_uV, true);
    view.setFloat32(i * EOG_RECORD_BYTES + 8, s.eog_r_uV, true);
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
  size: number;
  writeBytes(bytes: Uint8Array): void;
  close(): void;
};

class AppendingFile {
  readonly uri: string;
  private handle: FileHandleLike;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private readonly flushThresholdBytes: number;

  private constructor(uri: string, handle: FileHandleLike, flushThresholdBytes: number) {
    this.uri = uri;
    this.handle = handle;
    this.flushThresholdBytes = flushThresholdBytes;
  }

  static open(dir: Directory, filename: string, flushBytes = 2048): AppendingFile {
    const file = new File(dir, filename);
    if (!file.exists) file.create();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = (file as any).open() as FileHandleLike;
    handle.offset = handle.size; // seek to end (append)
    return new AppendingFile(file.uri, handle, flushBytes);
  }

  appendChunk(chunk: Uint8Array): void {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (this.pendingBytes >= this.flushThresholdBytes) this.flush();
  }

  flush(): void {
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

export const realBleClient: BleClient = {
  scan(onFound: (device: FoundDevice) => void): () => void {
    const manager = getBleManager();
    if (!manager) {
      if (__DEV__) console.warn('[ble/real] scan called with no BleManager');
      return () => {};
    }
    // Scan ALL advertisers (UUID filter passed as null) and match by name
    // client-side. The 128-bit service UUID doesn't fit the 31-byte
    // advertising packet alongside the "Neurex-EEG" name + flags, so the
    // firmware puts the UUID in the SCAN RESPONSE instead (so iOS background
    // discovery still works). Android foreground scanning here matches the
    // name in the advertising packet — simpler than a two-packet UUID filter
    // and still excludes earbuds/phones/watches/etc, so the user only sees
    // Neurex headbands in the Pair UI.
    //
    // No dedupe here: every advertisement fires onFound so the UI can
    // refresh RSSI for ranking when multiple headbands are in range.
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        if (__DEV__) console.warn('[ble/real] scan error:', error);
        return;
      }
      if (!device) return;
      const name = device.name ?? device.localName;
      if (!name || !name.startsWith('Neurex-EEG')) return;
      onFound({
        deviceId: device.id,
        serial: name,
        rssi: device.rssi ?? -127,
      });
    });
    return () => manager.stopDeviceScan();
  },

  async connect(deviceId: string): Promise<ConnectedDevice> {
    const manager = getBleManager();
    if (!manager) throw new NotReadyError('connect');

    // autoConnect: true → iOS maintains the connection across app suspensions
    // and the native side reconnects when the peripheral comes back in range.
    const device = await manager.connectToDevice(deviceId, { autoConnect: true });
    // Larger MTU fits a 118-byte packet in one PDU instead of fragmenting it.
    await device.requestMTU(247).catch((e) => {
      if (__DEV__) console.warn('[ble/real] requestMTU(247) failed:', e);
    });
    await device.discoverAllServicesAndCharacteristics();

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
      ): Promise<StreamHandle> {
        // Per-session directory under documents.
        const sessionsDir = new Directory(Paths.document, 'sessions');
        if (!sessionsDir.exists) sessionsDir.create({ intermediates: true });
        const sessionDir = new Directory(sessionsDir, sessionId);
        if (!sessionDir.exists) sessionDir.create();

        const eeg = AppendingFile.open(sessionDir, 'EEG.BIN');
        const eog = AppendingFile.open(sessionDir, 'EOG.BIN');

        const stats: StreamStats = {
          packets: 0,
          samples: 0,
          drops: 0,
          lastSeq: null,
          generation: 0,
        };
        let stopped = false;
        let subscription: Subscription | null = null;

        // Plan 02 ACK: track the contiguous frontier and write it to the
        // firmware every NEUREX_ACK_INTERVAL_MS so the device frees only
        // delivered packets and replays the rest on reconnect.
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
          if (stopped) return;
          if (error) {
            cb.onError?.(error as Error);
            return;
          }
          const b64 = characteristic?.value;
          if (!b64) return;

          const bytes = b64ToBytes(b64);
          const result = parsePacket(bytes, stats.generation);
          if (!result.ok) {
            stats.drops++;
            cb.onDrop?.(result.reason, stats);
            return;
          }
          const pkt = result.packet;

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

          // Advance the ACK frontier (only over in-order packets — the
          // tracker parks on a gap until firmware replay fills it).
          contig.feed(pkt.seq);

          try {
            eeg.appendChunk(encodePacketEeg(pkt));
            eog.appendChunk(encodePacketEog(pkt));
          } catch (e) {
            cb.onError?.(e as Error);
            return;
          }
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
          eogUri: eog.uri,
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
            try {
              eog.close();
            } catch (e) {
              if (__DEV__) console.warn('[ble/real] EOG close failed:', e);
            }
            return stats;
          },
        };
      },

      async startPreview(cb: PreviewCallbacks): Promise<PreviewHandle> {
        let stopped = false;
        let generation = 0;
        let lastSeq: number | null = null;
        const sub = manager.monitorCharacteristicForDevice(
          deviceId,
          NEUREX_SERVICE_UUID,
          NEUREX_EEG_NOTIFY_UUID,
          (error, characteristic) => {
            if (stopped) return;
            if (error) {
              cb.onError?.(error as unknown as Error);
              return;
            }
            const b64 = characteristic?.value;
            if (!b64) return;
            const bytes = b64ToBytes(b64);
            const result = parsePacket(bytes, generation);
            if (!result.ok) return;
            const pkt = result.packet;
            if (lastSeq !== null && pkt.seq < lastSeq) {
              generation++;
              pkt.generation = generation;
            }
            lastSeq = pkt.seq;
            cb.onPacket(pkt);
          },
        );
        return {
          async stop(): Promise<void> {
            stopped = true;
            try {
              sub.remove();
            } catch {
              /* ignore */
            }
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
