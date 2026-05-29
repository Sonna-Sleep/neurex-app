// In-app "connect a device" card on the Home screen for when no headband
// is paired yet. Mirrors the permission/scan flow from Pair.tsx but renders
// inline so the user never leaves Home.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body, Eyebrow, SerifHeadline } from '../../../theme/typography';
import { colors, spacing } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { bleClient, type FoundDevice } from '../../../lib/ble';
import { getBleManager } from '../../../lib/ble/manager';
import {
  checkBleAvailability,
  openSettingsForBluetooth,
  requestAndroidBlePermissions,
} from '../../../lib/ble/permissions';

type CardState =
  | 'idle'
  | 'preflight'
  | 'permission-denied'
  | 'bluetooth-off'
  | 'unsupported'
  | 'scanning'
  | 'scan-timeout'
  | 'found'
  | 'pairing'
  | 'error';

const SCAN_TIMEOUT_MS = 15_000;

export function ConnectDeviceCard() {
  const setPaired = useSession((s) => s.setPaired);
  const [state, setState] = useState<CardState>('idle');
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

  useEffect(() => clearScan, [clearScan]);

  const beginScan = useCallback(async () => {
    clearScan();
    setDevice(null);
    setErrorMsg(null);
    setState('preflight');

    const granted = await requestAndroidBlePermissions();
    if (!granted) return setState('permission-denied');

    const manager = getBleManager();
    const avail = await checkBleAvailability(manager);
    if (avail.state === 'bluetooth-off') return setState('bluetooth-off');
    if (avail.state === 'unauthorized') return setState('permission-denied');
    if (avail.state === 'unsupported' || avail.state === 'unknown') {
      if (manager !== null) return setState('unsupported');
    }

    setState('scanning');
    stopScanRef.current = bleClient.scan((found) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setDevice(found);
      setState('found');
    });
    timeoutRef.current = setTimeout(() => {
      setState((s) => (s === 'scanning' ? 'scan-timeout' : s));
    }, SCAN_TIMEOUT_MS);
  }, [clearScan]);

  const confirm = async () => {
    if (!device) return;
    clearScan();
    setState('pairing');
    setErrorMsg(null);
    try {
      const connection = await bleClient.connect(device.deviceId);
      await connection.disconnect();
      setPaired(device.serial, device.deviceId);
      setState('idle');
      setDevice(null);
    } catch (e) {
      setErrorMsg((e as Error).message);
      setState('error');
    }
  };

  const cancel = () => {
    clearScan();
    setState('idle');
    setDevice(null);
    setErrorMsg(null);
  };

  if (state === 'idle') {
    return (
      <View style={styles.wrap}>
        <Eyebrow>no headband</Eyebrow>
        <Card style={styles.card}>
          <SerifHeadline>Connect a device</SerifHeadline>
          <Body style={styles.subtext}>
            Power on your headband and tap below to pair it with the app.
          </Body>
          <Button label="connect device" onPress={beginScan} />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Eyebrow>pairing</Eyebrow>
      <Card style={styles.card}>
        {(state === 'preflight' || state === 'scanning') ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.textSecondary} />
            <Body style={styles.subtext}>
              {state === 'preflight'
                ? 'Checking Bluetooth…'
                : 'Searching for your headband…'}
            </Body>
          </View>
        ) : null}

        {state === 'scan-timeout' ? (
          <Body style={styles.subtext}>
            Nothing yet. Make sure the headband is powered on and the button is
            held for 4 seconds.
          </Body>
        ) : null}

        {state === 'bluetooth-off' ? (
          <Body style={styles.subtext}>
            Bluetooth is off. Turn it on, then tap re-scan.
          </Body>
        ) : null}

        {state === 'permission-denied' ? (
          <Body style={styles.subtext}>
            Neurex needs Bluetooth permission to find your headband. Open
            Settings to grant it.
          </Body>
        ) : null}

        {state === 'unsupported' ? (
          <Body style={styles.subtext}>
            This device doesn't support Bluetooth LE.
          </Body>
        ) : null}

        {state === 'found' && device ? (
          <View style={styles.foundCol}>
            <Eyebrow>found</Eyebrow>
            <SerifHeadline>{device.serial}</SerifHeadline>
          </View>
        ) : null}

        {state === 'pairing' ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.textSecondary} />
            <Body style={styles.subtext}>Connecting…</Body>
          </View>
        ) : null}

        {state === 'error' && errorMsg ? (
          <View style={styles.foundCol}>
            <Eyebrow>connection failed</Eyebrow>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {state === 'found' ? (
            <Button label="confirm" onPress={confirm} />
          ) : null}

          {state === 'bluetooth-off' || state === 'permission-denied' ? (
            <Button label="open settings" onPress={openSettingsForBluetooth} />
          ) : null}

          {state === 'scan-timeout' ||
          state === 'error' ||
          state === 'bluetooth-off' ||
          state === 'permission-denied' ? (
            <Button label="re-scan" variant="ghost" onPress={beginScan} />
          ) : null}

          <Button label="cancel" variant="ghost" onPress={cancel} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  foundCol: {
    gap: spacing.sm,
  },
  subtext: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.warning,
    fontSize: 13,
  },
  actions: {
    gap: spacing.md,
  },
});
