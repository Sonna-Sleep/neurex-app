// Circular sleep-score ring with the number + descriptor inside. Score bands
// use our own calm colors (the reference's orange is just layout inspiration).
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, typeScale } from '../theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function scoreBand(score: number | null): { label: string; color: string } {
  if (score == null) return { label: 'Analyzing…', color: colors.textTertiary };
  if (score >= 85) return { label: 'Optimal', color: colors.positive };
  if (score >= 70) return { label: 'Good', color: colors.positive };
  if (score >= 55) return { label: 'Fair', color: colors.warning };
  return { label: 'Pay attention', color: colors.danger };
}

type Props = {
  score: number | null;
  /** Diameter in px. */
  size?: number;
  /** Ring thickness. */
  stroke?: number;
  /** Show the descriptor word under the number. */
  showLabel?: boolean;
};

export function ScoreRing({ score, size = 160, stroke = 11, showLabel = true }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const band = scoreBand(score);
  const isScored = score != null;
  const progress = isScored ? Math.max(0, Math.min(1, (score as number) / 99)) : 0;

  const [anim] = useState(() => new Animated.Value(0));
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

  const dashoffset = anim.interpolate({ inputRange: [0, 1], outputRange: [c, c * (1 - progress)] });
  const numberSize = Math.round(size * 0.3);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.borderSubtle} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={band.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={isScored ? dashoffset : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.number, { fontSize: numberSize, lineHeight: numberSize + 2 }]} allowFontScaling={false}>
          {score != null ? `${score}%` : '—'}
        </Text>
        {showLabel ? (
          <Text style={[styles.descriptor, { color: band.color }]} allowFontScaling={false}>
            {band.label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    fontFamily: typeScale.serifHero.fontFamily,
    fontWeight: '600',
    letterSpacing: -1.5,
    color: colors.textPrimary,
  },
  descriptor: {
    fontFamily: typeScale.sansButton.fontFamily,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
});
