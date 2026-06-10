import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing, typeScale } from '../theme/tokens';

type Variant = 'primary' | 'ghost' | 'tonal';

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

  // Haptic FIRES BEFORE onPress runs so the tactile cue lands at the same
  // moment as the visual press feedback — feels snappier than triggering
  // haptic in onPress where any async work in the handler delays it.
  // Haptics.impactAsync is a no-op on platforms that lack haptic hardware
  // (Android without vibrator, web), so no platform guard needed.
  const handlePress = () => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'tonal' && styles.tonal,
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
                variant === 'tonal' && styles.labelGhost,
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
    borderRadius: radii.button,
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
  // Secondary button: a clearly visible filled surface + border so it reads as
  // tappable (a transparent + faint-border ghost was too dark to notice).
  ghost: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderDivider,
  },
  tonal: {
    backgroundColor: colors.bgElevated,
  },
  pressed: {
    // 0.85 reads as a refined dim; 0.7 looked like a glitch.
    opacity: 0.85,
    // Subtle scale-down on press gives the button a "physical" press feel
    // that pure-opacity changes lack. 0.98 is the Oura/Whoop sweet spot —
    // perceptible but not janky.
    transform: [{ scale: 0.98 }],
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
});
