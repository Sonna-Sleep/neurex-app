import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { SerifDisplay, Body } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Welcome'>;

export function Welcome({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.logoArea}>
        <Logo height={28} />
      </View>

      <View style={styles.center}>
        <SerifDisplay style={styles.headline}>
          Sleep deeper.{'\n'}Wake up actually rested.
        </SerifDisplay>
        <Body style={styles.subtext}>Let's get your sleep mask set up.</Body>
      </View>

      <View style={styles.actions}>
        <Button label="Continue" onPress={() => navigation.navigate('Auth')} />
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
  logoArea: {
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headline: {
    marginBottom: spacing.md,
    textAlign: 'left',
  },
  subtext: {
    color: colors.textSecondary,
    textAlign: 'left',
  },
  actions: {
    paddingBottom: spacing.lg,
  },
});
