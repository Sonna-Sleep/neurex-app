// Journal tab — a sleep calendar. A week strip of day-circles up top; tapping a
// day shows that night's report (score ring + in-bed/asleep + hypnogram +
// stage breakdown). Pages back/forward by week.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { SerifDisplay, Secondary } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { WeekStrip, dateKey, weekStartOf } from '../../components/WeekStrip';
import { NightReport } from './NightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayKey(): string {
  return dateKey(new Date());
}

export function JournalScreen() {
  const authReady = useSession((s) => s.authReady);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey());
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    try {
      const list = await sessionRepo.list();
      setSessions(list);
      setLoadError(false);
      setLoaded(true);
      // Select the most recent night ONCE — a later refetch must not yank the
      // user off the day/week they're viewing.
      if (!initialized.current && list.length > 0) {
        initialized.current = true;
        const latest = list.reduce((a, b) => (a.endMs > b.endMs ? a : b));
        const k = dateKey(new Date(latest.endMs));
        setSelectedKey(k);
        setWeekStart(weekStartOf(keyToDate(k)));
      }
    } catch {
      // Fetch failed (network/db) — keep any sessions we already have and flag
      // the error so the empty state offers a retry instead of a misleading
      // "no sleep recorded".
      setLoadError(true);
      setLoaded(true);
    }
  }, []);

  // Refetch when auth settles (cold start) and whenever the tab regains focus —
  // so a night recorded on the Sleep tab appears here without an app restart.
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

  // Index sessions by their wake day (local date of endMs).
  const byDate = useMemo(() => {
    const map: Record<string, Session> = {};
    for (const s of sessions) {
      const k = dateKey(new Date(s.endMs));
      if (!map[k] || s.endMs > map[k].endMs) map[k] = s;
    }
    return map;
  }, [sessions]);

  const scoresByDate = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const k of Object.keys(byDate)) m[k] = byDate[k].score;
    return m;
  }, [byDate]);
  const hasByDate = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const k of Object.keys(byDate)) m[k] = true;
    return m;
  }, [byDate]);

  const selected = byDate[selectedKey] ?? null;

  // Seeing a night's report — inline here or on SessionDetail — clears its
  // "new" dot on the Journal tab.
  const markNightViewed = useSession((s) => s.markNightViewed);
  useEffect(() => {
    if (selected) markNightViewed(selected.id);
  }, [selected, markNightViewed]);

  const selectedDate = keyToDate(selectedKey);
  const headerLabel = `${selectedDate.toLocaleDateString(undefined, { weekday: 'long' })} ${selectedDate.getDate()} ${selectedDate.toLocaleDateString(undefined, { month: 'short' })}`;

  const shiftWeek = (deltaDays: number) =>
    setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + deltaDays));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {/* Header: date + week paging */}
        <View style={styles.header}>
          <SerifDisplay>{headerLabel}</SerifDisplay>
          <View style={styles.weekNav}>
            <Pressable onPress={() => shiftWeek(-7)} hitSlop={10}>
              <Text style={styles.chevron}>‹</Text>
            </Pressable>
            <Pressable onPress={() => shiftWeek(7)} hitSlop={10}>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
        </View>

        <WeekStrip
          weekStart={weekStart}
          scoresByDate={scoresByDate}
          hasByDate={hasByDate}
          selectedKey={selectedKey}
          onSelect={(d) => setSelectedKey(dateKey(d))}
        />

        {selected ? (
          <NightReport session={selected} />
        ) : loadError && sessions.length === 0 ? (
          <View style={styles.empty}>
            <Secondary style={styles.emptyText}>Couldn’t load your sleep history.</Secondary>
            <Pressable onPress={onRefresh} hitSlop={8}>
              <Secondary style={styles.retryText}>Tap to retry</Secondary>
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Secondary style={styles.emptyText}>
              {loaded ? 'No sleep recorded this night.' : ''}
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
    gap: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekNav: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  chevron: {
    fontFamily: systemFontFamily,
    fontSize: 26,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  empty: {
    paddingTop: spacing.xxl,
  },
  emptyText: {
    color: colors.textSecondary,
  },
  retryText: {
    color: colors.textPrimary,
    paddingTop: spacing.sm,
    textDecorationLine: 'underline',
  },
});
