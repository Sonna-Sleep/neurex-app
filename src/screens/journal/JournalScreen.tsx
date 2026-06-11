// Journal home — latest-night report first, with Calendar as a secondary browse
// action. Recording/storage/staging behavior stays outside this UI layer.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Eyebrow, Secondary, SerifDisplay } from '../../theme/typography';
import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { scoreBand } from '../../components/ScoreRing';
import { TabIcon } from '../../components/TabIcon';
import { NightReport } from './NightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import type { JournalStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<JournalStackParamList, 'JournalHome'>;

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.toLocaleDateString(undefined, {
    month: 'short',
  })} ${d.getDate()}`;
}

function latestSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return sessions.reduce((a, b) => (a.endMs > b.endMs ? a : b));
}

function statusFor(session: Session): { label: string; color: string; value: string } {
  if (session.score != null) {
    const band = scoreBand(session.score);
    return { label: band.label, color: band.color, value: `${session.score}` };
  }
  if (session.status === 'failed') {
    return { label: 'Needs review', color: colors.warning, value: '—' };
  }
  return { label: 'Analyzing', color: colors.textTertiary, value: '—' };
}

export function JournalScreen({ navigation }: Props) {
  const authReady = useSession((s) => s.authReady);
  const markNightViewed = useSession((s) => s.markNightViewed);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await sessionRepo.list();
      setSessions(list);
      setLoadError(false);
      setLoaded(true);
    } catch {
      setLoadError(true);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [authReady, load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const latest = useMemo(() => latestSession(sessions), [sessions]);

  useEffect(() => {
    if (latest) markNightViewed(latest.id);
  }, [latest, markNightViewed]);

  const latestStatus = latest ? statusFor(latest) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Eyebrow>journal</Eyebrow>
            <SerifDisplay>Latest night</SerifDisplay>
          </View>
          <Pressable
            onPress={() => navigation.navigate('JournalCalendar')}
            style={({ pressed }) => [styles.calendarButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open calendar"
          >
            <TabIcon name="journal" color={colors.textPrimary} size={18} />
            <Text style={styles.calendarButtonText}>Calendar</Text>
          </Pressable>
        </View>

        {latest && latestStatus ? (
          <>
            <View style={styles.latestIntro}>
              <View style={styles.latestText}>
                <Text style={styles.latestDate}>{dateLabel(latest.endMs)}</Text>
                <Secondary style={styles.latestMeta}>
                  {latest.score != null ? 'Sleep score' : 'Recording received'}
                </Secondary>
              </View>
              <View style={[styles.statusBadge, { borderColor: latestStatus.color }]}>
                <Text style={[styles.statusValue, { color: latestStatus.color }]}>{latestStatus.value}</Text>
                <Text style={[styles.statusLabel, { color: latestStatus.color }]}>{latestStatus.label}</Text>
              </View>
            </View>
            <NightReport session={latest} />
          </>
        ) : loadError && sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Couldn’t load your sleep history.</Text>
            <Secondary style={styles.emptyText}>Check your connection, then try again.</Secondary>
            <Pressable onPress={onRefresh} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{loaded ? 'No recordings yet.' : ''}</Text>
            <Secondary style={styles.emptyText}>
              {loaded ? 'Start a recording from Sleep, then your night will appear here.' : ''}
            </Secondary>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: TAB_BAR_SPACE,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
  },
  calendarButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderDivider,
    backgroundColor: colors.bgElevated,
  },
  calendarButtonText: {
    fontFamily: systemFontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  latestIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  latestText: {
    flex: 1,
    gap: spacing.xs,
  },
  latestDate: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  latestMeta: {
    color: colors.textSecondary,
  },
  statusBadge: {
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    borderWidth: 1,
    backgroundColor: colors.bgSurface,
  },
  statusValue: {
    fontFamily: systemFontFamily,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
  },
  statusLabel: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  empty: {
    minHeight: 260,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyText: {
    color: colors.textSecondary,
  },
  retryText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingTop: spacing.sm,
  },
});
