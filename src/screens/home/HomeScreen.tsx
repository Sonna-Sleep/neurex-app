import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

const HEADBAND = require('../../../assets/images/headband.png');
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '../../components/Logo';
import { StatusPill } from '../../components/StatusPill';
import { SerifHeadline, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { deviceRepo, sessionRepo, type Session, type Device } from '../../lib/repos';
import { TimeSlept } from './components/TimeSlept';
import { StageBreakdown } from './components/StageBreakdown';
import { SleepStrip } from './components/SleepStrip';
import { StimImpactCard } from './components/StimImpactCard';
// Hypnogram is Pro-only (spec §4). Kept in the codebase, gated when paywall lands.

export function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [device, setDevice] = useState<Device | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([sessionRepo.latest(), deviceRepo.current()]).then(
      ([s, d]) => {
        if (!alive) return;
        setSession(s);
        setDevice(d);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Logo height={22} />
        <StatusPill battery={device?.battery ?? null} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {session ? (
          <Results session={session} />
        ) : (
          <EmptyState hasDevice={!!device} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Results({ session }: { session: Session }) {
  return (
    <View style={styles.results}>
      <TimeSlept tstSec={session.tst} score={session.score ?? 0} />
      <SleepStrip
        epochs={session.epochs}
        startMs={session.startMs}
        endMs={session.endMs}
      />
      <StimImpactCard
        stimCount={session.stimPulses.length}
        stimImpactPct={session.stimImpactPct}
      />
      <StageBreakdown stageMinutes={session.stageMinutes} />
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
