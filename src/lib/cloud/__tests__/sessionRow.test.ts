import { sessionRowWithRaw } from '../sessionRow';

describe('sessionRowWithRaw — attach raw provenance to the sessions insert', () => {
  const base = { id: 's1', status: 'uploaded', storage_prefix: 'uid/label' };

  test('adds raw_sha256 + raw_storage_path when a hash is present', () => {
    const row = sessionRowWithRaw(base, {
      rawSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      rawStoragePath: 'uid/label/segments/raw',
    });
    expect(row.raw_sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(row.raw_storage_path).toBe('uid/label/segments/raw');
    // does not mutate the input row
    expect((base as Record<string, unknown>).raw_sha256).toBeUndefined();
  });

  test('omits raw columns entirely when the hash is absent (so the night still stages from eeg)', () => {
    for (const rawSha256 of [undefined, null, '']) {
      const row = sessionRowWithRaw(base, { rawSha256, rawStoragePath: 'x' });
      expect('raw_sha256' in row).toBe(false);
      expect('raw_storage_path' in row).toBe(false);
    }
  });

  test('preserves the original columns unchanged', () => {
    const row = sessionRowWithRaw(base, { rawSha256: 'abc', rawStoragePath: 'p' });
    expect(row.id).toBe('s1');
    expect(row.status).toBe('uploaded');
    expect(row.storage_prefix).toBe('uid/label');
  });
});
