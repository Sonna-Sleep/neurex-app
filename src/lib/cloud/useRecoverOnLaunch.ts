import { useEffect, useRef } from 'react';

import { useSession } from '../../state/session';
import { recoverChunkedSessions } from './chunkRecovery';
import { recoverAll } from './recovery';

/**
 * On launch — once auth is ready + signed in, and nothing is currently
 * recording — sweep documentDirectory/sessions/ for any night that was written
 * to disk but never uploaded: a crash/kill mid-night, an iOS state-restoration
 * we couldn't resume, or an upload that never finished. Each recoverable night
 * is shipped through the normal transmit path (idempotent: upload resumes,
 * finalize dedupes), so retrying across launches is safe and never duplicates.
 *
 * Runs at most once per process (a crash starts a new process → it runs again).
 */
export function useRecoverOnLaunch(): void {
  const authReady = useSession((s) => s.authReady);
  const signedIn = useSession((s) => s.authStatus === 'signed-in');
  const streaming = useSession((s) => s.streaming);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (!authReady || !signedIn) return;
    if (streaming) return; // never touch the live session's file mid-recording
    ran.current = true;
    // Legacy single-file nights (EEG.BIN) + crashed segments-first nights (segments/eeg).
    // Disjoint layouts, so both run; each is independently idempotent.
    recoverAll(null).catch(() => undefined);
    recoverChunkedSessions(null).catch(() => undefined);
  }, [authReady, signedIn, streaming]);
}
