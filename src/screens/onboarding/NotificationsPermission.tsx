import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';

import { Button } from '../../components/Button';
import { SerifDisplay, Body } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<
  OnboardingStackParamList,
  'NotificationsPermission'
>;

export function NotificationsPermission({ navigation: _ }: Props) {
  const completeOnboarding = useSession((s) => s.completeOnboarding);
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    setBusy(true);
    try {
      await Notifications.requestPermissionsAsync();
    } finally {
      setBusy(false);
      completeOnboarding();
    }
  };

  const skip = () => completeOnboarding();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <SerifDisplay style={styles.headline}>Stay in the loop</SerifDisplay>
        <Body style={styles.subtext}>
          We'll let you know when your night is ready to view. Nothing else.
        </Body>
      </View>

      <View style={styles.actions}>
        <Button label="allow" onPress={allow} loading={busy} />
        <Button label="not now" variant="ghost" onPress={skip} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headline: {
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  subtext: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
});
