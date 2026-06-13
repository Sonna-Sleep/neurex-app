import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { SerifDisplay, SerifHeadline, Body } from '../../theme/typography';
import { colors, layout, radii, spacing } from '../../theme/tokens';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'HowItWorks'>;

type Step = {
  label: string;
  headline: string;
  body: string;
};

const STEPS: Step[] = [
  {
    label: '1',
    headline: 'Start a session',
    body: 'Put on the device, tap start, and keep your phone nearby.',
  },
  {
    label: '2',
    headline: 'Sleep normally',
    body: 'Neurex records quietly through the night.',
  },
  {
    label: '3',
    headline: 'Review your report',
    body: 'Stop the session and your sleep report appears in Journal.',
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
            <View key={step.label}>
              <View style={styles.stepRow}>
                <View style={styles.pillColumn}>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{step.label}</Text>
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
          label="Got it"
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
    width: 44,
  },
  connectorRow: {
    width: 44,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  pill: {
    width: 36,
    height: 36,
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
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
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
