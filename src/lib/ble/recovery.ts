// Data-loss safety net for recordings (2026-06-03).
//
// Recordings stream to FileSystem.documentDirectory/sessions/<sessionId>/EEG.BIN
// (+ EOG.BIN) as packets arrive. The "saved" list in the UI is only populated
// when a session is STOPPED normally (multiStop). If a session ends by a BLE
// disconnect / app kill instead, its partial file is left ORPHANED on disk and
// the UI never surfaces it — which is how a dropped overnight looked like "no
// data at all" even though bytes were written.
//
// This module scans the sessions/ directory for any folder holding a non-empty
// EEG.BIN and returns it so the UI can offer to share/pull it. So a dropped
// session always leaves a RECOVERABLE partial file, never a silent zero.

import { Directory, File, Paths } from 'expo-file-system';

const EEG_RECORD_BYTES = 8; // uint32 ms + float32 fpz_uV (matches real.ts)

export type RecoveredSession = {
  sessionId: string;
  /** Parsed from the folder name (dual sessions are "<serial>_<uuid>"). */
  serial: string;
  eegUri: string;
  eogUri: string | null;
  /** Approx sample count derived from EEG.BIN size. */
  samples: number;
  bytes: number;
};

/**
 * List on-disk sessions with recorded EEG data, excluding the given session IDs
 * (typically the ones currently recording or already in this run's saved list).
 * Best-effort: any filesystem error yields an empty list rather than throwing.
 */
export function listRecoverableSessions(exclude: Set<string> = new Set()): RecoveredSession[] {
  try {
    const sessionsDir = new Directory(Paths.document, 'sessions');
    if (!sessionsDir.exists) return [];

    const out: RecoveredSession[] = [];
    for (const entry of sessionsDir.list()) {
      if (!(entry instanceof Directory)) continue;
      const sessionId = entry.name;
      if (exclude.has(sessionId)) continue;

      const eeg = new File(entry, 'EEG.BIN');
      const bytes = eeg.exists ? eeg.size ?? 0 : 0;
      if (bytes <= 0) continue; // nothing recorded → skip

      const eog = new File(entry, 'EOG.BIN');
      out.push({
        sessionId,
        serial: sessionId.includes('_') ? sessionId.split('_')[0] : 'recording',
        eegUri: eeg.uri,
        eogUri: eog.exists ? eog.uri : null,
        samples: Math.floor(bytes / EEG_RECORD_BYTES),
        bytes,
      });
    }
    // Biggest (most data) first.
    return out.sort((a, b) => b.bytes - a.bytes);
  } catch {
    return [];
  }
}
