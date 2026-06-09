import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../../components/Button';
import { SerifDisplay, Body, Eyebrow } from '../../../theme/typography';
import { colors, layout, spacing } from '../../../theme/tokens';

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  canContinue: boolean;
  onContinue: () => void;
  onSkip?: () => void;
  isLast: boolean;
  children: React.ReactNode;
};

export function ProfileCard({
  eyebrow, title, subtitle, canContinue, onContinue, onSkip, isLast, children,
}: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <SerifDisplay style={styles.title}>{title}</SerifDisplay>
        {subtitle ? <Body style={styles.subtitle}>{subtitle}</Body> : null}
        <View style={styles.input}>{children}</View>
      </View>
      <View style={styles.actions}>
        <Button label={isLast ? 'finish' : 'continue'} onPress={onContinue} disabled={!canContinue} />
        {onSkip ? <Button label="skip" variant="ghost" onPress={onSkip} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, paddingHorizontal: layout.screenPadding },
  center: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary },
  input: { marginTop: spacing.lg },
  actions: { paddingBottom: spacing.xl, gap: spacing.sm },
});
