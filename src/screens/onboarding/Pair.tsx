import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

const HEADBAND = require('../../../assets/images/headband.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SerifDisplay, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
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
  | 'found'
  | 'pairing'
  | 'paired'
  | 'error';

const SCAN_TIMEOUT_MS = 15_000;

export function Pair({ navigation }: Props) {
  const setPaired = useSession((s) => s.setPaired);
  const [state, setState] = useState<PairState>('preflight');
  const [device, setDevice] = useState<FoundDevice | null>(null);
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
    setDevice(null);
    setErrorMsg(null);
    setState('preflight');

    // 1. Android 12+ runtime permission. On iOS this is a no-op; the system
    //    dialog fires the first time ble-plx asks the radio for something.
    const granted = await requestAndroidBlePermissions();
    if (!granted) {
      setState('permission-denied');
      return;
    }

    // 2. BleManager + radio state. In Expo Go the manager is null, which
    //    surfaces as 'unsupported' (no native module — stub mode).
    const manager = getBleManager();
    const avail = await checkBleAvailability(manager);
    if (avail.state === 'bluetooth-off') return setState('bluetooth-off');
    if (avail.state === 'unauthorized') return setState('permission-denied');
    if (avail.state === 'unsupported' || avail.state === 'unknown') {
      // Expo Go: stub client returns synthetic devices, so still let the
      // scan proceed in that case — the stub will hand us a fake device.
      if (manager !== null) return setState('unsupported');
    }

    // 3. Start the actual scan. Wrap onFound so a re-scan after timeout
    //    doesn't fire stale callbacks into the new state.
    setState('scanning');
    stopScanRef.current = bleClient.scan((found) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setDevice(found);
      setState('found');
    });

    timeoutRef.current = setTimeout(() => {
      // Still scanning, no device found — surface a re-scan affordance.
      setState((s) => (s === 'scanning' ? 'scan-timeout' : s));
    }, SCAN_TIMEOUT_MS);
  }, [clearScan]);

  useEffect(() => {
    void beginScan();
    return clearScan;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    if (!device) return;
    clearScan();
    setState('pairing');
    setErrorMsg(null);
    try {
      // Pairing happens implicitly on first connect — confirm reachability,
      // then drop the connection. The HomeScreen Start-session flow reconnects
      // using the persisted pairedDeviceId.
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Image
          source={HEADBAND}
          style={styles.deviceImage}
          resizeMode="contain"
        />

        <SerifDisplay style={styles.headline}>Pair your headband</SerifDisplay>
        <Body style={styles.subtext}>
          Hold the button on your headband for 4 seconds until the light pulses.
        </Body>

        <Card style={styles.card}>
          {(state === 'preflight' || state === 'scanning') ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>
                {state === 'preflight'
                  ? 'Checking Bluetooth…'
                  : 'Searching for your headband…'}
              </Body>
            </View>
          ) : null}

          {state === 'scan-timeout' ? (
            <View style={styles.foundCol}>
              <Eyebrow>nothing yet</Eyebrow>
              <Body style={styles.cardText}>
                Make sure the headband is powered on and the button is held
                for 4 seconds.
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
                Neurex needs Bluetooth permission to find your headband. Open
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

          {state === 'found' && device ? (
            <View style={styles.foundCol}>
              <Eyebrow>found</Eyebrow>
              <Body style={styles.deviceSerial}>{device.serial}</Body>
            </View>
          ) : null}

          {state === 'pairing' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.textSecondary} />
              <Body style={styles.cardText}>Connecting…</Body>
            </View>
          ) : null}

          {state === 'paired' ? (
            <View style={styles.foundCol}>
              <Eyebrow>connected</Eyebrow>
              <Body style={styles.deviceSerial}>{device?.serial}</Body>
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
          <Button
            label="re-scan"
            variant={
              state === 'bluetooth-off' || state === 'permission-denied'
                ? 'ghost'
                : undefined
            }
            onPress={beginScan}
          />
        ) : (
          <Button
            label="confirm"
            onPress={confirm}
            disabled={state !== 'found'}
            loading={state === 'pairing'}
          />
        )}
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
  deviceImage: {
    width: '100%',
    height: 180,
    marginBottom: spacing.xl,
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardText: {
    color: colors.textSecondary,
  },
  foundCol: {
    gap: spacing.sm,
  },
  deviceSerial: {
    fontSize: 18,
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
