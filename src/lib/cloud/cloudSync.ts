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

/** Slice a flat sample stream into segment-sized Uint8Arrays on sample bounds. */
export function planSegments(total: number, stream: Stream): Array<[number, number]> {
  const step = segmentBytes(stream);
  const spans: Array<[number, number]> = [];
  for (let off = 0; off < total; off += step) {
    spans.push([off, Math.min(off + step, total)]);
  }
  return spans.length ? spans : [[0, 0]];
}

export type SegmentUploadResult = { stream: Stream; uploaded: number };

/**
 * Upload a completed local recording file as ordered segment chunks. Each
 * chunk is retried independently; a single failure rejects so the caller can
 * keep the local file and retry later (offline buffering).
 */
export async function uploadFileAsSegments(
  sessionId: string,
  stream: Stream,
  file: File,
): Promise<SegmentUploadResult> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  if (!file.exists) return { stream, uploaded: 0 };

  const uid = await currentUserId();
  const bytes = await file.bytes();
  const spans = planSegments(bytes.length, stream);
  let uploaded = 0;

  for (let i = 0; i < spans.length; i++) {
    const [start, end] = spans[i];
    if (end <= start) continue;
    const chunk = bytes.subarray(start, end);
    const path = `${uid}/${sessionId}/segments/${stream}/${segName(i)}`;
    const { error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .upload(path, chunk, { contentType: 'application/octet-stream', upsert: true });
    if (error) throw new Error(`segment upload failed (${path}): ${error.message}`);
    uploaded += 1;
  }
  return { stream, uploaded };
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
export async function finalizeSession(input: FinalizeInput): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const uid = await currentUserId();
  const { error } = await supabase.from('sessions').insert({
    id: input.sessionId,
    user_id: uid,
    status: 'uploaded',
    storage_prefix: `${uid}/${input.sessionId}`,
    start_ms: input.startMs,
    end_ms: input.endMs,
    tib: Math.max(0, (input.endMs - input.startMs) / 60000),
  });
  if (error) throw new Error(`finalize failed: ${error.message}`);
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
export async function transmitSession(input: FinalizeInput): Promise<void> {
  const dir = new Directory(Paths.document, 'sessions', input.sessionId);
  if (!dir.exists) throw new Error(`no local session ${input.sessionId}`);

  const eeg = new File(dir, 'EEG.BIN');
  const eog = new File(dir, 'EOG.BIN');
  await uploadFileAsSegments(input.sessionId, 'eeg', eeg);
  if (eog.exists) await uploadFileAsSegments(input.sessionId, 'eog', eog);
  await finalizeSession(input);
  deleteLocalSession(input.sessionId); // nothing stays on the phone
}

/** Download the assembled raw recording back to the phone, on demand. */
export async function downloadRaw(sessionId: string, stream: Stream): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new NotAuthedError();
  const uid = await currentUserId();
  const path = `${uid}/${sessionId}/${stream}.bin`;
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).download(path);
  if (error || !data) throw new Error(`download failed (${path}): ${error?.message ?? 'no data'}`);
  const buf = new Uint8Array(await data.arrayBuffer());

  const outDir = new Directory(Paths.document, 'downloads');
  if (!outDir.exists) outDir.create({ intermediates: true });
  const out = new File(outDir, `${sessionId}_${stream}.bin`);
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
  const finish = (s: Session | null) => {
    if (s && !done) {
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
