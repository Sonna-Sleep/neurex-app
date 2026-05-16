// Polls Supabase for a newly-uploaded session to appear (or to finish
// processing). Use after uploadRecording() returns the session_id; the
// session row may already exist (Modal INSERTs before returning), so the
// first poll usually resolves immediately. We keep polling in case a
// future flow inserts the row eventually rather than synchronously.

import { useEffect, useState } from 'react';
import { supabaseSessionRepo } from '../repos/supabase';
import type { Session } from '../repos/types';
import { ProcessingTimeoutError, UploadError } from './errors';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

export type ProcessingStatus =
  | { state: 'idle' }
  | { state: 'polling' }
  | { state: 'ready'; session: Session }
  | { state: 'error'; error: UploadError };

export function useProcessingStatus(sessionId: string | null): ProcessingStatus {
  const [status, setStatus] = useState<ProcessingStatus>({ state: 'idle' });

  useEffect(() => {
    if (!sessionId) {
      setStatus({ state: 'idle' });
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    setStatus({ state: 'polling' });

    async function poll() {
      if (cancelled) return;
      try {
        // sessionId is non-null here — the early return above guards against it.
        const session = await supabaseSessionRepo.byId(sessionId!);
        if (cancelled) return;
        if (session) {
          setStatus({ state: 'ready', session });
          if (interval) clearInterval(interval);
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          // sessionId is non-null here — the early return above guards against it.
          setStatus({
            state: 'error',
            error: new ProcessingTimeoutError(sessionId!),
          });
          if (interval) clearInterval(interval);
        }
      } catch (e) {
        if (cancelled) return;
        const err =
          e instanceof UploadError
            ? e
            : new UploadError('Failed to poll session status', e);
        setStatus({ state: 'error', error: err });
        if (interval) clearInterval(interval);
      }
    }

    // First poll immediately, then on interval.
    poll();
    interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [sessionId]);

  return status;
}
