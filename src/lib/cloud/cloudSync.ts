// Cloud sync client for the "phone = transmitter" pipeline.
//
// Ships EEG/EOG RAW.BIN plus optional IMU.BIN to Supabase Storage as ordered
// segment chunks, finalizes the session (which the backend webhook turns into
// the unified QC report and beta sleep staging), deletes the local copy once
// the cloud confirms it, and exposes artifact download-on-demand + live result
// delivery.
//
// Storage layout for normal QC:
//   {uid}/{readable-label}/segments/raw/segNNNN.bin
//   {uid}/{readable-label}/segments/imu/segNNNN.bin   (optional)
// The backend concatenates these in memory; storage stays segment-shaped.

import { File, Directory, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import appConfig from '../../../app.json';

import { getSupabase } from '../auth/supabase';
import { IMU_BIN_NAME, IMU_HEADER_BYTES, IMU_META_NAME } from '../ble/imuRecord';
import type { DeviceScaleInfo } from '../ble/scale';
import { manifestFile } from '../ble/recordingManifest';
import { supabaseSessionRepo } from '../repos/supabase';
import type { Session } from '../repos/types';
import { buildSessionMetadata, colorFromSerial, deviceLabelFromColor } from './sessionMetadata';
import { hasRawProvenance, sessionRowWithRaw } from './sessionRow';
import { Sha256Stream } from './sha256Stream';
import {
  ensureStreamStatsSidecar,
  refreshStreamStatsSidecarUploadCounts,
  streamStatsFile,
} from './streamStatsSidecar';
import { writeUploadReceipt } from './uploadReceipt';
import { withUploadLock as runWithUploadLock, UPLOAD_LOCK_TIMEOUT_MS } from './uploadLock';
import { useDiagnostics } from '../../state/diagnostics';

// Re-export the surfaced stuck-upload counter so callers (e.g. a future health
// readout) can see how often the upload lock had to abandon a wedged transfer.
export { uploadLockStats } from './uploadLock';

export const RECORDINGS_BUCKET = 'recordings';

export type Stream = 'raw' | 'imu';

const DEVICE_META_NAME = 'device.json';

// Fixed chunk size keeps upload memory bounded for raw stream uploads.
const SEGMENT_BYTES = 3_000_000;

function segmentBytes(_stream: Stream): number {
  return SEGMENT_BYTES;
}

function segName(index: number): string {
  return `seg${String(index).padStart(4, '0')}.bin`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Global upload mutex. Serializes every segment-upload loop so recordings can't
// race the shared Supabase auth-token refresh or double the Storage request
// rate. Calls queue and run one fully-before-the-next; order within a stream is
// preserved. The lock's wait on a predecessor is TIME-BOUNDED (see uploadLock.ts)
// so one stuck transmission can't permanently block every future upload.
function withUploadLock<T>(fn: () => Promise<T>): Promise<T> {
  return runWithUploadLock(fn, UPLOAD_LOCK_TIMEOUT_MS, (timeouts) => {
    if (__DEV__) {
      console.warn(
        `[cloudSync] upload lock held >${Math.round(
          UPLOAD_LOCK_TIMEOUT_MS / 1000,
        )}s — abandoning stuck upload so the queue can proceed (timeouts=${timeouts})`,
      );
    }
  });
}

function datePart(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timePart(d: Date): string {
  const hours = d.getHours();
  const hour12 = hours % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours < 12 ? 'AM' : 'PM';
  return `${hour12}-${minutes}${ampm}`;
}

function shortSessionId(sessionId: string): string {
  return sessionId.replace(/-/g, '').slice(0, 6) || 'session';
}

function deviceTag(serial?: string): string {
  const trimmed = serial?.trim();
  if (!trimmed) return 'Device';
  const withoutBrand = trimmed.replace(/^Neurex[\s-]*/i, '').trim();
  const display = withoutBrand || trimmed;
  const safe = display.replace(/[^A-Za-z0-9]+/g, '');
  return safe || 'Device';
}

/**
 * Human-readable, collision-proof storage folder name for a recording:
 *   2026-06-27_4-27PM_White_d679e2   (date _ local time _ device _ short-id)
 * The short id from the session UUID guarantees uniqueness even for two
 * recordings from the same device in the same minute. Account isolation stays
 * the opaque {user_id} parent folder — no PII in paths.
 */
export function readableLabel(
  sessionId: string,
  startMs: number,
  _endMs: number,
  serial?: string,
): string {
  const d = new Date(startMs);
  return `${datePart(d)}_${timePart(d)}_${deviceTag(serial)}_${shortSessionId(sessionId)}`;
}

/**
 * Length-free storage label for a recording whose end isn't known yet:
 *   2026-06-27_4-27PM_White_d679e2   (date _ local time _ device _ short-id)
 * Kept for callers that need a stable label before endMs exists. The DB row
 * carries start_ms/end_ms; the Storage folder carries a readable local start
 * time, device tag, and short session id.
 */
export function readableLabelStable(sessionId: string, startMs: number, serial?: string): string {
  const d = new Date(startMs);
  return `${datePart(d)}_${timePart(d)}_${deviceTag(serial)}_${shortSessionId(sessionId)}`;
}

export class NotAuthedError extends Error {
  constructor() {
    super('not signed in');
    this.name = 'NotAuthedError';
  }
}

async function currentUserId(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) throw new NotAuthedError();
  return data.user.id;
}

export type SegmentUploadResult = {
  stream: Stream;
  uploaded: number;
  /** Lowercase-hex SHA-256 of the whole file (the ordered concatenation the
   * backend reassembles), computed as a byproduct of the upload read. '' when the
   * local file was absent. For EEG/EOG raw this is the client-declared integrity
   * hash that unlocks authoritative multichannel staging. */
  sha256: string;
};

/** List segment object names already in Storage under a prefix/stream, so a
 * retry can RESUME instead of re-uploading tens of MB. Paginated because a full
 * night is >100 segments and Storage list() caps each page at 100. */
async function existingSegments(prefix: string, stream: Stream): Promise<Set<string>> {
  const supabase = getSupabase();
  if (!supabase) return new Set();
  const dir = `${prefix}/segments/${stream}`;
  const names = new Set<string>();
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .list(dir, { limit: pageSize, offset });
    if (error || !data || data.length === 0) break;
    for (const o of data) names.add(o.name);
    if (data.length < pageSize) break;
  }
  return names;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function storageUploadBody(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer;
  if (
    buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
  ) {
    return buffer;
  }
  if (buffer instanceof ArrayBuffer) {
    return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function existingObjectMatches(path: string, chunk: Uint8Array): Promise<boolean | null> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).download(path);
  if (error || !data) return null;
  return bytesEqual(new Uint8Array(await data.arrayBuffer()), chunk);
}

function looksLikeDuplicateObject(error: { status?: number; statusCode?: string | number; message: string }): boolean {
  const status = Number(error.status ?? error.statusCode);
  return status === 409 || /already exists|duplicate|conflict/i.test(error.message);
}

async function uploadObjectNoOverwrite(
  path: string,
  chunk: Uint8Array,
  contentType = 'application/octet-stream',
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();

  const existing = await existingObjectMatches(path, chunk);
  if (existing === true) return;
  if (existing === false) throw new Error(`object conflict (${path}): existing bytes differ`);

  const { error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, storageUploadBody(chunk), { contentType, upsert: false });
  if (!error) return;

  const e = error as { status?: number; statusCode?: string | number; message: string };
  if (looksLikeDuplicateObject(e)) {
    const retryExisting = await existingObjectMatches(path, chunk);
    if (retryExisting === true) return;
    if (retryExisting === false) throw new Error(`object conflict (${path}): existing bytes differ`);
  }
  throw error;
}

async function uploadObjectWithOverwrite(
  path: string,
  chunk: Uint8Array,
  contentType = 'application/json',
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const { error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, storageUploadBody(chunk), { contentType, upsert: true });
  if (error) throw error;
}

/** Upload one numbered segment with bounded exponential-backoff retry. A retry is
 * idempotent only when the existing object has identical bytes; a different object
 * at the same segNNNN.bin path is a hard conflict, never overwritten. */
async function uploadSegmentWithRetry(path: string, chunk: Uint8Array): Promise<void> {
  const MAX = 5;
  let lastMsg = 'unknown error';
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      await uploadObjectNoOverwrite(path, chunk);
      return;
    } catch (error) {
      const e = error as { status?: number; statusCode?: string | number; message: string };
      lastMsg = `${e.status ?? e.statusCode ?? '?'} ${e.message}`.trim();
      if (/object conflict/i.test(e.message)) break;
    }
    if (attempt < MAX - 1) await sleep(500 * 2 ** attempt); // 0.5s,1s,2s,4s
  }
  throw new Error(`segment upload failed (${path}) after ${MAX} tries: ${lastMsg}`);
}

