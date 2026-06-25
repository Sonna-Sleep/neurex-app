// Journal home — weekly picker on top, selected-night report below. The
// calendar is the final control in the weekly row.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Secondary, SerifDisplay } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import {
  betterJournalSession,
  isCompletedSession,
  isJournalVisibleSession,
} from '../../lib/repos/sessionStatus';
import { useSession } from '../../state/session';
import { dateKey, weekStartOf } from '../../components/WeekStrip';
import { scoreBand } from '../../components/ScoreRing';
import { TabIcon } from '../../components/TabIcon';
import { NightReport } from './NightReport';
import { EmptyNightReport } from './EmptyNightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import { dateRailGestureRef } from '../../navigation/gestureRefs';
import type { JournalStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<JournalStackParamList, 'JournalHome'>;

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DATE_RAIL_DAYS = 21;
const DATE_RAIL_START_OFFSET = -7;
const DATE_RAIL_ITEM_W = 46;
const DATE_RAIL_GAP = 12;
const DATE_RAIL_CENTER_X = (DATE_RAIL_ITEM_W + DATE_RAIL_GAP) * 7;

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
  // True once the user has tapped a day. Before that we auto-show the latest
  // night; after, we respect their choice — including empty days (no recording),
  // which must NOT bounce back to the last recording.
  const userPicked = useRef(false);
  const dateRailRef = useRef<ScrollView>(null);
  // Native gesture on the horizontal date-rail. The tab-swipe Pan
  // requireExternalGestureToFail's against this ref, so a horizontal drag that
  // starts on the rail scrolls the rail instead of switching tabs.
  const railGesture = useMemo(() => Gesture.Native().withRef(dateRailGestureRef), []);

  const load = useCallback(async () => {
    if (!authReady) return;
    try {
      const list = await sessionRepo.list();
      setSessions(list);
      setLoadError(false);
      setLoaded(true);
      const visible = list.filter(isJournalVisibleSession);
      if (!initialized.current && visible.length > 0) {
        initialized.current = true;
        const latest = visible.reduce((a, b) => betterJournalSession(a, b));
        const k = dateKey(new Date(latest.endMs));
        setSelectedKey(k);
        setWeekStart(weekStartOf(keyToDate(k)));
      }
    } catch {
      setLoadError(true);
      setLoaded(true);
    }
  }, [authReady]);

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

  const journalSessions = useMemo(() => sessions.filter(isJournalVisibleSession), [sessions]);

  const byDate = useMemo(() => {
    const map: Record<string, Session> = {};
    for (const s of journalSessions) {
      const k = dateKey(new Date(s.endMs));
      map[k] = map[k] ? betterJournalSession(s, map[k]) : s;
    }
    return map;
  }, [journalSessions]);

  const selected = byDate[selectedKey] ?? null;

  const showLatestNight = useCallback(() => {
    if (journalSessions.length === 0) return;
    const latest = journalSessions.reduce((a, b) => betterJournalSession(a, b));
    const k = dateKey(new Date(latest.endMs));
    setSelectedKey(k);
    setWeekStart(weekStartOf(keyToDate(k)));
  }, [journalSessions]);

  useEffect(() => {
    if (!loaded || selected || journalSessions.length === 0 || userPicked.current) return;
    showLatestNight();
  }, [journalSessions.length, loaded, selected, showLatestNight]);

  useEffect(() => {
    if (selected) markNightViewed(selected.id);
  }, [selected, markNightViewed]);

  const selectedLabel = selectedDateLabel(selectedKey);
  const today = todayKey();
  const railDays = useMemo(
    () =>
      Array.from({ length: DATE_RAIL_DAYS }, (_, i) => {
        const offset = DATE_RAIL_START_OFFSET + i;
        return new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate() + offset,
        );
      }),
    [weekStart],
  );
  const shiftWeek = (deltaDays: number) =>
    setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + deltaDays));

  const selectDate = (date: Date) => {
    userPicked.current = true;
    setSelectedKey(dateKey(date));
    setWeekStart(weekStartOf(date));
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      dateRailRef.current?.scrollTo({ x: DATE_RAIL_CENTER_X, animated: false });
    });
  }, [weekStart]);

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

        <GestureDetector gesture={railGesture}>
        <ScrollView
          ref={dateRailRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.weekRail}
          decelerationRate="fast"
        >
          {railDays.map((d) => {
            const key = dateKey(d);
            const session = byDate[key] ?? null;
            const selectedDay = key === selectedKey;
            const isToday = key === today;
            const band = session && isCompletedSession(session) ? scoreBand(session.score) : null;
            const weekdayIndex = (d.getDay() + 6) % 7;
            return (
              <Pressable
                key={key}
                style={styles.day}
                onPress={() => selectDate(d)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`${d.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}${isToday ? ', today' : ''}${session ? ', sleep recorded' : ', no recording'}`}
              >
                <View
                  style={[
                    styles.dayCircle,
                    session
                      ? { borderColor: band?.color ?? colors.textTertiary, borderWidth: 2 }
                      : null,
                    selectedDay && styles.dayCircleSelected,
                  ]}
                >
                  {isToday ? <View pointerEvents="none" style={styles.todayHalo} /> : null}
                  <Text style={[styles.dayLetter, (selectedDay || session) && styles.dayLetterActive]}>
                    {WEEKDAYS[weekdayIndex]}
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
        </ScrollView>
        </GestureDetector>

        {selected ? (
          <NightReport session={selected} />
        ) : loadError && sessions.length === 0 ? (
          <View style={styles.empty}>
            <Secondary style={styles.emptyText}>Couldn’t load your sleep history.</Secondary>
            <Pressable onPress={onRefresh} hitSlop={8}>
              <Secondary style={styles.retryText}>Retry</Secondary>
            </Pressable>
          </View>
        ) : loaded ? (
          <>
            <EmptyNightReport />
            {journalSessions.length > 0 ? (
              <Pressable onPress={showLatestNight} hitSlop={8}>
                <Secondary style={styles.retryText}>Show latest night</Secondary>
              </Pressable>
            ) : null}
          </>
        ) : null}
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
    alignItems: 'flex-start',
    gap: DATE_RAIL_GAP,
    paddingRight: layout.screenPadding,
    paddingVertical: spacing.xs, // breathing room so the today halo isn't clipped
  },
  day: {
    width: DATE_RAIL_ITEM_W,
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
  // Concentric outer ring marking today — sits outside the 36px circle so it
  // never collides with the score-band ring or the selected-day fill.
  todayHalo: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: colors.todayRing,
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
