import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Eyebrow, SerifDisplay } from '../theme/typography';
import { spacing } from '../theme/tokens';

type Props = {
  label: string;
  value: string;
  emphasized?: boolean;
  style?: ViewStyle;
};

export function EyebrowValue({ label, value, emphasized, style }: Props) {
  return (
    <View style={[styles.cell, style]}>
      <Eyebrow>{label}</Eyebrow>
      <SerifDisplay style={[styles.value, emphasized && styles.emphasized]}>
        {value}
      </SerifDisplay>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  value: {
    marginTop: spacing.xs,
  },
  emphasized: {
    fontSize: 44,
    lineHeight: 48,
  },
});