/**
 * Upload a completed local recording file as ordered segment chunks. Runs under
 * the global upload mutex (one recording's stream at a time), resumes past
 * already-uploaded segments, and retries each segment with backoff. Rejects only
 * after a segment exhausts its retries — the caller keeps the local file to retry.
 */
export async function uploadFileAsSegments(
  prefix: string,
  stream: Stream,
  file: File,
): Promise<SegmentUploadResult> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  if (!file.exists) return { stream, uploaded: 0, sha256: '' };

  return withUploadLock(async () => {
    // Resume: don't re-send segments already in Storage; a retry should pick up
    // where it left off.
    const already = await existingSegments(prefix, stream);

    // Memory-safe: read one segment-sized chunk at a time through a file handle
    // (readBytes advances the offset), so a full night (>100 MB) never sits in
    // RAM as a single buffer. Ordered cloud concatenation reproduces the file
    // exactly regardless of where chunk boundaries fall.
    const step = segmentBytes(stream);
    const handle = file.open();
    // Whole-file SHA-256 accumulated over the SAME ordered chunks the backend
    // concatenates, so it is byte-exact even across a resumed upload (every chunk
    // is read — and hashed — in order regardless of which segments are skipped).
    const hash = new Sha256Stream();
    let index = 0;
    let uploaded = 0;
    try {
      for (;;) {
        const chunk = handle.readBytes(step); // advances offset even when we skip
        if (chunk.length === 0) break; // EOF
        hash.update(chunk);
        const name = segName(index);
        const path = `${prefix}/segments/${stream}/${name}`;
        if (already.has(name)) {
          const matches = await existingObjectMatches(path, chunk);
          if (matches !== true) {
            throw new Error(`segment conflict (${path}): existing bytes differ or cannot be verified`);
          }
        } else {
          await uploadSegmentWithRetry(path, chunk);
          uploaded += 1;
        }
        index += 1;
      }
    } finally {
      handle.close();
    }
    return { stream, uploaded, sha256: hash.digestHex() };
  });
}

