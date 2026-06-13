import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../../components/Button';
import { SerifDisplay, Body } from '../../../theme/typography';
import { colors, layout, spacing } from '../../../theme/tokens';

type Props = {
  title: string;
  subtitle?: string;
  canContinue: boolean;
  onContinue: () => void;
  onSkip?: () => void;
  isLast: boolean;
  children: React.ReactNode;
};

export function ProfileCard({
  title, subtitle, canContinue, onContinue, onSkip, isLast, children,
}: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* KeyboardAvoidingView lifts the actions above the keyboard; the
          number-pad used for the date-of-birth step has no dismiss key on iOS,
          so without this the Continue button is hidden behind it. Tapping the
          empty area dismisses the keyboard as the escape hatch. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.center} onPress={Keyboard.dismiss} accessible={false}>
          <SerifDisplay style={styles.title}>{title}</SerifDisplay>
          {subtitle ? <Body style={styles.subtitle}>{subtitle}</Body> : null}
          <View style={styles.input}>{children}</View>
        </Pressable>
        <View style={styles.actions}>
          <Button label={isLast ? 'Finish' : 'Continue'} onPress={onContinue} disabled={!canContinue} />
          {onSkip ? <Button label="Skip" variant="ghost" onPress={onSkip} /> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, paddingHorizontal: layout.screenPadding },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary },
  input: { marginTop: spacing.lg },
  actions: { paddingBottom: spacing.xl, gap: spacing.sm },
});
