import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { Avatar } from '../../components/Avatar';
import { useSession } from '../../state/session';
import { ageFromDob } from '../../lib/profile';
import type { LegalDocKey } from '../../lib/legalContent';
import appConfig from '../../../app.json';
import { DebugSection } from './DebugSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { EditProfileSheet } from './EditProfileSheet';
import { LegalSheet } from './LegalSheet';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

function greeting(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function memberSinceLabel(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return `Member since ${new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })}`;
}

export function AccountScreen() {
  const user = useSession((s) => s.user);
  const avatarUri = useSession((s) => s.avatarUri);
  const signOut = useSession((s) => s.signOut);
  const [editing, setEditing] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);

  const firstName = user?.firstName?.trim();
  const name = firstName || 'You';
  const headline = firstName ? `${greeting(new Date().getHours())}, ${firstName}` : 'Your profile';
  const age = ageFromDob(user?.dob);
  const sub = [age ? `${age}` : null, user?.sex && user.sex !== 'unspecified' ? user.sex : null]
    .filter(Boolean)
    .join(' · ');
  const memberSince = memberSinceLabel(user?.memberSinceMs);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile header */}
        <View style={styles.profile}>
          <Avatar uri={avatarUri} name={name} size={76} />
          <Text style={styles.name}>{headline}</Text>
          {user?.email ? <Text style={styles.sub}>{user.email}</Text> : null}
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          {memberSince ? <Text style={styles.memberSince}>{memberSince}</Text> : null}
          <Pressable onPress={() => setEditing(true)} hitSlop={8} style={styles.editBtn}>
            <Text style={styles.editText}>Edit profile</Text>
          </Pressable>
        </View>

        {/* Links — grouped card. Privacy + About render in-app (LegalSheet),
            not external Chrome links. */}
        <View style={styles.card}>
          <Row label="Contact support" onPress={() => Linking.openURL('mailto:contact@neurex.tech')} first />
          <Row label="Privacy policy" onPress={() => setLegalDoc('privacy')} />
          <Row label="About" onPress={() => setLegalDoc('about')} />
        </View>

        <DebugSection />

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable onPress={signOut} hitSlop={8}>
            <Text style={styles.logout}>Log out</Text>
          </Pressable>
          <View style={styles.dangerZone}>
            <DeleteAccountSection />
          </View>
          <Text style={styles.version}>version {appConfig.expo.version}</Text>
        </View>
      </ScrollView>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </SafeAreaView>
  );
}

function Row({ label, onPress, first }: { label: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.rowPressed]}
    >
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
    paddingBottom: TAB_BAR_SPACE,
  },
  profile: {
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingBottom: spacing.xl,
  },
  name: {
    fontFamily: systemFontFamily,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.3,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  sub: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    color: colors.textSecondary,
  },
  memberSince: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.xs,
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
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  rowDivider: {
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
    alignItems: 'flex-start',
  },
  logout: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // Delete sits well below Log out, fenced off by a hairline + generous space
  // so the destructive action can't be hit by muscle memory after Log out.
  dangerZone: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    paddingTop: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  version: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.xxl,
  },
});
