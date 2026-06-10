// Shared, unmissable back control. Editorial style (no native header bar) but a
// clear chevron + label with a large tap target so users always have an obvious
// way out of pushed/detail screens.
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { colors, spacing, systemFontFamily } from '../theme/tokens';

type Props = {
  label?: string;
  onPress?: () => void;
};

export function BackButton({ label = 'back', onPress }: Props) {
  const navigation = useNavigation();
  return (
    <Pressable
      onPress={onPress ?? (() => navigation.goBack())}
      hitSlop={16}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <Text style={styles.text}>‹ {label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    fontFamily: systemFontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
