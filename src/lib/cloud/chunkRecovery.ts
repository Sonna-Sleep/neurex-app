// Launch-time recovery + post-session transmit for the 30-min chunked-upload
// pipeline (Feature 2).
//
// A chunked night is written as segments/eeg/segNNNN.bin and uploaded +
// deleted-after-confirm DURING the recording. Two gaps this closes:
//
//   - Crash mid-night: the confirmed segments are safely in the cloud (deleted
//     locally) and the un-uploaded tail is still on disk — but the session was
//     never finalized, so the backend (which only re-dispatches EXISTING session
//     rows) would never stage it. recoverChunkedSessions() ships the tail and
//     finalizes once it's fully confirmed.
//   - Manual "Sync to cloud" / the normal transmit path reads EEG.BIN, which a
//     chunked session doesn't have; transmitChunkedSession() handles it instead
//     so the post-session path never finalizes+deletes unconfirmed segments.
//
// Invariant: NEVER finalize while local segments remain (an outage just retries),
// and NEVER delete a segment the server didn't confirm.

import { Directory, File, Paths } from 'expo-file-system';

import { getSupabase } from '../auth/supabase';
import { CHUNK_SECONDS, CHUNKED_UPLOAD_ENABLED } from '../config';
import { estimateChunkedDurationMs, parseSegName } from '../ble/segRoll';
import { addTask } from './chunkQueue';
import { drainChunks } from './chunkDriver';
import { fileQueueStore, readSegBytes, sha256Hex } from './chunkUploadStore';
import {
  deleteLocalSession,
  type FinalizeInput,
  finalizeSession,
  readableLabelStable,
  uploadSidecarIfPresent,
} from './cloudSync';
import { isStageableDurationMs } from './recoveryMath';

const META_NAME = 'meta.json';

type ChunkMeta = { sessionId: string; startedAtMs: number; serial?: string | null };

function sessionsRoot(): Directory {
  return new Directory(Paths.document, 'sessions');
}

function segEegDir(sessionDir: Directory): Directory {
  return new Directory(new Directory(sessionDir, 'segments'), 'eeg');
}

function readMeta(dir: Directory): ChunkMeta | null {
  try {
    const f = new File(dir, META_NAME);
    if (!f.exists) return null;
    const m = JSON.parse(f.textSync());
    if (m && typeof m.sessionId === 'string' && typeof m.startedAtMs === 'number') return m;
    return null;
  } catch {
    return null;
  }
}

type LocalSeg = { index: number; uri: string; bytes: number };

/** The live / mid-iOS-restore session id, which must never be swept. Dynamic
 * import because streamController statically imports the chunk driver, so a
 * static import here risks a cycle. Returns null if unavailable (e.g. tests). */
async function liveOrRestoringSessionId(): Promise<string | null> {
  try {
    const { activeOrRestoringSessionId } = await import('../ble/streamController');
    return activeOrRestoringSessionId();
  } catch {
    return null;
  }
}

/** On-disk segments still present (= not yet confirmed in the cloud), with their
 * real seq parsed from the filename, lowest first. */
function listLocalSegs(eegDir: Directory): LocalSeg[] {
  const out: LocalSeg[] = [];
  try {
    if (!eegDir.exists) return out;
    for (const item of eegDir.list()) {
      if (!(item instanceof File)) continue;
      const name = item.uri.replace(/\/+$/, '').split('/').pop() ?? '';
      const index = parseSegName(name);
      if (index === null) continue;
      const bytes = item.size ?? 0;
      if (bytes > 0) out.push({ index, uri: item.uri, bytes });
    }
  } catch {
    /* unreadable → treat as none */
  }
  return out.sort((a, b) => a.index - b.index);
}

