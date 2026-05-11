import React from 'react';
import { Pressable, StyleSheet, View, Text } from 'react-native';
import { colors, radii, spacing, fonts } from '../theme/tokens';

type Props = {
  battery: number | null;
  unsynced?: boolean;
  onPress?: () => void;
};

export function StatusPill({ battery, unsynced, onPress }: Props) {
  const isLow = battery !== null && battery < 15;
  const label = battery !== null ? `${battery}%` : '—';

  return (
    <Pressable onPress={onPress} style={styles.pill} hitSlop={8}>
      <View
        style={[
          styles.dot,
          { backgroundColor: isLow ? colors.warning : colors.textPrimary },
        ]}
      />
      <Text style={[styles.label, isLow && { color: colors.warning }]}>
        {label}
      </Text>
      {unsynced ? <View style={styles.unsyncedDot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontWeight: '500',
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textPrimary,
  },
  unsyncedDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textTertiary,
    marginLeft: spacing.xs,
  },
});