/** Upload a small sidecar file (e.g. the scale-provenance scale.json) to
 * `${prefix}/${name}` if it exists. Best-effort: sidecars are provenance, not
 * sample data, so the caller treats a failure as non-fatal. */
export async function uploadSidecarIfPresent(
  prefix: string,
  file: File,
  name: string,
): Promise<void> {
  if (!file.exists) return;
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const handle = file.open();
  try {
    const bytes = handle.readBytes(1 << 16); // sidecars are < 64 KB
    await uploadObjectWithOverwrite(`${prefix}/${name}`, bytes);
  } finally {
    handle.close();
  }
}

export type FinalizeInput = {
  sessionId: string;
  startMs: number;
  endMs: number;
  /** Whole-stream SHA-256 of the uploaded EEG/EOG RAW.BIN (lowercase hex). Set
   * ONLY when the complete raw stream is confirmed in Storage — it is the
   * backend's integrity gate that unlocks authoritative multichannel
   * (Fp1/Fp2 + EOG) staging. Required for every new successful recording. */
  rawSha256?: string | null;
  /** Storage prefix of the EEG/EOG raw stream (provenance only). */
  rawStoragePath?: string | null;
};

function recordingLabel(startMs: number): string {
  const d = new Date(startMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

type LocalSessionProvenance = {
  deviceId?: string | null;
  serial?: string | null;
  scale?: DeviceScaleInfo;
};

function sessionDirectory(sessionId: string): Directory {
  return new Directory(Paths.document, 'sessions', sessionId);
}

/** Read the device/scale provenance stamped locally at recording start.
 * Best-effort and never throws; missing/corrupt sidecars only remove metadata,
 * never block the required EEG/EOG RAW.BIN upload. */
function readLocalSessionProvenance(sessionId: string): LocalSessionProvenance {
  let deviceId: string | null | undefined;
  let serial: string | null | undefined;
  let scale: DeviceScaleInfo | undefined;
  const dir = sessionDirectory(sessionId);

  try {
    const metaF = new File(dir, 'meta.json');
    if (metaF.exists) {
      const m = JSON.parse(metaF.textSync()) as { deviceId?: string; serial?: string };
      deviceId = m.deviceId;
      serial = m.serial;
    }
  } catch {
    /* missing/corrupt meta.json only drops the display device name */
  }

  try {
    const scaleF = new File(dir, 'scale.json');
    if (scaleF.exists) {
      const s = JSON.parse(scaleF.textSync()) as { scale?: DeviceScaleInfo };
      scale = s.scale;
    }
  } catch {
    /* missing/corrupt scale.json only drops scale/device provenance */
  }

  return { deviceId, serial, scale };
}

function currentAppBuild(): number | null {
  if (Platform.OS === 'ios') {
    const b = (appConfig.expo as { ios?: { buildNumber?: string } }).ios?.buildNumber;
    const n = b == null ? NaN : Number(b);
    return Number.isFinite(n) ? n : null; // string buildNumber -> int column
  }
  return appConfig.expo.android?.versionCode ?? null;
}

/** Read the device/scale provenance plus the tester log, and assemble the
 * sessions metadata columns. Best-effort and never throws; missing sidecars
 * just mean fewer metadata columns on the sessions row. */
function readFinalizeMetadata(sessionId: string): Record<string, unknown> {
  const { deviceId, serial, scale } = readLocalSessionProvenance(sessionId);
  const testerLog = useDiagnostics.getState().lastTesterLog;
  return buildSessionMetadata({ deviceId, serial, scale, testerLog, appBuild: currentAppBuild() });
}

function writeDeviceSidecar(sessionId: string, provenance: LocalSessionProvenance): File {
  const dir = sessionDirectory(sessionId);
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, DEVICE_META_NAME);
  if (file.exists) file.delete();
  file.create();
  const serial = provenance.serial?.trim() || null;
  const scale = provenance.scale;
  file.write(
    JSON.stringify({
      schemaVer: 1,
      sessionId,
      deviceId: provenance.deviceId ?? null,
      serial,
      deviceLabel: deviceLabelFromColor(colorFromSerial(serial)),
      variantKnown: scale ? scale.variantKnown === 1 : null,
      firmwareBuildId: scale ? (scale.fwBuildId >>> 0).toString(16) : null,
      scaleSchemaVer: scale?.schemaVer ?? null,
      streamChannelCount: scale?.streamChannelCount ?? null,
      channelRole: scale?.channelRole ?? null,
      appVersion: appConfig.expo.version,
      appBuild: currentAppBuild(),
      createdAtMs: Date.now(),
    }),
  );
  return file;
}

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  // PostgREST returns PGRST204 ("column ... not found in the schema cache") when a
  // column doesn't exist yet (migration 0015 not applied). Treat that — and the
  // raw SQL "column ... does not exist" — as the additive-fallback trigger.
  return (
    error.code === 'PGRST204' ||
    /could not find|does not exist|schema cache/i.test(error.message ?? '')
  );
}

