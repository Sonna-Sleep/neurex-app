import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { Secondary } from '../../../theme/typography';
import { colors, spacing, typeScale } from '../../../theme/tokens';

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
  // Spring the score in when analysis lands — it's the hero value, so it should
  // arrive with a little life rather than just popping into place. Built-in
  // Animated (no Reanimated/Babel dependency) keeps this beta-safe.
  const anim = useRef(new Animated.Value(0)).current;
  const isScored = score != null;
  useEffect(() => {
    if (!isScored) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [score, isScored, anim]);

  const scoreStyle = isScored
    ? {
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
      }
    : null;

  return (
    <View style={styles.wrap}>
      <Secondary style={styles.label}>{label}</Secondary>
      <Animated.Text style={[styles.score, scoreStyle]} allowFontScaling={false}>
        {score ?? '—'}
      </Animated.Text>
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
  score: typeScale.serifHero,
});
