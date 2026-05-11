import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { colors, layout, radii, spacing } from '../theme/tokens';

type Props = ViewProps & {
  children: React.ReactNode;
};

export function Card({ children, style, ...rest }: Props) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
});
