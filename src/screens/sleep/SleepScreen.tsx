// Sleep tab: select a device, record, and sync.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Logo } from '../../components/Logo';
import { StatusPill } from '../../components/StatusPill';
import { bleClient } from '../../lib/ble';
import { getBleManager } from '../../lib/ble/manager';
import {
  checkBleAvailability,
  requestAndroidBlePermissions,
} from '../../lib/ble/permissions';
import { colors, layout, spacing } from '../../theme/tokens';
import { Body, SerifHeadline } from '../../theme/typography';
import { useSession } from '../../state/session';
import { RecordingCard } from '../home/components/RecordingCard';
import { ConnectDeviceCard } from '../home/components/ConnectDeviceCard';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';
import { WakeAlarmCard } from './components/WakeAlarmCard';

type DevicePresence = 'checking' | 'nearby' | 'missing';
const FIRST_SEEN_GRACE_MS = 3000;
const LAST_SEEN_GRACE_MS = 8000;

export function SleepScreen() {
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const pairedSerial = useSession((s) => s.pairedSerial);
  const setPaired = useSession((s) => s.setPaired);
  const deviceBattery = useSession((s) => s.deviceBattery);
  const streaming = useSession((s) => s.streaming);
  const devicePresence = usePairedDevicePresence(pairedDeviceId, streaming !== null);
  const deviceReady = streaming !== null || devicePresence === 'nearby';

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
          {pairedDeviceId && deviceReady ? (
            <RecordingCard
              idleFooter={
                <DeviceConnectionStatus
                  label={pairedSerial ?? 'Paired device'}
                  onChange={() => setPaired(null)}
                />
              }
            />
          ) : pairedDeviceId ? (
            <ConnectPairedDeviceCard
              checking={devicePresence === 'checking'}
              onChange={() => setPaired(null)}
            />
          ) : (
            <ConnectDeviceCard />
          )}
          <WakeAlarmCard />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function usePairedDevicePresence(
  pairedDeviceId: string | null,
  disabled: boolean,
): DevicePresence {
  const [presence, setPresence] = useState<DevicePresence>(
    pairedDeviceId ? 'checking' : 'missing',
  );
  const lastSeenRef = useRef(0);
  const scanStartedRef = useRef(0);

  useEffect(() => {
    if (!pairedDeviceId || disabled) {
      setPresence(pairedDeviceId ? 'nearby' : 'missing');
      return;
    }

    let cancelled = false;
    let stopScan: (() => void) | null = null;
    lastSeenRef.current = 0;
    scanStartedRef.current = Date.now();
    setPresence('checking');

    const startScan = async () => {
      const granted = await requestAndroidBlePermissions();
      if (!granted || cancelled) {
        if (!cancelled) setPresence('missing');
        return;
      }

      const avail = await checkBleAvailability(getBleManager());
      if (avail.state !== 'ready' || cancelled) {
        if (!cancelled) setPresence('missing');
        return;
      }

      stopScan = bleClient.scan((found) => {
        if (found.deviceId !== pairedDeviceId || cancelled) return;
        lastSeenRef.current = Date.now();
        setPresence('nearby');
      });
    };

    void startScan();

    const tick = setInterval(() => {
      if (cancelled) return;
      const now = Date.now();
      const lastSeen = lastSeenRef.current;
      if (lastSeen > 0) {
        setPresence(now - lastSeen <= LAST_SEEN_GRACE_MS ? 'nearby' : 'missing');
      } else if (now - scanStartedRef.current > FIRST_SEEN_GRACE_MS) {
        setPresence('missing');
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(tick);
      stopScan?.();
    };
  }, [pairedDeviceId, disabled]);

  return presence;
}

function ConnectPairedDeviceCard({
  checking,
  onChange,
}: {
  checking: boolean;
  onChange: () => void;
}) {
  return (
    <View style={styles.connectWrap}>
      <Card style={styles.connectCard}>
        <SerifHeadline>Connect device</SerifHeadline>
        <Body style={styles.connectText}>
          {checking
            ? 'Looking for your Neurex device.'
            : 'Turn on your Neurex device and keep it near this phone.'}
        </Body>
        <Button label="Change device" variant="ghost" onPress={onChange} />
      </Card>
    </View>
  );
}

function DeviceConnectionStatus({
  label,
  onChange,
}: {
  label: string;
  onChange: () => void;
}) {
  return (
    <View style={styles.deviceIdentity}>
      <View style={styles.deviceRow}>
        <View style={styles.deviceText}>
          <Text style={styles.deviceName} numberOfLines={1} adjustsFontSizeToFit>
            {label}
          </Text>
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
  connectWrap: {
    paddingTop: spacing.md,
  },
  connectCard: {
    gap: spacing.lg,
  },
  connectText: {
    color: colors.textSecondary,
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
  deviceName: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
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
