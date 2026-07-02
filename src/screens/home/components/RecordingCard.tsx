// Live-recording card on Sleep. Shows the in-progress stream when one is
// active, otherwise renders a richer "start recording" surface when paired.
// Owns the start/stop orchestration via streamController.
//
// On stop, RAW.BIN is handed to Supabase Storage for staging. In dev, the local
// raw file can still be shared manually.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body, SerifHeadline, Secondary } from '../../../theme/typography';
import { colors, spacing } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { startSession, stopSession } from '../../../lib/ble/streamController';
import { EEG_SAMPLE_RATE_HZ } from '../../../lib/ble/constants';
import { transmitSession } from '../../../lib/cloud/cloudSync';
import { MIN_STAGING_MIN, MIN_STAGING_SEC } from '../../../lib/cloud/recoveryMath';
import { exportRecordingBundle } from '../../../lib/files/recordingBundleExport';
import type { RootStackParamList } from '../../../navigation/types';

// Holds the just-finished local recording so the UI can offer a share button.
type SavedRecording = {
  sessionId: string;
  rawUri: string;
  samples: number;
  durationSec: number;
  startedAtMs: number;
  endMs: number;
  endedEarly?: boolean;
};

export function RecordingCard({ idleFooter }: { idleFooter?: React.ReactNode }) {
  const streaming = useSession((s) => s.streaming);
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const pairedSerial = useSession((s) => s.pairedSerial);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [busy, setBusy] = useState<'idle' | 'starting' | 'stopping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  // Cloud sync of the just-finished recording. This screen only reflects the
  // phone handoff (upload + sessions row finalize), not backend QC outcome.
  const [sync, setSync] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [exporting, setExporting] = useState(false);
  // Re-render once per second so the elapsed timer ticks even when no
  // packet arrives, while keeping render pure.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const streamingSessionId = streaming?.sessionId ?? null;
  useEffect(() => {
    if (!streamingSessionId) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [streamingSessionId]);

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

  const onStop = useCallback(async () => {
    setBusy('stopping');
    setError(null);
    try {
      const result = await stopSession();
      if (!result) return;
      // The local recording bytes are already written under
      // documentDirectory/sessions/<id>/ and persist across app restarts until
      // transmitSession confirms cloud upload + finalize.
      // Duration/endMs come from RECEIVED SAMPLES, not wall-clock: if the
      // device stops sending mid-night (brownout / contact loss) wall-clock
      // would overstate an 8-h "night" with minutes of real data. endedEarly
      // flags a large wall-clock-vs-data gap so the saved view can tell the user.
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
        rawUri: result.rawUri,
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

  const onExportBundle = useCallback(async () => {
    if (!saved || exporting) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError('Sharing is not available on this device.');
        return;
      }
      setExporting(true);
      setError(null);
      const bundle = await exportRecordingBundle(saved.sessionId);
      await Sharing.shareAsync(bundle.uri, {
        mimeType: 'application/zip',
        UTI: 'com.pkware.zip-archive',
        dialogTitle: 'Export recording bundle',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }, [saved, exporting]);

  // Ship the just-finished recording to the cloud: upload as segments, finalize
  // the sessions row, and delete the local copy only after cloud confirmation.
  // Backend QC runs after this handoff, but this control only answers the simple
  // question the user needs at End: did the recording upload safely?
  const onSyncToCloud = useCallback(async () => {
    if (!saved || sync === 'uploading' || sync === 'done') return;
    if (saved.durationSec < MIN_STAGING_SEC) {
      setError(
        `Record at least ${MIN_STAGING_MIN} minutes before syncing. This short recording is still saved on this phone.`,
      );
      return;
    }
    setError(null);
    setSync('uploading');
    try {
      await transmitSession({
        sessionId: saved.sessionId,
        startMs: saved.startedAtMs,
        endMs: saved.endMs,
      });
      setSync('done');
    } catch (e) {
      setSync('error');
      setError((e as Error).message);
    }
  }, [saved, sync]);

  // Auto-sync the moment a night is saved — no manual tap. Skipped (manual
  // button shown) for very short recordings because we only cloud-stage nights
  // long enough to produce useful analysis. onSyncToCloud guards re-entry, so
  // this fires once.
  useEffect(() => {
    if (saved && sync === 'idle' && saved.durationSec >= MIN_STAGING_SEC) {
      // Intentional transition side-effect: once a recording becomes saved, start upload.
      onSyncToCloud();
    }
  }, [saved, sync, onSyncToCloud]);

  // ── Active recording ─────────────────────────────────────────────────────
  if (streaming) {
    const elapsedSec = Math.max(0, Math.floor((nowMs - streaming.startedAtMs) / 1000));
    const recordedSec = Math.floor((streaming.samples ?? 0) / EEG_SAMPLE_RATE_HZ);
    const dataLagging = elapsedSec - recordedSec > 10 * 60;
    const isReconnecting = streaming.connection === 'reconnecting';
    const isLost = streaming.connection === 'lost';
    const waitingForDevice = isReconnecting || isLost;
    const statusTitle = isLost
      ? 'Device disconnected'
      : isReconnecting
        ? 'Trying to reconnect'
        : 'Device connected';
    const statusBody = isLost
      ? 'The app is still trying. Saved data stays on this phone.'
      : isReconnecting
        ? 'Recording will continue when Bluetooth comes back.'
        : 'Recording is active.';
    const bubbleLabel =
      busy === 'stopping'
        ? 'saving'
        : isLost
          ? 'disconnected'
          : isReconnecting
            ? 'reconnecting'
            : 'elapsed';
    return (
      <View style={styles.controlScreen}>
        <Pressable
          onPress={onStop}
          disabled={busy === 'stopping'}
          style={({ pressed }) => [
            styles.sessionBubble,
            styles.sessionBubbleActive,
            pressed && styles.bubblePressed,
            busy === 'stopping' && styles.bubbleDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
        >
          {busy === 'stopping' || waitingForDevice ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : null}
          <Text style={styles.elapsedValue}>{formatElapsed(elapsedSec)}</Text>
          <Text style={styles.elapsedLabel}>{bubbleLabel}</Text>
        </Pressable>

        <View style={styles.recordingStatus}>
          <Text style={styles.savedValue}>Saved on phone: {formatElapsed(recordedSec)}</Text>
          <View style={styles.connectionRow}>
            <View
              style={[
                styles.connectionDot,
                waitingForDevice ? styles.connectionDotWarning : styles.connectionDotOk,
              ]}
            />
            <Text style={styles.connectionTitle}>{statusTitle}</Text>
          </View>
          <Secondary style={styles.connectionBody}>{statusBody}</Secondary>
        </View>

        {streaming.error ? <Text style={styles.error}>{streaming.error}</Text> : null}
        {dataLagging ? (
          <Secondary style={styles.subtext}>
            The device is not sending enough EEG data. Keep the phone nearby and check the fit.
          </Secondary>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Just-finished local recording (saved on phone, offer share) ─────────
  if (saved) {
    const mins = Math.floor(saved.durationSec / 60);
    const secs = saved.durationSec % 60;
    const syncing = sync === 'uploading';
    const canStage = saved.durationSec >= MIN_STAGING_SEC;
    const headline =
      sync === 'uploading'
        ? 'Uploading your night…'
        : sync === 'done'
          ? 'Uploaded'
          : sync === 'error'
            ? "Couldn't upload"
            : 'Night saved';
    const sub = syncing
      ? 'Making sure your recording is stored safely.'
      : sync === 'done'
        ? 'Your recording is stored in cloud.'
      : canStage
        ? `Your recording is saved${saved.durationSec > 0 ? ` · ${mins}m ${secs}s` : ''}.`
        : `Your recording is saved · ${mins}m ${secs}s. Record at least ${MIN_STAGING_MIN} minutes to analyze.`;
    return (
      <View style={styles.wrap}>
        <Card style={styles.card}>
          <SerifHeadline>{headline}</SerifHeadline>
          <Body style={styles.subtext}>{sub}</Body>
          {saved.endedEarly ? (
            <Secondary style={styles.subtext}>
              The device stopped sending data earlier than expected — only the received data was saved.
            </Secondary>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {syncing ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : sync === 'idle' && canStage ? (
            <Button label="Sync to cloud" onPress={onSyncToCloud} />
          ) : sync === 'error' && canStage ? (
            <Button label="Retry cloud sync" onPress={onSyncToCloud} />
          ) : null}

          {sync !== 'done' && sync !== 'uploading' ? (
            <Button
              label={exporting ? 'Preparing export...' : 'Export recording'}
              variant="ghost"
              onPress={onExportBundle}
              disabled={exporting}
              loading={exporting}
            />
          ) : null}

          {__DEV__ ? (
            <Button label="Share raw file" variant="ghost" onPress={() => onShare(saved.rawUri)} />
          ) : null}
          <Button
            label="Done"
            variant="ghost"
            onPress={() => {
              setSaved(null);
              setError(null);
              setSync('idle');
              setExporting(false);
            }}
          />
        </Card>
      </View>
    );
  }

  // ── Idle (paired but not streaming) — quiet bedtime control surface ───────
  if (!pairedDeviceId) return null;
  return (
    <View style={styles.controlScreen}>
      <Pressable
        onPress={onStart}
        disabled={busy === 'starting'}
        style={({ pressed }) => [
          styles.sessionBubble,
          pressed && styles.bubblePressed,
          busy === 'starting' && styles.bubbleDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Start session"
      >
        {busy === 'starting' ? <ActivityIndicator color={colors.textPrimary} /> : null}
        <Text style={styles.startLabel}>{busy === 'starting' ? 'Connecting' : 'Start\nSession'}</Text>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Lull')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Wind down"
        style={({ pressed }) => [styles.windDownLink, pressed && styles.windDownLinkPressed]}
      >
        <Text style={styles.windDownLabel}>Wind down</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {idleFooter ? <View style={styles.idleFooter}>{idleFooter}</View> : null}
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
  subtext: {
    color: colors.textSecondary,
  },
  controlScreen: {
    flexGrow: 1,
    minHeight: 420,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  idleFooter: {
    width: '100%',
    alignItems: 'center',
  },
  sessionBubble: {
    width: 218,
    height: 218,
    borderRadius: 109,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderDivider,
    backgroundColor: colors.bgElevated,
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 8,
  },
  sessionBubbleActive: {
    borderColor: colors.textSecondary,
  },
  bubblePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  bubbleDisabled: {
    opacity: 0.7,
  },
  startLabel: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '500',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  elapsedValue: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '600',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  elapsedLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  recordingStatus: {
    width: '100%',
    maxWidth: 330,
    alignItems: 'center',
    gap: spacing.sm,
  },
  savedValue: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionDotOk: {
    backgroundColor: colors.positive,
  },
  connectionDotWarning: {
    backgroundColor: colors.warning,
  },
  connectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  connectionBody: {
    maxWidth: 330,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  error: {
    color: colors.warning,
    fontSize: 13,
  },
  diagRow: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.sm,
    letterSpacing: 0.3,
  },
  windDownLink: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  windDownLinkPressed: {
    opacity: 0.7,
  },
  windDownLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: colors.accent,
  },
});
