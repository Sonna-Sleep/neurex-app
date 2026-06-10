import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Logo } from '../../components/Logo';
import { StatusPill } from '../../components/StatusPill';
import { Button } from '../../components/Button';
import { SerifHeadline, Secondary } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { deviceRepo, sessionRepo, type Session, type Device } from '../../lib/repos';
import { useSession } from '../../state/session';
import { Skeleton } from '../../components/Skeleton';
import { NightSummary } from './components/NightSummary';
import { ProcessingCard } from './components/ProcessingCard';

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [session, setSession] = useState<Session | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const authReady = useSession((s) => s.authReady);
  const processingSessionId = useSession((s) => s.processingSessionId);
  const streaming = useSession((s) => s.streaming);
  const deviceBattery = useSession((s) => s.deviceBattery);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([sessionRepo.latest(), deviceRepo.current()]);
    setSession(s);
    setDevice(d);
    setLoaded(true);
  }, []);

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

  const openSleep = () => navigation.navigate('Record');
  const openNight = () =>
    session &&
    navigation.navigate('History', {
      screen: 'SessionDetail',
      params: { sessionId: session.id },
    });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Logo height={30} />
        <View style={styles.topBarRight}>
          <StatusPill battery={deviceBattery ?? device?.battery ?? null} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        <View style={styles.hero}>
          {processingSessionId ? (
            <ProcessingCard
              sessionId={processingSessionId}
              onReady={() => load().catch(() => undefined)}
            />
          ) : session ? (
            <Pressable onPress={openNight} style={({ pressed }) => pressed && styles.pressed}>
              <NightSummary tstMin={session.tst} score={session.score} recordingMinutes={session.tib} />
              {session.score != null ? <Secondary style={styles.viewNight}>view night</Secondary> : null}
            </Pressable>
          ) : !loaded ? (
            <Skeleton.Card />
          ) : (
            <View style={styles.empty}>
              <SerifHeadline style={styles.emptyTitle}>Your first night awaits</SerifHeadline>
              <Secondary style={styles.emptySub}>Wear your mask tonight to see your sleep.</Secondary>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {streaming ? (
            <Button label="recording — open" onPress={openSleep} />
          ) : (
            <Button label="start sleep" onPress={openSleep} />
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
  topBar: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarRight: {
    position: 'absolute',
    right: layout.screenPadding,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xl,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  pressed: {
    opacity: 0.6,
  },
  viewNight: {
    textAlign: 'center',
    color: colors.accent,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptySub: {
    textAlign: 'center',
    color: colors.textSecondary,
  },
  footer: {
    paddingTop: spacing.lg,
  },
});
