// One night's full report — score ring, in-bed/asleep, hypnogram, stage
// breakdown, details. Extracted from JournalScreen so the same rendering is
// reused inline in the Journal calendar AND on the dedicated SessionDetail
// screen (opened from the "Your night is ready" notification).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Eyebrow, Secondary } from '../../theme/typography';
import { colors, spacing, systemFontFamily } from '../../theme/tokens';
import type { Session } from '../../lib/repos';
import { ScoreRing } from '../../components/ScoreRing';
import { Hypnogram } from '../home/components/Hypnogram';
import { StageBreakdown } from '../home/components/StageBreakdown';

function fmtDur(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function NightReport({ session }: { session: Session }) {
  return (
    <View style={styles.report}>
      {/* Score ring + in-bed / asleep */}
      <View style={styles.scoreRow}>
        <ScoreRing score={session.score} size={150} showLabel={false} />
        <View style={styles.stats}>
          <Stat value={fmtDur(session.tib)} label="In bed" />
          <Stat value={fmtDur(session.tst)} label="Asleep" />
        </View>
      </View>

      {session.score != null ? (
        <>
          <View style={styles.section}>
            <Eyebrow>sleep stages</Eyebrow>
            <Hypnogram epochs={session.epochs} startMs={session.startMs} endMs={session.endMs} />
          </View>
          <StageBreakdown stageMinutes={session.stageMinutes} />

          <View style={styles.section}>
            <Eyebrow>details</Eyebrow>
            <View style={styles.detailRows}>
              <DetailRow
                label="Fell asleep in"
                value={session.sol != null ? `${Math.round(session.sol)} min` : '—'}
              />
              <DetailRow
                label="Staging confidence"
                value={session.confidence != null ? `${Math.round(session.confidence * 100)}%` : '—'}
              />
            </View>
          </View>
        </>
      ) : (
        <Secondary style={styles.processing}>Analyzing this night…</Secondary>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Secondary style={styles.statLabel}>{label}</Secondary>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Secondary style={styles.detailLabel}>{label}</Secondary>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  report: {
    gap: spacing.xl,
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
  detailRows: {
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: colors.textSecondary,
  },
  detailValue: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  processing: {
    color: colors.textSecondary,
  },
});
