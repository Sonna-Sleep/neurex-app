import { buildStoredZip } from '../src/lib/files/zipStore';

function u32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

const zip = buildStoredZip([
  { path: 'session/meta.json', bytes: new Uint8Array(Buffer.from('{"ok":true}', 'utf8')) },
  { path: 'session/RAW.BIN', bytes: new Uint8Array([1, 2, 3, 4]) },
]);

if (u32(zip, 0) !== 0x04034b50) throw new Error('missing local file header');

let eocd = -1;
for (let i = zip.byteLength - 22; i >= 0; i--) {
  if (u32(zip, i) === 0x06054b50) {
    eocd = i;
    break;
  }
}

if (eocd < 0) throw new Error('missing end-of-central-directory record');
if (zip[eocd + 10] !== 2 || zip[eocd + 11] !== 0) throw new Error('wrong zip entry count');

console.log('smoke-recording-export-zip ok');
