import type { Session } from '../types';
import {
  isFailedAnalysisSession,
  isJournalVisibleSession,
  isPendingAnalysisSession,
  journalSessionRank,
} from '../sessionStatus';

function session(overrides: Partial<Session>): Session {
  return {
    id: 'session-id',
    startMs: 0,
    endMs: 60_000,
    tib: 1,
    tst: null,
    waso: null,
    efficiency: null,
    awakenings: null,
    stageMinutes: {},
    epochs: [],
    score: null,
    confidence: null,
    sol: null,
    excludedMinutes: 0,
    signalEndMs: null,
    storagePrefix: null,
    status: 'uploaded',
    ...overrides,
  };
}

describe('sessionStatus', () => {
  it('shows failed cloud sessions in the journal so uploads are not hidden', () => {
    const failed = session({ status: 'failed', tib: 17.36 });

    expect(isFailedAnalysisSession(failed)).toBe(true);
    expect(isPendingAnalysisSession(failed)).toBe(false);
    expect(isJournalVisibleSession(failed)).toBe(true);
    expect(journalSessionRank(failed)).toBe(1);
  });

  it('keeps short pending recordings hidden until they are actionable', () => {
    expect(isJournalVisibleSession(session({ status: 'uploaded', tib: 17.36 }))).toBe(false);
    expect(isJournalVisibleSession(session({ status: 'processing', tib: 19.99 }))).toBe(false);
    expect(isJournalVisibleSession(session({ status: 'processing', tib: 20 }))).toBe(true);
  });
});
