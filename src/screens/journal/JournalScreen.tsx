// Journal home — latest-night summary first. Detailed graphs stay one tap
// deeper in SessionDetail so the landing screen stays calm.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Eyebrow, Secondary } from '../../theme/typography';
import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { useSession } from '../../state/session';
import { ScoreRing, scoreBand } from '../../components/ScoreRing';
import { TabIcon } from '../../components/TabIcon';
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

function fmtDur(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtSol(min: number | null): string {
  if (min == null) return '—';
  return `${Math.round(min)}m`;
}

function statusLabel(session: Session): { label: string; color: string } {
  if (session.score != null) {
    const band = scoreBand(session.score);
    return { label: band.label, color: band.color };
  }
  if (session.status === 'failed') return { label: 'Needs review', color: colors.warning };
  return { label: 'Analyzing', color: colors.textTertiary };
}

export function JournalScreen({ navigation }: Props) {
  const authReady = useSession((s) => s.authReady);
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
  const status = latest ? statusLabel(latest) : null;

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
          <Eyebrow>journal</Eyebrow>
          <Pressable
            onPress={() => navigation.navigate('JournalCalendar')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open calendar"
          >
            <TabIcon name="journal" color={colors.textPrimary} size={20} />
          </Pressable>
        </View>

        {latest && status ? (
          <View style={styles.summary}>
            <View style={styles.dateBlock}>
              <Secondary style={styles.kicker}>Latest night</Secondary>
              <Text style={styles.date}>{dateLabel(latest.endMs)}</Text>
            </View>

            <View style={styles.scoreRow}>
              <ScoreRing score={latest.score} size={132} stroke={10} showLabel={false} />
              <View style={styles.scoreText}>
                <Text style={[styles.scoreLabel, { color: status.color }]}>{status.label}</Text>
                <Secondary style={styles.scoreSubtext}>
                  {latest.score != null ? 'Sleep score' : 'Report pending'}
                </Secondary>
              </View>
            </View>

            <View style={styles.metrics}>
              <Metric label="Asleep" value={fmtDur(latest.tst)} />
              <Metric label="In bed" value={fmtDur(latest.tib)} />
              <Metric label="Fell asleep" value={fmtSol(latest.sol)} />
            </View>

            <Pressable
              onPress={() => navigation.navigate('SessionDetail', { sessionId: latest.id })}
              style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.reportButtonText}>View report</Text>
            </Pressable>
          </View>
        ) : loadError && sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Couldn’t load journal.</Text>
            <Pressable onPress={onRefresh} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{loaded ? 'No recordings yet.' : ''}</Text>
            <Secondary style={styles.emptyText}>{loaded ? 'Record from Sleep to fill your journal.' : ''}</Secondary>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Secondary style={styles.metricLabel}>{label}</Secondary>
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
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.borderDivider,
    backgroundColor: colors.bgElevated,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  summary: {
    gap: spacing.xl,
  },
  dateBlock: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  kicker: {
    color: colors.textTertiary,
  },
  date: {
    fontFamily: systemFontFamily,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.md,
  },
  scoreText: {
    flex: 1,
    gap: spacing.xs,
  },
  scoreLabel: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
  },
  scoreSubtext: {
    color: colors.textSecondary,
  },
  metrics: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  metric: {
    flex: 1,
    minHeight: 84,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  metricValue: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metricLabel: {
    color: colors.textSecondary,
  },
  reportButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.ctaBg,
  },
  reportButtonText: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ctaText,
  },
  empty: {
    minHeight: 320,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    lineHeight: 34,
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
  },
});
