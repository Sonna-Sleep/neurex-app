// In-app "connect a device" card on the Sleep screen for when no Neurex device
// has been selected yet. Mirrors the permission/scan flow from Pair.tsx but renders
// inline so the user never leaves Sleep.
//
// Supports multiple Cerelogs in range — shows a live list sorted by signal
// strength (strongest first), so the user can pick the Neurex device they
// physically have in hand.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body } from '../../../theme/typography';
import { colors, radii, spacing } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { bleClient, type FoundDevice } from '../../../lib/ble';
import { getBleManager } from '../../../lib/ble/manager';
import {
  checkBleAvailability,
  openSettingsForBluetooth,
  requestAndroidBlePermissions,
} from '../../../lib/ble/permissions';

type CardState =
  | 'preflight'
  | 'permission-denied'
  | 'bluetooth-off'
  | 'unsupported'
  | 'scanning'
  | 'scan-timeout'
  | 'pairing'
  | 'error';

const SCAN_TIMEOUT_MS = 15_000;

function shortId(deviceId: string): string {
  // Android: full MAC like AA:BB:CC:DD:EE:FF — use last 5 chars (last 2 bytes).
  // iOS: opaque system UUID — last 5 still uniquely distinguishes 4 chips.
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

export function ConnectDeviceCard({
  onConnected,
}: {
  onConnected?: (device: FoundDevice) => void;
}) {
  const setPaired = useSession((s) => s.setPaired);
  const [state, setState] = useState<CardState>('preflight');
  const [devices, setDevices] = useState<Record<string, FoundDevice>>({});
  const [pairingId, setPairingId] = useState<string | null>(null);
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
    setErrorMsg(null);
    setState('preflight');

    const granted = await requestAndroidBlePermissions();
    if (!granted) return setState('permission-denied');

    const manager = getBleManager();
    const avail = await checkBleAvailability(manager);
    if (avail.state === 'bluetooth-off') return setState('bluetooth-off');
    if (avail.state === 'unauthorized') return setState('permission-denied');
    if (avail.state === 'unsupported' || avail.state === 'unknown') {
      return setState('unsupported');
    }

    setState('scanning');
    stopScanRef.current = bleClient.scan((found) => {
      setDevices((prev) => ({ ...prev, [found.deviceId]: found }));
    });
    timeoutRef.current = setTimeout(() => {
      // Only flip to scan-timeout if we still have no devices — otherwise
      // keep scanning so RSSI keeps updating in the list.
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

  const pickDevice = async (device: FoundDevice) => {
    clearScan();
    setPairingId(device.deviceId);
    setState('pairing');
    setErrorMsg(null);
    try {
      const connection = await bleClient.connect(device.deviceId);
      await connection.disconnect();
      setPaired(device.serial, device.deviceId);
      onConnected?.(device);
      setDevices({});
      setPairingId(null);
    } catch (e) {
      setErrorMsg((e as Error).message);
      setState('error');
      setPairingId(null);
    }
  };

  useEffect(() => {
    void beginScan();
    return clearScan;
  }, [beginScan, clearScan]);

  // Sorted strongest-signal-first so the Neurex device in your hand sits on top.
  const sortedDevices = useMemo(
    () => Object.values(devices).sort((a, b) => b.rssi - a.rssi),
    [devices],
  );

  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        {state === 'preflight' ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.textSecondary} />
            <Body style={styles.subtext}>Checking Bluetooth…</Body>
          </View>
        ) : null}

        {state === 'scanning' ? (
          <View style={styles.scanHeader}>
            <ActivityIndicator color={colors.textSecondary} />
            <Body style={styles.subtext}>
              {sortedDevices.length === 0
                ? 'Searching for your Neurex device…'
                : `Found ${sortedDevices.length}. Choose yours below.`}
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
          <Body style={styles.subtext}>
            Nothing yet. Make sure your Neurex device is on — press the button to turn it on.
          </Body>
        ) : null}

        {state === 'bluetooth-off' ? (
          <Body style={styles.subtext}>
            Bluetooth is off. Turn it on, then tap re-scan.
          </Body>
        ) : null}

        {state === 'permission-denied' ? (
          <Body style={styles.subtext}>
            Neurex needs Bluetooth permission to find your Neurex device. Open
            Settings to grant it.
          </Body>
        ) : null}

        {state === 'unsupported' ? (
          <Body style={styles.subtext}>
            Bluetooth LE isn't available in this app build or on this device.
          </Body>
        ) : null}

        {state === 'pairing' ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.textSecondary} />
            <Body style={styles.subtext}>
              Connecting{pairingId ? ` to …${shortId(pairingId)}` : ''}…
            </Body>
          </View>
        ) : null}

        {state === 'error' && errorMsg ? (
          <View style={styles.col}>
            <Body style={styles.statusTitle}>Connection failed</Body>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {state === 'bluetooth-off' || state === 'permission-denied' ? (
            <Button label="Open settings" onPress={openSettingsForBluetooth} />
          ) : null}

          {state === 'scan-timeout' ||
          state === 'error' ||
          state === 'bluetooth-off' ||
          state === 'permission-denied' ? (
            <Button label="Re-scan" variant="ghost" onPress={beginScan} />
          ) : null}
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
  col: {
    gap: spacing.sm,
  },
  subtext: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  statusTitle: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  scanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
    gap: spacing.md,
  },
});
