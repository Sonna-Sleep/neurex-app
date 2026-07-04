import type { Session } from './types';

const MIN_ANALYSIS_MIN = 20;

export function isCompletedSession(session: Session): boolean {
  return session.status === 'ready' && session.score != null && session.tst != null;
}

export function isFailedAnalysisSession(session: Session): boolean {
  return session.status === 'failed';
}

export function isPendingAnalysisSession(session: Session): boolean {
  return (
    (session.status === 'uploaded' || session.status === 'processing') &&
    session.tib >= MIN_ANALYSIS_MIN
  );
}

export function isJournalVisibleSession(session: Session): boolean {
  return (
    isCompletedSession(session) ||
    isPendingAnalysisSession(session) ||
    isFailedAnalysisSession(session)
  );
}

export function journalSessionRank(session: Session): number {
  if (isCompletedSession(session)) return 3;
  if (isPendingAnalysisSession(session)) return 2;
  if (isFailedAnalysisSession(session)) return 1;
  return 0;
}

export function betterJournalSession(a: Session, b: Session): Session {
  const rankDelta = journalSessionRank(a) - journalSessionRank(b);
  if (rankDelta > 0) return a;
  if (rankDelta < 0) return b;
  return a.endMs > b.endMs ? a : b;
}

export function cloudUploadAttentionSessions(sessions: Session[], limit = 5): Session[] {
  return sessions
    .filter((session) => isFailedAnalysisSession(session) || isPendingAnalysisSession(session))
    .sort((a, b) => b.endMs - a.endMs)
    .slice(0, limit);
}
