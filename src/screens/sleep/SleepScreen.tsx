// Sleep tab: select a device, record, and sync.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const setPaired = useSession((s) => s.setPaired);
  const deviceBattery = useSession((s) => s.deviceBattery);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Logo height={30} />
        <View style={styles.topBarRight}>
          {deviceBattery !== null ? <StatusPill battery={deviceBattery} /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          {pairedDeviceId ? (
            <RecordingCard
              idleFooter={<DeviceConnectionStatus onChange={() => setPaired(null)} />}
            />
          ) : (
            <ConnectDeviceCard />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DeviceConnectionStatus({ onChange }: { onChange: () => void }) {
  return (
    <View style={styles.deviceIdentity}>
      <View style={styles.deviceRow}>
        <View style={styles.deviceText}>
          <Text style={styles.deviceStatus}>Not connected</Text>
        </View>
        <Pressable
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel="Pair device"
          hitSlop={10}
          style={styles.changeButton}
        >
          <Text style={styles.changeText}>Pair</Text>
        </Pressable>
      </View>
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
    paddingTop: 0,
    paddingBottom: TAB_BAR_SPACE + spacing.lg,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
  },
  deviceIdentity: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
  },
  deviceRow: {
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  deviceText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  deviceStatus: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  changeButton: {
    minWidth: 72,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  changeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
