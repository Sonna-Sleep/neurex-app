// Journal tab — a sleep calendar. A week strip of day-circles up top; tapping a
// day shows that night's report (score ring + in-bed/asleep + hypnogram +
// stage breakdown). Pages back/forward by week.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Eyebrow, SerifDisplay, Secondary } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { ScoreRing } from '../../components/ScoreRing';
import { WeekStrip, dateKey, weekStartOf } from '../../components/WeekStrip';
import { Hypnogram } from '../home/components/Hypnogram';
import { StageBreakdown } from '../home/components/StageBreakdown';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDur(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function todayKey(): string {
  return dateKey(new Date(Date.now()));
}

export function JournalScreen() {
  const authReady = useSession((s) => s.authReady);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(todayKey());
  const [weekStart, setWeekStart] = useState<Date>(weekStartOf(new Date(Date.now())));
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const list = await sessionRepo.list();
    setSessions(list);
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
  }, []);

  // Refetch when auth settles (cold start) and whenever the tab regains focus —
  // so a night recorded on the Sleep tab appears here without an app restart.
  useEffect(() => {
    load().catch(() => undefined);
  }, [authReady, load]);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
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
          <View style={styles.report}>
            {/* Score ring + in-bed / asleep */}
            <View style={styles.scoreRow}>
              <ScoreRing score={selected.score} size={150} />
              <View style={styles.stats}>
                <Stat value={fmtDur(selected.tib)} label="In bed" />
                <Stat value={fmtDur(selected.tst)} label="Asleep" />
              </View>
            </View>

            {selected.score != null ? (
              <>
                <View style={styles.section}>
                  <Eyebrow>sleep stages</Eyebrow>
                  <Hypnogram epochs={selected.epochs} startMs={selected.startMs} endMs={selected.endMs} />
                </View>
                <StageBreakdown stageMinutes={selected.stageMinutes} />

                <View style={styles.section}>
                  <Eyebrow>details</Eyebrow>
                  <View style={styles.detailRows}>
                    <DetailRow
                      label="Fell asleep in"
                      value={selected.sol != null ? `${Math.round(selected.sol)} min` : '—'}
                    />
                    <DetailRow
                      label="Signal quality"
                      value={
                        selected.confidence != null
                          ? `${Math.round(selected.confidence * 100)}%`
                          : '—'
                      }
                    />
                  </View>
                </View>
              </>
            ) : (
              <Secondary style={styles.processing}>Analyzing this night…</Secondary>
            )}
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Secondary style={styles.statLabel}>{label}</Secondary>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Secondary style={styles.detailLabel}>{label}</Secondary>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
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
  report: {
    gap: spacing.xl,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  stats: {
    flex: 1,
    gap: spacing.lg,
  },
  stat: {
    gap: 2,
  },
  statValue: {
    fontFamily: systemFontFamily,
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  statLabel: {
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.md,
  },
  detailRows: {
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: colors.textSecondary,
  },
  detailValue: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  processing: {
    color: colors.textSecondary,
  },
  empty: {
    paddingTop: spacing.xxl,
  },
  emptyText: {
    color: colors.textSecondary,
  },
});
