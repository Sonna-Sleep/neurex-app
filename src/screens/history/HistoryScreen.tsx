import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SerifHeadline,
  SerifDisplay,
  Body,
  Eyebrow,
  Secondary,
} from '../../theme/typography';
import { colors, layout, spacing, stageOpacity } from '../../theme/tokens';
import { sessionRepo, type Session, type SleepStage } from '../../lib/repos';

const STAGE_ORDER: SleepStage[] = ['deep', 'rem', 'light', 'wake'];

export function HistoryScreen() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    let alive = true;
    sessionRepo.list().then((s) => {
      if (alive) setSessions(s);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  const avg =
    sessions.reduce((s, x) => s + (x.score ?? 0), 0) / sessions.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Eyebrow>history · {sessions.length} nights</Eyebrow>
          <SerifDisplay>{Math.round(avg)} avg</SerifDisplay>
        </View>

        <View style={styles.list}>
          {sessions.map((s) => (
            <Row key={s.id} session={s} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ session }: { session: Session }) {
  const total =
    STAGE_ORDER.reduce((acc, k) => acc + session.stageMinutes[k], 0) || 1;
  const tstH = Math.floor(session.tst / 3600);
  const tstM = Math.floor((session.tst % 3600) / 60);
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View>
          <Eyebrow>{formatDate(session.endMs)}</Eyebrow>
          <Secondary style={styles.meta}>
            {tstH}h {tstM}m · {Math.round(session.efficiency * 100)}%
          </Secondary>
        </View>
        <SerifDisplay>{session.score ?? 0}</SerifDisplay>
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
    </View>
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
