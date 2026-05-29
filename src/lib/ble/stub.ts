// Synthetic BLE implementation for Expo Go / web / hardware-free dev.
//
// Matches the streaming contract exactly: scan finds a fake "Neurex-EEG"
// device after ~1.8 s; startStream synthesizes 4-sample packets at ~62.5
// Hz (real cadence: 250 Hz / 4) and writes them to per-session EEG.BIN +
// EOG.BIN in the canonical on-disk format. The Home screen + upload
// pipeline therefore work end-to-end without hardware.

import { File, Directory, Paths } from 'expo-file-system';

import {
  EEG_SAMPLE_INTERVAL_MS,
  SAMPLES_PER_PACKET,
} from './constants';
import type {
  BleClient,
  ConnectedDevice,
  EegSample,
  FoundDevice,
  ParsedPacket,
  StreamCallbacks,
  StreamHandle,
  StreamStats,
} from './types';

const FAKE_DEVICE: FoundDevice = {
  deviceId: 'fake-deviceid-Neurex-EEG-STUB',
  serial: 'Neurex-EEG (stub)',
  rssi: -52,
};

// Same encoders as real.ts. Duplicated rather than imported so stub stays
// self-contained and the real-path file I/O isn't pulled into Expo Go.
const EEG_RECORD_BYTES = 8;
const EOG_RECORD_BYTES = 12;

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

type FileHandleLike = {
  offset: number;
  size: number;
  writeBytes(bytes: Uint8Array): void;
  close(): void;
};

function openAppending(dir: Directory, name: string): { uri: string; handle: FileHandleLike } {
  const file = new File(dir, name);
  if (!file.exists) file.create();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (file as any).open() as FileHandleLike;
  handle.offset = handle.size;
  return { uri: file.uri, handle };
}

export const stubBleClient: BleClient = {
  scan(onFound) {
    const t = setTimeout(() => onFound(FAKE_DEVICE), 1800);
    return () => clearTimeout(t);
  },

  async connect(deviceId): Promise<ConnectedDevice> {
    await new Promise((r) => setTimeout(r, 700));
    return {
      deviceId,

      async startStream(sessionId, cb: StreamCallbacks): Promise<StreamHandle> {
        const sessionsDir = new Directory(Paths.document, 'sessions');
        if (!sessionsDir.exists) sessionsDir.create({ intermediates: true });
        const sessionDir = new Directory(sessionsDir, sessionId);
        if (!sessionDir.exists) sessionDir.create();

        const eeg = openAppending(sessionDir, 'EEG.BIN');
        const eog = openAppending(sessionDir, 'EOG.BIN');

        const stats: StreamStats = {
          packets: 0,
          samples: 0,
          drops: 0,
          lastSeq: null,
          generation: 0,
        };
        const startedAt = Date.now();
        let stopped = false;
        let nextSeq = 0;

        // 62.5 Hz packet cadence → ~16 ms interval. setInterval(16) is fine
        // for a stub; real cadence is driven by BLE notifications.
        const interval = setInterval(() => {
          if (stopped) return;
          const baseMs = (Date.now() - startedAt) >>> 0;
          const samples: EegSample[] = [];
          for (let i = 0; i < SAMPLES_PER_PACKET; i++) {
            const ms = (baseMs + i * EEG_SAMPLE_INTERVAL_MS) >>> 0;
            // Crude 10 Hz alpha @ ~30 µV peak + tiny offset on EOG channels
            // so each one is visibly distinct in plots.
            const t = ms / 1000;
            samples.push({
              ms,
              fpz_uV: 30 * Math.sin(2 * Math.PI * 10 * t),
              eog_l_uV: 20 * Math.sin(2 * Math.PI * 0.5 * t),
              eog_r_uV: -20 * Math.sin(2 * Math.PI * 0.5 * t),
            });
          }
          const pkt: ParsedPacket = {
            generation: stats.generation,
            seq: nextSeq,
            baseMs,
            samples,
          };
          nextSeq = (nextSeq + 1) & 0xff;
          if (nextSeq === 0) stats.generation++;
          stats.lastSeq = pkt.seq;
          stats.packets++;
          stats.samples += SAMPLES_PER_PACKET;

          try {
            eeg.handle.writeBytes(encodePacketEeg(pkt));
            eog.handle.writeBytes(encodePacketEog(pkt));
          } catch (e) {
            cb.onError?.(e as Error);
            return;
          }
          cb.onPacket?.(pkt, stats);
        }, 16);

        return {
          sessionDir: sessionDir.uri,
          eegUri: eeg.uri,
          eogUri: eog.uri,
          async stop(): Promise<StreamStats> {
            if (stopped) return stats;
            stopped = true;
            clearInterval(interval);
            try {
              eeg.handle.close();
            } catch {
              /* ignore */
            }
            try {
              eog.handle.close();
            } catch {
              /* ignore */
            }
            return stats;
          },
        };
      },

      async disconnect() {},
    };
  },
};
