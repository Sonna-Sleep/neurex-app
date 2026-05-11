import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { SerifDisplay, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'EmailSent'>;

export function EmailSent({ navigation, route }: Props) {
  const { email } = route.params;
  const authStatus = useSession((s) => s.authStatus);

  // When the user taps the magic link in their email, the deep-link handler
  // sets the session, which flips authStatus to 'signed-in'. Move them along.
  useEffect(() => {
    if (authStatus === 'signed-in') {
      navigation.navigate('Pair');
    }
  }, [authStatus, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Eyebrow>check your email</Eyebrow>
        <SerifDisplay style={styles.headline}>
          We sent you a link
        </SerifDisplay>
        <Body style={styles.body}>
          Tap the sign-in link we just emailed to{'\n'}
          <Body style={styles.email}>{email}</Body>
        </Body>
        <Body style={styles.muted}>
          The link expires in 1 hour. You can close this and come back later.
        </Body>

        <View style={styles.actions}>
          <Button
            label="use a different email"
            variant="ghost"
            onPress={() => navigation.goBack()}
          />
        </View>
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
    gap: spacing.md,
  },
  headline: {
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  email: {
    color: colors.textPrimary,
  },
  muted: {
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  actions: {
    width: '100%',
    marginTop: spacing.xl,
  },
});
