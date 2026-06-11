// Journal tab — a month calendar for recorded nights. Tapping a day shows that
// night's report without changing the underlying session fetch/pipeline.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Eyebrow, Secondary, SerifDisplay } from '../../theme/typography';
import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { dateKey } from '../../components/WeekStrip';
import { scoreBand } from '../../components/ScoreRing';
import { NightReport } from './NightReport';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayKey(): string {
  return dateKey(new Date());
}

function monthStartOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function buildCalendarDays(monthStart: Date): Date[] {
  const first = monthStartOf(monthStart);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    return new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
  });
}

export function JournalScreen() {
  const authReady = useSession((s) => s.authReady);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey());
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => monthStartOf(new Date()));
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
        setVisibleMonth(monthStartOf(keyToDate(k)));
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
    // Intentional data fetch on auth readiness; load() owns the state transition.
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
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const recordedInMonth = useMemo(() => {
    return sessions.filter((s) => {
      const d = new Date(s.endMs);
      return d.getFullYear() === visibleMonth.getFullYear() && d.getMonth() === visibleMonth.getMonth();
    }).length;
  }, [sessions, visibleMonth]);

  // Seeing a night's report — inline here or on SessionDetail — clears its
  // "new" dot on the Journal tab.
  const markNightViewed = useSession((s) => s.markNightViewed);
  useEffect(() => {
    if (selected) markNightViewed(selected.id);
  }, [selected, markNightViewed]);

  const selectedDate = keyToDate(selectedKey);
  const selectedLabel = `${selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}, ${selectedDate.toLocaleDateString(undefined, { month: 'short' })} ${selectedDate.getDate()}`;

  const shiftMonth = (deltaMonths: number) =>
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + deltaMonths, 1));

  const selectDate = (date: Date) => {
    setSelectedKey(dateKey(date));
    setVisibleMonth(monthStartOf(date));
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
        <View style={styles.header}>
          <View>
            <Eyebrow>journal</Eyebrow>
            <SerifDisplay>Sleep calendar</SerifDisplay>
          </View>
          <View style={styles.monthNav}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.chevron}>‹</Text>
            </Pressable>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.calendarPanel}>
          <View style={styles.calendarHeader}>
            <Text style={styles.monthLabel}>{monthLabel(visibleMonth)}</Text>
            <Secondary style={styles.monthMeta}>
              {recordedInMonth === 1 ? '1 recorded night' : `${recordedInMonth} recorded nights`}
            </Secondary>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekday}>
                {day}
              </Text>
            ))}
          </View>

          <View style={styles.monthGrid}>
            {calendarDays.map((d) => {
              const key = dateKey(d);
              const has = hasByDate[key];
              const selectedDay = key === selectedKey;
              const inMonth = d.getMonth() === visibleMonth.getMonth();
              const band = has ? scoreBand(scoresByDate[key] ?? null) : null;
              return (
                <Pressable
                  key={key}
                  style={[
                    styles.dayCell,
                    !inMonth && styles.dayCellMuted,
                    selectedDay && styles.dayCellSelected,
                  ]}
                  onPress={() => selectDate(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}${has ? ', sleep recorded' : ', no recording'}`}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      !inMonth && styles.dayNumberMuted,
                      selectedDay && styles.dayNumberSelected,
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                  {has ? <View style={[styles.recordingDot, band ? { backgroundColor: band.color } : null]} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {selected ? (
          <View style={styles.reportSection}>
            <View style={styles.reportHeader}>
              <Eyebrow>selected night</Eyebrow>
              <Text style={styles.selectedLabel}>{selectedLabel}</Text>
            </View>
            <NightReport session={selected} />
          </View>
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
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  monthNav: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  chevron: {
    fontFamily: systemFontFamily,
    fontSize: 26,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  calendarPanel: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    padding: spacing.md,
    gap: spacing.md,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  monthLabel: {
    fontFamily: systemFontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  monthMeta: {
    color: colors.textTertiary,
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontFamily: systemFontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.small,
    gap: 4,
  },
  dayCellMuted: {
    opacity: 0.42,
  },
  dayCellSelected: {
    backgroundColor: colors.bgElevated,
  },
  dayNumber: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayNumberMuted: {
    color: colors.textTertiary,
  },
  dayNumberSelected: {
    color: colors.textPrimary,
  },
  recordingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
  },
  reportSection: {
    gap: spacing.lg,
  },
  reportHeader: {
    gap: spacing.xs,
  },
  selectedLabel: {
    fontFamily: systemFontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
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
