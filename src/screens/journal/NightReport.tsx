// One night's full report — score ring, in-bed/asleep, hypnogram, stage
// breakdown, details. Extracted from JournalScreen so the same rendering is
// reused inline in the Journal calendar AND on the dedicated SessionDetail
// screen (opened from the "Your night is ready" notification).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Eyebrow, Secondary } from '../../theme/typography';
import { colors, spacing, systemFontFamily } from '../../theme/tokens';
import type { Session } from '../../lib/repos';
import { isCompletedSession, isPendingAnalysisSession } from '../../lib/repos/sessionStatus';
import { ScoreRing } from '../../components/ScoreRing';
import { Hypnogram } from '../home/components/Hypnogram';
import { StageBreakdown } from '../home/components/StageBreakdown';
import { SleepAnalysis } from './components/SleepAnalysis';

function fmtDur(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function NightReport({ session, history = [] }: { session: Session; history?: Session[] }) {
  const completed = isCompletedSession(session);
  const pending = isPendingAnalysisSession(session);
  return (
    <View style={styles.report}>
      <View style={styles.summaryIntro}>
        <Eyebrow>here’s how you slept today</Eyebrow>
        <Text style={styles.summaryTitle}>{nightSummary(session)}</Text>
        <Secondary>
          Start with the essentials, then explore brain, body, context, and model confidence below.
        </Secondary>
      </View>
      {/* Score ring + in-bed / asleep */}
      <View style={styles.scoreRow}>
        <ScoreRing score={session.score} size={150} showLabel={false} />
        <View style={styles.stats}>
          <Stat value={fmtDur(session.tib)} label="In bed" />
          <Stat value={fmtDur(session.tst)} label="Asleep" />
        </View>
      </View>

      {completed ? (
        <>
          <View style={styles.section}>
            <Eyebrow>sleep stages</Eyebrow>
            <Hypnogram epochs={session.epochs} startMs={session.startMs} endMs={session.endMs} />
            {session.excludedMinutes > 0 ? (
              <Secondary style={styles.signalNote}>
                {`No-signal time excluded from sleep metrics: ${fmtDur(session.excludedMinutes)}${
                  session.signalEndMs != null
                    ? ` · usable signal ended around ${fmtTime(session.startMs + session.signalEndMs)}`
                    : ''
                }.`}
              </Secondary>
            ) : null}
          </View>
          <StageBreakdown stageMinutes={session.stageMinutes} />

          <SleepAnalysis session={session} history={history} />

          <View style={styles.section}>
            <Eyebrow>recording details</Eyebrow>
            <View style={styles.detailGrid}>
              <DetailTile value={fmtTime(session.startMs)} label="Went to bed" />
              <DetailTile value={fmtTime(session.endMs)} label="Woke up" />
              <DetailTile
                value={session.confidence != null ? `${Math.round(session.confidence * 100)}%` : '—'}
                label="Stage confidence"
              />
            </View>
          </View>
        </>
      ) : session.status === 'failed' ? (
        <Secondary style={styles.processing}>
          Analysis failed. Contact support at contact@neurex.tech.
        </Secondary>
      ) : (
        <Secondary style={styles.processing}>
          {pending ? 'Analyzing this night…' : 'This recording could not be analyzed.'}
        </Secondary>
      )}
    </View>
  );
}

function nightSummary(session: Session) {
  if (session.tst == null) return 'Your night is still being analyzed.';
  const efficiency = session.efficiency == null ? null : `${Math.round(session.efficiency)}% efficiency`;
  const latency = session.sol == null ? null : `${Math.round(session.sol)} min to fall asleep`;
  const detail = [efficiency, latency].filter(Boolean).join(' · ');
  return `${fmtDur(session.tst)} asleep${detail ? ` · ${detail}` : ''}`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Secondary style={styles.statLabel}>{label}</Secondary>
    </View>
  );
}

function DetailTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.detailTile}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  report: {
    gap: spacing.xl,
  },
  summaryIntro: {
    gap: spacing.xs,
  },
  summaryTitle: {
    fontFamily: systemFontFamily,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '600',
    letterSpacing: -0.4,
    color: colors.textPrimary,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  stats: {
    flex: 1,
    gap: spacing.lg,
  },
  stat: {
    gap: 2,
  },
  statValue: {
    fontFamily: systemFontFamily,
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  statLabel: {
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.md,
  },
  signalNote: {
    color: colors.textSecondary,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  detailTile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 76,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  detailValue: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  detailLabel: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  processing: {
    color: colors.textSecondary,
  },
});
