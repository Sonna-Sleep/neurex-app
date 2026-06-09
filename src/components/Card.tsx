import React from 'react';
import { Platform, View, StyleSheet, ViewProps } from 'react-native';
import { colors, layout, radii } from '../theme/tokens';

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
    paddingVertical: 22,
    paddingHorizontal: 20,
    // Soft, low shadow so cards float gently off the page (iOS only — Android
    // elevation renders harsher; the surface/border lift carries it there).
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      default: {},
    }),
  },
});
