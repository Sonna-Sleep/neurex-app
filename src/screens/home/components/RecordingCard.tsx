// Live-recording card on Sleep. Shows the in-progress stream when one is
// active, otherwise renders a richer "start recording" surface when paired.
// Owns the start/stop orchestration via streamController.
//
// On stop, the raw EEG.BIN is uploaded to Supabase Storage for staging. In dev,
// the local file can still be shared manually for diagnostics.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body, Eyebrow, SerifDisplay, SerifHeadline, Secondary } from '../../../theme/typography';
import { colors, radii, spacing, typeScale } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { startSession, stopSession } from '../../../lib/ble/streamController';
import { EEG_SAMPLE_RATE_HZ } from '../../../lib/ble/constants';
import { transmitSession, subscribeToResult } from '../../../lib/cloud/cloudSync';
import { handleNightReady } from '../../../lib/nights/onNightReady';
import type { Session } from '../../../lib/repos/types';

// Holds the just-finished local recording so the UI can offer a share button.
type SavedRecording = {
  sessionId: string;
  eegUri: string;
  samples: number;
  durationSec: number;
  startedAtMs: number;
  endMs: number;
  endedEarly?: boolean;
};

// Backend staging needs at least ten 30-second epochs.
const MIN_STAGING_SEC = 5 * 60;

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
  const [sync, setSync] = useState<'idle' | 'uploading' | 'analyzing' | 'slow' | 'done' | 'error'>(
    'idle',
  );
  const [summary, setSummary] = useState<Session | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubRef.current?.(), []);
  // Re-render once per second so the elapsed timer ticks even when no
  // packet arrives, while keeping render pure.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
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
      setError('Pair your Neurex device first.');
      return;
    }
    setError(null);
    setBusy('starting');
    try {
      await startSession(pairedDeviceId, pairedSerial);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }, [pairedDeviceId, pairedSerial]);

  const onForgetDevice = useCallback(() => {
    Alert.alert(
      'Forget this Neurex device?',
      `${pairedSerial ?? 'The paired Neurex device'} will be removed. You can pair again from Sleep.`,
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
      // The raw EEG.BIN is already written to the phone
      // (documentDirectory/sessions/<id>/) and persists across app restarts until
      // transmitSession confirms cloud upload + finalize.
      const sampleDurationSec = result.stats.samples / EEG_SAMPLE_RATE_HZ;
      const startedAtMs = streaming?.startedAtMs ?? Date.now() - Math.round(sampleDurationSec * 1000);
      const endMs = startedAtMs + Math.round(sampleDurationSec * 1000);
      const wallClockSec =
        streaming != null
          ? Math.max(0, (Date.now() - streaming.startedAtMs) / 1000)
          : sampleDurationSec;
      const endedEarly = wallClockSec - sampleDurationSec > 10 * 60;
      setSaved({
        sessionId: result.sessionId,
        eegUri: result.eegUri,
        samples: result.stats.samples,
        durationSec: Math.floor(sampleDurationSec),
        startedAtMs,
        endMs,
        endedEarly,
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
    if (saved.durationSec < MIN_STAGING_SEC) {
      setError('Record at least 5 minutes before syncing. This short recording is still saved on this phone.');
      return;
    }
    setError(null);
    setSummary(null);
    setSync('uploading');
    try {
      await transmitSession({
        sessionId: saved.sessionId,
        startMs: saved.startedAtMs,
        endMs: saved.endMs,
      });
      setSync('analyzing');
      unsubRef.current?.();
      unsubRef.current = subscribeToResult(
        saved.sessionId,
        (s) => {
          setSummary(s);
          setSync('done');
          // Notify + flag the night as new (no-op banner when foregrounded).
          handleNightReady(s);
        },
        {
          // Don't spin on "Analyzing…" forever if the backend never flips the
          // row to ready (flaky webhook). After this, switch to a reassuring
          // message — the scheduled reconcile + push still deliver the result.
          timeoutMs: 3 * 60_000,
          onSlow: () => setSync((cur) => (cur === 'analyzing' ? 'slow' : cur)),
          onFailed: (message) => {
            setSync('error');
            setError(message ?? 'Analysis failed. The raw recording is safely stored in cloud.');
          },
        },
      );
    } catch (e) {
      setSync('error');
      setError((e as Error).message);
    }
  }, [saved, sync]);

  // Auto-sync the moment a night is saved — no manual tap. Skipped (manual
  // button shown) for very short recordings because the backend needs at least
  // five minutes of EEG. onSyncToCloud guards re-entry, so this fires once.
  useEffect(() => {
    if (saved && sync === 'idle' && saved.durationSec >= MIN_STAGING_SEC) {
      // Intentional transition side-effect: once a recording becomes saved, start upload.
      onSyncToCloud();
    }
  }, [saved, sync, onSyncToCloud]);

  // ── Active recording ─────────────────────────────────────────────────────
  if (streaming) {
    const elapsedSec = Math.max(0, Math.floor((nowMs - streaming.startedAtMs) / 1000));
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
              <SerifHeadline>Recording from {pairedSerial ?? 'Neurex device'}</SerifHeadline>
              <Body style={styles.subtext}>
                {isReconnecting
                  ? 'Reconnecting to your Neurex device…'
                  : `${formatElapsed(elapsedSec)} elapsed`}
              </Body>
            </View>
          </View>

          {__DEV__ ? (
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
          ) : null}

          {streaming.error ? <Text style={styles.error}>{streaming.error}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={busy === 'stopping' ? 'Saving…' : streaming.error ? 'Save & stop' : 'Stop recording'}
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
    const syncing = sync === 'uploading' || sync === 'analyzing';
    const canStage = saved.durationSec >= MIN_STAGING_SEC;
    const eyebrow = syncing
      ? 'recording · syncing'
      : sync === 'slow'
        ? 'recording · still analyzing'
        : sync === 'done'
          ? 'recording · ready'
          : sync === 'error'
            ? 'recording · sync failed'
            : 'recording · saved on phone';
    const headline =
      sync === 'uploading'
        ? 'Uploading your night…'
        : sync === 'analyzing'
          ? 'Analyzing your night…'
          : sync === 'slow'
            ? 'Still analyzing…'
            : sync === 'done'
              ? 'Your night is ready'
              : sync === 'error'
                ? "Couldn't sync"
                : 'Night saved';
    const sub = syncing
      ? 'This usually takes under a minute.'
      : sync === 'slow'
        ? 'This one is taking a little longer — we’ll notify you when it’s ready. You can close the app.'
      : sync === 'done'
        ? 'Saved to your journal.'
        : canStage
          ? `Your recording is saved${saved.durationSec > 0 ? ` · ${mins}m ${secs}s` : ''}.`
          : `Your recording is saved · ${mins}m ${secs}s. Record at least 5 minutes to analyze.`;
    return (
      <View style={styles.wrap}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Card style={styles.card}>
          <SerifHeadline>{headline}</SerifHeadline>
          <Body style={styles.subtext}>{sub}</Body>
          {saved.endedEarly ? (
            <Secondary style={styles.subtext}>
              The headband stopped sending data earlier than expected — only the received data was saved.
            </Secondary>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {sync === 'done' && summary ? (
            <View style={styles.stats}>
              <Stat label="Score" value={summary.score != null ? `${summary.score}%` : '—'} />
              <Stat label="Deep" value={`${Math.round(summary.stageMinutes?.deep ?? 0)}m`} />
              <Stat label="REM" value={`${Math.round(summary.stageMinutes?.rem ?? 0)}m`} />
              <Stat label="Light" value={`${Math.round(summary.stageMinutes?.light ?? 0)}m`} />
            </View>
          ) : null}

          {syncing ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : sync === 'idle' && canStage ? (
            <Button label="Sync to cloud" onPress={onSyncToCloud} />
          ) : sync === 'error' && canStage ? (
            <Button label="Retry cloud sync" onPress={onSyncToCloud} />
          ) : null}

          {__DEV__ ? (
            <Button label="share EEG.BIN" variant="ghost" onPress={() => onShare(saved.eegUri)} />
          ) : null}
          <Button
            label="Done"
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

  // ── Idle (paired but not streaming) — quiet bedtime control surface ───────
  if (!pairedDeviceId) return null;
  const batteryLabel = deviceBattery !== null ? `${deviceBattery}%` : '—';
  return (
    <View style={styles.idle}>
      <View style={styles.idleMain}>
        <View style={styles.idleHead}>
          <Eyebrow>tonight</Eyebrow>
          <SerifDisplay style={styles.idleTitle}>Ready to record</SerifDisplay>
          <Secondary style={styles.idleSub}>
            Wear your Neurex device and keep your phone nearby.
          </Secondary>
        </View>

        <View style={styles.readinessPanel}>
          <ReadyRow label="Device" value={pairedSerial ?? 'Paired'} />
          <View style={styles.divider} />
          <ReadyRow label="Battery" value={batteryLabel} />
          <View style={styles.divider} />
          <ReadyRow label="Analysis" value="Records over 5 min can be staged" />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.bedtimeActions}>
        <Button
          label={busy === 'starting' ? 'Connecting…' : 'Start recording'}
          onPress={onStart}
          loading={busy === 'starting'}
        />
        <Pressable onPress={onForgetDevice} hitSlop={8} style={styles.unpair}>
          <Secondary style={styles.unpairText}>Forget device</Secondary>
        </Pressable>
      </View>
    </View>
  );
}

function ReadyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readyRow}>
      <Secondary style={styles.readyLabel}>{label}</Secondary>
      <Text style={styles.readyValue} numberOfLines={2}>
        {value}
      </Text>
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
  idle: {
    flexGrow: 1,
    justifyContent: 'space-between',
    alignItems: 'stretch',
    gap: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  idleMain: {
    gap: spacing.xl,
  },
  idleHead: {
    alignItems: 'flex-start',
    gap: spacing.md,
    maxWidth: 330,
  },
  idleTitle: {
    fontSize: 36,
    lineHeight: 41,
  },
  idleSub: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 23,
  },
  readinessPanel: {
    alignSelf: 'stretch',
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  readyRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  readyLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  readyValue: {
    flex: 1,
    textAlign: 'right',
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
  },
  bedtimeActions: {
    alignSelf: 'stretch',
    gap: spacing.lg,
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
  unpair: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  unpairText: {
    color: colors.textSecondary,
  },
});
