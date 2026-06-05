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
import { colors, layout, spacing, stageColors, stageOpacity } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import { sessionRepo, type Session, type SleepStage } from '../../lib/repos';
import { downloadRaw } from '../../lib/cloud/cloudSync';
import * as Sharing from 'expo-sharing';
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
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.scroll}>
          <View style={styles.header}>
            <Eyebrow>history</Eyebrow>
          </View>
          <View style={styles.list}>
            <Skeleton.Row />
            <Skeleton.Row />
            <Skeleton.Row />
          </View>
        </View>
      </SafeAreaView>
    );
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
  const [dl, setDl] = useState<'idle' | 'busy' | 'err'>('idle');
  const total =
    STAGE_ORDER.reduce((acc, k) => acc + (session.stageMinutes?.[k] ?? 0), 0) || 1;
  const tstLabel = session.tst != null
    ? `${Math.floor(session.tst / 60)}h ${Math.floor(session.tst % 60)}m asleep`
    : session.status === 'failed'
      ? 'Processing failed'
      : 'Still analyzing — usually under a minute';
  // date · timestamp · length (the per-account organization the user asked for)
  const meta = `${formatTime(session.startMs)} · ${formatLen(session.tib)}`;
  // Dual-record nights carry the headband tag in their storage folder
  // (date_time_len_TAG); surface it so two devices on one account are tellable
  // apart at a glance. null for legacy/uuid-only prefixes.
  const device = sourceTag(session.storagePrefix);
  const canDownload = Boolean(session.storagePrefix);

  const onDownload = useCallback(async () => {
    if (!session.storagePrefix || dl === 'busy') return;
    setDl('busy');
    try {
      const uri = await downloadRaw(session.storagePrefix, 'eeg');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Save / send EEG.BIN',
        });
      }
      setDl('idle');
    } catch {
      setDl('err');
    }
  }, [session.storagePrefix, dl]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.rowPressed]}
      >
        <View style={styles.rowTop}>
          <View>
            <Eyebrow>
              {formatDate(session.startMs)}
              {device ? ` · ${device}` : ''}
            </Eyebrow>
            <Secondary style={styles.meta}>{meta}</Secondary>
            <Secondary style={styles.meta}>{tstLabel}</Secondary>
          </View>
          <SerifDisplay>{session.score ?? '—'}</SerifDisplay>
        </View>
        <View style={styles.bar}>
          {STAGE_ORDER.map((stage) => {
            const flex = (session.stageMinutes?.[stage] ?? 0) / total;
            if (flex <= 0) return null;
            return (
              <View
                key={stage}
                style={{
                  flex,
                  backgroundColor: stageColors[stage],
                  opacity: stageOpacity[stage],
                }}
              />
            );
          })}
        </View>
      </Pressable>
      {canDownload ? (
        <Pressable
          onPress={onDownload}
          style={({ pressed }) => [styles.dl, pressed && styles.rowPressed]}
        >
          <Secondary style={styles.dlText}>
            {dl === 'busy'
              ? 'downloading…'
              : dl === 'err'
                ? '↓ download raw — failed, tap to retry'
                : '↓ download raw EEG'}
          </Secondary>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Headband tag from a readable storage prefix ({uid}/date_time_len_TAG).
 * Returns null for legacy uuid-only prefixes so single recordings stay clean. */
function sourceTag(prefix: string | null): string | null {
  if (!prefix) return null;
  const label = prefix.split('/').pop() ?? '';
  const parts = label.split('_');
  if (parts.length < 4) return null; // not the date_time_len_tag shape
  const tag = parts[parts.length - 1];
  return tag || null;
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

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatLen(minutes: number) {
  const sec = Math.max(0, Math.round(minutes * 60));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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
  dl: {
    alignSelf: 'flex-start',
    paddingTop: spacing.xs,
  },
  dlText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
});
