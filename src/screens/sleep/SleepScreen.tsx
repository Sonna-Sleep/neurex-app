// Sleep tab — the start/stop recording control, and nothing else. Hosts the
// existing recording lifecycle: pair → pre-bed signal check → record → sync.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '../../components/Logo';
import { StatusPill } from '../../components/StatusPill';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { RecordingCard } from '../home/components/RecordingCard';
import { ConnectDeviceCard } from '../home/components/ConnectDeviceCard';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

export function SleepScreen() {
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const deviceBattery = useSession((s) => s.deviceBattery);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Logo height={30} />
        <View style={styles.topBarRight}>
          <StatusPill battery={deviceBattery ?? null} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          {pairedDeviceId ? <RecordingCard /> : <ConnectDeviceCard />}
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
    paddingBottom: TAB_BAR_SPACE,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
});
