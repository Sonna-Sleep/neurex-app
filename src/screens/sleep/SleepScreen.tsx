// Sleep tab — the start/stop recording control, and nothing else. Hosts the
// existing recording lifecycle: pair → record → sync.
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
import { Eyebrow } from '../../theme/typography';

export function SleepScreen() {
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const pairedSerial = useSession((s) => s.pairedSerial);
  const setPaired = useSession((s) => s.setPaired);
  const deviceBattery = useSession((s) => s.deviceBattery);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <Logo height={30} />
        <View style={styles.topBarRight}>
          <StatusPill battery={deviceBattery ?? null} />
        </View>
      </View>

      {pairedDeviceId ? (
        <View style={styles.fixedDevice}>
          <DeviceIdentity
            serial={pairedSerial}
            deviceId={pairedDeviceId}
            onChange={() => setPaired(null)}
          />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          {pairedDeviceId ? <RecordingCard /> : <ConnectDeviceCard />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function shortDeviceId(deviceId: string | null): string | null {
  if (!deviceId) return null;
  const clean = deviceId.replace(/[^A-Za-z0-9]/g, '');
  return clean.slice(-5).toUpperCase() || null;
}

function DeviceIdentity({
  serial,
  deviceId,
  onChange,
}: {
  serial: string | null;
  deviceId: string | null;
  onChange: () => void;
}) {
  const id = shortDeviceId(deviceId);
  return (
    <View style={styles.deviceIdentity}>
      <Eyebrow>paired device</Eyebrow>
      <View style={styles.deviceRow}>
        <View style={styles.deviceText}>
          <Text style={styles.deviceName} numberOfLines={1} adjustsFontSizeToFit>
            {serial ?? 'Neurex device'}
          </Text>
          {id ? <Text style={styles.deviceMeta}>id …{id}</Text> : null}
        </View>
        <Pressable
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel="Change paired device"
          hitSlop={10}
          style={styles.changeButton}
        >
          <Text style={styles.changeText}>Change</Text>
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
  fixedDevice: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: TAB_BAR_SPACE + spacing.lg,
  },
  body: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: spacing.md,
  },
  deviceIdentity: {
    gap: spacing.sm,
  },
  deviceRow: {
    minHeight: 54,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
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
    gap: 2,
  },
  deviceName: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  deviceMeta: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 16,
  },
  changeButton: {
    minHeight: 34,
    justifyContent: 'center',
  },
  changeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
