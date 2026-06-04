// TEMPORARY two-person overnight recorder (Aleksas + Goda on one phone).
//
// 2026-06-01: self-contained section, deliberately separate from the main Home
// record flow so it can't disturb the proven single-device path. Scans for
// Neurex headbands, lets you START up to two independently, shows live per-
// device sample counts, and STOP each to its own EEG.BIN. Stopgap until the iOS
// app.
//
// 2026-06-04: each saved/recovered recording can now ALSO be synced to the
// cloud (→ YASA → sleep graph in History), not just shared off the phone. Each
// headband uploads as its own independent session via transmitLocalRecording
// (which mints a fresh uuid since dual folder ids are "<serial>_<uuid>").

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
import { transmitLocalRecording, subscribeToResult } from '../../lib/cloud/cloudSync';
import type { Session } from '../../lib/repos/types';

const SCAN_MS = 12000;
const KEEP_AWAKE_TAG = 'neurex-dual-record';
// Matches real.ts encoder — used to estimate a recording's duration (and thus
// its start time, for recovered sessions) from its sample count.
const SAMPLE_RATE_HZ = 250;

type SyncStatus = 'uploading' | 'analyzing' | 'done' | 'error';

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
  // Per-recording cloud sync, keyed by the local folder id (sessionId).
  const [syncState, setSyncState] = useState<Record<string, SyncStatus>>({});
  const [syncSummary, setSyncSummary] = useState<Record<string, Session>>({});
  const unsubsRef = useRef<(() => void)[]>([]);
  useEffect(() => () => unsubsRef.current.forEach((u) => u()), []);

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

  // Keep-awake whenever a device is recording OR a cloud upload is in flight —
  // a ~140 MB night shouldn't get throttled/killed if the screen sleeps mid-sync.
  const syncing = Object.values(syncState).some((v) => v === 'uploading' || v === 'analyzing');
  useEffect(() => {
    if (active.length > 0 || syncing) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  }, [active.length, syncing]);

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

  // Upload one recording to the cloud as its own session → YASA → sleep graph.
  // folderId is the on-disk session folder; startMs/endMs label/bound it.
  const onSync = useCallback(
    async (folderId: string, serial: string, startMs: number, endMs: number) => {
      const st = syncState[folderId];
      if (st === 'uploading' || st === 'analyzing' || st === 'done') return;
      setError(null);
      setSyncState((s) => ({ ...s, [folderId]: 'uploading' }));
      try {
        const cloudId = await transmitLocalRecording({ folderId, serial, startMs, endMs });
        setSyncState((s) => ({ ...s, [folderId]: 'analyzing' }));
        const unsub = subscribeToResult(cloudId, (sess) => {
          setSyncSummary((m) => ({ ...m, [folderId]: sess }));
          setSyncState((s) => ({ ...s, [folderId]: 'done' }));
        });
        unsubsRef.current.push(unsub);
      } catch (e) {
        setSyncState((s) => ({ ...s, [folderId]: 'error' }));
        setError(`${serial}: ${(e as Error).message}`);
      }
    },
    [syncState],
  );

  const syncLabel = (folderId: string): string => {
    switch (syncState[folderId]) {
      case 'uploading':
        return 'uploading to cloud…';
      case 'analyzing':
        return 'analyzing in cloud…';
      case 'done':
        return 'synced ✓';
      case 'error':
        return 'retry cloud sync';
      default:
        return 'sync to cloud';
    }
  };

  // Sync button + (once staged) a one-line summary, shared by saved + recovered.
  const renderSync = (folderId: string, serial: string, startMs: number, endMs: number) => {
    const st = syncState[folderId];
    const sum = syncSummary[folderId];
    return (
      <>
        <Button
          label={syncLabel(folderId)}
          onPress={() => onSync(folderId, serial, startMs, endMs)}
          loading={st === 'uploading' || st === 'analyzing'}
        />
        {st === 'done' && sum ? (
          <Secondary style={styles.subtext}>
            score {sum.score ?? '—'} · deep {Math.round(sum.stageMinutes?.deep ?? 0)}m · rem{' '}
            {Math.round(sum.stageMinutes?.rem ?? 0)}m · light{' '}
            {Math.round(sum.stageMinutes?.light ?? 0)}m
          </Secondary>
        ) : null}
      </>
    );
  };

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
          Keep the phone plugged in and on. In the morning, stop each — then sync
          to the cloud for a sleep graph, or share the raw file off the phone.
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

        {/* Saved sessions — sync to cloud for a graph, or share off the phone */}
        {saved.length > 0 ? (
          <View style={styles.savedBlock}>
            <Eyebrow>saved · sync for a sleep graph, or share to pull off</Eyebrow>
            {saved.map((s) => (
              <View key={s.sessionId} style={styles.savedRow}>
                <Body style={styles.deviceName}>
                  {s.serial} · {s.samples.toLocaleString()} samples
                </Body>
                {renderSync(
                  s.sessionId,
                  s.serial,
                  s.startedAtMs,
                  s.startedAtMs + (s.samples / SAMPLE_RATE_HZ) * 1000,
                )}
                <View style={styles.shareRow}>
                  <Button label="share EEG" variant="ghost" onPress={() => onShare(s.eegUri)} />
                  <Button label="EOG" variant="ghost" onPress={() => onShare(s.eogUri)} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Recovered from a dropped/crashed session (safety net) */}
        {recovered.length > 0 ? (
          <View style={styles.savedBlock}>
            <Eyebrow>recovered · sync for a sleep graph, or share to pull off</Eyebrow>
            {recovered.map((s) => {
              // No wall-clock start was captured for an orphaned session, so
              // anchor the end at "now" and back out the start from the sample
              // count. YASA stages from the signal, not the clock — this only
              // labels/bounds the session.
              const endMs = Date.now();
              const startMs = endMs - (s.samples / SAMPLE_RATE_HZ) * 1000;
              return (
                <View key={s.sessionId} style={styles.savedRow}>
                  <Body style={styles.deviceName}>
                    {s.serial} · {s.samples.toLocaleString()} samples
                  </Body>
                  {renderSync(s.sessionId, s.serial, startMs, endMs)}
                  <View style={styles.shareRow}>
                    <Button label="share EEG" variant="ghost" onPress={() => onShare(s.eegUri)} />
                    {s.eogUri ? (
                      <Button label="EOG" variant="ghost" onPress={() => onShare(s.eogUri!)} />
                    ) : null}
                  </View>
                </View>
              );
            })}
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
