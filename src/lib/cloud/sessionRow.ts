// Attach raw-ground-truth provenance to the sessions insert row.
//
// The backend treats `raw_sha256` as a HARD integrity gate: when it is present it
// verifies the assembled segments/raw against it and, on a match, stages the
// authoritative MULTICHANNEL path (Fp1/Fp2 + EOG → YASA). A MISMATCH FAILS the
// night. So the caller must only pass a hash once the COMPLETE raw is confirmed
// uploaded. New recordings are raw-gated before finalize; absent/empty here is
// only a guardrail so an incomplete upload cannot claim raw provenance.

export type RawProvenance = {
  rawSha256?: string | null;
  rawStoragePath?: string | null;
};

export function hasRawProvenance({ rawSha256 }: RawProvenance): boolean {
  return typeof rawSha256 === 'string' && rawSha256.length > 0;
}

/** Return a copy of `row` with raw_sha256/raw_storage_path added iff a non-empty
 * hash is supplied. Never mutates `row`. */
export function sessionRowWithRaw(
  row: Record<string, unknown>,
  provenance: RawProvenance,
): Record<string, unknown> {
  const { rawSha256, rawStoragePath } = provenance;
  if (typeof rawSha256 !== 'string' || rawSha256.length === 0) return { ...row };
  const out: Record<string, unknown> = { ...row, raw_sha256: rawSha256 };
  if (rawStoragePath) out.raw_storage_path = rawStoragePath;
  return out;
}
