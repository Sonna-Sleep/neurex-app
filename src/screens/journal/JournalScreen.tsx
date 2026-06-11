// Journal home — weekly picker on top, selected-night report below. The
// calendar is the final control in the weekly row.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Secondary, SerifDisplay } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { dateKey, weekStartOf } from '../../components/WeekStrip';
import { scoreBand } from '../../components/ScoreRing';
import { TabIcon } from '../../components/TabIcon';
import { NightReport } from './NightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import type { JournalStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<JournalStackParamList, 'JournalHome'>;

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayKey(): string {
  return dateKey(new Date());
}

function selectedDateLabel(key: string): string {
  const d = keyToDate(key);
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.toLocaleDateString(undefined, {
    month: 'short',
  })} ${d.getDate()}`;
}

export function JournalScreen({ navigation }: Props) {
  const authReady = useSession((s) => s.authReady);
  const markNightViewed = useSession((s) => s.markNightViewed);
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
      if (!initialized.current && list.length > 0) {
        initialized.current = true;
        const latest = list.reduce((a, b) => (a.endMs > b.endMs ? a : b));
        const k = dateKey(new Date(latest.endMs));
        setSelectedKey(k);
        setWeekStart(weekStartOf(keyToDate(k)));
      }
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

  const byDate = useMemo(() => {
    const map: Record<string, Session> = {};
    for (const s of sessions) {
      const k = dateKey(new Date(s.endMs));
      if (!map[k] || s.endMs > map[k].endMs) map[k] = s;
    }
    return map;
  }, [sessions]);

  const selected = byDate[selectedKey] ?? null;

  useEffect(() => {
    if (selected) markNightViewed(selected.id);
  }, [selected, markNightViewed]);

  const selectedLabel = selectedDateLabel(selectedKey);
  const shiftWeek = (deltaDays: number) =>
    setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + deltaDays));

  const selectDate = (date: Date) => {
    setSelectedKey(dateKey(date));
    setWeekStart(weekStartOf(date));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        <View style={styles.top}>
          <View style={styles.titleBlock}>
            <SerifDisplay>{selectedLabel}</SerifDisplay>
          </View>
          <View style={styles.weekNav}>
            <Pressable onPress={() => shiftWeek(-7)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.chevron}>‹</Text>
            </Pressable>
            <Pressable onPress={() => shiftWeek(7)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.weekRail}>
          {Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
            const key = dateKey(d);
            const session = byDate[key] ?? null;
            const selectedDay = key === selectedKey;
            const band = session ? scoreBand(session.score) : null;
            return (
              <Pressable
                key={key}
                style={styles.day}
                onPress={() => selectDate(d)}
                hitSlop={4}
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.dayCircle,
                    session && band ? { borderColor: band.color, borderWidth: 2 } : null,
                    selectedDay && styles.dayCircleSelected,
                  ]}
                >
                  <Text style={[styles.dayLetter, (selectedDay || session) && styles.dayLetterActive]}>
                    {WEEKDAYS[i]}
                  </Text>
                </View>
                <Text style={[styles.dayNumber, selectedDay && styles.dayNumberActive]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
          <Pressable
            style={styles.day}
            onPress={() => navigation.navigate('JournalCalendar')}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Open calendar"
          >
            <View style={[styles.dayCircle, styles.calendarCircle]}>
              <TabIcon name="journal" color={colors.textPrimary} size={18} />
            </View>
            <Text style={styles.dayNumber}>All</Text>
          </Pressable>
        </View>

        {selected ? (
          <NightReport session={selected} />
        ) : loadError && sessions.length === 0 ? (
          <View style={styles.empty}>
            <Secondary style={styles.emptyText}>Couldn’t load your sleep history.</Secondary>
            <Pressable onPress={onRefresh} hitSlop={8}>
              <Secondary style={styles.retryText}>Retry</Secondary>
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Secondary style={styles.emptyText}>
              {loaded ? `No recording for ${selectedLabel}.` : ''}
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
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
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
  weekRail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 5,
  },
  day: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: colors.bgElevated,
  },
  calendarCircle: {
    borderColor: colors.borderDivider,
    backgroundColor: colors.bgElevated,
  },
  dayLetter: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  dayLetterActive: {
    color: colors.textPrimary,
  },
  dayNumber: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    color: colors.textTertiary,
  },
  dayNumberActive: {
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
  },
});
