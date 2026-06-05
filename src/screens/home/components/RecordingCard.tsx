// Live-recording card on Home. Shows the in-progress stream when one is
// active, otherwise renders a "Start session" CTA when a device is paired.
// Owns the start/stop orchestration via streamController.
//
// 2026-06-01: LOCAL-ONLY recording for the Android full-night test. On stop
// the raw EEG.BIN / EOG.BIN stay on the phone (no cloud upload); the user
// gets a "share recording" button to pull the files off in the morning
// (Drive / email / USB). Cloud upload was removed from this flow.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body, Eyebrow, SerifHeadline, Secondary } from '../../../theme/typography';
import { colors, spacing, typeScale } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { startSession, stopSession } from '../../../lib/ble/streamController';
import { EEG_SAMPLE_RATE_HZ } from '../../../lib/ble/constants';
import { transmitSession, subscribeToResult } from '../../../lib/cloud/cloudSync';
import type { Session } from '../../../lib/repos/types';
import { SignalPreview } from './SignalPreview';

// Holds the just-finished local recording so the UI can offer a share button.
type SavedRecording = {
  sessionId: string;
  eegUri: string;
  eogUri: string;
  samples: number;
  durationSec: number;
  startedAtMs: number;
};

export function RecordingCard() {
  const streaming = useSession((s) => s.streaming);
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const pairedSerial = useSession((s) => s.pairedSerial);
  const setPaired = useSession((s) => s.setPaired);
  const deviceBattery = useSession((s) => s.deviceBattery);

  const [busy, setBusy] = useState<'idle' | 'starting' | 'stopping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  // Cloud sync of the just-finished recording (transmit → analyze → summary).
  const [sync, setSync] = useState<'idle' | 'uploading' | 'analyzing' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<Session | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubRef.current?.(), []);
  // Re-render once per second so the elapsed timer ticks even when no
  // packet arrives. Reading Date.now() inside render gives us live time.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [streaming]);

  // Keep the screen/CPU awake for the whole recording so Android doesn't
  // suspend JS + BLE mid-night. Released when the session ends. (Belt-and-
  // suspenders with the user keeping the phone plugged in / on.)
  useEffect(() => {
    if (!streaming) return;
    const tag = 'neurex-recording';
    activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [streaming]);

  const onStart = useCallback(async () => {
    if (!pairedDeviceId) {
      setError('Pair your headband first.');
      return;
    }
    setError(null);
    setBusy('starting');
    try {
      await startSession(pairedDeviceId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }, [pairedDeviceId]);

  const onUnpair = useCallback(() => {
    Alert.alert(
      'Forget this headband?',
      `${pairedSerial ?? 'The paired headband'} will be removed. You can pair again from Home.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => setPaired(null),
        },
      ],
    );
  }, [pairedSerial, setPaired]);

  const onStop = useCallback(async () => {
    setBusy('stopping');
    setError(null);
    try {
      const result = await stopSession();
      if (!result) return;
      // LOCAL-ONLY: no cloud upload. The raw EEG.BIN / EOG.BIN are already
      // written to the phone (documentDirectory/sessions/<id>/) and persist
      // across app restarts — safe for an overnight. Surface a share button
      // so the files can be pulled off in the morning.
      const elapsedSec =
        streaming != null
          ? Math.max(0, Math.floor((Date.now() - streaming.startedAtMs) / 1000))
          : 0;
      const startedAtMs = streaming?.startedAtMs ?? Date.now() - elapsedSec * 1000;
      setSaved({
        sessionId: result.sessionId,
        eegUri: result.eegUri,
        eogUri: result.eogUri,
        samples: result.stats.samples,
        durationSec: elapsedSec,
        startedAtMs,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }, [streaming]);

  const onShare = useCallback(async (uri: string) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError('Sharing is not available on this device.');
        return;
      }
      // Share one file at a time (Android share sheet → Drive / email / USB).
      await Sharing.shareAsync(uri, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Export recording',
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Ship the just-finished recording to the cloud: upload as segments, finalize
  // (→ webhook → YASA), delete the local copy, then live-subscribe for the
  // summary. On failure the local files are kept (transmitSession throws before
  // deleting), so nothing is lost.
  const onSyncToCloud = useCallback(async () => {
    if (!saved || sync === 'uploading' || sync === 'analyzing' || sync === 'done') return;
    setError(null);
    setSummary(null);
    setSync('uploading');
    try {
      await transmitSession({
        sessionId: saved.sessionId,
        startMs: saved.startedAtMs,
        endMs: saved.startedAtMs + saved.durationSec * 1000,
      });
      setSync('analyzing');
      unsubRef.current?.();
      unsubRef.current = subscribeToResult(saved.sessionId, (s) => {
        setSummary(s);
        setSync('done');
      });
    } catch (e) {
      setSync('error');
      setError((e as Error).message);
    }
  }, [saved, sync]);

  // ── Active recording ─────────────────────────────────────────────────────
  if (streaming) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - streaming.startedAtMs) / 1000));
    const realRateHz =
      elapsedSec > 0 ? Math.round(streaming.samples / elapsedSec) : 0;
    const lossPct =
      streaming.packets + streaming.drops > 0
        ? Math.round((streaming.drops / (streaming.packets + streaming.drops)) * 100)
        : 0;
    const connLabel =
      streaming.connection === 'connected'
        ? 'connected'
        : streaming.connection === 'reconnecting'
          ? 'reconnecting…'
          : 'connection lost';
    const isReconnecting = streaming.connection === 'reconnecting';
    return (
      <View style={styles.wrap}>
        <Eyebrow>recording · {connLabel}</Eyebrow>
        <Card style={styles.card}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.textSecondary} />
            <View style={styles.titleCol}>
              <SerifHeadline>Streaming from {pairedSerial ?? 'headband'}</SerifHeadline>
              <Body style={styles.subtext}>
                {isReconnecting
                  ? 'Reconnecting to your headband…'
                  : `${formatElapsed(elapsedSec)} elapsed`}
              </Body>
            </View>
          </View>

          <View style={styles.stats}>
            <Stat label="samples" value={streaming.samples.toLocaleString()} />
            <Stat
              label="rate"
              value={`${realRateHz} Hz`}
              hint={`target ${EEG_SAMPLE_RATE_HZ}`}
            />
            <Stat label="drops" value={`${streaming.drops}`} hint={`${lossPct}%`} />
            <Stat
              label="battery"
              value={deviceBattery !== null ? `${deviceBattery}%` : '—'}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={busy === 'stopping' ? 'saving…' : 'stop session'}
            variant="ghost"
            onPress={onStop}
            loading={busy === 'stopping'}
          />
        </Card>
      </View>
    );
  }

  // ── Just-finished local recording (saved on phone, offer share) ─────────
  if (saved) {
    const mins = Math.floor(saved.durationSec / 60);
    const secs = saved.durationSec % 60;
    return (
      <View style={styles.wrap}>
        <Eyebrow>recording · saved on phone</Eyebrow>
        <Card style={styles.card}>
          <SerifHeadline>Saved to this phone</SerifHeadline>
          <Body style={styles.subtext}>
            {saved.samples.toLocaleString()} samples
            {saved.durationSec > 0 ? ` · ${mins}m ${secs}s` : ''}. Raw EEG/EOG
            are stored on the device. Share them to Drive, email, or USB to pull
            the night off in the morning.
          </Body>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {sync === 'done' && summary ? (
            <View style={styles.stats}>
              <Stat label="score" value={summary.score != null ? `${summary.score}` : '—'} />
              <Stat label="deep" value={`${Math.round(summary.stageMinutes?.deep ?? 0)}m`} />
              <Stat label="rem" value={`${Math.round(summary.stageMinutes?.rem ?? 0)}m`} />
              <Stat label="light" value={`${Math.round(summary.stageMinutes?.light ?? 0)}m`} />
            </View>
          ) : null}

          <Button
            label={
              sync === 'uploading'
                ? 'uploading to cloud…'
                : sync === 'analyzing'
                  ? 'analyzing in cloud…'
                  : sync === 'done'
                    ? 'synced ✓'
                    : sync === 'error'
                      ? 'retry cloud sync'
                      : 'sync to cloud'
            }
            onPress={onSyncToCloud}
            loading={sync === 'uploading' || sync === 'analyzing'}
          />

          <Button label="share EEG.BIN" variant="ghost" onPress={() => onShare(saved.eegUri)} />
          <Button label="share EOG.BIN" variant="ghost" onPress={() => onShare(saved.eogUri)} />
          <Button
            label="done"
            variant="ghost"
            onPress={() => {
              unsubRef.current?.();
              unsubRef.current = null;
              setSaved(null);
              setError(null);
              setSync('idle');
              setSummary(null);
            }}
          />
        </Card>
      </View>
    );
  }

  // ── Idle (paired but not streaming) ──────────────────────────────────────
  if (!pairedDeviceId) return null;
  return (
    <View style={styles.wrap}>
      <Eyebrow>headband · paired</Eyebrow>
      <Card style={styles.card}>
        <SerifHeadline>Ready to record</SerifHeadline>
        <Body style={styles.subtext}>
          Put on the headband and tap Start. Keep the phone nearby through the
          night.
        </Body>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={busy === 'starting' ? 'connecting…' : 'start session'}
          onPress={onStart}
          loading={busy === 'starting'}
        />
        {pairedDeviceId ? <SignalPreview deviceId={pairedDeviceId} /> : null}
        <Button label="unpair" variant="ghost" onPress={onUnpair} />
      </Card>
    </View>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} allowFontScaling={false}>
        {value}
      </Text>
      <Secondary style={styles.statLabel}>{label}</Secondary>
      {hint ? <Secondary style={styles.statHint}>{hint}</Secondary> : null}
    </View>
  );
}

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
  titleCol: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  subtext: {
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    gap: spacing.xs,
  },
  statValue: {
    ...typeScale.statNumber,
    fontSize: 24,
  },
  statLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  statHint: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  error: {
    color: colors.warning,
    fontSize: 13,
  },
});
