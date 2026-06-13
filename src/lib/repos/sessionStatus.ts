import type { Session } from './types';

const MIN_ANALYSIS_MIN = 20;

export function isCompletedSession(session: Session): boolean {
  return session.status === 'ready' && session.score != null && session.tst != null;
}

export function isPendingAnalysisSession(session: Session): boolean {
  return (
    (session.status === 'uploaded' || session.status === 'processing') &&
    session.tib >= MIN_ANALYSIS_MIN
  );
}

export function isJournalVisibleSession(session: Session): boolean {
  return isCompletedSession(session) || isPendingAnalysisSession(session);
}

export function journalSessionRank(session: Session): number {
  if (isCompletedSession(session)) return 2;
  if (isPendingAnalysisSession(session)) return 1;
  return 0;
}

export function betterJournalSession(a: Session, b: Session): Session {
  const rankDelta = journalSessionRank(a) - journalSessionRank(b);
  if (rankDelta > 0) return a;
  if (rankDelta < 0) return b;
  return a.endMs > b.endMs ? a : b;
}
