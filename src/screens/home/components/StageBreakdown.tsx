import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

import { colors, spacing, stageColors, radii } from '../../../theme/tokens';
import { systemFontFamily } from '../../../theme/tokens';
import type { SleepStage } from '../../../lib/repos';

type Props = { stageMinutes: Record<SleepStage, number> };

const ORDER: { key: SleepStage; label: string }[] = [
  { key: 'wake', label: 'Awake' },
  { key: 'rem', label: 'REM' },
  { key: 'light', label: 'Light' },
  { key: 'deep', label: 'Deep' },
];

export function StageBreakdown({ stageMinutes }: Props) {
  const total = ORDER.reduce((s, x) => s + stageMinutes[x.key], 0) || 1;
  const max = Math.max(...ORDER.map((x) => stageMinutes[x.key]));

  return (
    <View style={styles.wrap}>
      {ORDER.map(({ key, label }) => {
        const min = stageMinutes[key];
        const fraction = min / total;
        const widthPct = (min / Math.max(max, 1)) * 100;
        return (
          <View key={key} style={styles.row}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${widthPct}%`,
                    backgroundColor: stageColors[key],
                  },
                ]}
              />
            </View>
            <View style={styles.meta}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{fmtDur(min)}</Text>
              <Text style={styles.percent}>
                {Math.round(fraction * 100)}%
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.sm,
  },
  barTrack: {
    height: 22,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.small,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.small,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  label: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
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
    fontWeight: '400',
    color: colors.textSecondary,
  },
});
