import { useEffect, useRef } from 'react';

import { useSession } from '../../state/session';
import { activeOrRestoringSessionId } from '../ble/streamController';
import {
  clearActiveRecording,
  getActiveRecording,
  noticeFromRecovery,
  recoverAll,
} from './recovery';

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
    (async () => {
      const marker = await getActiveRecording();
      const liveOrRestoringSessionIdNow = activeOrRestoringSessionId();
      try {
        const results = await recoverAll(null);
        const notice = noticeFromRecovery({
          marker,
          results,
          liveOrRestoringSessionId: liveOrRestoringSessionIdNow,
          nowMs: Date.now(),
        });
        if (notice) useSession.getState().setSessionNotice(notice);
      } finally {
        if (marker && marker.sessionId !== liveOrRestoringSessionIdNow) {
          await clearActiveRecording();
        }
      }
    })().catch(() => undefined);
  }, [authReady, signedIn, streaming]);
}