const OPTIONAL_FINALIZE_COLUMNS = new Set([
  'device_id',
  'device_label',
  'firmware_build_id',
  'uv_per_lsb',
  'pga_gain',
  'vref_v',
  'adc_bits',
  'sample_rate_hz',
  'channel_count',
  'fp1_index',
  'variant_known',
  'app_version',
  'app_build',
  'electrode_type',
  'electrode_batch',
  'montage',
  'reference_site',
  'bias_site',
  'tester',
  'notes',
]);

function missingColumnName(error: { message?: string }): string | null {
  const msg = error.message ?? '';
  return (
    msg.match(/'([a-zA-Z0-9_]+)' column/i)?.[1] ??
    msg.match(/column "?([a-zA-Z0-9_]+)"? (?:of relation "[^"]+" )?does not exist/i)?.[1] ??
    null
  );
}

/**
 * Insert the sessions row (status='uploaded'). On the cloud this fires the DB
 * webhook → Modal reads the segment stream → QC/YASA → writes results back.
 *
 * Deploy-safe: optional device/scale/tester/app metadata rides the insert, but if
 * production is missing one optional column, retry without only that column.
 * Required storage, recording label, and raw provenance must stay present.
 */
export async function finalizeSession(input: FinalizeInput, prefix: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  if (!hasRawProvenance(input)) {
    throw new Error('finalize blocked: EEG/EOG RAW.BIN upload/hash is required');
  }
  const uid = await currentUserId();
  const core = {
    id: input.sessionId,
    user_id: uid,
    status: 'uploaded',
    storage_prefix: prefix,
    start_ms: input.startMs,
    end_ms: input.endMs,
    tib: Math.max(0, (input.endMs - input.startMs) / 60000),
  };
  const readable = {
    recording_label: recordingLabel(input.startMs),
  };
  // raw_sha256/raw_storage_path ride every insert. The additive fallback may
  // drop optional metadata columns, but it must not drop raw_sha256.
  const full = sessionRowWithRaw(
    { ...core, ...readable, ...readFinalizeMetadata(input.sessionId) },
    { rawSha256: input.rawSha256, rawStoragePath: input.rawStoragePath },
  );
  let row = full;
  let { error } = await supabase.from('sessions').insert(row);
  const droppedColumns: string[] = [];
  while (error && isMissingColumnError(error)) {
    const col = missingColumnName(error);
    if (!col || !OPTIONAL_FINALIZE_COLUMNS.has(col) || !(col in row)) break;
    droppedColumns.push(col);
    const { [col]: _dropped, ...next } = row;
    row = next;
    if (__DEV__)
      console.warn(
        `[cloudSync] optional sessions column missing (${col}) — retrying without it: ` +
          error.message,
      );
    ({ error } = await supabase.from('sessions').insert(row));
  }
  if (!error && droppedColumns.length > 0 && __DEV__) {
    console.warn(`[cloudSync] finalized after dropping optional columns: ${droppedColumns.join(', ')}`);
  }
  // Idempotent: a retry with the same session id re-runs finalize after the row
  // already exists. A unique-violation (23505) just means "already finalized" —
  // the backend will still stage it — so it's a success, not an error. Anything
  // else is a real failure.
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505' || /duplicate key|already exists/i.test(error.message)) return;
    throw new Error(`finalize failed: ${error.message}`);
  }
}

