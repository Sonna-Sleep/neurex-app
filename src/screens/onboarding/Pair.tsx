import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SerifDisplay, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, radii, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { bleClient, type FoundDevice } from '../../lib/ble';
import { getBleManager } from '../../lib/ble/manager';
import {
  checkBleAvailability,
  openSettingsForBluetooth,
  requestAndroidBlePermissions,
} from '../../lib/ble/permissions';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Pair'>;

type PairState =
  | 'preflight'
  | 'permission-denied'
  | 'bluetooth-off'
  | 'unsupported'
  | 'scanning'
  | 'scan-timeout'
  | 'pairing'
  | 'paired'
  | 'error';

const SCAN_TIMEOUT_MS = 15_000;

function shortId(deviceId: string): string {
  const clean = deviceId.replace(/[^A-Za-z0-9]/g, '');
  return clean.slice(-5).toUpperCase();
}

function rssiBars(rssi: number): string {
  if (rssi >= -55) return '••••';
  if (rssi >= -70) return '•••';
  if (rssi >= -80) return '••';
  if (rssi >= -90) return '•';
  return '·';
}

export function Pair({ navigation }: Props) {
  const setPaired = useSession((s) => s.setPaired);
  const [state, setState] = useState<PairState>('preflight');
  const [devices, setDevices] = useState<Record<string, FoundDevice>>({});
  const [pairedDevice, setPairedDevice] = useState<FoundDevice | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScan = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (stopScanRef.current) stopScanRef.current();
    stopScanRef.current = null;
  }, []);

  const beginScan = useCallback(async () => {
    clearScan();
    setDevices({});
    setPairedDevice(null);
    setErrorMsg(null);
    setState('preflight');

    const granted = await requestAndroidBlePermissions();
    if (!granted) {
      setState('permission-denied');
      return;
    }

    const manager = getBleManager();
    const avail = await checkBleAvailability(manager);
    if (avail.state === 'bluetooth-off') return setState('bluetooth-off');
    if (avail.state === 'unauthorized') return setState('permission-denied');
    if (avail.state === 'unsupported' || avail.state === 'unknown') {
      if (manager !== null) return setState('unsupported');
    }

    setState('scanning');
    stopScanRef.current = bleClient.scan((found) => {
      setDevices((prev) => ({ ...prev, [found.deviceId]: found }));
    });

    timeoutRef.current = setTimeout(() => {
      // Only switch to scan-timeout if list is still empty — otherwise
      // keep the scan running so RSSI ranking stays live.
      setDevices((prev) => {
        setState((s) =>
          s === 'scanning' && Object.keys(prev).length === 0
            ? 'scan-timeout'
            : s,
        );
        return prev;
      });
    }, SCAN_TIMEOUT_MS);
  }, [clearScan]);

  useEffect(() => {
    void beginScan();
    return clearScan;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickDevice = async (device: FoundDevice) => {
    clearScan();
    setPairedDevice(device);
    setState('pairing');
    setErrorMsg(null);
    try {
      const connection = await bleClient.connect(device.deviceId);
      await connection.disconnect();
      setPaired(device.serial, device.deviceId);
      setState('paired');
      setTimeout(() => navigation.navigate('HowItWorks'), 700);
    } catch (e) {
      setErrorMsg((e as Error).message);
      setState('error');
    }
  };

  const skip = () => {
    setPaired(null);
    navigation.navigate('HowItWorks');
  };

  const sortedDevices = useMemo(
    () => Object.values(devices).sort((a, b) => b.rssi - a.rssi),
    [devices],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <SerifDisplay style={styles.headline}>Pair your sleep mask</SerifDisplay>
        <Body style={styles.subtext}>
          Press the button to turn your mask on.
        </Body>

        <Card style={styles.card}>
          {state === 'preflight' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>Checking Bluetooth…</Body>
            </View>
          ) : null}

          {state === 'scanning' ? (
            <View style={styles.scanHeader}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>
                {sortedDevices.length === 0
                  ? 'Searching for your sleep mask…'
                  : `Found ${sortedDevices.length} — keep scanning…`}
              </Body>
            </View>
          ) : null}

          {state === 'scanning' && sortedDevices.length > 0 ? (
            <View style={styles.list}>
              {sortedDevices.map((d) => (
                <Pressable
                  key={d.deviceId}
                  style={styles.deviceRow}
                  onPress={() => pickDevice(d)}
                >
                  <View style={styles.deviceCol}>
                    <Body style={styles.deviceName}>{d.serial}</Body>
                    <Body style={styles.deviceMeta}>
                      id …{shortId(d.deviceId)} · {d.rssi} dBm
                    </Body>
                  </View>
                  <Text style={styles.bars}>{rssiBars(d.rssi)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {state === 'scan-timeout' ? (
            <View style={styles.foundCol}>
              <Eyebrow>nothing yet</Eyebrow>
              <Body style={styles.cardText}>
                Make sure your mask is on — press the button to turn it on.
              </Body>
            </View>
          ) : null}

          {state === 'bluetooth-off' ? (
            <View style={styles.foundCol}>
              <Eyebrow>bluetooth is off</Eyebrow>
              <Body style={styles.cardText}>
                Turn on Bluetooth, then tap re-scan.
              </Body>
            </View>
          ) : null}

          {state === 'permission-denied' ? (
            <View style={styles.foundCol}>
              <Eyebrow>permission needed</Eyebrow>
              <Body style={styles.cardText}>
                Neurex needs Bluetooth permission to find your sleep mask. Open
                Settings to grant it.
              </Body>
            </View>
          ) : null}

          {state === 'unsupported' ? (
            <View style={styles.foundCol}>
              <Eyebrow>not supported</Eyebrow>
              <Body style={styles.cardText}>
                This device doesn't support Bluetooth LE.
              </Body>
            </View>
          ) : null}

          {state === 'pairing' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>
                Connecting
                {pairedDevice ? ` to …${shortId(pairedDevice.deviceId)}` : ''}…
              </Body>
            </View>
          ) : null}

          {state === 'paired' ? (
            <View style={styles.foundCol}>
              <Eyebrow>connected</Eyebrow>
              <Body style={styles.deviceSerial}>{pairedDevice?.serial}</Body>
            </View>
          ) : null}

          {state === 'error' && errorMsg ? (
            <View style={styles.foundCol}>
              <Eyebrow>connection failed</Eyebrow>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}
        </Card>
      </View>

      <View style={styles.actions}>
        {state === 'bluetooth-off' || state === 'permission-denied' ? (
          <Button label="open settings" onPress={openSettingsForBluetooth} />
        ) : null}
        {state === 'scan-timeout' ||
        state === 'error' ||
        state === 'bluetooth-off' ||
        state === 'permission-denied' ? (
          <Button label="re-scan" variant="ghost" onPress={beginScan} />
        ) : null}
        <Button label="skip for now" variant="ghost" onPress={skip} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headline: {
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  subtext: {
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  card: {
    minHeight: 100,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  foundCol: {
    gap: spacing.sm,
  },
  deviceSerial: {
    fontSize: 18,
  },
  list: {
    gap: spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    gap: spacing.md,
  },
  deviceCol: {
    flex: 1,
    gap: 2,
  },
  deviceName: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  deviceMeta: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  bars: {
    color: colors.textPrimary,
    fontSize: 16,
    letterSpacing: 2,
  },
  errorText: {
    color: colors.warning,
    fontSize: 13,
  },
  actions: {
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
});
