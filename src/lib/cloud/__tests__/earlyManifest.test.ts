/**
 * ensureEarlyManifestUploaded: uploads recording_manifest.json to Storage on the
 * first chunk so an app killed before finalize still leaves a recoverable night.
 * Uses an injected `upload` so no real filesystem / Supabase is touched.
 */
import { ensureEarlyManifestUploaded, _resetEarlyManifest } from '../earlyManifest';

beforeEach(() => _resetEarlyManifest());

test('uploads the manifest once, then no-ops for the same session', async () => {
  const upload = jest.fn().mockResolvedValue(undefined);

  const a = await ensureEarlyManifestUploaded('sess-1', 'uid/label', { upload });
  const b = await ensureEarlyManifestUploaded('sess-1', 'uid/label', { upload });

  expect(a).toBe(true);
  expect(b).toBe(true);
  expect(upload).toHaveBeenCalledTimes(1); // second call is a no-op
  expect(upload).toHaveBeenCalledWith('uid/label', 'sess-1');
});

test('a failed upload does not latch — the next chunk retries', async () => {
  const upload = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(undefined);

  const first = await ensureEarlyManifestUploaded('sess-2', 'uid/label', { upload });
  expect(first).toBe(false); // first attempt failed
  expect(upload).toHaveBeenCalledTimes(1);

  const second = await ensureEarlyManifestUploaded('sess-2', 'uid/label', { upload });
  expect(second).toBe(true); // retry succeeded
  expect(upload).toHaveBeenCalledTimes(2);

  // Now latched — no third attempt.
  await ensureEarlyManifestUploaded('sess-2', 'uid/label', { upload });
  expect(upload).toHaveBeenCalledTimes(2);
});

test('distinct sessions each upload their own manifest', async () => {
  const upload = jest.fn().mockResolvedValue(undefined);
  await ensureEarlyManifestUploaded('sess-a', 'uid/a', { upload });
  await ensureEarlyManifestUploaded('sess-b', 'uid/b', { upload });
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload).toHaveBeenNthCalledWith(1, 'uid/a', 'sess-a');
  expect(upload).toHaveBeenNthCalledWith(2, 'uid/b', 'sess-b');
});

test('an empty session id is treated as already-done (no upload)', async () => {
  const upload = jest.fn().mockResolvedValue(undefined);
  const ok = await ensureEarlyManifestUploaded('', 'uid/label', { upload });
  expect(ok).toBe(true);
  expect(upload).not.toHaveBeenCalled();
});
