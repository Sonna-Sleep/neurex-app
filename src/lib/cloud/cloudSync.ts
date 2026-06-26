// Cloud sync client for the "phone = transmitter" pipeline.
//
// Ships a recording to Supabase Storage as ordered segment chunks, finalizes
// the session (which the backend webhook turns into the unified QC report and
// beta sleep staging), deletes the local copy once the cloud confirms it, and
// exposes artifact download-on-demand + live result delivery.
//
// Storage layout for normal QC:
//   {uid}/{readable-label}/segments/eeg/segNNNN.bin
// The backend concatenates these in memory; storage stays segment-shaped.

import { File, Directory, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import appConfig from '../../../app.json';

import { getSupabase } from '../auth/supabase';
import type { DeviceScaleInfo } from '../ble/scale';
import { supabaseSessionRepo } from '../repos/supabase';
import type { Session } from '../repos/types';
import { buildSessionMetadata } from './sessionMetadata';
import {
  ensureStreamStatsSidecar,
  refreshStreamStatsSidecarUploadCounts,
  streamStatsFile,
} from './streamStatsSidecar';
import { withUploadLock as runWithUploadLock, UPLOAD_LOCK_TIMEOUT_MS } from './uploadLock';
import { useDiagnostics } from '../../state/diagnostics';

// Re-export the surfaced stuck-upload counter so callers (e.g. a future health
// readout) can see how often the upload lock had to abandon a wedged transfer.
export { uploadLockStats } from './uploadLock';

export const RECORDINGS_BUCKET = 'recordings';

// On-disk bytes per sample (must match real.ts encoders + backend decoders).
//   eeg = 8  (uint32 ms + float32 fp1_uV)
//   raw = 40 (uint32 ms + uint8 seq + 3 status + 8×int32 counts) — RAW_RECORD_BYTES
const SAMPLE_BYTES = { eeg: 8, raw: 40 } as const;
export type Stream = keyof typeof SAMPLE_BYTES;

// ~5 minutes per segment at 250 Hz — fine-grained crash protection without
// flooding Storage with tiny objects. Cut on whole-sample boundaries so the
// backend's ordered concatenation is byte-identical to the original.
const SEGMENT_SECONDS = 5 * 60;
const SAMPLE_RATE_HZ = 250;

function segmentBytes(stream: Stream): number {
  return SEGMENT_SECONDS * SAMPLE_RATE_HZ * SAMPLE_BYTES[stream];
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

/**
 * Human-readable, collision-proof storage folder name for a recording:
 *   2026-06-03_2014_6m1s_3f9ac1   (date _ HHMM _ length _ short-id)
 * The 6-char id (from the session UUID) guarantees uniqueness even for two
 * recordings in the same minute; the rest is for the eye when browsing Storage.
 * Account isolation stays the opaque {user_id} parent folder — no PII in paths.
 */
export function readableLabel(
  sessionId: string,
  startMs: number,
  endMs: number,
  serial?: string,
): string {
  const d = new Date(startMs);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}`;
  const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
  const len = sec >= 60 ? `${Math.floor(sec / 60)}m${sec % 60}s` : `${sec}s`;
  // Tag the folder with the serial's tail when available; otherwise fall back
  // to the session short-id.
  const tag = serial
    ? serial.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'rec'
    : sessionId.replace(/-/g, '').slice(0, 6) || 'nodate';
  return `${date}_${time}_${len}_${tag}`;
}

/**
 * Length-free storage label for a recording whose end isn't known yet:
 *   2026-06-03_2014_3f9ac1   (date _ HHMM _ short-id/serial-tail)
 * Segments-first upload ships chunks DURING the night — before endMs exists —
 * so the prefix must be derivable at session start and stay STABLE for every
 * chunk + the eventual finalize. The recording length (cosmetic, "for the eye")
 * is dropped from the folder name; the DB row still carries start_ms/end_ms. Used
 * by the chunk driver; the legacy post-session EEG.BIN path keeps readableLabel().
 */
export function readableLabelStable(sessionId: string, startMs: number, serial?: string): string {
  const d = new Date(startMs);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}`;
  const tag = serial
    ? serial.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'rec'
    : sessionId.replace(/-/g, '').slice(0, 6) || 'nodate';
  return `${date}_${time}_${tag}`;
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

export type SegmentUploadResult = { stream: Stream; uploaded: number };

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

/** Upload one segment with bounded exponential-backoff retry. A transient
 * 4xx/5xx (incl. the token-refresh-race 400) retries that single segment rather
 * than aborting the whole night. Surfaces the HTTP status on final failure. */
async function uploadChunkWithRetry(path: string, chunk: Uint8Array): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const MAX = 5;
  let lastMsg = 'unknown error';
  for (let attempt = 0; attempt < MAX; attempt++) {
    const { error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .upload(path, chunk, { contentType: 'application/octet-stream', upsert: true });
    if (!error) return;
    const e = error as { status?: number; statusCode?: string | number; message: string };
    lastMsg = `${e.status ?? e.statusCode ?? '?'} ${e.message}`.trim();
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
  if (!file.exists) return { stream, uploaded: 0 };

  return withUploadLock(async () => {
    // Resume: don't re-send segments already in Storage (a 9.6h night is ~115
    // EEG objects — a retry should pick up where it left off).
    const already = await existingSegments(prefix, stream);

    // Memory-safe: read one segment-sized chunk at a time through a file handle
    // (readBytes advances the offset), so a full night (>100 MB) never sits in
    // RAM as a single buffer. Ordered cloud concatenation reproduces the file
    // exactly regardless of where chunk boundaries fall.
    const step = segmentBytes(stream);
    const handle = file.open();
    let index = 0;
    let uploaded = 0;
    try {
      for (;;) {
        const chunk = handle.readBytes(step); // advances offset even when we skip
        if (chunk.length === 0) break; // EOF
        const name = segName(index);
        if (!already.has(name)) {
          await uploadChunkWithRetry(`${prefix}/segments/${stream}/${name}`, chunk);
          uploaded += 1;
        }
        index += 1;
      }
    } finally {
      handle.close();
    }
    return { stream, uploaded };
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
    await uploadChunkWithRetry(`${prefix}/${name}`, bytes);
  } finally {
    handle.close();
  }
}

export type FinalizeInput = {
  sessionId: string;
  startMs: number;
  endMs: number;
};

/** Read the device/scale provenance the recording stamped locally (meta.json +
 *  scale.json) plus the tester log, and assemble the sessions metadata columns.
 *  Returns {} if nothing is available (older recordings) — never throws. */
function readFinalizeMetadata(sessionId: string): Record<string, unknown> {
  let deviceId: string | null | undefined;
  let serial: string | null | undefined;
  let scale: DeviceScaleInfo | undefined;
  try {
    const dir = new Directory(Paths.document, 'sessions', sessionId);
    const metaF = new File(dir, 'meta.json');
    if (metaF.exists) {
      const m = JSON.parse(metaF.textSync()) as { deviceId?: string; serial?: string };
      deviceId = m.deviceId;
      serial = m.serial;
    }
    const scaleF = new File(dir, 'scale.json');
    if (scaleF.exists) {
      const s = JSON.parse(scaleF.textSync()) as { scale?: DeviceScaleInfo };
      scale = s.scale;
    }
  } catch {
    /* best-effort — a missing/corrupt sidecar just means fewer metadata columns */
  }
  const testerLog = useDiagnostics.getState().lastTesterLog;
  // Per-platform build number (the night should be stamped with the binary that
  // produced it). iOS has no buildNumber in app.json yet → null (honest) rather
  // than wrongly stamping the Android versionCode.
  let appBuild: number | null;
  if (Platform.OS === 'ios') {
    const b = (appConfig.expo as { ios?: { buildNumber?: string } }).ios?.buildNumber;
    const n = b == null ? NaN : Number(b);
    appBuild = Number.isFinite(n) ? n : null; // string buildNumber → int column
  } else {
    appBuild = appConfig.expo.android?.versionCode ?? null;
  }
  return buildSessionMetadata({ deviceId, serial, scale, testerLog, appBuild });
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

/**
 * Insert the sessions row (status='uploaded'). On the cloud this fires the DB
 * webhook → Modal reads the segment stream → QC/YASA → writes results back.
 *
 * Deploy-safe: the device/scale/tester metadata columns (migration 0015) ride the
 * insert, but if 0015 hasn't landed on the live DB yet the insert is retried with
 * the CORE columns only (mirrors the backend's additive fallback) so a night is
 * never lost to a not-yet-applied migration.
 */
export async function finalizeSession(input: FinalizeInput, prefix: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
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
  const full = { ...core, ...readFinalizeMetadata(input.sessionId) };
  let { error } = await supabase.from('sessions').insert(full);
  if (error && isMissingColumnError(error)) {
    if (__DEV__)
      console.warn(
        `[cloudSync] sessions metadata columns missing (migration 0015 not applied?) — ` +
          `inserting core columns only: ${error.message}`,
      );
    ({ error } = await supabase.from('sessions').insert(core));
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
 * One-shot: upload a session's local EEG as segments, finalize, then delete
 * the local copy. Throws (and keeps local bytes) on any failure.
 */
export async function transmitSession(input: FinalizeInput): Promise<string> {
  const dir = new Directory(Paths.document, 'sessions', input.sessionId);
  if (!dir.exists) throw new Error(`no local session ${input.sessionId}`);

  // Segments-first recording (segments/eeg, no local EEG.BIN): route through the
  // chunk pipeline, which uploads any unconfirmed segments and finalizes ONLY
  // when the local tail is fully in the cloud — so it never finalizes + deletes
  // unconfirmed data the way the legacy EEG.BIN fallback would.
  // Dynamic import avoids a static cloudSync ↔ chunkRecovery cycle.
  const segEeg = new Directory(new Directory(dir, 'segments'), 'eeg');
  if (segEeg.exists) {
    const { transmitChunkedSession } = await import('./chunkRecovery');
    return transmitChunkedSession(input);
  }

  // {user_id}/{readable label} — account folder stays the opaque uid; the
  // session folder is human-readable date_time_length_shortid.
  const uid = await currentUserId();
  const prefix = `${uid}/${readableLabel(input.sessionId, input.startMs, input.endMs)}`;

  // Legacy fallback: upload the completed local EEG.BIN as ordered cloud
  // segments. This stays for old recordings and the explicit
  // EXPO_PUBLIC_CHUNKED_UPLOAD=0 emergency path; new recordings write local
  // segments directly.
  const eeg = new File(dir, 'EEG.BIN');
  await uploadFileAsSegments(prefix, 'eeg', eeg);
  // Diagnostic raw ground truth, uploaded as a parallel 'raw' segment stream
  // ({prefix}/segments/raw/segNNNN.bin → backend reads it in order). Present only
  // when raw capture was on. BEST-EFFORT: raw is a debugging bonus and must never
  // block finalizing the night. NOTE: this post-session path (and the eeg upload
  // above) writes directly to Supabase Storage via uploadChunkWithRetry — there is
  // NO per-chunk /ingest sha256 verification here; that check exists only for the
  // live chunked-recording eeg stream (chunkDriver/chunkRecovery → /ingest). The
  // backend never treats an unverified raw as authoritative (it stages the complete
  // eeg.bin), so a partial raw can't corrupt the night.
  const rawBin = new File(dir, 'RAW.BIN');
  if (rawBin.exists) {
    try {
      await uploadFileAsSegments(prefix, 'raw', rawBin);
    } catch (e) {
      if (__DEV__) console.warn('[cloudSync] raw upload failed (non-fatal):', e);
    }
  }
  // Self-describing scale/provenance sidecar (scale.json — separate from the
  // recovery meta.json) uploaded BEFORE finalize so the backend sees it when
  // staging. Best-effort: a missing/failed sidecar must not lose the night
  // (older recordings have none and fall back to the assumed scale).
  try {
    await uploadSidecarIfPresent(prefix, new File(dir, 'scale.json'), 'scale.json');
  } catch (e) {
    if (__DEV__) console.warn('[cloudSync] scale.json upload failed (non-fatal):', e);
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
    await refreshStreamStatsSidecarUploadCounts(input.sessionId, prefix);
    await uploadSidecarIfPresent(prefix, streamStatsFile(input.sessionId), 'stream_stats.json');
  } catch (e) {
    if (__DEV__) console.warn('[cloudSync] stream_stats.json upload failed (non-fatal):', e);
  }
  await finalizeSession(input, prefix);
  deleteLocalSession(input.sessionId); // nothing stays on the phone
  return prefix;
}

/**
 * Download a whole-file artifact back to the phone, on demand.
 * `prefix` is the session's storage_prefix ({user_id}/{readable label}).
 * Normal segment-first QC sessions may not have this root file unless it was a
 * legacy upload or a raw-derived reprocess artifact.
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