/** Delete the local session directory after the cloud has confirmed the upload. */
export function deleteLocalSession(sessionId: string): void {
  const dir = new Directory(Paths.document, 'sessions', sessionId);
  if (dir.exists) dir.delete();
}

/**
 * One-shot: upload a session's EEG/EOG RAW.BIN plus optional IMU.BIN, finalize,
 * then delete the local copy.
 */
export async function transmitSession(input: FinalizeInput): Promise<string> {
  const dir = sessionDirectory(input.sessionId);
  if (!dir.exists) throw new Error(`no local session ${input.sessionId}`);

  const provenance = readLocalSessionProvenance(input.sessionId);

  // {user_id}/{readable label} — account folder stays the opaque uid; the
  // session folder is human-readable date_time_device_shortid.
  const uid = await currentUserId();
  const prefix = `${uid}/${readableLabel(
    input.sessionId,
    input.startMs,
    input.endMs,
    provenance.serial ?? undefined,
  )}`;

  // Required EEG/EOG raw stream ({prefix}/segments/raw/segNNNN.bin). The backend
  // reads it in order. A retry may accept identical existing bytes, but never
  // overwrites different bytes at the same segNNNN.bin.
  const rawBin = new File(dir, 'RAW.BIN');
  if (!rawBin.exists || rawBin.size <= 0) {
    throw new Error('raw upload required: missing EEG/EOG RAW.BIN');
  }
  const res = await uploadFileAsSegments(prefix, 'raw', rawBin);
  const rawSha256 = res.sha256 || null;
  if (!rawSha256) throw new Error('raw upload produced no sha256');

  const imuBin = new File(dir, IMU_BIN_NAME);
  let imuSha256: string | null = null;
  let imuUploaded = false;
  const hasImuSamples = imuBin.exists && imuBin.size > IMU_HEADER_BYTES;
  if (hasImuSamples) {
    const imuRes = await uploadFileAsSegments(prefix, 'imu', imuBin);
    imuSha256 = imuRes.sha256 || null;
    if (!imuSha256) throw new Error('IMU upload produced no sha256');
    imuUploaded = true;
  }
  // Self-describing scale/provenance sidecar (scale.json — separate from the
  // recovery meta.json) uploaded BEFORE finalize so the backend sees it when
  // staging. Best-effort: a missing/failed sidecar is reported by backend/QC,
  // but must not delete an otherwise complete EEG/EOG RAW.BIN night.
  try {
    await uploadSidecarIfPresent(prefix, new File(dir, 'scale.json'), 'scale.json');
  } catch (e) {
    if (__DEV__) console.warn('[cloudSync] scale.json upload failed (non-fatal):', e);
  }
  try {
    await uploadSidecarIfPresent(prefix, manifestFile(input.sessionId), 'recording_manifest.json');
  } catch (e) {
    if (__DEV__) console.warn('[cloudSync] recording_manifest.json upload failed (non-fatal):', e);
  }
  try {
    await uploadSidecarIfPresent(
      prefix,
      writeDeviceSidecar(input.sessionId, provenance),
      DEVICE_META_NAME,
    );
  } catch (e) {
    if (__DEV__) console.warn('[cloudSync] device.json upload failed (non-fatal):', e);
  }
  if (hasImuSamples) {
    try {
      await uploadSidecarIfPresent(prefix, new File(dir, IMU_META_NAME), IMU_META_NAME);
    } catch (e) {
      if (__DEV__) console.warn('[cloudSync] imu.json upload failed (non-fatal):', e);
    }
  }
  // App-side BLE/upload forensic sidecar. Best-effort, but written/uploaded
  // before finalize so the backend can include it in the one QC report.
  try {
    await ensureStreamStatsSidecar({
      sessionId: input.sessionId,
      startedAtMs: input.startMs,
      endMs: input.endMs,
      stopReason: 'recovery',
      prefix,
    });
    await refreshStreamStatsSidecarUploadCounts(
      input.sessionId,
      prefix,
      {
        rawSha256,
        rawUploaded: !!rawSha256,
      },
      {
        imuSha256,
        imuUploaded,
      },
    );
    await uploadSidecarIfPresent(prefix, streamStatsFile(input.sessionId), 'stream_stats.json');
  } catch (e) {
    if (__DEV__) console.warn('[cloudSync] stream_stats.json upload failed (non-fatal):', e);
  }
  const rawStoragePath = `${prefix}/segments/raw`;
  await finalizeSession(
    {
      ...input,
      rawSha256,
      rawStoragePath,
    },
    prefix,
  );
  writeUploadReceipt({
    sessionId: input.sessionId,
    storagePrefix: prefix,
    rawStoragePath,
    rawSha256,
    imuSha256,
  });
  return prefix;
}

