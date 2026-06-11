import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

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
    avgScore: `${Math.round(avgScore)}`,
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
  const headline = firstName ? `${greeting(new Date().getHours())}, ${firstName}` : 'Your profile';
  const age = ageFromDob(user?.dob);
  const sub = [age ? `${age}` : null, user?.sex && user.sex !== 'unspecified' ? user.sex : null]
    .filter(Boolean)
    .join(' · ');
  const memberSince = memberSinceLabel(user?.memberSinceMs);
  const stats = useMemo(() => profileStats(sessions), [sessions]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.identityRow}>
            <Avatar uri={avatarUri} name={name} size={72} />
            <View style={styles.identityText}>
              <Text style={styles.name}>{headline}</Text>
              {user?.email ? <Text style={styles.sub}>{user.email}</Text> : null}
            </View>
          </View>
          <View style={styles.metaRow}>
            {sub ? <Text style={styles.meta}>{sub}</Text> : null}
            {memberSince ? <Text style={styles.meta}>{memberSince}</Text> : null}
          </View>
          <Pressable onPress={() => setEditing(true)} hitSlop={8} style={styles.editBtn}>
            <Text style={styles.editText}>Edit profile</Text>
          </Pressable>
        </View>

        <View style={styles.statsPanel}>
          <ProfileStat icon="moon" value={stats.nights} label="Nights" />
          <ProfileStat icon="clock" value={stats.avgAsleep} label="Avg. asleep" />
          <ProfileStat icon="score" value={stats.avgScore} label="Avg. score" />
        </View>

        <View style={styles.card}>
          <Row label="Contact support" onPress={() => setSupport(true)} first />
          <Row label="Privacy policy" onPress={() => setLegalDoc('privacy')} />
          <Row label="About" onPress={() => setLegalDoc('about')} />
        </View>

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
      <SupportSheet visible={support} onClose={() => setSupport(false)} />
    </SafeAreaView>
  );
}

type ProfileStatIconName = 'moon' | 'clock' | 'score';

function ProfileStat({ icon, value, label }: { icon: ProfileStatIconName; value: string; label: string }) {
  return (
    <View style={styles.statItem}>
      <ProfileStatIcon name={icon} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileStatIcon({ name }: { name: ProfileStatIconName }) {
  const c = colors.accent;
  switch (name) {
    case 'moon':
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Path d="M20 16.4A8.5 8.5 0 1 1 9.6 4 6.7 6.7 0 0 0 20 16.4Z" fill={c} />
        </Svg>
      );
    case 'clock':
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} fill={c} />
          <Path d="M12 7V12L15.5 15" stroke={colors.bgPrimary} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'score':
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} stroke={c} strokeWidth={4} opacity={0.32} />
          <Path d="M12 3A9 9 0 0 1 21 12" stroke={c} strokeWidth={4} strokeLinecap="round" />
          <Rect x={10.2} y={10.2} width={3.6} height={3.6} rx={1.8} fill={c} />
        </Svg>
      );
  }
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
    paddingBottom: TAB_BAR_SPACE,
    gap: spacing.xl,
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
  metaRow: {
    gap: spacing.xs,
  },
  meta: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    color: colors.textTertiary,
  },
  editBtn: {
    alignSelf: 'flex-start',
  },
  editText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
  statsPanel: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  statItem: {
    flex: 1,
    minHeight: 116,
    justifyContent: 'center',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  statValue: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: systemFontFamily,
    fontSize: 13,
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
