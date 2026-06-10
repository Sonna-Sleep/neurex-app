import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
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

  const name = user?.firstName?.trim() || 'You';
  const initial = name.charAt(0).toUpperCase();
  const age = ageFromDob(user?.dob);
  const sub = [age ? `${age}` : null, user?.sex && user.sex !== 'unspecified' ? user.sex : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile header */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{name}</Text>
          {user?.email ? <Text style={styles.sub}>{user.email}</Text> : null}
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          <Pressable onPress={() => setEditing(true)} hitSlop={8} style={styles.editBtn}>
            <Text style={styles.editText}>edit profile</Text>
          </Pressable>
        </View>

        {/* Links */}
        <View style={styles.rows}>
          <Row label="contact support" onPress={() => Linking.openURL('mailto:contact@neurex.tech')} />
          <Row label="privacy policy" onPress={() => Linking.openURL(LEGAL_URLS.privacyPolicy)} />
          <Row label="about" onPress={() => Linking.openURL(LEGAL_URLS.about)} />
        </View>

        <DebugSection />

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable onPress={signOut} hitSlop={8}>
            <Text style={styles.logout}>log out</Text>
          </Pressable>
          <DeleteAccountSection />
          <Text style={styles.version}>version {appConfig.expo.version}</Text>
        </View>
      </ScrollView>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
    </SafeAreaView>
  );
}

function Row({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  scroll: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  profile: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xl,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    fontFamily: systemFontFamily,
    fontSize: 30,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  name: {
    fontFamily: systemFontFamily,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    color: colors.textSecondary,
  },
  editBtn: {
    marginTop: spacing.md,
  },
  editText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
  rows: {
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  rowPressed: {
    opacity: 0.5,
  },
  rowLabel: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    color: colors.textPrimary,
  },
  chevron: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    color: colors.textTertiary,
  },
  footer: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  logout: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  version: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
