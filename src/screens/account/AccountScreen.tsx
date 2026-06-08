import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { SerifHeadline, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { deviceRepo, type Device } from '../../lib/repos';
import { LEGAL_URLS } from '../../lib/legal';
import appConfig from '../../../app.json';
import { DebugSection } from './DebugSection';
import { DeleteAccountSection } from './DeleteAccountSection';

export function AccountScreen() {
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const [device, setDevice] = useState<Device | null>(null);

  useEffect(() => {
    deviceRepo.current().then(setDevice);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <SerifHeadline style={styles.headline}>Account</SerifHeadline>

        <Section eyebrow="profile">
          <Body>{user?.email ?? 'guest'}</Body>
        </Section>

        <Section eyebrow="device">
          {device ? (
            <View style={styles.col}>
              <Body>{device.serial}</Body>
              <Body style={styles.muted}>battery {device.battery}%</Body>
              <Body style={styles.muted}>firmware {device.firmware}</Body>
            </View>
          ) : (
            <Body style={styles.muted}>no headband paired</Body>
          )}
        </Section>

        <Section eyebrow="legal">
          <View style={styles.col}>
            <Body style={styles.link} onPress={() => Linking.openURL(LEGAL_URLS.privacyPolicy)}>privacy policy</Body>
            <Body style={styles.link} onPress={() => Linking.openURL(LEGAL_URLS.about)}>about</Body>
          </View>
        </Section>

        <Section eyebrow="app">
          <Body style={styles.muted}>version {appConfig.expo.version}</Body>
        </Section>

        {/*
          DORMANT: dual-headband recording removed from the UI 2026-06-07 (single-device app).
          The component (./DualRecordSection.tsx) and engine (../../lib/ble/multiController.ts)
          are kept intact but unwired. To revive, re-add the import above and render
          <DualRecordSection /> here. See docs/DORMANT_FEATURES.md.
        */}

        <DebugSection />

        <DeleteAccountSection />

        <View style={styles.actions}>
          <Button label="log out" variant="ghost" onPress={signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  scroll: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  headline: {
    marginBottom: spacing.xl,
  },
  section: {
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  sectionBody: {
    paddingTop: spacing.sm,
  },
  col: {
    gap: spacing.xs,
  },
  muted: {
    color: colors.textSecondary,
  },
  link: { color: colors.textSecondary, textDecorationLine: 'underline' },
  actions: {
    paddingTop: spacing.xl,
  },
});
