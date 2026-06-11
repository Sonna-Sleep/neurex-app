// One night's full report — score ring, in-bed/asleep, hypnogram, stage
// breakdown, details. Extracted from JournalScreen so the same rendering is
// reused inline in the Journal calendar AND on the dedicated SessionDetail
// screen (opened from the "Your night is ready" notification).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

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

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
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
            <View style={styles.detailGrid}>
              <DetailTile icon="moon" value={fmtTime(session.startMs)} label="Went to bed" />
              <DetailTile icon="alarm" value={fmtTime(session.endMs)} label="Woke up" />
              <DetailTile
                icon="asleep"
                value={session.sol != null ? `${Math.round(session.sol)} min` : '—'}
                label="Asleep after"
              />
              <DetailTile
                icon="confidence"
                value={session.confidence != null ? `${Math.round(session.confidence * 100)}%` : '—'}
                label="Confidence"
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

type DetailIconName = 'asleep' | 'moon' | 'alarm' | 'confidence';

function DetailTile({ icon, value, label }: { icon: DetailIconName; value: string; label: string }) {
  return (
    <View style={styles.detailTile}>
      <DetailIcon name={icon} />
      <View style={styles.detailText}>
        <Text style={styles.detailValue}>{value}</Text>
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
    </View>
  );
}

function DetailIcon({ name }: { name: DetailIconName }) {
  const c = colors.textSecondary;
  switch (name) {
    case 'asleep':
      return (
        <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
          <Circle cx={22} cy={22} r={18} fill={c} />
          <Path d="M14 20C16 23 18 23 20 20M24 20C26 23 28 23 30 20" stroke={colors.bgPrimary} strokeWidth={3} strokeLinecap="round" />
          <Path d="M17 29C20 32 24 32 27 29" stroke={colors.bgPrimary} strokeWidth={3} strokeLinecap="round" />
        </Svg>
      );
    case 'moon':
      return (
        <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
          <Path d="M33 30.5A15.5 15.5 0 0 1 16.5 8A17 17 0 1 0 33 30.5Z" fill={c} />
        </Svg>
      );
    case 'alarm':
      return (
        <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
          <Circle cx={22} cy={24} r={14} fill={c} />
          <Path d="M15 8L9 13M29 8L35 13" stroke={c} strokeWidth={4} strokeLinecap="round" />
          <Path d="M15 24L20 29L30 18" stroke={colors.bgPrimary} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'confidence':
      return (
        <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
          <Circle cx={22} cy={22} r={17} fill={c} />
          <Path d="M14 23L20 29L31 16" stroke={colors.bgPrimary} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
  }
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
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  detailTile: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    paddingRight: spacing.sm,
  },
  detailText: {
    flex: 1,
    gap: 2,
  },
  detailValue: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  detailLabel: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  processing: {
    color: colors.textSecondary,
  },
});
