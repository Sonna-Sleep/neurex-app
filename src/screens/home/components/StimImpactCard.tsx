import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Eyebrow, Secondary } from '../../../theme/typography';
import {
  colors,
  layout,
  radii,
  spacing,
  systemFontFamily,
  typeScale,
} from '../../../theme/tokens';

type Props = {
  stimCount: number;
  stimImpactPct: number | null;
};

// Neurex Boost card — the unique "we made your sleep deeper tonight" moment.
// Spec §4 free-tier: shows count + single SWA % number. The detailed
// per-stim phase accuracy view is Pro (v2).
export function StimImpactCard({ stimCount, stimImpactPct }: Props) {
  if (stimCount === 0) {
    return (
      <View style={styles.wrap}>
        <Eyebrow>neurex boost</Eyebrow>
        <Body style={styles.muted}>
          No stims tonight. Wear the sleep mask during NREM to enhance slow-wave
          sleep.
        </Body>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Eyebrow>neurex boost</Eyebrow>
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statNum} allowFontScaling={false}>
            {stimCount}
          </Text>
          <Secondary style={styles.statLabel}>stims delivered</Secondary>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          {stimImpactPct == null ? (
            <>
              <Text style={styles.statNumPending} allowFontScaling={false}>
                —
              </Text>
              <Secondary style={styles.statLabel}>analyzing…</Secondary>
            </>
          ) : (
            <>
              <Text style={styles.statNum} allowFontScaling={false}>
                <Text style={styles.plus}>+</Text>
                {Math.round(stimImpactPct)}
                <Text style={styles.unit}>%</Text>
              </Text>
              <Secondary style={styles.statLabel}>slow-wave boost</Secondary>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.borderSubtle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flex: 1,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  statNum: typeScale.statNumber,
  // Same metrics as statNum but muted color — keeps the visual rhythm
  // identical when the value is still being computed.
  statNumPending: {
    ...typeScale.statNumber,
    color: colors.textTertiary,
  },
  plus: {
    color: colors.textSecondary,
    fontWeight: '300',
  },
  unit: {
    fontSize: 24,
    fontWeight: '300',
    color: colors.textSecondary,
  },
  statLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  divider: {
    width: 1,
    height: 48,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md,
  },
  muted: {
    color: colors.textSecondary,
  },
});
