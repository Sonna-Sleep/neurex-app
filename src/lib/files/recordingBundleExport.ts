import { Directory, File, Paths } from 'expo-file-system';

import { crc32Append, crc32Finish, zipUtf8 } from './zipStore';

export type RecordingBundleExport = {
  uri: string;
  fileName: string;
  entryCount: number;
  bytes: number;
};

type FileHandleLike = {
  offset: number | null;
  size: number | null;
  readBytes(length: number): Uint8Array;
  writeBytes(bytes: Uint8Array): void;
  close(): void;
};

type BundleEntry = {
  path: string;
  file: File;
  size: number;
  crc: number;
};

const READ_CHUNK_BYTES = 64 * 1024;

function nameFromUri(uri: string): string {
  return decodeURIComponent(uri.replace(/\/+$/, '').split('/').pop() ?? '');
}

function sanitizeFileName(input: string): string {
  const safe = input.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'recording';
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

function bytes(out: number[]): Uint8Array {
  return new Uint8Array(out);
}

function pushBytes(out: number[], input: Uint8Array): void {
  for (let i = 0; i < input.byteLength; i++) out.push(input[i]);
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

function localHeader(entry: BundleEntry): Uint8Array {
  const name = zipUtf8(entry.path);
  assertUint16(name.byteLength, 'file name length');
  assertUint32(entry.size, 'file size');
  const out: number[] = [];
  u32(out, 0x04034b50);
  u16(out, 20);
  u16(out, 0x0800);
  u16(out, 0);
  u16(out, 0);
  u16(out, 0);
  u32(out, entry.crc);
  u32(out, entry.size);
  u32(out, entry.size);
  u16(out, name.byteLength);
  u16(out, 0);
  pushBytes(out, name);
  return bytes(out);
}

function centralHeader(entry: BundleEntry, localOffset: number): Uint8Array {
  const name = zipUtf8(entry.path);
  assertUint16(name.byteLength, 'file name length');
  assertUint32(entry.size, 'file size');
  assertUint32(localOffset, 'local header offset');
  const out: number[] = [];
  u32(out, 0x02014b50);
  u16(out, 20);
  u16(out, 20);
  u16(out, 0x0800);
  u16(out, 0);
  u16(out, 0);
  u16(out, 0);
  u32(out, entry.crc);
  u32(out, entry.size);
  u32(out, entry.size);
  u16(out, name.byteLength);
  u16(out, 0);
  u16(out, 0);
  u16(out, 0);
  u16(out, 0);
  u32(out, 0);
  u32(out, localOffset);
  pushBytes(out, name);
  return bytes(out);
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Uint8Array {
  assertUint16(entryCount, 'entry count');
  assertUint32(centralSize, 'central directory size');
  assertUint32(centralOffset, 'central directory offset');
  const out: number[] = [];
  u32(out, 0x06054b50);
  u16(out, 0);
  u16(out, 0);
  u16(out, entryCount);
  u16(out, entryCount);
  u32(out, centralSize);
  u32(out, centralOffset);
  u16(out, 0);
  return bytes(out);
}

function fileHandle(file: File): FileHandleLike {
  return file.open() as FileHandleLike;
}

function fileSize(file: File): number {
  const info = file.info();
  const size = info.exists && typeof info.size === 'number' ? info.size : file.size;
  assertUint32(size, 'file size');
  return size;
}

async function crc32File(file: File, size: number): Promise<number> {
  const handle = fileHandle(file);
  try {
    handle.offset = 0;
    let remaining = size;
    let crc = 0xffffffff;
    while (remaining > 0) {
      const chunk = handle.readBytes(Math.min(READ_CHUNK_BYTES, remaining));
      if (chunk.byteLength === 0) throw new Error(`could not read ${nameFromUri(file.uri)}`);
      crc = crc32Append(crc, chunk);
      remaining -= chunk.byteLength;
    }
    return crc32Finish(crc);
  } finally {
    handle.close();
  }
}

async function collectEntries(dir: Directory, rootName: string, rel = ''): Promise<BundleEntry[]> {
  if (!dir.exists) throw new Error('local recording folder was not found');
  const items = dir.list().sort((a, b) => nameFromUri(a.uri).localeCompare(nameFromUri(b.uri)));
  const entries: BundleEntry[] = [];

  for (const item of items) {
    const name = nameFromUri(item.uri);
    if (!name) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    if (item instanceof Directory) {
      entries.push(...(await collectEntries(item, rootName, childRel)));
    } else if (item instanceof File && item.exists) {
      const size = fileSize(item);
      entries.push({
        path: safeEntryPath(`${rootName}/${childRel}`),
        file: item,
        size,
        crc: await crc32File(item, size),
      });
    }
  }

  return entries;
}

function writeFileData(out: FileHandleLike, file: File, size: number): number {
  const input = fileHandle(file);
  let written = 0;
  try {
    input.offset = 0;
    let remaining = size;
    while (remaining > 0) {
      const chunk = input.readBytes(Math.min(READ_CHUNK_BYTES, remaining));
      if (chunk.byteLength === 0) throw new Error(`could not read ${nameFromUri(file.uri)}`);
      out.writeBytes(chunk);
      remaining -= chunk.byteLength;
      written += chunk.byteLength;
    }
  } finally {
    input.close();
  }
  return written;
}

function writeZipFile(outFile: File, entries: readonly BundleEntry[]): number {
  const out = fileHandle(outFile);
  const centralRecords: Uint8Array[] = [];
  let offset = 0;
  try {
    out.offset = 0;
    for (const entry of entries) {
      const header = localHeader(entry);
      const localOffset = offset;
      out.writeBytes(header);
      offset += header.byteLength;
      offset += writeFileData(out, entry.file, entry.size);
      centralRecords.push(centralHeader(entry, localOffset));
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const record of centralRecords) {
      out.writeBytes(record);
      offset += record.byteLength;
      centralSize += record.byteLength;
    }
    const eocd = endOfCentralDirectory(entries.length, centralSize, centralOffset);
    out.writeBytes(eocd);
    offset += eocd.byteLength;
    return offset;
  } finally {
    out.close();
  }
}

export async function exportRecordingBundle(sessionId: string): Promise<RecordingBundleExport> {
  const sessionDir = new Directory(Paths.document, 'sessions', sessionId);
  const rootName = `neurex-recording-${sanitizeFileName(sessionId)}`;
  const entries = await collectEntries(sessionDir, rootName);
  if (entries.length === 0) throw new Error('local recording folder is empty');

  const exportsDir = new Directory(Paths.cache, 'exports');
  if (!exportsDir.exists) exportsDir.create({ intermediates: true, idempotent: true });

  const fileName = `${rootName}.zip`;
  const out = new File(exportsDir, fileName);
  if (out.exists) out.delete();
  out.create();
  const bytes = writeZipFile(out, entries);

  return {
    uri: out.uri,
    fileName,
    entryCount: entries.length,
    bytes,
  };
}
