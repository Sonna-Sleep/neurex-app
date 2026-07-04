// Read bytes from a Supabase Storage download body across runtimes.
//
// Browser Blob has arrayBuffer(). React Native's Blob polyfill can lack that
// method, but RN does provide FileReader. Resumable uploads must be able to read
// already-uploaded segment blobs to verify their bytes before skipping them.

type BlobLike = {
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

type FileReaderLike = {
  result: string | ArrayBuffer | null;
  error: unknown;
  onloadend: (() => void) | null;
  onerror: (() => void) | null;
  readAsArrayBuffer: (blob: BlobLike) => void;
};

type FileReaderCtor = new () => FileReaderLike;

export async function blobToArrayBuffer(blob: BlobLike): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();

  const FileReaderImpl = (globalThis as unknown as { FileReader?: FileReaderCtor }).FileReader;
  if (!FileReaderImpl) {
    throw new Error('downloaded storage blob cannot be read as bytes on this runtime');
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReaderImpl();
    reader.onerror = () => reject(reader.error ?? new Error('storage blob read failed'));
    reader.onloadend = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('storage blob read did not produce bytes'));
      }
    };
    reader.readAsArrayBuffer(blob);
  });
}
