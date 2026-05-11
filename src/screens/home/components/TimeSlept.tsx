import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '../../../theme/typography';
import { colors, spacing, systemFontFamily } from '../../../theme/tokens';

type Props = {
  tstSec: number;
  score: number;
};

export function TimeSlept({ tstSec, score }: Props) {
  const h = Math.floor(tstSec / 3600);
  const m = Math.floor((tstSec % 3600) / 60);
  return (
    <View style={styles.wrap}>
      <Eyebrow>last night · score {score}</Eyebrow>
      <Text style={styles.hero} allowFontScaling={false}>
        <Text style={styles.big}>{h}</Text>
        <Text style={styles.unit}>h </Text>
        <Text style={styles.big}>{m}</Text>
        <Text style={styles.unit}>min</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  hero: {
    color: colors.textPrimary,
    fontFamily: systemFontFamily,
  },
  big: {
    fontSize: 76,
    fontWeight: '300',
    letterSpacing: -2,
    lineHeight: 80,
    color: colors.textPrimary,
    fontFamily: systemFontFamily,
  },
  unit: {
    fontSize: 32,
    fontWeight: '300',
    letterSpacing: -0.5,
    color: colors.textPrimary,
    fontFamily: systemFontFamily,
  },
});
