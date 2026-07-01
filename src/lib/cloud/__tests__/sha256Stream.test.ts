import { createHash, randomBytes } from 'crypto';

import { Sha256Stream } from '../sha256Stream';

/** Node's reference digest of the exact bytes — the authority we match. */
function nodeHex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

describe('Sha256Stream — incremental SHA-256 (matches hashlib/Node)', () => {
  test('empty stream hashes to the canonical empty-input digest', () => {
    expect(new Sha256Stream().digestHex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('"abc" matches the published SHA-256 test vector', () => {
    const s = new Sha256Stream();
    s.update(new Uint8Array([0x61, 0x62, 0x63])); // 'abc'
    expect(s.digestHex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('chunked updates equal the one-shot digest of the concatenation', () => {
    // 300 bytes crosses several 64-byte blocks and a non-aligned tail.
    const whole = new Uint8Array(randomBytes(300));
    const ref = nodeHex(whole);

    const s = new Sha256Stream();
    // Feed in irregular chunk sizes — the boundary must not affect the result.
    let off = 0;
    for (const size of [1, 63, 64, 65, 7, whole.length]) {
      const end = Math.min(off + size, whole.length);
      if (end > off) s.update(whole.subarray(off, end));
      off = end;
    }
    expect(s.digestHex()).toBe(ref);
  });

  test('a length that lands exactly on the 55/56 padding boundary is correct', () => {
    for (const n of [55, 56, 63, 64, 119, 120]) {
      const bytes = new Uint8Array(randomBytes(n));
      const s = new Sha256Stream();
      // one byte at a time — worst case for buffering
      for (let i = 0; i < bytes.length; i++) s.update(bytes.subarray(i, i + 1));
      expect(s.digestHex()).toBe(nodeHex(bytes));
    }
  });

  test('digestHex is idempotent (reading it twice returns the same value)', () => {
    const s = new Sha256Stream();
    s.update(new Uint8Array([1, 2, 3, 4, 5]));
    const first = s.digestHex();
    expect(s.digestHex()).toBe(first);
    expect(first).toBe(nodeHex(new Uint8Array([1, 2, 3, 4, 5])));
  });

  test('matches a large multi-megabyte stream fed in small packets', () => {
    // Simulates a night: many small raw packets accumulated incrementally.
    const packet = new Uint8Array(randomBytes(720)); // ~one 18-sample raw packet
    const ref = createHash('sha256');
    const s = new Sha256Stream();
    for (let i = 0; i < 5000; i++) {
      ref.update(Buffer.from(packet));
      s.update(packet);
    }
    expect(s.digestHex()).toBe(ref.digest('hex'));
  });
});
