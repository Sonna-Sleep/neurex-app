// Early session-identity persistence for the segments-first upload pipeline.
//
// WHY: a night's EEG uploads to Storage as segment chunks DURING recording, but
// the recording_manifest.json sidecar — the only artifact that carries the
// session's UUID + true start time — is uploaded only at finalize (in-app Stop /
// next-launch recovery). If the app is killed overnight before finalize AND
// launch recovery never runs, the chunks sit in Storage as an ORPHAN: real EEG,
// but nothing tells the backend which session it is, so it can never be staged
// or shown. (Observed live: multiple full nights stuck exactly this way.)
//
// FIX: upload the manifest sidecar as soon as the session's FIRST chunk is
// queued, so {prefix}/recording_manifest.json (schemaVer, sessionId, startedAtMs,
// sampleRateHz) is durably in the cloud alongside the very first EEG bytes. The
// backend's orphan-recovery sweep then always learns the real session id and
// recovers the night with the SAME id the app would use — so if the app's own
// recovery also runs later, the two converge on one row instead of duplicating.
//
// Idempotent per session (uploads once; retries on the next chunk until it
// succeeds). Best-effort: never throws, never blocks the EEG upload.

// Sessions whose manifest is already confirmed in Storage — don't re-upload.
const uploadedFor = new Set<string>();

export type EarlyManifestDeps = {
  /** Injected in tests. Must reject to signal "retry on the next chunk". */
  upload?: (prefix: string, sessionId: string) => Promise<void>;
};

// recordingManifest + cloudSync pull in expo-file-system (untransformed ESM in
// the test/build runtime), so they're lazy-required here — mirroring
// CloudLullSession's defaultPersistLullLog — and only touched on-device. Tests
// inject `upload`, so this default never loads them.
async function defaultUpload(prefix: string, sessionId: string): Promise<void> {
  const { manifestFile, RECORDING_MANIFEST_NAME } =
    require('../ble/recordingManifest') as typeof import('../ble/recordingManifest');
  const { uploadSidecarIfPresent } =
    require('./cloudSync') as typeof import('./cloudSync');
  const f = manifestFile(sessionId);
  // The manifest is written locally at record start; if it's somehow not on disk
  // yet, reject so we retry when the next chunk closes (rather than marking a
  // no-op upload as success).
  if (!f.exists) throw new Error('recording_manifest.json not written yet');
  await uploadSidecarIfPresent(prefix, f, RECORDING_MANIFEST_NAME);
}

/**
 * Ensure this session's manifest sidecar is in Storage. Returns true once it has
 * been uploaded (or was already), false if this attempt failed (a later chunk
 * retries). Safe to call on every enqueued chunk — a no-op after the first
 * success.
 */
export async function ensureEarlyManifestUploaded(
  sessionId: string,
  prefix: string,
  deps: EarlyManifestDeps = {},
): Promise<boolean> {
  if (!sessionId || uploadedFor.has(sessionId)) return true;
  const upload = deps.upload ?? defaultUpload;
  try {
    await upload(prefix, sessionId);
    uploadedFor.add(sessionId);
    return true;
  } catch {
    return false; // best-effort — the next closed chunk retries
  }
}

/** Test seam: clear the per-session "already uploaded" memory. */
export function _resetEarlyManifest(): void {
  uploadedFor.clear();
}
