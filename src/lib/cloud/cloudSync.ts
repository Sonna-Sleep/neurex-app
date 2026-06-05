// Cloud sync client for the "phone = transmitter" pipeline.
//
// Ships a recording to Supabase Storage as ordered segment chunks, finalizes
// the session (which the backend webhook turns into YASA staging), deletes the
// local copy once the cloud confirms it, and exposes raw download-on-demand +
// live result delivery.
//
// STATUS: compile-verified, NOT yet device-tested (built while the test phone
// was unplugged). It is intentionally ADDITIVE — it does not touch the
// validated BLE→local-file recording path in real.ts. Wiring it into the
// recording flow + on-device verification is the remaining Phase-2 step.
//
// Storage layout (matches backend assemble_if_needed):
//   {uid}/{sessionId}/segments/eeg/segNNNN.bin
//   {uid}/{sessionId}/segments/eog/segNNNN.bin
// The backend concatenates these (whole-sample boundaries) into eeg.bin/eog.bin.

import { File, Directory, Paths } from 'expo-file-system';

import { getSupabase } from '../auth/supabase';
import { supabaseSessionRepo } from '../repos/supabase';
import type { Session } from '../repos/types';

export const RECORDINGS_BUCKET = 'recordings';

// On-disk bytes per sample (must match real.ts encoders + backend decoders).
const SAMPLE_BYTES = { eeg: 8, eog: 12 } as const;
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

// Global upload mutex. Serializes EVERY segment-upload loop (single- and
// dual-record) so two recordings syncing at once can't race the shared Supabase
// auth-token refresh or double the Storage request rate — the likely trigger of
// the mid-stream HTTP 400 seen when both nights were synced together. Calls
// queue and run one fully-before-the-next; order within a stream is preserved.
let uploadTail: Promise<unknown> = Promise.resolve();
function withUploadLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = uploadTail.then(fn, fn);
  uploadTail = run.catch(() => {});
  return run;
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
  // For dual-record the two nights share a phone but come from different
  // headbands — tag the folder with the serial's tail so they're tellable apart
  // at a glance. Single-device falls back to the session short-id.
  const tag = serial
    ? serial.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'rec'
    : sessionId.replace(/-/g, '').slice(0, 6) || 'nodate';
  return `${date}_${time}_${len}_${tag}`;
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
    // EEG + ~115 EOG objects — a retry should pick up where it left off).
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

export type FinalizeInput = {
  sessionId: string;
  startMs: number;
  endMs: number;
};

/**
 * Insert the sessions row (status='uploaded'). On the cloud this fires the DB
 * webhook → Modal assembles the segments → YASA → writes results back.
 */
