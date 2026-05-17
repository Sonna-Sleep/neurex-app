import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

const HEADBAND = require('../../../assets/images/headband.png');
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '../../components/Logo';
import { StatusPill } from '../../components/StatusPill';
import { SerifHeadline, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { deviceRepo, sessionRepo, type Session, type Device } from '../../lib/repos';
import { useSession } from '../../state/session';
import { Skeleton } from '../../components/Skeleton';
import { NightSummary } from './components/NightSummary';
import { StageBreakdown } from './components/StageBreakdown';
import { Hypnogram } from './components/Hypnogram';
import { StimImpactCard } from './components/StimImpactCard';
import { ProcessingCard } from './components/ProcessingCard';

export function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Distinguishes "we haven't tried fetching yet" (show Skeleton) from
  // "we tried and got nothing" (show EmptyState — the genuine first-night
  // CTA). Without this flag both states look identical.
  const [loaded, setLoaded] = useState(false);
  const authReady = useSession((s) => s.authReady);
  const processingSessionId = useSession((s) => s.processingSessionId);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      sessionRepo.latest(),
      deviceRepo.current(),
    ]);
    setSession(s);
    setDevice(d);
    setLoaded(true);
  }, []);

  // Re-runs when auth settles, so a cold start that queried as anonymous
  // re-fetches once the Supabase session is restored. Also refetches when
  // a processing job finishes so the new session row replaces the
  // ProcessingCard.
  useEffect(() => {
    load().catch(() => undefined);
  }, [load, authReady, processingSessionId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Logo height={28} />
        <StatusPill battery={device?.battery ?? null} />
      </View>

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
        {processingSessionId ? (
          <ProcessingCard
            sessionId={processingSessionId}
            onReady={() => load().catch(() => undefined)}
          />
        ) : session ? (
          <Results session={session} />
        ) : !loaded ? (
          <Skeleton.Card />
        ) : (
          <EmptyState hasDevice={!!device} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Results({ session }: { session: Session }) {
  // `tib` is the recording duration in minutes; pass it so the night summary
  // can say "21 min recorded — not analyzed yet" until staging produces tst.
  const isAnalyzed = session.score !== null;
  return (
    <View style={styles.results}>
      <NightSummary
        tstMin={session.tst}
        score={session.score}
        recordingMinutes={session.tib}
      />
      {isAnalyzed ? (
        <>
          <Hypnogram
            epochs={session.epochs}
            startMs={session.startMs}
            endMs={session.endMs}
          />
          <StageBreakdown stageMinutes={session.stageMinutes} />
        </>
      ) : null}
      <StimImpactCard
        stimCount={session.stimPulses.length}
        stimImpactPct={session.stimImpactPct}
      />
    </View>
  );
}

function EmptyState({ hasDevice }: { hasDevice: boolean }) {
  return (
    <View style={styles.emptyState}>
      <Eyebrow>last night</Eyebrow>
      <SerifHeadline style={styles.emptyHeadline}>
        Waiting for your first night
      </SerifHeadline>
      <Body style={styles.emptyBody}>
        {hasDevice
          ? 'Wear it tonight. It starts on its own.'
          : 'Pair your headband to start.'}
      </Body>
      <Image
        source={HEADBAND}
        style={styles.deviceImage}
        resizeMode="contain"
      />
    </View>
  );
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxxl,
    gap: spacing.md,
  },
  emptyHeadline: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  deviceImage: {
    width: '100%',
    height: 200,
    marginTop: spacing.xxl,
    opacity: 0.5,
  },
});
