import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

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

const SIZE = 184;
const STROKE = 12;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Score → plain-language verdict + calm band color. Turns a bare number into
// something a half-asleep person can read at a glance. Scores cap at 99.
function scoreBand(score: number | null): { label: string; color: string } {
  if (score == null) return { label: 'Analyzing…', color: colors.textTertiary };
  if (score >= 85) return { label: 'Optimal', color: colors.positive };
  if (score >= 70) return { label: 'Good', color: '#7FB3E0' };
  if (score >= 55) return { label: 'Fair', color: colors.warning };
  return { label: 'Pay attention', color: '#D98C6A' };
}

export function NightSummary({
  tstMin,
  score,
  recordingMinutes,
  label = 'last night',
}: Props) {
  const isScored = score != null;
  const band = scoreBand(score);
  const progress = isScored ? Math.max(0, Math.min(1, (score as number) / 99)) : 0;

  // Single non-native-driver value drives both the inner text spring-in and the
  // ring sweep (SVG stroke props can't use the native driver).
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isScored) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 750,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [score, isScored, anim]);

  const dashoffset = anim.interpolate({ inputRange: [0, 1], outputRange: [C, C * (1 - progress)] });
  const centerStyle = isScored
    ? {
        opacity: anim,
        transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
      }
    : null;

  return (
    <View style={styles.wrap}>
      <Secondary style={styles.label}>{label}</Secondary>

      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.borderSubtle}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={band.color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={C}
            strokeDashoffset={isScored ? dashoffset : C}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <Animated.View style={[styles.center, centerStyle]}>
          <Text style={styles.score} allowFontScaling={false}>
            {score ?? '—'}
          </Text>
          <Text style={[styles.descriptor, { color: band.color }]} allowFontScaling={false}>
            {band.label}
          </Text>
        </Animated.View>
      </View>

      <Secondary style={styles.sub}>{subline(tstMin, recordingMinutes)}</Secondary>
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
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  label: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: typeScale.serifHero,
  descriptor: {
    fontFamily: typeScale.sansButton.fontFamily,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: spacing.xs,
  },
  sub: {
    fontSize: 15,
    color: colors.textSecondary,
  },
});
