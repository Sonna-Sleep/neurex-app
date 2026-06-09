import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { SerifDisplay, SerifHeadline, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, radii, spacing } from '../../theme/tokens';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'HowItWorks'>;

type Step = {
  eyebrow: string;
  headline: string;
  body: string;
};

const STEPS: Step[] = [
  {
    eyebrow: 'NIGHT',
    headline: 'Slip it on.',
    body: 'Open Neurex, tap Start session, then keep your phone nearby through the night.',
  },
  {
    eyebrow: 'ALL NIGHT',
    headline: 'Sleep.',
    body: 'The sleep mask records your sleep signal while you rest.',
  },
  {
    eyebrow: 'MORNING',
    headline: 'Stop and sync.',
    body: 'Tap Stop session, then sync to the cloud so your sleep graph can appear.',
  },
];

export function HowItWorks({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <SerifDisplay style={styles.headline}>Here's how it works.</SerifDisplay>

        <View style={styles.timeline}>
          {STEPS.map((step, index) => (
            <View key={step.eyebrow}>
              <View style={styles.stepRow}>
                <View style={styles.pillColumn}>
                  <View style={styles.pill}>
                    <Eyebrow style={styles.pillText} numberOfLines={1}>
                      {step.eyebrow}
                    </Eyebrow>
                  </View>
                </View>

                <View style={styles.stepContent}>
                  <SerifHeadline style={styles.stepHeadline}>
                    {step.headline}
                  </SerifHeadline>
                  <Body style={styles.stepBody}>{step.body}</Body>
                </View>
              </View>
              {index < STEPS.length - 1 ? (
                <View style={styles.connectorRow}>
                  <View style={styles.connector} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label="got it"
          onPress={() => navigation.navigate('NotificationsPermission')}
        />
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
  scroll: {
    flexGrow: 1,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  headline: {
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  timeline: {},
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  pillColumn: {
    alignItems: 'center',
    width: 116,
  },
  connectorRow: {
    width: 116,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  pill: {
    width: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  connector: {
    width: 1,
    height: 32,
    backgroundColor: colors.borderSubtle,
  },
  stepContent: {
    flex: 1,
    gap: spacing.sm,
  },
  stepHeadline: {
    color: colors.textPrimary,
  },
  stepBody: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  actions: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
});
