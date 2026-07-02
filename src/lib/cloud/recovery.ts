// Crash / kill recovery for EEG/EOG RAW.BIN overnight recordings.
//
// If the app is killed mid-night (OOM, crash, force-stop, reboot), the bytes are
// on disk but the in-memory session state is gone, so without this nothing would
// upload them. This module closes that gap:
//
//   - At session start, streamController writes a self-describing meta.json into
//     the session dir AND a durable "active recording" marker in AsyncStorage
//     (so an iOS state-restoration relaunch knows which session to resume).
//   - At a clean stop, the marker is cleared.
//   - On app launch, scanRecoverable() finds every session dir with a non-empty
//     EEG/EOG RAW.BIN that isn't the live session and isn't yet uploaded. An
//     uploaded night's dir is removed by deleteLocalSession; recoverAll() ships them
//     through the same transmitSession path. transmitSession deletes the local
//     copy only after the cloud upload + finalize succeed, so a failed recovery
//     keeps the bytes for next launch.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';

import { transmitSession } from './cloudSync';
import {
  reconstructTiming,
  durationMsFromBytes,
  isStageableDurationMs,
  RECOVERY_RESTORE_GRACE_MS,
} from './recoveryMath';
import { EEG_SAMPLE_RATE_HZ } from '../ble/constants';
import { IMU_BIN_NAME, IMU_HEADER_BYTES, IMU_META_NAME } from '../ble/imuRecord';
import { readRecordingManifest } from '../ble/recordingManifest';

const ACTIVE_KEY = 'neurex-active-recording';
const META_NAME = 'meta.json';
const RAW_NAME = 'RAW.BIN';

export type RecordingMeta = {
  sessionId: string;
  startedAtMs: number;
  endMs?: number;
  deviceId?: string | null;
  serial?: string | null;
};

export type RecoverableRecording = {
  sessionId: string;
  startedAtMs: number;
  endMs: number;
  sizeBytes: number;
  serial?: string | null;
};

export type LocalRecordingInspection = RecoverableRecording & {
  durationMs: number;
  stageable: boolean;
  hasScale: boolean;
  hasManifest: boolean;
  hasStreamStats: boolean;
  hasImu: boolean;
  hasImuMeta: boolean;
};

function sessionsDir(): Directory {
  return new Directory(Paths.document, 'sessions');
}

function isMeta(m: unknown): m is RecordingMeta {
  return (
    !!m &&
    typeof (m as RecordingMeta).sessionId === 'string' &&
    typeof (m as RecordingMeta).startedAtMs === 'number'
  );
}

// ── durable active-recording marker (AsyncStorage) ─────────────────────────

/** Persist which session is live + where it started, so an iOS restoration
 * relaunch can resume it. Best-effort; failure never blocks recording. */
export async function setActiveRecording(meta: RecordingMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(meta));
  } catch {
    /* non-fatal */
  }
}

export async function clearActiveRecording(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* non-fatal */
  }
}

export async function getActiveRecording(): Promise<RecordingMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return isMeta(m) ? m : null;
  } catch {
    return null;
  }
}

// ── self-describing per-session meta.json ──────────────────────────────────

/** Write meta.json into the session dir (best-effort) so a recovered orphan's
 * true start time + device survive a kill even without the AsyncStorage marker. */
export function writeSessionMeta(meta: RecordingMeta): void {
  try {
    const dir = new Directory(sessionsDir(), meta.sessionId);
    if (!dir.exists) dir.create({ intermediates: true });
    const f = new File(dir, META_NAME);
    if (!f.exists) f.create();
    f.write(JSON.stringify(meta));
  } catch {
    /* non-fatal — recovery still reconstructs timing from size + mtime */
  }
}

function readMeta(dir: Directory): RecordingMeta | null {
  try {
    const f = new File(dir, META_NAME);
    if (!f.exists) return null;
    const m = JSON.parse(f.textSync());
    return isMeta(m) ? m : null;
  } catch {
    return null;
  }
}

function fileExists(dir: Directory, name: string): boolean {
  try {
    return new File(dir, name).exists;
  } catch {
    return false;
  }
}

function fileSizeIfPresent(dir: Directory, name: string): number {
  try {
    const f = new File(dir, name);
    return f.exists ? f.size : 0;
  } catch {
    return 0;
  }
}

// ── scan + recover orphaned recordings ─────────────────────────────────────

/** Inspect every local recording folder with a non-empty RAW.BIN. Unlike
 * scanRecoverable(), this includes short/debug captures so the UI can always
 * show what is still on the phone and export it if needed. */
