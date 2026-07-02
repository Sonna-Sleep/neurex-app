// Streaming SHA-256 — the one capability expo-crypto lacks.
//
// expo-crypto's Crypto.digest is one-shot: it needs the whole message in memory.
// A full night's RAW.BIN is too large to buffer on a phone at finalize. This
// computes the digest
// INCREMENTALLY — fed each raw packet as it is written — so the whole-stream hash
// is ready at finalize with O(1) memory. The output is byte-for-byte identical to
// Python's hashlib.sha256(...).hexdigest() and Node's crypto, which is what the
// backend's integrity gate (verify_sha256 against the client-declared raw_sha256)
// compares against.
//
// Pure (no RN/expo import) so it unit-tests in plain node and can hash any stream.

// First 32 bits of the fractional parts of the cube roots of the first 64 primes.
// prettier-ignore
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX = '0123456789abcdef';

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Mix one 64-byte block (at `off` in `block`) into `state` (H0..H7), in place. */
function processBlock(state: Uint32Array, w: Uint32Array, block: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4;
    w[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e;
    e = (d + t1) >>> 0;
    d = c; c = b; b = a;
    a = (t1 + t2) >>> 0;
  }
  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0;
  state[5] = (state[5] + f) >>> 0;
  state[6] = (state[6] + g) >>> 0;
  state[7] = (state[7] + h) >>> 0;
}

export class Sha256Stream {
  // H0: first 32 bits of the fractional parts of the square roots of the first 8 primes.
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly buffer = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private bufLen = 0;
  private totalBytes = 0;

  /** Feed more bytes into the running digest. Chunk boundaries never affect the
   * result — update(a); update(b) equals update(a‖b). */
  update(bytes: Uint8Array): this {
    this.totalBytes += bytes.length;
    let i = 0;
    if (this.bufLen > 0) {
      while (i < bytes.length && this.bufLen < 64) this.buffer[this.bufLen++] = bytes[i++];
      if (this.bufLen === 64) {
        processBlock(this.state, this.w, this.buffer, 0);
        this.bufLen = 0;
      }
    }
    while (i + 64 <= bytes.length) {
      processBlock(this.state, this.w, bytes, i);
      i += 64;
    }
    while (i < bytes.length) this.buffer[this.bufLen++] = bytes[i++];
    return this;
  }

  /** Lowercase hex of the SHA-256 so far. Non-destructive: pads a COPY of the
   * state, so the stream can keep receiving updates afterward and digestHex can
   * be read repeatedly. */
  digestHex(): string {
    const state = this.state.slice();
    const w = new Uint32Array(64);
    // Pad the buffered remainder: 0x80, zeros, then the 64-bit big-endian bit length.
    const tail = new Uint8Array(this.bufLen < 56 ? 64 : 128);
    tail.set(this.buffer.subarray(0, this.bufLen));
    tail[this.bufLen] = 0x80;
    const bitLen = this.totalBytes * 8;
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    const end = tail.length;
    tail[end - 8] = (hi >>> 24) & 0xff;
    tail[end - 7] = (hi >>> 16) & 0xff;
    tail[end - 6] = (hi >>> 8) & 0xff;
    tail[end - 5] = hi & 0xff;
    tail[end - 4] = (lo >>> 24) & 0xff;
    tail[end - 3] = (lo >>> 16) & 0xff;
    tail[end - 2] = (lo >>> 8) & 0xff;
    tail[end - 1] = lo & 0xff;
    for (let off = 0; off < end; off += 64) processBlock(state, w, tail, off);

    let out = '';
    for (let i = 0; i < 8; i++) {
      const v = state[i];
      out += HEX[(v >>> 28) & 0xf] + HEX[(v >>> 24) & 0xf] + HEX[(v >>> 20) & 0xf] + HEX[(v >>> 16) & 0xf];
      out += HEX[(v >>> 12) & 0xf] + HEX[(v >>> 8) & 0xf] + HEX[(v >>> 4) & 0xf] + HEX[v & 0xf];
    }
    return out;
  }
}
