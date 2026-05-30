// Live-recording card on Home. Shows the in-progress stream when one is
// active, otherwise renders a "Start session" CTA when a device is paired.
// Owns the start/stop orchestration via streamController + triggers the
// upload pipeline once the user stops.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body, Eyebrow, SerifHeadline, Secondary } from '../../../theme/typography';
import { colors, spacing, typeScale } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { startSession, stopSession } from '../../../lib/ble/streamController';
import { uploadRecording } from '../../../lib/upload/uploadRecording';
import { EEG_SAMPLE_RATE_HZ } from '../../../lib/ble/constants';
import { SignalPreview } from './SignalPreview';

export function RecordingCard() {
  const streaming = useSession((s) => s.streaming);
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const pairedSerial = useSession((s) => s.pairedSerial);
  const setPaired = useSession((s) => s.setPaired);
  const setProcessingSessionId = useSession((s) => s.setProcessingSessionId);
  const deviceBattery = useSession((s) => s.deviceBattery);

  const [busy, setBusy] = useState<'idle' | 'starting' | 'stopping'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Re-render once per second so the elapsed timer ticks even when no
  // packet arrives. Reading Date.now() inside render gives us live time.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
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
      // Kick the upload. The Modal endpoint returns a server-assigned
      // session_id; we route the Home screen to its Processing state via
      // setProcessingSessionId so the user sees "Analyzing your night".
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const upload = await uploadRecording({
        eeg: { uri: result.eegUri, name: `${stamp}_EEG.BIN` },
        eog: { uri: result.eogUri, name: `${stamp}_EOG.BIN` },
      });
      setProcessingSessionId(upload.sessionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }, [setProcessingSessionId]);

  // ── Active recording ─────────────────────────────────────────────────────
  if (streaming) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - streaming.startedAtMs) / 1000));
    const realRateHz =
      elapsedSec > 0 ? Math.round(streaming.samples / elapsedSec) : 0;
    const lossPct =
      streaming.packets + streaming.drops > 0
        ? Math.round((streaming.drops / (streaming.packets + streaming.drops)) * 100)
        : 0;
    return (
      <View style={styles.wrap}>
        <Eyebrow>recording · {streaming.connection}</Eyebrow>
        <Card style={styles.card}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.textSecondary} />
            <View style={styles.titleCol}>
              <SerifHeadline>Streaming from {pairedSerial ?? 'headband'}</SerifHeadline>
              <Body style={styles.subtext}>{formatElapsed(elapsedSec)} elapsed</Body>
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
            label={busy === 'stopping' ? 'uploading…' : 'stop session'}
            variant="ghost"
            onPress={onStop}
            loading={busy === 'stopping'}
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