async function currentUid(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Upload a chunked session's remaining on-disk segments at their real seq, then —
 * only when the tail is fully confirmed in the cloud — finalize the session row
 * (idempotent) and delete the now-empty local dir. Returns the storage prefix on
 * a complete handoff, or null if segments remain (offline) so the caller can keep
 * the local files and retry. The prefix is rebuilt from meta so it EXACTLY matches
 * what the live recording used. `endMsOverride` fills the journal row's duration
 * (the post-session path knows it from received samples); otherwise it's estimated
 * from the highest segment index.
 */
async function settleChunkedSession(
  sessionId: string,
  meta: ChunkMeta,
  uid: string,
  endMsOverride?: number,
): Promise<string | null> {
  const eegDir = segEegDir(new Directory(sessionsRoot(), sessionId));
  const prefix = `${uid}/${readableLabelStable(sessionId, meta.startedAtMs, meta.serial ?? undefined)}`;

  const before = listLocalSegs(eegDir);
  if (before.length > 0) {
    let queue = fileQueueStore.load();
    for (const seg of before) {
      const bytes = readSegBytes(seg.uri);
      if (bytes.length === 0) continue;
      const sha256 = await sha256Hex(bytes);
      queue = addTask(queue, {
        sessionId,
        seq: seg.index,
        path: seg.uri,
        prefix,
        bytes: bytes.length,
        sha256,
        attempts: 0,
      });
    }
    fileQueueStore.save(queue);
    await drainChunks();
  }

  // Still segments on disk → not fully confirmed; keep them for the next retry.
  if (listLocalSegs(eegDir).length > 0) return null;

  // Ship the self-describing µV-scale sidecar (scale.json) so the backend stages
  // with the EXACT scale this recording used, not the assumed fallback. Best-
  // effort: a missing/failed sidecar must not block finalizing a confirmed night.
  try {
    const scaleFile = new File(new Directory(sessionsRoot(), sessionId), 'scale.json');
    await uploadSidecarIfPresent(prefix, scaleFile, 'scale.json');
  } catch {
    /* non-fatal — older recordings have no sidecar and fall back to the assumed scale */
  }

  const maxIndex = before.length > 0 ? before[before.length - 1].index : -1;
  const endMs =
    endMsOverride ?? meta.startedAtMs + estimateChunkedDurationMs(maxIndex, CHUNK_SECONDS);
  await finalizeSession({ sessionId, startMs: meta.startedAtMs, endMs }, prefix);
  deleteLocalSession(sessionId);
  return prefix;
}

/**
 * Post-session handoff for a chunked recording (the manual "Sync to cloud" path).
 * Uploads any segments not yet confirmed, finalizes, and deletes the local dir.
 * Throws if segments remain unconfirmed (offline) so the caller keeps the local
 * copy and can retry — exactly like the EEG.BIN transmitSession contract.
 */
export async function transmitChunkedSession(input: FinalizeInput): Promise<string> {
  const dir = new Directory(sessionsRoot(), input.sessionId);
  if (!dir.exists) throw new Error(`no local session ${input.sessionId}`);
  const uid = await currentUid();
  if (!uid) throw new Error('not signed in');
  const meta = readMeta(dir) ?? { sessionId: input.sessionId, startedAtMs: input.startMs };
  const prefix = await settleChunkedSession(input.sessionId, meta, uid, input.endMs);
  if (!prefix) throw new Error('upload incomplete — segments kept locally for retry');
  return prefix;
}

/**
 * Recover every crashed chunked session at launch. Safe to call alongside
 * recoverAll() (disjoint layouts: EEG.BIN vs segments/eeg). No-op when chunked
 * upload is disabled or signed out. `liveSessionId` is excluded so a live /
 * resuming session is never touched.
 */
export async function recoverChunkedSessions(liveSessionId?: string | null): Promise<void> {
  if (!CHUNKED_UPLOAD_ENABLED) return;
  const uid = await currentUid();
  if (!uid) return;

  // Never sweep the live or mid-restore session (parallels recoverAll).
  const liveId = liveSessionId ?? (await liveOrRestoringSessionId());

  // Ship anything already queued first (idempotent — upsert server-side).
  await drainChunks();

  const root = sessionsRoot();
  if (!root.exists) return;
  let dirs: (Directory | File)[];
  try {
    dirs = root.list();
  } catch {
    return;
  }

  for (const item of dirs) {
    if (!(item instanceof Directory)) continue;
    const sessionId = item.uri.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!sessionId || sessionId.startsWith('__') || sessionId === liveId) continue;
    if (!segEegDir(item).exists) continue; // legacy EEG.BIN → recoverAll handles it

    const meta = readMeta(item);
    if (!meta) continue; // can't rebuild the owner prefix safely — leave for review

    // Guard tiny/empty crash artifacts: with a present tail, require a stageable
    // length; the rare already-uploaded-but-unfinalized dir (no local segs) is
    // finalized idempotently regardless so it doesn't dangle.
    const segs = listLocalSegs(segEegDir(item));
    if (segs.length > 0) {
      const maxIndex = segs[segs.length - 1].index;
      if (!isStageableDurationMs(estimateChunkedDurationMs(maxIndex, CHUNK_SECONDS))) continue;
    }
    try {
      await settleChunkedSession(sessionId, meta, uid);
    } catch {
      /* finalize/upload failed — retry next launch (segments are safe in cloud) */
    }
  }
}
