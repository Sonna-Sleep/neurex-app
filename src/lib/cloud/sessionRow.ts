// Attach raw-ground-truth provenance to the sessions insert row.
//
// The backend treats `raw_sha256` as a HARD integrity gate: when it is present it
// verifies the assembled segments/raw against it and, on a match, stages the
// authoritative MULTICHANNEL path (Fp1/Fp2 + EOG → YASA). A MISMATCH FAILS the
// night. So the caller must only pass a hash once the COMPLETE raw is confirmed
// uploaded — absent/empty here means "stage from the eeg fallback" (Fp1-only),
// which is the safe default for interrupted nights.

export type RawProvenance = {
  rawSha256?: string | null;
  rawStoragePath?: string | null;
};

/** Return a copy of `row` with raw_sha256/raw_storage_path added iff a non-empty
 * hash is supplied. Never mutates `row`. */
export function sessionRowWithRaw(
  row: Record<string, unknown>,
  { rawSha256, rawStoragePath }: RawProvenance,
): Record<string, unknown> {
  if (!rawSha256) return { ...row };
  const out: Record<string, unknown> = { ...row, raw_sha256: rawSha256 };
  if (rawStoragePath) out.raw_storage_path = rawStoragePath;
  return out;
}
