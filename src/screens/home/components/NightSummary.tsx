import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Secondary } from '../../../theme/typography';
import { colors, spacing, systemFontFamily } from '../../../theme/tokens';

type Props = {
  tstSec: number;
  score: number;
  label?: string;
};

export function NightSummary({ tstSec, score, label = 'last night' }: Props) {
  const h = Math.floor(tstSec / 3600);
  const m = Math.floor((tstSec % 3600) / 60);
  return (
    <View style={styles.wrap}>
      <Secondary style={styles.label}>{label}</Secondary>
      <Text style={styles.score} allowFontScaling={false}>
        {score}
      </Text>
      <Secondary style={styles.label}>
        {h}h {m}min asleep
      </Secondary>
    </View>
  );
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
