import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  SerifHeadline,
  SerifDisplay,
  Body,
  Eyebrow,
  Secondary,
} from '../../theme/typography';
import { colors, layout, spacing, stageOpacity } from '../../theme/tokens';
import { sessionRepo, type Session, type SleepStage } from '../../lib/repos';
import { useSession } from '../../state/session';
import type { HistoryStackParamList } from '../../navigation/types';

const STAGE_ORDER: SleepStage[] = ['deep', 'rem', 'light', 'wake'];

type Props = NativeStackScreenProps<HistoryStackParamList, 'HistoryList'>;

export function HistoryScreen({ navigation }: Props) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const authReady = useSession((s) => s.authReady);

  const load = useCallback(async () => {
    setSessions(await sessionRepo.list());
  }, []);

  // Re-runs when auth settles, so a cold start that queried as anonymous
  // re-fetches once the Supabase session is restored.
  useEffect(() => {
    load().catch(() => undefined);
  }, [load, authReady]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (!sessions) {
    return <SafeAreaView style={styles.container} edges={['top']} />;
  }

  if (sessions.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Eyebrow>history</Eyebrow>
          <SerifHeadline style={styles.headline}>Nothing here yet</SerifHeadline>
          <Body style={styles.body}>
            Past nights and trends will show up here once you've worn the
            headband.
          </Body>
        </View>
      </SafeAreaView>
    );
  }

  // Average only over scored nights — an unprocessed night (score null)
  // shouldn't drag the average toward zero.
  const scored = sessions.filter((s) => s.score != null);
  const avg = scored.length
    ? Math.round(
        scored.reduce((sum, x) => sum + (x.score as number), 0) /
          scored.length,
      )
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textSecondary}
          />
        }
      >
        <View style={styles.header}>
          <Eyebrow>history · {sessions.length} nights</Eyebrow>
          <SerifDisplay>{avg ?? '—'} avg</SerifDisplay>
        </View>

        <View style={styles.list}>
          {sessions.map((s) => (
            <Row
              key={s.id}
              session={s}
              onPress={() =>
                navigation.navigate('SessionDetail', { sessionId: s.id })
              }
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  session,
  onPress,
}: {
  session: Session;
  onPress: () => void;
}) {
  const total =
    STAGE_ORDER.reduce((acc, k) => acc + session.stageMinutes[k], 0) || 1;
  const tstH = Math.floor(session.tst / 3600);
  const tstM = Math.floor((session.tst % 3600) / 60);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTop}>
        <View>
          <Eyebrow>{formatDate(session.endMs)}</Eyebrow>
          <Secondary style={styles.meta}>
            {tstH}h {tstM}m
          </Secondary>
        </View>
        <SerifDisplay>{session.score ?? '—'}</SerifDisplay>
      </View>
      <View style={styles.bar}>
        {STAGE_ORDER.map((stage) => {
          const flex = session.stageMinutes[stage] / total;
          if (flex <= 0) return null;
          return (
            <View
              key={stage}
              style={{
                flex,
                backgroundColor: colors.textPrimary,
                opacity: stageOpacity[stage],
              }}
            />
          );
        })}
      </View>
    </Pressable>
  );
}

function formatDate(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const dayDiff = Math.round(
    (stripTime(today) - stripTime(d)) / (24 * 3600 * 1000),
  );
  if (dayDiff === 0) return 'last night';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function stripTime(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  header: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  list: {
    gap: spacing.lg,
  },
  row: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  meta: {
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  bar: {
    height: 6,
    flexDirection: 'row',
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    gap: spacing.md,
  },
  headline: {
    marginTop: spacing.sm,
  },
  body: {
    color: colors.textSecondary,
  },
});
