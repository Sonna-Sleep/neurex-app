import { Directory, File, Paths } from 'expo-file-system';

export const UPLOAD_RECEIPT_NAME = 'upload_receipt.json';

export type UploadReceipt = {
  schemaVer: 1;
  sessionId: string;
  uploadedAtMs: number;
  storagePrefix: string;
  rawStoragePath: string;
  rawSha256: string;
  imuSha256?: string | null;
};

function sessionDir(sessionId: string): Directory {
  return new Directory(Paths.document, 'sessions', sessionId);
}

export function uploadReceiptFile(sessionId: string): File {
  return new File(sessionDir(sessionId), UPLOAD_RECEIPT_NAME);
}

export function hasUploadReceiptInDir(dir: Directory): boolean {
  try {
    return new File(dir, UPLOAD_RECEIPT_NAME).exists;
  } catch {
    return false;
  }
}

export function readUploadReceiptFromDir(dir: Directory): UploadReceipt | null {
  try {
    const file = new File(dir, UPLOAD_RECEIPT_NAME);
    if (!file.exists) return null;
    const parsed = JSON.parse(file.textSync()) as Partial<UploadReceipt>;
    if (
      parsed.schemaVer !== 1 ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.uploadedAtMs !== 'number' ||
      typeof parsed.storagePrefix !== 'string' ||
      typeof parsed.rawStoragePath !== 'string' ||
      typeof parsed.rawSha256 !== 'string'
    ) {
      return null;
    }
    return {
      schemaVer: 1,
      sessionId: parsed.sessionId,
      uploadedAtMs: parsed.uploadedAtMs,
      storagePrefix: parsed.storagePrefix,
      rawStoragePath: parsed.rawStoragePath,
      rawSha256: parsed.rawSha256,
      imuSha256: parsed.imuSha256 ?? null,
    };
  } catch {
    return null;
  }
}

export function writeUploadReceipt(receipt: Omit<UploadReceipt, 'schemaVer' | 'uploadedAtMs'>): void {
  const dir = sessionDir(receipt.sessionId);
  if (!dir.exists) dir.create({ intermediates: true });
  const file = uploadReceiptFile(receipt.sessionId);
  if (!file.exists) file.create();
  file.write(
    JSON.stringify({
      schemaVer: 1,
      uploadedAtMs: Date.now(),
      ...receipt,
    } satisfies UploadReceipt),
  );
}
