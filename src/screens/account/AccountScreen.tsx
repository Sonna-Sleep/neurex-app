import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { Avatar } from '../../components/Avatar';
import { useSession } from '../../state/session';
import { ageFromDob } from '../../lib/profile';
import { sessionRepo, type Session } from '../../lib/repos';
import type { LegalDocKey } from '../../lib/legalContent';
import appConfig from '../../../app.json';
import { DeleteAccountSection } from './DeleteAccountSection';
import { EditProfileSheet } from './EditProfileSheet';
import { LegalSheet } from './LegalSheet';
import { SupportSheet } from './SupportSheet';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

function memberSinceLabel(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return `Member since ${new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })}`;
}

function fmtDur(min: number | null): string {
  if (min == null) return '—';
  const rounded = Math.round(min);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function profileStats(sessions: Session[]) {
  const completed = sessions.filter((s) => s.score != null && s.tst != null);
  if (completed.length === 0) {
    return { nights: '—', avgAsleep: '—', avgScore: '—' };
  }
  const avgTst = completed.reduce((sum, s) => sum + (s.tst ?? 0), 0) / completed.length;
  const avgScore = completed.reduce((sum, s) => sum + (s.score ?? 0), 0) / completed.length;
  return {
    nights: `${completed.length}`,
    avgAsleep: fmtDur(avgTst),
    avgScore: `${Math.round(avgScore)}%`,
  };
}

export function AccountScreen() {
  const user = useSession((s) => s.user);
  const avatarUri = useSession((s) => s.avatarUri);
  const signOut = useSession((s) => s.signOut);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [editing, setEditing] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);
  const [support, setSupport] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setSessions(await sessionRepo.list());
    } catch {
      setSessions([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadStats();
    }, [loadStats]),
  );

  const firstName = user?.firstName?.trim();
  const name = firstName || 'You';
  const age = ageFromDob(user?.dob);
  const sub = [age ? `${age}` : null, user?.sex && user.sex !== 'unspecified' ? user.sex : null]
    .filter(Boolean)
    .join(' · ');
  const memberSince = memberSinceLabel(user?.memberSinceMs);
  const profileMeta = [sub || null, memberSince].filter(Boolean).join(' · ');
  const stats = useMemo(() => profileStats(sessions), [sessions]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.identityRow}>
            <Avatar uri={avatarUri} name={name} size={64} />
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {user?.email ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => setEditing(true)} hitSlop={8} style={styles.editBtn}>
              <Text style={styles.editText}>Edit profile</Text>
            </Pressable>
          </View>
          {profileMeta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {profileMeta}
            </Text>
          ) : null}
        </View>

        <View style={styles.statsPanel}>
          <ProfileStat value={stats.nights} label="Nights" first />
          <ProfileStat value={stats.avgAsleep} label="Avg. asleep" />
          <ProfileStat value={stats.avgScore} label="Avg. score" />
        </View>

        <View style={styles.card}>
          <Row label="Contact support" onPress={() => setSupport(true)} first />
          <Row label="Privacy policy" onPress={() => setLegalDoc('privacy')} />
          <Row label="About" onPress={() => setLegalDoc('about')} />
        </View>

        <View style={styles.accountCard}>
          <Pressable onPress={signOut} hitSlop={8} style={styles.accountRow}>
            <Text style={styles.logout}>Log out</Text>
          </Pressable>
          <View style={[styles.accountRow, styles.accountDivider]}>
            <DeleteAccountSection />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.version}>version {appConfig.expo.version}</Text>
        </View>
      </ScrollView>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />
      <SupportSheet visible={support} onClose={() => setSupport(false)} />
    </SafeAreaView>
  );
}

function ProfileStat({ value, label, first }: { value: string; label: string; first?: boolean }) {
  return (
    <View style={[styles.statItem, !first && styles.statDivider]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {value}
      </Text>
    </View>
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
    paddingTop: spacing.xl,
    paddingBottom: TAB_BAR_SPACE + spacing.xxl,
    gap: spacing.lg,
  },
  profileHeader: {
    gap: spacing.md,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  name: {
    fontFamily: systemFontFamily,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  meta: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  editBtn: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  editText: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statsPanel: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  statItem: {
    flex: 1,
    minHeight: 82,
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  statDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderSubtle,
  },
  statValue: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingVertical: 14,
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
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  chevron: {
    fontFamily: systemFontFamily,
    fontSize: 20,
    color: colors.textTertiary,
  },
  accountCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  accountRow: {
    minHeight: 54,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  accountDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  logout: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  footer: {
    alignItems: 'flex-start',
    paddingTop: spacing.xs,
  },
  version: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
