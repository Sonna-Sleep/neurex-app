// Real /ingest upload contract for the 30-min chunked-upload pipeline (F2).
//
// PURE: the HTTP call, token lookup, and endpoint are all injected, so the
// upload/confirm contract is fully unit-testable without a device or a live
// backend. The RN-wired default (expo-file-system uploadAsync streaming the
// segment straight from disk + the Supabase access token) is assembled in
// chunkDriver.ts, which is the RN layer.
//
// Uploading the file from its URI — rather than marshalling bytes through JS
// fetch — guarantees the server receives EXACTLY the bytes we hashed, so the
// {bytes_received, sha256} it returns can gate the local delete (confirmMatches).

import type { ChunkTask } from './chunkQueue';
import type { ChunkUploader, ServerConfirm } from './chunkUpload';

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

/** Minimal HTTP result the uploader needs — maps onto FileSystemUploadResult. */
export type UploadResult = { status: number; body: string };
export type UploadFn = (
  url: string,
  fileUri: string,
  headers: Record<string, string>,
) => Promise<UploadResult>;

export type IngestDeps = {
  /** Backend base URL (no trailing /ingest). */
  endpoint: string;
  /** Supabase access token, or null when not signed in. */
  getToken: () => Promise<string | null>;
  /** Binary file upload. */
  upload: UploadFn;
};

/**
 * Build a ChunkUploader that POSTs a segment to {endpoint}/ingest. Throws on any
 * non-2xx, missing token, or unparseable body — drainQueue treats a throw as a
 * transient failure (keep the chunk, retry on the next drain), so an expired
 * token or an outage just pauses uploads; it never deletes unconfirmed data.
 */
export function makeIngestUploader(deps: IngestDeps): ChunkUploader {
  const url = `${deps.endpoint.replace(/\/+$/, '')}/ingest`;
  return async (task: ChunkTask): Promise<ServerConfirm> => {
    const token = await deps.getToken();
    if (!token) throw new IngestError('not authenticated — will retry');

    const res = await deps.upload(url, task.path, {
      Authorization: `Bearer ${token}`,
      'x-storage-prefix': task.prefix,
      'x-seq': String(task.seq),
      'content-type': 'application/octet-stream',
    });

    if (res.status !== 200) {
      throw new IngestError(`ingest HTTP ${res.status}: ${(res.body ?? '').slice(0, 200)}`);
    }
    let parsed: { bytes_received?: number; sha256?: string };
    try {
      parsed = JSON.parse(res.body) as { bytes_received?: number; sha256?: string };
    } catch {
      throw new IngestError('ingest returned an unparseable body');
    }
    return { bytes_received: parsed.bytes_received, sha256: parsed.sha256 };
  };
}
