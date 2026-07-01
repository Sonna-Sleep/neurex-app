// Launch-time recovery + post-session transmit for the segments-first upload
// pipeline.
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
import {
  endMsFromManifest,
  manifestFile,
  readRecordingManifest,
} from '../ble/recordingManifest';
import { addTask } from './chunkQueue';
import { drainChunks } from './chunkDriver';
import { fileQueueStore, readSegBytes, sha256Hex } from './chunkUploadStore';
import {
  deleteLocalSession,
  type FinalizeInput,
  finalizeSession,
  readableLabelStable,
  uploadFileAsSegments,
  uploadSidecarIfPresent,
} from './cloudSync';
import { isStageableDurationMs } from './recoveryMath';
import {
  ensureStreamStatsSidecar,
  refreshStreamStatsSidecarUploadCounts,
  streamStatsFile,
} from './streamStatsSidecar';

const META_NAME = 'meta.json';

type ChunkMeta = { sessionId: string; startedAtMs: number; endMs?: number; serial?: string | null };

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
type RemoteSeg = { index: number; bytes: number | null };

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

async function listRemoteSegs(prefix: string): Promise<RemoteSeg[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const dir = `${prefix}/segments/eeg`;
  const out: RemoteSeg[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from('recordings')
      .list(dir, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error || !data) return [];
    for (const item of data) {
      const index = parseSegName(item.name);
      if (index === null) continue;
      const metadata = (item as { metadata?: Record<string, unknown>; size?: unknown }).metadata;
      const size =
        typeof metadata?.size === 'number'
          ? metadata.size
          : typeof (item as { size?: unknown }).size === 'number'
            ? ((item as unknown as { size: number }).size)
            : null;
      out.push({ index, bytes: size });
    }
    if (data.length < pageSize) break;
  }
  return out.sort((a, b) => a.index - b.index);
}

function endMsFromSegments(
  startedAtMs: number,
  segs: readonly { index: number; bytes: number | null }[],
): number | null {
  if (segs.length === 0) return null;
  const allSizesKnown = segs.every((seg) => typeof seg.bytes === 'number' && seg.bytes > 0);
  const contiguousFromZero = segs.every((seg, i) => seg.index === i);
  if (allSizesKnown && contiguousFromZero) {
    const totalBytes = segs.reduce((sum, seg) => sum + (seg.bytes ?? 0), 0);
    return startedAtMs + Math.round((totalBytes / (250 * 8)) * 1000);
  }
  const maxIndex = segs[segs.length - 1].index;
  return startedAtMs + estimateChunkedDurationMs(maxIndex, CHUNK_SECONDS);
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
  const manifest = readRecordingManifest(sessionId);

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
    await drainChunks(sessionId);
  }

  // Still segments on disk → not fully confirmed; keep them for the next retry.
  if (listLocalSegs(eegDir).length > 0) return null;

  const remoteSegs = before.length === 0 ? await listRemoteSegs(prefix) : [];
  const manifestEndMs =
    manifest && manifest.samplesWritten > 0 ? endMsFromManifest(manifest) : null;
  const localEndMs = endMsFromSegments(meta.startedAtMs, before);
  const remoteEndMs = endMsFromSegments(meta.startedAtMs, remoteSegs);
  const candidates = [
    manifestEndMs,
    endMsOverride && endMsOverride > meta.startedAtMs ? endMsOverride : null,
    meta.endMs && meta.endMs > meta.startedAtMs ? meta.endMs : null,
    localEndMs,
    remoteEndMs,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const endMs = candidates.length > 0 ? Math.max(...candidates) : meta.startedAtMs;

  // Upload the raw ALL-channel ground truth (single RAW.BIN, written lockstep with
  // the eeg chunks) as a parallel 'raw' segment stream, and capture its whole-file
  // hash — the client-declared integrity gate that unlocks authoritative
  // MULTICHANNEL (Fp1/Fp2 + EOG) staging. The hash is only declared once the full
  // raw is confirmed in Storage (uploadFileAsSegments resolves only after every
  // segment lands). Best-effort: on ANY failure we finalize WITHOUT the hash, so
  // the night safely stages from the Fp1 eeg fallback rather than failing the
  // backend integrity check on a partial upload.
  let rawSha256: string | null = null;
  try {
    const rawBin = new File(new Directory(sessionsRoot(), sessionId), 'RAW.BIN');
    if (rawBin.exists) {
      const res = await uploadFileAsSegments(prefix, 'raw', rawBin);
      rawSha256 = res.sha256 || null;
    }
  } catch {
    /* non-fatal — finalize without the hash → Fp1 eeg fallback */
  }

  // Ship the self-describing µV-scale sidecar (scale.json) so the backend stages
  // with the EXACT scale this recording used, not the assumed fallback. Best-
  // effort: a missing/failed sidecar must not block finalizing a confirmed night.
  try {
    const scaleFile = new File(new Directory(sessionsRoot(), sessionId), 'scale.json');
    await uploadSidecarIfPresent(prefix, scaleFile, 'scale.json');
  } catch {
    /* non-fatal — older recordings have no sidecar and fall back to the assumed scale */
  }

  try {
    await uploadSidecarIfPresent(prefix, manifestFile(sessionId), 'recording_manifest.json');
  } catch {
    /* non-fatal — debugging/recovery sidecar only */
  }

  // Ship the wind-down log (lull.json) written by CloudLullSession at Lull close,
  // so tomorrow the 25-min fade (W, played volume, onset) sits next to the EEG.
  // Best-effort: absent on nights that never ran Lull, and never blocks finalize.
  try {
    const lullFile = new File(new Directory(sessionsRoot(), sessionId), 'lull.json');
    await uploadSidecarIfPresent(prefix, lullFile, 'lull.json');
  } catch {
    /* non-fatal — the wind-down log is a bonus artifact */
  }

  // Ship the BLE/upload stats sidecar before finalize when possible. Recovery can
  // synthesize one from meta/endMs if the live stop path never got to write it.
  try {
    await ensureStreamStatsSidecar({
      sessionId,
      startedAtMs: meta.startedAtMs,
      endMs,
      stopReason: 'recovery',
      prefix,
    });
    await refreshStreamStatsSidecarUploadCounts(sessionId, prefix);
    await uploadSidecarIfPresent(prefix, streamStatsFile(sessionId), 'stream_stats.json');
  } catch {
    /* non-fatal — QC will flag missing stream_stats.json inside the report */
  }

  await finalizeSession(
    {
      sessionId,
      startMs: meta.startedAtMs,
      endMs,
      rawSha256,
      rawStoragePath: rawSha256 ? `${prefix}/segments/raw` : null,
    },
    prefix,
  );
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
 * recoverAll() (disjoint layouts: EEG.BIN vs segments/eeg). No-op only when the
 * legacy EEG.BIN fallback is explicitly enabled or signed out. `liveSessionId`
 * is excluded so a live / resuming session is never touched.
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
    const manifest = readRecordingManifest(sessionId);
    if (segs.length > 0) {
      const maxIndex = segs[segs.length - 1].index;
      const inferredEndMs =
        manifest && manifest.samplesWritten > 0
          ? endMsFromManifest(manifest)
          : meta.startedAtMs + estimateChunkedDurationMs(maxIndex, CHUNK_SECONDS);
      if (!isStageableDurationMs(inferredEndMs - meta.startedAtMs)) continue;
    }
    try {
      await settleChunkedSession(sessionId, meta, uid);
    } catch {
      /* finalize/upload failed — retry next launch (segments are safe in cloud) */
    }
  }
}
