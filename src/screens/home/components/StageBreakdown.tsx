import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

import {
  colors,
  spacing,
  stageColors,
  STAGE_META,
  radii,
  systemFontFamily,
} from '../../../theme/tokens';
import type { SleepStage } from '../../../lib/repos';

type Props = { stageMinutes: Record<SleepStage, number> };

export function StageBreakdown({ stageMinutes }: Props) {
  // Read every stage through `?? 0` — a short night may be missing a stage.
  const minutesFor = (key: SleepStage) => stageMinutes?.[key] ?? 0;
  const total = STAGE_META.reduce((s, x) => s + minutesFor(x.key), 0) || 1;

  return (
    <View style={styles.wrap}>
      {/* One honest stacked proportion bar: each segment is its true share of
          the night, so widths actually match the percentages below. */}
      <View style={styles.bar}>
        {STAGE_META.map(({ key }) => {
          const min = minutesFor(key);
          if (min <= 0) return null;
          return (
            <View key={key} style={{ flex: min / total, backgroundColor: stageColors[key] }} />
          );
        })}
      </View>

      {/* Legend rows, sleep-first order: color · stage · duration · share. */}
      <View style={styles.rows}>
        {STAGE_META.map(({ key, label }) => {
          const min = minutesFor(key);
          const pct = Math.round((min / total) * 100);
          return (
            <View key={key} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: stageColors[key] }]} />
              <Text style={styles.label}>{label}</Text>
              <View style={styles.spacer} />
              <Text style={styles.value}>{fmtDur(min)}</Text>
              <Text style={styles.percent}>{pct}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function fmtDur(min: number) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return `${h}h ${r}m`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  bar: {
    flexDirection: 'row',
    height: 16,
    borderRadius: radii.small,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface,
    gap: 2,
  },
  rows: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  spacer: {
    flex: 1,
  },
  value: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  percent: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    color: colors.textSecondary,
    width: 40,
    textAlign: 'right',
  },
});