export async function finalizeSession(input: FinalizeInput, prefix: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const uid = await currentUserId();
  const { error } = await supabase.from('sessions').insert({
    id: input.sessionId,
    user_id: uid,
    status: 'uploaded',
    storage_prefix: prefix,
    start_ms: input.startMs,
    end_ms: input.endMs,
    tib: Math.max(0, (input.endMs - input.startMs) / 60000),
  });
  // Idempotent: a retry of a recording with a STABLE session id (dual-record)
  // re-runs finalize after the row already exists. A unique-violation (23505)
  // just means "already finalized" — the backend will still stage it — so it's
  // a success, not an error. Anything else is a real failure.
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
 * One-shot: upload a session's local EEG (+ optional EOG) as segments, finalize,
 * then delete the local copy. Throws (and keeps local bytes) on any failure.
 */
export async function transmitSession(input: FinalizeInput): Promise<string> {
  const dir = new Directory(Paths.document, 'sessions', input.sessionId);
  if (!dir.exists) throw new Error(`no local session ${input.sessionId}`);

  // {user_id}/{readable label} — account folder stays the opaque uid; the
  // session folder is human-readable date_time_length_shortid.
  const uid = await currentUserId();
  const prefix = `${uid}/${readableLabel(input.sessionId, input.startMs, input.endMs)}`;

  const eeg = new File(dir, 'EEG.BIN');
  const eog = new File(dir, 'EOG.BIN');
  await uploadFileAsSegments(prefix, 'eeg', eeg);
  if (eog.exists) await uploadFileAsSegments(prefix, 'eog', eog);
  await finalizeSession(input, prefix);
  deleteLocalSession(input.sessionId); // nothing stays on the phone
  return prefix;
}

/** expo-crypto's randomUUID is RFC4122 v4 on SDK 54 — the cloud sessions.id
 * column is a strict uuid, so dual-record (whose local folder id is
 * "<serial>_<uuid>") must mint a fresh one rather than reuse the folder name. */
function newUuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as { randomUUID?: () => string };
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  throw new Error('expo-crypto randomUUID unavailable — cannot mint cloud session id');
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pull the embedded uuid out of a dual folder id ("<serial>_<uuid>"), so the
 * cloud session id is stable + valid without a sidecar lookup. */
function uuidFromFolderId(folderId: string): string | null {
  const m = folderId.match(UUID_RE);
  return m ? m[0] : null;
}

type CloudMeta = { cloudSessionId: string; prefix: string; startMs: number; endMs: number };

/**
 * Resolve the STABLE cloud identity for a local recording, persisted in a
 * `cloud.json` sidecar inside the session folder. This is the fix for the
 * duplicate-folder bug: a recovered recording has no fixed wall-clock start, so
 * deriving it from `Date.now()` made every retry mint a new prefix and re-upload
 * the whole night. Locking the chosen id + prefix + bounds on first sync means
 * every later retry reuses the SAME storage folder — so segment-resume actually
 * works and we never scatter duplicate copies across folders.
 */
async function getOrCreateCloudMeta(
  dir: Directory,
  folderId: string,
  uid: string,
  serial: string | undefined,
  startMs: number,
  endMs: number,
): Promise<CloudMeta> {
  const metaFile = new File(dir, 'cloud.json');
  if (metaFile.exists) {
    try {
      const m = JSON.parse(await metaFile.text()) as Partial<CloudMeta>;
      if (m.cloudSessionId && m.prefix && typeof m.startMs === 'number' && typeof m.endMs === 'number') {
        return m as CloudMeta;
      }
    } catch {
      // fall through and re-create
    }
  }
  const cloudSessionId = uuidFromFolderId(folderId) ?? newUuid();
  const meta: CloudMeta = {
    cloudSessionId,
    prefix: `${uid}/${readableLabel(cloudSessionId, startMs, endMs, serial)}`,
    startMs,
    endMs,
  };
  try {
    metaFile.write(JSON.stringify(meta));
  } catch {
    // sidecar is an optimization; if the write fails we still have a valid meta
    // for this attempt (stability degrades to derive-from-folder-uuid only)
  }
  return meta;
}

/**
 * Transmit a local recording whose on-disk folder id is NOT a bare uuid. The
 * dual-record path (multiController) names folders "<serial>_<uuid>". A stable
 * cloud id + prefix is pinned in a sidecar on first sync so retries resume the
 * same upload instead of starting a new folder. Returns the CLOUD session id
 * (subscribe to that for the staged result).
 *
 * NON-DESTRUCTIVE on purpose: unlike transmitSession it does NOT delete the
 * local files. The dual path is a two-person stopgap and the recordings may be
 * the only on-device copy of someone else's night — the caller decides deletion.
 */
export async function transmitLocalRecording(opts: {
  folderId: string;
  serial?: string;
  startMs: number;
  endMs: number;
}): Promise<string> {
  const dir = new Directory(Paths.document, 'sessions', opts.folderId);
  if (!dir.exists) throw new Error(`no local session ${opts.folderId}`);

  const uid = await currentUserId();
  const meta = await getOrCreateCloudMeta(dir, opts.folderId, uid, opts.serial, opts.startMs, opts.endMs);

  const eeg = new File(dir, 'EEG.BIN');
  const eog = new File(dir, 'EOG.BIN');
  await uploadFileAsSegments(meta.prefix, 'eeg', eeg);
  if (eog.exists) await uploadFileAsSegments(meta.prefix, 'eog', eog);
  await finalizeSession(
    { sessionId: meta.cloudSessionId, startMs: meta.startMs, endMs: meta.endMs },
    meta.prefix,
  );
  return meta.cloudSessionId;
}

/**
 * Download the assembled raw recording back to the phone, on demand.
 * `prefix` is the session's storage_prefix ({user_id}/{readable label}).
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
export function subscribeToResult(
  sessionId: string,
  onReady: (session: Session) => void,
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  let done = false;
  // Only fire for a row the backend has actually staged. byId returns the row at
  // ANY status (including the just-inserted 'uploaded'), so without this guard
  // the immediate read below would flip the UI to "done" before YASA ever runs.
  const finish = (s: Session | null) => {
    if (s && s.status === 'ready' && !done) {
      done = true;
      onReady(s);
    }
  };

  // Immediate read (already processed?).
  supabaseSessionRepo.byId(sessionId).then(finish).catch(() => {});

  const channel = supabase
    .channel(`session-${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        const row = payload.new as { status?: string } | null;
        if (row?.status === 'ready') {
          supabaseSessionRepo.byId(sessionId).then(finish).catch(() => {});
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
