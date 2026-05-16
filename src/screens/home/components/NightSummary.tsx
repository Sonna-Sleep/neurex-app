import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Secondary } from '../../../theme/typography';
import { colors, spacing, systemFontFamily } from '../../../theme/tokens';

type Props = {
  /** Minutes asleep. null until the staging pipeline runs. */
  tstMin: number | null;
  /** 0..99 score. null until the staging pipeline runs. */
  score: number | null;
  /** When score is null we still want to show that we have a recording —
   * pass the recording's wall-clock duration so the user sees "21 min recorded"
   * instead of nothing. Optional; omit for the post-staging case. */
  recordingMinutes?: number | null;
  label?: string;
};

export function NightSummary({
  tstMin,
  score,
  recordingMinutes,
  label = 'last night',
}: Props) {
  return (
    <View style={styles.wrap}>
      <Secondary style={styles.label}>{label}</Secondary>
      <Text style={styles.score} allowFontScaling={false}>
        {score ?? '—'}
      </Text>
      <Secondary style={styles.label}>{subline(tstMin, recordingMinutes)}</Secondary>
    </View>
  );
}

function subline(tstMin: number | null, recordingMinutes: number | null | undefined) {
  if (tstMin != null) return `${fmtDuration(tstMin)} asleep`;
  if (recordingMinutes != null) return `${fmtDuration(recordingMinutes)} recorded — not analyzed yet`;
  return 'not analyzed yet';
}

function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  score: {
    fontSize: 104,
    fontWeight: '300',
    letterSpacing: -4,
    lineHeight: 108,
    color: colors.textPrimary,
    fontFamily: systemFontFamily,
  },
});