/**
 * Download a whole-file artifact back to the phone, on demand.
 * `prefix` is the session's storage_prefix ({user_id}/{readable label}).
 * Root files are usually generated artifacts; uploaded EEG/EOG recordings live
 * under segments/raw.
 */
export async function downloadRaw(prefix: string, stream: Stream): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const path = `${prefix}/${stream}.bin`;
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).download(path);
  if (error || !data) throw new Error(`download failed (${path}): ${error?.message ?? 'no data'}`);
  const buf = new Uint8Array(await data.arrayBuffer());

  const label = prefix.split('/').pop() || 'recording';
  const outDir = new Directory(Paths.document, 'downloads');
  if (!outDir.exists) outDir.create({ intermediates: true });
  const out = new File(outDir, `${label}_${stream}.bin`);
  if (out.exists) out.delete();
  out.create();
  out.write(buf);
  return out.uri;
}

/**
 * Live result delivery: subscribe to this user's session row and call back with
 * the staged summary the moment the backend flips it to 'ready'. Falls back to
 * one immediate read in case it was already done. Returns an unsubscribe fn.
 */
export type SubscribeResultOpts = {
  /** If the row hasn't flipped to 'ready' within this window, fire `onSlow`
   * once so the UI can stop showing an endless spinner. The subscription stays
   * live, so a late 'ready' still delivers via `onReady`. */
  timeoutMs?: number;
  /** Poll fallback after `onSlow` fires. Realtime can miss updates while the app
   * is backgrounded/suspended; polling keeps the Sleep page in sync with Journal. */
  pollIntervalMs?: number;
  onSlow?: () => void;
  /** Called when the backend marks staging as failed. */
  onFailed?: (message?: string) => void;
};

