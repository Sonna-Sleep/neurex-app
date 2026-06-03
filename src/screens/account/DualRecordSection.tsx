// TEMPORARY two-person overnight recorder (Aleksas + Goda on one phone).
//
// 2026-06-01: self-contained section, deliberately separate from the main Home
// record flow so it can't disturb the proven single-device path. Scans for
// Neurex headbands, lets you START up to two independently, shows live per-
// device sample counts, and STOP+share each to its own EEG.BIN. Stopgap until
// the iOS app — local-only, no cloud.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Body, Eyebrow, SerifHeadline, Secondary } from '../../theme/typography';
import { colors, spacing } from '../../theme/tokens';
import { bleClient, type FoundDevice } from '../../lib/ble';
import {
  multiStart,
  multiStop,
  multiSnapshot,
  multiActiveCount,
  multiActiveSessionIds,
  type MultiStopResult,
} from '../../lib/ble/multiController';
import { listRecoverableSessions, type RecoveredSession } from '../../lib/ble/recovery';

const SCAN_MS = 12000;
const KEEP_AWAKE_TAG = 'neurex-dual-record';

type ActiveView = { deviceId: string; serial: string; samples: number; startedAtMs: number };

export function DualRecordSection() {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Record<string, FoundDevice>>({});
  const [active, setActive] = useState<ActiveView[]>([]);
  const [saved, setSaved] = useState<MultiStopResult[]>([]);
  const [recovered, setRecovered] = useState<RecoveredSession[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  // Poll the controller for live per-device sample counts while recording.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setActive(multiSnapshot()), 1000);
    return () => clearInterval(t);
  }, [open]);

  // Safety net: surface any orphaned session (a disconnect/crash left a partial
  // file the normal stop flow never showed). Re-scan on open and on start/stop.
  useEffect(() => {
    if (!open) {
      setRecovered([]);
      return;
    }
    const exclude = new Set<string>(multiActiveSessionIds());
    for (const s of saved) exclude.add(s.sessionId);
    setRecovered(listRecoverableSessions(exclude));
  }, [open, saved, active.length]);

  // Keep-awake whenever at least one device is recording.
  useEffect(() => {
    if (active.length > 0) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  }, [active.length]);

  const clearScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setScanning(false);
  }, []);

  const startScan = useCallback(() => {
    setError(null);
    setDevices({});
    setScanning(true);
    stopScanRef.current = bleClient.scan((found) => {
      setDevices((prev) => ({ ...prev, [found.deviceId]: found }));
    });
    setTimeout(clearScan, SCAN_MS);
  }, [clearScan]);

  const onStart = useCallback(async (d: FoundDevice) => {
    setBusy(d.deviceId);
    setError(null);
    try {
      await multiStart(d.deviceId, d.serial);
      setActive(multiSnapshot());
    } catch (e) {
      setError(`${d.serial}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const onStop = useCallback(async (deviceId: string) => {
    setBusy(deviceId);
    setError(null);
    try {
      const r = await multiStop(deviceId);
      if (r) setSaved((prev) => [r, ...prev]);
      setActive(multiSnapshot());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const onShare = useCallback(async (uri: string) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError('Sharing not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Export recording',
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  if (!open) {
    return (
      <View style={styles.wrap}>
        <Button
          label="dual record (2 headbands)"
          variant="ghost"
          onPress={() => setOpen(true)}
        />
      </View>
    );
  }

  const activeIds = new Set(active.map((a) => a.deviceId));
  const found = Object.values(devices).filter((d) => !activeIds.has(d.deviceId));

  return (
    <View style={styles.wrap}>
      <Eyebrow>dual record · {multiActiveCount()} recording</Eyebrow>
      <Card style={styles.card}>
        <SerifHeadline>Two-headband recording</SerifHeadline>
        <Body style={styles.subtext}>
          Start each headband below. Both record to this phone in separate files.
          Keep the phone plugged in and on. Stop + share each in the morning.
        </Body>

        {/* Active recordings */}
        {active.map((a) => {
          const sec = Math.max(0, Math.floor((Date.now() - a.startedAtMs) / 1000));
          const m = Math.floor(sec / 60);
          return (
            <View key={a.deviceId} style={styles.deviceRow}>
              <View style={styles.deviceInfo}>
                <Body style={styles.deviceName}>● {a.serial}</Body>
                <Secondary style={styles.subtext}>
                  {a.samples.toLocaleString()} samples · {m}m
                </Secondary>
              </View>
              <Button
                label={busy === a.deviceId ? '…' : 'stop'}
                variant="ghost"
                onPress={() => onStop(a.deviceId)}
              />
            </View>
          );
        })}

        {/* Discovered, not-yet-recording */}
        {found.map((d) => (
          <View key={d.deviceId} style={styles.deviceRow}>
            <View style={styles.deviceInfo}>
              <Body style={styles.deviceName}>{d.serial}</Body>
              <Secondary style={styles.subtext}>rssi {d.rssi}</Secondary>
            </View>
            <Button
              label={busy === d.deviceId ? 'starting…' : 'start'}
              onPress={() => onStart(d)}
            />
          </View>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={scanning ? 'scanning…' : 'scan for headbands'}
          variant="ghost"
          onPress={startScan}
          loading={scanning}
        />

        {/* Saved sessions ready to share */}
        {saved.length > 0 ? (
          <View style={styles.savedBlock}>
            <Eyebrow>saved · share to pull off the phone</Eyebrow>
            {saved.map((s) => (
              <View key={s.sessionId} style={styles.savedRow}>
                <Body style={styles.deviceName}>
                  {s.serial} · {s.samples.toLocaleString()} samples
                </Body>
                <View style={styles.shareRow}>
                  <Button label="share EEG" onPress={() => onShare(s.eegUri)} />
                  <Button
                    label="EOG"
                    variant="ghost"
                    onPress={() => onShare(s.eogUri)}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Recovered from a dropped/crashed session (safety net) */}
        {recovered.length > 0 ? (
          <View style={styles.savedBlock}>
            <Eyebrow>recovered · from a dropped session — share to pull off</Eyebrow>
            {recovered.map((s) => (
              <View key={s.sessionId} style={styles.savedRow}>
                <Body style={styles.deviceName}>
                  {s.serial} · {s.samples.toLocaleString()} samples
                </Body>
                <View style={styles.shareRow}>
                  <Button label="share EEG" onPress={() => onShare(s.eegUri)} />
                  {s.eogUri ? (
                    <Button label="EOG" variant="ghost" onPress={() => onShare(s.eogUri!)} />
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {active.length === 0 ? (
          <Button label="close" variant="ghost" onPress={() => setOpen(false)} />
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingVertical: spacing.sm },
  card: { gap: spacing.sm },
  subtext: { color: colors.textSecondary },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  deviceInfo: { flex: 1, gap: 2 },
  deviceName: { color: colors.textPrimary },
  error: { color: colors.warning, fontSize: 13 },
  savedBlock: { gap: spacing.sm, paddingTop: spacing.sm },
  savedRow: { gap: spacing.xs },
  shareRow: { flexDirection: 'row', gap: spacing.sm },
});