export function inspectLocalRecordings(activeSessionId?: string | null): LocalRecordingInspection[] {
  const out: LocalRecordingInspection[] = [];
  let items: (Directory | File)[];
  try {
    const dir = sessionsDir();
    if (!dir.exists) return out;
    items = dir.list();
  } catch {
    return out;
  }

  for (const item of items) {
    if (!(item instanceof Directory)) continue;
    const sessionId = item.uri.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!sessionId || sessionId === activeSessionId || sessionId.startsWith('__')) continue;

    let raw: File;
    try {
      raw = new File(item, RAW_NAME);
      if (!raw.exists || raw.size <= 0) continue;
    } catch {
      continue;
    }

    const sizeBytes = raw.size;
    const meta = readMeta(item);
    const manifest = readRecordingManifest(sessionId);
    const sampleRateHz = manifest?.sampleRateHz ?? EEG_SAMPLE_RATE_HZ;
    const rawBytesPerSample = manifest?.rawRecordBytes ?? null;
    const durationMs = durationMsFromBytes(sizeBytes, sampleRateHz, rawBytesPerSample ?? undefined);
    const timing = reconstructTiming({
      sizeBytes,
      sampleRateHz,
      rawBytesPerSample,
      modificationTimeMs: raw.modificationTime,
      metaStartedAtMs: meta?.startedAtMs ?? (manifest?.startedAtMs || null),
      nowMs: Date.now(),
    });

    out.push({
      sessionId,
      startedAtMs: timing.startedAtMs,
      endMs: timing.endMs,
      durationMs,
      sizeBytes,
      serial: meta?.serial ?? null,
      stageable: isStageableDurationMs(durationMs),
      hasScale: fileExists(item, 'scale.json'),
      hasManifest: fileExists(item, 'recording_manifest.json'),
      hasStreamStats: fileExists(item, 'stream_stats.json'),
      hasImu: fileSizeIfPresent(item, IMU_BIN_NAME) > IMU_HEADER_BYTES,
      hasImuMeta: fileExists(item, IMU_META_NAME),
    });
  }

  return out.sort((a, b) => b.startedAtMs - a.startedAtMs);
}

/**
 * Find recordings on disk that were never uploaded: every session dir with a
 * non-empty EEG/EOG RAW.BIN, except the one currently recording. Endpoints come
 * from meta.json when present, else are reconstructed from the file's byte count
 * (→ duration) and modification time, so even a metadata-less orphan uploads.
 */
export function scanRecoverable(activeSessionId?: string | null): RecoverableRecording[] {
  const out: RecoverableRecording[] = [];
  let items: (Directory | File)[];
  try {
    const dir = sessionsDir();
    if (!dir.exists) return out;
    items = dir.list();
  } catch {
    return out;
  }
  for (const item of items) {
    if (!(item instanceof Directory)) continue;
    const sessionId = item.uri.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!sessionId || sessionId === activeSessionId) continue;
    // Reserved '__'-prefixed dirs are NOT recordings (e.g. the contact-quality
    // preview '__contact_preview__') — never upload them as a night.
    if (sessionId.startsWith('__')) continue;
    let raw: File;
    try {
      raw = new File(item, RAW_NAME);
      if (!raw.exists || raw.size <= 0) continue;
    } catch {
      continue;
    }
    const sizeBytes = raw.size;
    const meta = readMeta(item);
    const manifest = readRecordingManifest(sessionId);
    const sampleRateHz = manifest?.sampleRateHz ?? EEG_SAMPLE_RATE_HZ;
    const rawBytesPerSample = manifest?.rawRecordBytes ?? null;
    // Apply the same minimum-length floor as the live sync path. Short setup or
    // debug captures are not useful for cloud staging, so don't ship them — they
    // stay on disk like a short recording kept in the app.
    if (!isStageableDurationMs(durationMsFromBytes(sizeBytes, sampleRateHz, rawBytesPerSample ?? undefined))) {
      continue;
    }
    const { startedAtMs, endMs } = reconstructTiming({
      sizeBytes,
      sampleRateHz,
      rawBytesPerSample,
      modificationTimeMs: raw.modificationTime,
      metaStartedAtMs: meta?.startedAtMs ?? (manifest?.startedAtMs || null),
      nowMs: Date.now(),
    });
    out.push({ sessionId, startedAtMs, endMs, sizeBytes, serial: meta?.serial ?? null });
  }
  return out;
}

export type RecoveryResult = { sessionId: string; ok: boolean; error?: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The session id that must NOT be swept: the live recording OR one currently
 * being resumed from iOS state restoration. Read via dynamic import because
 * streamController.ts statically imports THIS module, so a static import would
 * be a cycle. Returns null if unavailable (e.g. unit tests). */
async function liveOrRestoringSessionId(): Promise<string | null> {
  try {
    const { activeOrRestoringSessionId } = await import('../ble/streamController');
    return activeOrRestoringSessionId();
  } catch {
    return null;
  }
}

/**
 * Upload every recoverable recording through the normal transmit path. Each is
 * independent — one failure doesn't block the rest. Returns a per-session
 * result for logging/surfacing.
 *
 * Guards the iOS state-restoration race: if a marker says a session was
 * recording when we were killed, a background resume (wakeHandler →
 * resumeSessionAfterRestore) may be about to reclaim it onto the SAME dir.
 * Uploading + deleting that dir mid-resume would corrupt the live night. So we
 * wait a grace window when a marker exists, then exclude whatever is ACTUALLY
 * live or mid-resume now (a stale marker with no live resume still gets its
 * orphan recovered).
 */
export async function recoverAll(activeSessionId?: string | null): Promise<RecoveryResult[]> {
  const marker = await getActiveRecording();
  if (marker) await delay(RECOVERY_RESTORE_GRACE_MS);

  const liveId = (await liveOrRestoringSessionId()) ?? activeSessionId ?? null;
  const recs = scanRecoverable(activeSessionId).filter((r) => r.sessionId !== liveId);
  const results: RecoveryResult[] = [];
  for (const r of recs) {
    try {
      await transmitSession({ sessionId: r.sessionId, startMs: r.startedAtMs, endMs: r.endMs });
      results.push({ sessionId: r.sessionId, ok: true });
    } catch (e) {
      results.push({ sessionId: r.sessionId, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
