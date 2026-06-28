export type StoredZipEntry = {
  path: string;
  bytes: Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Append(crc: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function crc32Finish(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  return crc32Finish(crc32Append(0xffffffff, bytes));
}

export function zipUtf8(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const cp = input.codePointAt(i);
    if (cp == null) continue;
    if (cp > 0xffff) i++;

    if (cp <= 0x7f) {
      out.push(cp);
    } else if (cp <= 0x7ff) {
      out.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      out.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >>> 18),
        0x80 | ((cp >>> 12) & 0x3f),
        0x80 | ((cp >>> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function assertUint16(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`zip ${label} is out of range`);
  }
}

function assertUint32(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`zip ${label} is out of range`);
  }
}

function u16(out: number[], n: number): void {
  assertUint16(n, 'u16');
  out.push(n & 0xff, (n >>> 8) & 0xff);
}

function u32(out: number[], n: number): void {
  assertUint32(n, 'u32');
  out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function pushBytes(out: number[], bytes: Uint8Array): void {
  for (let i = 0; i < bytes.byteLength; i++) out.push(bytes[i]);
}

function safeEntryPath(path: string): string {
  const cleaned = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .join('/');
  if (!cleaned) throw new Error('zip entry path is empty');
  return cleaned;
}

export function buildStoredZip(entries: readonly StoredZipEntry[]): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];
  const used = new Set<string>();

  for (const entry of entries) {
    const path = safeEntryPath(entry.path);
    if (used.has(path)) throw new Error(`duplicate zip entry ${path}`);
    used.add(path);

    const name = zipUtf8(path);
    const size = entry.bytes.byteLength;
    const crc = crc32(entry.bytes);
    const localOffset = out.length;
    assertUint16(name.byteLength, 'file name length');
    assertUint32(size, 'file size');
    assertUint32(localOffset, 'local header offset');

    u32(out, 0x04034b50);
    u16(out, 20);
    u16(out, 0x0800);
    u16(out, 0);
    u16(out, 0);
    u16(out, 0);
    u32(out, crc);
    u32(out, size);
    u32(out, size);
    u16(out, name.byteLength);
    u16(out, 0);
    pushBytes(out, name);
    pushBytes(out, entry.bytes);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0x0800);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, crc);
    u32(central, size);
    u32(central, size);
    u16(central, name.byteLength);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, localOffset);
    pushBytes(central, name);
  }

  const centralOffset = out.length;
  pushBytes(out, new Uint8Array(central));
  const centralSize = central.length;
  assertUint16(entries.length, 'entry count');
  assertUint32(centralOffset, 'central directory offset');
  assertUint32(centralSize, 'central directory size');

  u32(out, 0x06054b50);
  u16(out, 0);
  u16(out, 0);
  u16(out, entries.length);
  u16(out, entries.length);
  u32(out, centralSize);
  u32(out, centralOffset);
  u16(out, 0);

  return new Uint8Array(out);
}
