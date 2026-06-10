import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Body, Eyebrow, SerifHeadline } from '../../theme/typography';
import { BackButton } from '../../components/BackButton';
import { colors, layout, spacing } from '../../theme/tokens';
import { sessionRepo, type Session } from '../../lib/repos';
import { Skeleton } from '../../components/Skeleton';
import { NightSummary } from '../home/components/NightSummary';
import { Hypnogram } from '../home/components/Hypnogram';
import { StageBreakdown } from '../home/components/StageBreakdown';
import type { HistoryStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<HistoryStackParamList, 'SessionDetail'>;

export function SessionDetailScreen({ navigation, route }: Props) {
  const { sessionId } = route.params;
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    sessionRepo.byId(sessionId).then((s) => {
      if (!alive) return;
      setSession(s);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <BackButton label="history" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {session ? (
          <View style={styles.results}>
            <NightSummary
              tstMin={session.tst}
              score={session.score}
              recordingMinutes={session.tib}
              label={formatNight(session.endMs)}
            />
            {session.score !== null && (
              <>
                <Hypnogram
                  epochs={session.epochs}
                  startMs={session.startMs}
                  endMs={session.endMs}
                />
                <StageBreakdown stageMinutes={session.stageMinutes} />
              </>
            )}
          </View>
        ) : loaded ? (
          <View style={styles.empty}>
            <Eyebrow>not found</Eyebrow>
            <SerifHeadline style={styles.emptyHeadline}>
              This night couldn't be loaded
            </SerifHeadline>
            <Body style={styles.emptyBody}>
              Try again, or go back to History.
            </Body>
          </View>
        ) : (
          <Skeleton.Card />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatNight(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  topBar: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  back: {
    color: colors.textSecondary,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxxl,
  },
  results: {
    gap: spacing.xl,
    paddingTop: spacing.md,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingTop: spacing.xxxl,
  },
  emptyHeadline: {},
  emptyBody: {
    color: colors.textSecondary,
  },
});
