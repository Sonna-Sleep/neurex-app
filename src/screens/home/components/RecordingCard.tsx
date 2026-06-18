// Live-recording card on Sleep. Shows the in-progress stream when one is
// active, otherwise renders a richer "start recording" surface when paired.
// Owns the start/stop orchestration via streamController.
//
// On stop, the raw EEG.BIN is uploaded to Supabase Storage for staging. In dev,
// the local file can still be shared manually for diagnostics.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Body, SerifHeadline, Secondary } from '../../../theme/typography';
import { colors, spacing, typeScale } from '../../../theme/tokens';
import { useSession } from '../../../state/session';
import { startSession, stopSession } from '../../../lib/ble/streamController';
import { EEG_SAMPLE_RATE_HZ } from '../../../lib/ble/constants';
import { transmitSession, subscribeToResult } from '../../../lib/cloud/cloudSync';
import { MIN_STAGING_MIN, MIN_STAGING_SEC } from '../../../lib/cloud/recoveryMath';
import { handleNightReady } from '../../../lib/nights/onNightReady';
import type { Session } from '../../../lib/repos/types';
import { useIsFocused } from '@react-navigation/native';
import { ContactRing, BAND_COLORS, BAND_LABEL } from './ContactRing';
import { useContactQuality } from '../../../lib/ble/useContactQuality';
import { startPreview, stopPreview } from '../../../lib/ble/contactPreview';

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

export function RecordingCard({ idleFooter }: { idleFooter?: React.ReactNode }) {
  const streaming = useSession((s) => s.streaming);
  const pairedDeviceId = useSession((s) => s.pairedDeviceId);
  const pairedSerial = useSession((s) => s.pairedSerial);
  const contact = useContactQuality();
  const focused = useIsFocused();
  const isStreaming = streaming != null;

  const [busy, setBusy] = useState<'idle' | 'starting' | 'stopping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  // Cloud sync of the just-finished recording (transmit → analyze → summary).
  const [sync, setSync] = useState<
    'idle' | 'uploading' | 'analyzing' | 'slow' | 'done' | 'error' | 'analysis-error'
  >('idle');
  const [summary, setSummary] = useState<Session | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubRef.current?.(), []);
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

  // Live contact preview: when the Sleep tab is focused, paired, and NOT recording,
  // connect a non-persisted preview so the ring glows by contact before Start. Stops
  // on blur / unpair / when recording begins (recording feeds the ring itself).
  useEffect(() => {
    if (!focused || !pairedDeviceId || isStreaming) {
      void stopPreview();
      return undefined;
    }
    void startPreview(pairedDeviceId);
    return () => {
      void stopPreview();
    };
  }, [focused, pairedDeviceId, isStreaming]);

  const onStart = useCallback(async () => {
    if (!pairedDeviceId) {
      setError('Pair your Neurex device first.');
      return;
    }
    setError(null);
    setBusy('starting');
    try {
      await stopPreview(); // release the preview BLE link before recording reconnects
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
      // The raw EEG.BIN is already written to the phone
      // (documentDirectory/sessions/<id>/) and persists across app restarts until
      // transmitSession confirms cloud upload + finalize.
      // Duration/endMs come from RECEIVED SAMPLES, not wall-clock: if the
      // headband stops sending mid-night (brownout / contact loss) wall-clock
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
  // summary. Upload/finalize errors keep the local files and can be retried;
  // backend analysis failures happen after cloud handoff, so there is no local
  // retry path to offer.
  const onSyncToCloud = useCallback(async () => {
    if (!saved || sync === 'uploading' || sync === 'analyzing' || sync === 'done') return;
    if (saved.durationSec < MIN_STAGING_SEC) {
      setError(
        `Record at least ${MIN_STAGING_MIN} minutes before syncing. This short recording is still saved on this phone.`,
      );
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
            setSync('analysis-error');
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
    const isReconnecting = streaming.connection === 'reconnecting';
    return (
      <View style={styles.controlScreen}>
        <ContactRing band={contact.band} active={contact.active}>
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
            {busy === 'stopping' || isReconnecting ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : null}
            <Text style={styles.elapsedValue}>{formatElapsed(elapsedSec)}</Text>
            <Text style={styles.elapsedLabel}>{busy === 'stopping' ? 'saving' : 'elapsed'}</Text>
          </Pressable>
        </ContactRing>

        {streaming.error ? <Text style={styles.error}>{streaming.error}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Just-finished local recording (saved on phone, offer share) ─────────
  if (saved) {
    const mins = Math.floor(saved.durationSec / 60);
    const secs = saved.durationSec % 60;
    const syncing = sync === 'uploading' || sync === 'analyzing';
    const canStage = saved.durationSec >= MIN_STAGING_SEC;
    const headline =
      sync === 'uploading'
        ? 'Uploading your night…'
        : sync === 'analyzing'
          ? 'Analyzing your night…'
          : sync === 'slow'
            ? 'Still analyzing…'
            : sync === 'done'
              ? 'Your night is ready'
              : sync === 'analysis-error'
                ? 'Analysis failed'
                : sync === 'error'
                  ? "Couldn't sync"
                  : 'Night saved';
    const sub = syncing
      ? 'This usually takes under a minute.'
      : sync === 'slow'
        ? 'This one is taking a little longer — we’ll notify you when it’s ready. You can close the app.'
      : sync === 'done'
        ? 'Saved to your journal.'
      : sync === 'analysis-error'
        ? 'The upload finished, but analysis failed. The raw recording is stored in cloud.'
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
  return (
    <View style={styles.controlScreen}>
      <ContactRing band={contact.band} active={contact.active}>
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
      </ContactRing>
      {contact.active ? (
        <Text style={[styles.contactLabel, { color: BAND_COLORS[contact.band] }]}>
          {BAND_LABEL[contact.band]}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {idleFooter ? <View style={styles.idleFooter}>{idleFooter}</View> : null}
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
  contactLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
