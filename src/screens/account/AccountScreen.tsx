import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { SerifHeadline, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { ageFromDob } from '../../lib/profile';
import { LEGAL_URLS } from '../../lib/legal';
import appConfig from '../../../app.json';
import { DebugSection } from './DebugSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { EditProfileSheet } from './EditProfileSheet';

export function AccountScreen() {
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const [editing, setEditing] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <SerifHeadline style={styles.headline}>Account</SerifHeadline>

        <Section eyebrow="account">
          <View style={styles.col}>
            <Body>{user?.firstName ?? 'add your name'}</Body>
            <Body style={styles.muted}>{user?.email ?? 'guest'}</Body>
            <Body style={styles.muted}>
              {ageFromDob(user?.dob) ? `${ageFromDob(user?.dob)} years` : 'add birth date'}
              {user?.sex && user.sex !== 'unspecified' ? ` · ${user.sex}` : ''}
            </Body>
            <Body style={styles.link} onPress={() => setEditing(true)}>edit</Body>
          </View>
        </Section>

        <Section eyebrow="about">
          <Body style={styles.muted}>
            Neurex tracks your sleep with a dry-electrode EEG headband and shows your stages and a nightly score.
          </Body>
        </Section>

        <Section eyebrow="support">
          <Body style={styles.link} onPress={() => Linking.openURL('mailto:contact@neurex.tech')}>contact@neurex.tech</Body>
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

        <DebugSection />

        <DeleteAccountSection />

        <View style={styles.actions}>
          <Button label="log out" variant="ghost" onPress={signOut} />
        </View>
      </ScrollView>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
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
