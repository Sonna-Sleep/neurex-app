// Skeleton loading placeholders. Shown while data is being fetched so the
// screen doesn't pop from empty to full — Oura/Whoop both use this pattern
// to make "loading" feel like progress instead of a frozen UI.
//
// Uses React Native's built-in Animated API with native driver — no extra
// deps, no perf cost on older devices.

import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

import { colors, radii, spacing } from '../theme/tokens';

type BlockProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

/**
 * Single shimmering block. Use directly for one-off placeholders, or as
 * the building block for composed skeletons (Card / Row).
 */
function Block({ width = '100%', height = 16, borderRadius = 6, style }: BlockProps) {
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as Animated.WithAnimatedValue<ViewStyle['width']>,
          height,
          borderRadius,
          backgroundColor: colors.bgSurface,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Home screen loading placeholder — mirrors the rough shape of the
 * NightSummary + Hypnogram + StageBreakdown stack so the layout doesn't
 * shift when real data arrives.
 */
function Card() {
  return (
    <View style={styles.card}>
      <Block width={120} height={14} />
      <Block width={140} height={104} borderRadius={12} />
      <Block width={180} height={14} />
      <Block height={220} borderRadius={12} style={styles.gap} />
      <View style={styles.gap}>
        <Block height={22} borderRadius={6} />
        <Block height={22} borderRadius={6} style={styles.smallGap} />
        <Block height={22} borderRadius={6} style={styles.smallGap} />
        <Block height={22} borderRadius={6} style={styles.smallGap} />
      </View>
    </View>
  );
}

/**
 * Journal list row placeholder — same shape as a Journal row
 * (date + duration on left, score on right, stage bar below).
 */
function Row() {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.rowLeft}>
          <Block width={80} height={12} />
          <Block width={50} height={14} style={styles.smallGap} />
        </View>
        <Block width={48} height={36} borderRadius={6} />
      </View>
      <Block height={6} borderRadius={2} style={styles.smallGap} />
    </View>
  );
}

export const Skeleton = { Block, Card, Row };

const styles = StyleSheet.create({
  card: {
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  row: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  rowLeft: {
    gap: spacing.xs,
  },
  gap: {
    marginTop: spacing.md,
  },
  smallGap: {
    marginTop: spacing.xs,
  },
});

// Touch — keep `radii` symbol referenced so the import isn't flagged when
// we add card-radius variants in future iterations.
void radii;
