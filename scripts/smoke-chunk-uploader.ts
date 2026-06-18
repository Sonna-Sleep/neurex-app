import assert from 'node:assert/strict';

import type { ChunkTask } from '../src/lib/cloud/chunkQueue';
import { IngestError, makeIngestUploader, type UploadResult } from '../src/lib/cloud/chunkUploader';

function task(over: Partial<ChunkTask> = {}): ChunkTask {
  return {
    sessionId: 's1',
    seq: 3,
    path: 'file:///sessions/s1/segments/eeg/seg0003.bin',
    prefix: 'uid/2026-06-18_0312_s1abcd',
    bytes: 1000,
    sha256: 'deadbeef',
    attempts: 0,
    ...over,
  };
}

(async () => {
  // happy path: 200 → parsed confirm; headers + url + seq are correct
  {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    let seenFileUri = '';
    const upload = async (url: string, fileUri: string, headers: Record<string, string>) => {
      seenUrl = url;
      seenFileUri = fileUri;
      seenHeaders = headers;
      return { status: 200, body: JSON.stringify({ bytes_received: 1000, sha256: 'aa', path: 'p' }) };
    };
    const up = makeIngestUploader({
      endpoint: 'https://api.example.com/', // trailing slash must be trimmed
      getToken: async () => 'JWT123',
      upload,
    });
    const confirm = await up(task());
    assert.equal(confirm.bytes_received, 1000);
    assert.equal(confirm.sha256, 'aa');
    assert.equal(seenUrl, 'https://api.example.com/ingest');
    assert.equal(seenFileUri, 'file:///sessions/s1/segments/eeg/seg0003.bin');
    assert.equal(seenHeaders.Authorization, 'Bearer JWT123');
    assert.equal(seenHeaders['x-storage-prefix'], 'uid/2026-06-18_0312_s1abcd');
    assert.equal(seenHeaders['x-seq'], '3');
  }

  // no token → throws BEFORE uploading (so drainQueue keeps + retries)
  {
    let called = false;
    const up = makeIngestUploader({
      endpoint: 'https://api.example.com',
      getToken: async () => null,
      upload: async () => {
        called = true;
        return { status: 200, body: '{}' };
      },
    });
    await assert.rejects(() => up(task()), IngestError);
    assert.equal(called, false, 'must not upload without a token');
  }

  // non-200 → throws (treated as transient by drainQueue → keep + retry)
  {
    const up = makeIngestUploader({
      endpoint: 'https://api.example.com',
      getToken: async () => 'JWT',
      upload: async (): Promise<UploadResult> => ({ status: 503, body: 'upstream down' }),
    });
    await assert.rejects(() => up(task()), IngestError);
  }

  // 200 but unparseable body → throws (never a false confirm → never deletes)
  {
    const up = makeIngestUploader({
      endpoint: 'https://api.example.com',
      getToken: async () => 'JWT',
      upload: async (): Promise<UploadResult> => ({ status: 200, body: '<html>nope</html>' }),
    });
    await assert.rejects(() => up(task()), IngestError);
  }

  console.log('ALL CHUNK-UPLOADER ASSERTIONS PASSED');
})();
