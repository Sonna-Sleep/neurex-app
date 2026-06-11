// Full-screen calendar browse mode for Journal. Recorded days open the existing
// session detail report; empty days only select/highlight the date.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Eyebrow, Secondary, SerifDisplay } from '../../theme/typography';
import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { dateKey } from '../../components/WeekStrip';
import { scoreBand } from '../../components/ScoreRing';
import { sessionRepo, type Session } from '../../lib/repos';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import type { JournalStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<JournalStackParamList, 'JournalCalendar'>;

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

function selectedDateLabel(key: string): string {
  const d = keyToDate(key);
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.toLocaleDateString(undefined, {
    month: 'short',
  })} ${d.getDate()}`;
}

function buildCalendarDays(monthStart: Date): Date[] {
  const first = monthStartOf(monthStart);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    return new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
  });
}

function latestSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return sessions.reduce((a, b) => (a.endMs > b.endMs ? a : b));
}

export function JournalCalendarScreen({ navigation }: Props) {
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
      const latest = latestSession(list);
      if (!initialized.current && latest) {
        initialized.current = true;
        const k = dateKey(new Date(latest.endMs));
        setSelectedKey(k);
        setVisibleMonth(monthStartOf(keyToDate(k)));
      }
    } catch {
      setLoadError(true);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const selectedSession = byDate[selectedKey] ?? null;
  const recordedInMonth = useMemo(() => {
    return sessions.filter((s) => {
      const d = new Date(s.endMs);
      return d.getFullYear() === visibleMonth.getFullYear() && d.getMonth() === visibleMonth.getMonth();
    }).length;
  }, [sessions, visibleMonth]);

  const shiftMonth = (deltaMonths: number) =>
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + deltaMonths, 1));

  const selectDate = (date: Date) => {
    const key = dateKey(date);
    const session = byDate[key];
    setSelectedKey(key);
    setVisibleMonth(monthStartOf(date));
    if (session) navigation.navigate('SessionDetail', { sessionId: session.id });
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
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to journal"
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backText}>Journal</Text>
          </Pressable>
          <View style={styles.monthNav}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <Text style={styles.chevron}>‹</Text>
            </Pressable>
            <Pressable
              onPress={() => shiftMonth(1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.header}>
          <View>
            <Eyebrow>journal</Eyebrow>
            <SerifDisplay>Calendar</SerifDisplay>
          </View>
        </View>

        <View style={styles.monthSummary}>
          <Text style={styles.monthLabel}>{monthLabel(visibleMonth)}</Text>
          <Secondary style={styles.monthMeta}>
            {recordedInMonth === 1 ? '1 recorded night' : `${recordedInMonth} recorded nights`}
          </Secondary>
        </View>

        <View style={styles.calendarPanel}>
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
              const session = byDate[key] ?? null;
              const selectedDay = key === selectedKey;
              const inMonth = d.getMonth() === visibleMonth.getMonth();
              const band = session ? scoreBand(session.score) : null;
              return (
                <Pressable
                  key={key}
                  style={[
                    styles.dayCell,
                    !inMonth && styles.dayCellMuted,
                    selectedDay && styles.dayCellSelected,
                    session && band ? { borderColor: band.color } : null,
                  ]}
                  onPress={() => selectDate(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}${session ? ', sleep recorded' : ', no recording'}`}
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
                  {session ? <View style={[styles.recordingDot, band ? { backgroundColor: band.color } : null]} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.footer}>
          {loadError && sessions.length === 0 ? (
            <>
              <Text style={styles.footerTitle}>Couldn’t load your calendar.</Text>
              <Pressable onPress={onRefresh} hitSlop={8}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : selectedSession ? (
            <>
              <Text style={styles.footerTitle}>{selectedDateLabel(selectedKey)}</Text>
              <Secondary style={styles.footerText}>Opening recorded nights shows the full report.</Secondary>
            </>
          ) : (
            <>
              <Text style={styles.footerTitle}>{loaded ? selectedDateLabel(selectedKey) : ''}</Text>
              <Secondary style={styles.footerText}>{loaded ? 'No recording for this date.' : ''}</Secondary>
            </>
          )}
        </View>
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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  backButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  backChevron: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  backText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  header: {
    gap: spacing.xs,
  },
  monthNav: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  chevron: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  monthSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  monthLabel: {
    fontFamily: systemFontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  monthMeta: {
    color: colors.textTertiary,
  },
  calendarPanel: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    padding: spacing.md,
    gap: spacing.md,
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
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  dayCellMuted: {
    opacity: 0.42,
  },
  dayCellSelected: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.borderDivider,
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
  footer: {
    minHeight: 84,
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
  },
  footerTitle: {
    fontFamily: systemFontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  footerText: {
    color: colors.textSecondary,
  },
  retryText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