export function subscribeToResult(
  sessionId: string,
  onReady: (session: Session) => void,
  opts?: SubscribeResultOpts,
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  let done = false;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let appStateSub: { remove: () => void } | null = null;
  const clearSlow = () => {
    if (slowTimer) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
  };
  const clearPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
  const poll = () => {
    if (!done) supabaseSessionRepo.byId(sessionId).then(finish).catch(() => {});
  };
  const startPoll = () => {
    if (pollTimer || done) return;
    poll();
    pollTimer = setInterval(poll, opts?.pollIntervalMs ?? 15_000);
  };
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') poll();
  });
  // Only fire for a row the backend has actually staged. byId returns the row at
  // ANY status (including the just-inserted 'uploaded'), so without this guard
  // the immediate read below would flip the UI to "done" before backend analysis
  // ever runs.
  const fail = (message?: string) => {
    if (!done) {
      done = true;
      clearSlow();
      clearPoll();
      opts?.onFailed?.(message);
    }
  };
  const finish = (s: Session | null) => {
    if (!s || done) return;
    if (s.status === 'failed') {
      fail();
    } else if (s.status === 'ready') {
      done = true;
      clearSlow();
      clearPoll();
      onReady(s);
    }
  };

  // Immediate read (already processed?).
  supabaseSessionRepo.byId(sessionId).then(finish).catch(() => {});
  startPoll();

  const channel = supabase
    .channel(`session-${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        const row = payload.new as { status?: string; error?: string | null } | null;
        if (row?.status === 'ready') {
          supabaseSessionRepo.byId(sessionId).then(finish).catch(() => {});
        } else if (row?.status === 'failed') {
          fail(row.error ?? undefined);
        }
      },
    )
    .subscribe();

  // Stalled-staging escape hatch: surface "still analyzing" rather than an
  // infinite spinner. Does NOT unsubscribe — a late 'ready' still resolves.
  if (opts?.timeoutMs && opts.onSlow) {
    const onSlow = opts.onSlow;
    slowTimer = setTimeout(() => {
      if (!done) {
        onSlow();
        startPoll();
      }
    }, opts.timeoutMs);
  }

  return () => {
    clearSlow();
    clearPoll();
    appStateSub?.remove();
    appStateSub = null;
    supabase.removeChannel(channel);
  };
}
