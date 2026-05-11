import React from 'react';
import { Pressable, StyleSheet, View, ActivityIndicator } from 'react-native';
import { colors, radii, spacing, typeScale } from '../theme/tokens';
import { Text } from 'react-native';

type Variant = 'primary' | 'ghost' | 'destructive';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  fullWidth = true,
  iconLeft,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'destructive' && styles.destructive,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={variant === 'primary' ? colors.ctaText : colors.textPrimary}
          />
        ) : (
          <>
            {iconLeft ? <View style={styles.iconLeft}>{iconLeft}</View> : null}
            <Text
              style={[
                styles.label,
                variant === 'primary' && styles.labelPrimary,
                variant === 'ghost' && styles.labelGhost,
                variant === 'destructive' && styles.labelDestructive,
              ]}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  primary: {
    backgroundColor: colors.ctaBg,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  destructive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLeft: {
    marginRight: spacing.sm,
  },
  label: {
    ...typeScale.sansButton,
  },
  labelPrimary: {
    color: colors.ctaText,
  },
  labelGhost: {
    color: colors.textPrimary,
  },
  labelDestructive: {
    color: colors.textPrimary,
  },
});
