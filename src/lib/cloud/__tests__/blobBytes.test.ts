import { blobToArrayBuffer } from '../blobBytes';

function bytes(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

describe('blobToArrayBuffer', () => {
  const originalFileReader = (globalThis as { FileReader?: unknown }).FileReader;

  afterEach(() => {
    (globalThis as { FileReader?: unknown }).FileReader = originalFileReader;
  });

  test('uses browser-style blob.arrayBuffer when available', async () => {
    const input = new Uint8Array([1, 2, 3]).buffer;

    await expect(blobToArrayBuffer({ arrayBuffer: async () => input })).resolves.toBe(input);
  });

  test('falls back to React Native FileReader when arrayBuffer is missing', async () => {
    class FakeFileReader {
      result: ArrayBuffer | string | null = null;
      error: unknown = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsArrayBuffer(): void {
        this.result = new Uint8Array([4, 5, 6]).buffer;
        this.onloadend?.();
      }
    }
    (globalThis as { FileReader?: unknown }).FileReader = FakeFileReader;

    const buffer = await blobToArrayBuffer({});
    expect(bytes(buffer)).toEqual([4, 5, 6]);
  });

  test('throws a clear error when neither byte reader exists', async () => {
    (globalThis as { FileReader?: unknown }).FileReader = undefined;

    await expect(blobToArrayBuffer({})).rejects.toThrow(
      'downloaded storage blob cannot be read as bytes on this runtime',
    );
  });
});
