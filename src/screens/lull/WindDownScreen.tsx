// Wind-down — the full-screen Lull modal.
//
// Lull plays a sleep soundscape and fades its volume to silence as the user
// falls asleep, driven by the live EEG/EOG montage over BLE. This screen is the
// only UX surface: pick an audio sink (Spotify or the built-in soundscape),
// start the wind-down, watch a calm visualization of how asleep you are, and
// reach the terminal "asleep — muted" state when sleep onset latches.
//
// The screen owns the LullEngine lifecycle: it constructs an engine with the
// chosen sink on Start, drives `lullStore` from the engine's per-tick callback,
// and tears the engine down on Stop / unmount. The engine taps the live BLE
// stream via the engineTap registry — when no recording stream is running it
// simply never receives samples and W stays at its calibration value, which is
// surfaced honestly to the user.
//
// Reanimated drives the breathing visualization: the volume shared value scales
// and dims a soft halo so the screen visibly "quiets" as the music fades, all on
// the UI thread (babel-preset-expo wires the worklets plugin in managed Expo).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { SerifHeadline, Body, Secondary, Eyebrow } from '../../theme/typography';
import { colors, radii, spacing } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

import { useLull, type LullSink } from '../../lull/state/lullStore';
import { LullEngine } from '../../lull/engine/LullEngine';
import type { LullParams } from '../../lull/core/sleepiness';
import type { AudioSink } from '../../lull/audio/AudioSink';
import { SpotifySink } from '../../lull/audio/SpotifySink';
import { BundledSink } from '../../lull/audio/BundledSink';
import { authorize, isConnected } from '../../lull/audio/spotifyAuth';
import paramsJson from '../../lull/lull_params.json';

const params = paramsJson as unknown as LullParams;

type Props = NativeStackScreenProps<RootStackParamList, 'Lull'>;

/**
 * Build the chosen audio sink. Kept here (not in the engine) so the engine stays
 * sink-agnostic and the screen owns the user's sink choice. Spotify connection
 * is verified before constructing the Spotify sink — the caller gates Start on
 * `spotifyReady` so this only runs once authorized.
 */
function makeSink(sink: LullSink): AudioSink {
  return sink === 'spotify' ? new SpotifySink() : new BundledSink();
}

export function WindDownScreen({ navigation }: Props) {
  // ── Store-driven UI state ───────────────────────────────────────────────
  const phase = useLull((s) => s.phase);
  const W = useLull((s) => s.W);
  const volume = useLull((s) => s.volume);
  const sink = useLull((s) => s.sink);
  const setPhase = useLull((s) => s.setPhase);
  const setW = useLull((s) => s.setW);
  const setVolume = useLull((s) => s.setVolume);
  const setSink = useLull((s) => s.setSink);
  const reset = useLull((s) => s.reset);

  const [spotifyReady, setSpotifyReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The live engine for this session. A ref (not state) so reconstructing it
  // never triggers a render and `stop()` on unmount always sees the latest one.
  const engineRef = useRef<LullEngine | null>(null);

  const active = phase === 'calibrating' || phase === 'winddown';

  // Keep the screen + CPU awake only while a wind-down is running, so iOS/Android
  // don't suspend JS + BLE mid-session and stall the estimator. Released the
  // moment the session ends (stop / asleep / unmount). Same pattern as
  // RecordingCard's recording keep-awake.
  useEffect(() => {
    if (!active) return;
    const tag = 'lull-winddown';
    activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [active]);

  // On first mount, reflect whether Spotify is already connected so the picker
  // shows "Spotify" as ready vs "Connect Spotify".
  useEffect(() => {
    let alive = true;
    isConnected()
      .then((c) => {
        if (alive) setSpotifyReady(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Tear the engine down + reset transient store state whenever the screen
  // unmounts (user swipes the modal away or navigates back).
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
      reset();
    };
  }, [reset]);

  // ── Engine control ──────────────────────────────────────────────────────
  const onStart = useCallback(() => {
    if (active) return;
    setError(null);
    const audioSink = makeSink(sink);
    // fs defaults to params.fs_default (250 Hz, the device rate) — the engine
    // resolves `undefined` to that. The live Scale char isn't surfaced on the
    // session store today, so we run at the validated default sample rate.
    const engine = new LullEngine(params, audioSink, undefined, (tick) => {
      // Drive the store from the engine's per-tick callback. The estimator
      // returns W=1 during calibration; once it dips below the onset window the
      // volume ratchet starts fading and we move to wind-down. The first latched
      // onset is the terminal "asleep" cutoff (the engine mutes + stops).
      setW(tick.W);
      setVolume(tick.volume);
      // The store's setPhase takes a value (no functional form). The asleep
      // state is terminal; reading the store directly avoids a stale closure.
      if (tick.onset) {
        setPhase('asleep');
      } else if (useLull.getState().phase !== 'asleep') {
        setPhase(tick.tSec < params.calib_seconds ? 'calibrating' : 'winddown');
      }
    });
    engineRef.current = engine;
    engine.start();
    setPhase('calibrating');
  }, [active, sink, setW, setVolume, setPhase]);

  const onStop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    reset();
  }, [reset]);

  const onConnectSpotify = useCallback(async () => {
    setError(null);
    try {
      const tokens = await authorize();
      if (tokens) {
        setSink('spotify');
        setSpotifyReady(true);
      } else {
        setError('Spotify connection was cancelled.');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setSink]);

  const onClose = useCallback(() => {
    // Unmount cleanup stops the engine; just dismiss the modal.
    navigation.goBack();
  }, [navigation]);

  // ── Visualization (reanimated) ──────────────────────────────────────────
  // A soft halo whose scale + opacity track the current volume, with a slow
  // breathing pulse layered on top so the screen feels alive even while the
  // volume holds steady. As the music fades the halo shrinks and dims to near
  // nothing — a visible "winding down".
  const breath = useSharedValue(0);
  const vol = useSharedValue(volume);

  useEffect(() => {
    // Drive the shared volume value smoothly toward the store volume.
    vol.value = withTiming(volume, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [volume, vol]);

  useEffect(() => {
    // Continuous gentle breathing while active; rest when not.
    if (active) {
      breath.value = withRepeat(
        withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      breath.value = withTiming(0, { duration: 600 });
    }
  }, [active, breath]);

  const haloStyle = useAnimatedStyle(() => {
    // Volume in [0,1] maps to a 0.4–1.0 scale and 0.12–0.55 opacity; the breath
    // adds a small ±6% scale shimmer.
    const v = vol.value;
    const base = 0.4 + 0.6 * v;
    const shimmer = 1 + 0.06 * breath.value;
    return {
      transform: [{ scale: base * shimmer }],
      opacity: 0.12 + 0.43 * v,
    };
  });

  // ── Copy per phase ──────────────────────────────────────────────────────
  const wPct = Math.round(Math.max(0, Math.min(1, W)) * 100);
  const volPct = Math.round(Math.max(0, Math.min(1, volume)) * 100);

  const headline =
    phase === 'asleep'
      ? 'Asleep — muted'
      : phase === 'winddown'
        ? 'Winding down'
        : phase === 'calibrating'
          ? 'Calibrating'
          : 'Wind down';

  const sub =
    phase === 'asleep'
      ? 'Sleep onset detected. The music is muted — rest well.'
      : phase === 'winddown'
        ? 'Following your brain. The music fades as you drift off.'
        : phase === 'calibrating'
          ? 'Learning your awake baseline. Lie back and relax.'
          : 'Plays a calm soundscape and fades it to silence as you fall asleep.';

  const sinkLabel = sink === 'spotify' ? 'Spotify' : 'Built-in soundscape';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close wind down"
        >
          <Secondary style={styles.close}>Close</Secondary>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.vizWrap} accessibilityRole="image" accessibilityLabel="Calm visualization">
          <Animated.View style={[styles.halo, haloStyle]} />
          <View style={styles.coreDot} />
        </View>

        <Eyebrow style={styles.eyebrow}>{phase === 'asleep' ? 'Lull complete' : 'Lull'}</Eyebrow>
        <SerifHeadline style={styles.headline}>{headline}</SerifHeadline>
        <Body style={styles.sub}>{sub}</Body>

        {active ? (
          <View style={styles.metrics}>
            <Metric label="Awake" value={`${wPct}%`} />
            <Metric label="Volume" value={`${volPct}%`} />
          </View>
        ) : null}

        {error ? <Secondary style={styles.error}>{error}</Secondary> : null}
      </View>

      <View style={styles.controls}>
        {phase === 'idle' ? (
          <>
            <Eyebrow style={styles.pickerLabel}>Sound source</Eyebrow>
            <View style={styles.sinkRow}>
              <SinkChip
                label="Spotify"
                selected={sink === 'spotify'}
                onPress={() => (spotifyReady ? setSink('spotify') : onConnectSpotify())}
                badge={sink === 'spotify' ? undefined : spotifyReady ? undefined : 'Connect'}
              />
              <SinkChip
                label="Built-in"
                selected={sink === 'bundled'}
                onPress={() => setSink('bundled')}
              />
            </View>

            {sink === 'spotify' && !spotifyReady ? (
              <Button label="Connect Spotify" onPress={onConnectSpotify} variant="ghost" />
            ) : null}

            <Button label="Start wind down" onPress={onStart} />
            <Secondary style={styles.sinkHint}>Playing through {sinkLabel}.</Secondary>
          </>
        ) : phase === 'asleep' ? (
          <Button label="Done" onPress={onClose} />
        ) : (
          <Button label="Stop" onPress={onStop} variant="ghost" />
        )}
      </View>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Secondary style={styles.metricValue}>{value}</Secondary>
      <Eyebrow style={styles.metricLabel}>{label}</Eyebrow>
    </View>
  );
}

function SinkChip({
  label,
  selected,
  onPress,
  badge,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
    >
      <Body style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Body>
      {badge ? <Secondary style={styles.chipBadge}>{badge}</Secondary> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  close: {
    color: colors.textSecondary,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  vizWrap: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  halo: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.accent,
  },
  coreDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.textPrimary,
    opacity: 0.9,
  },
  eyebrow: {
    color: colors.textTertiary,
  },
  headline: {
    textAlign: 'center',
  },
  sub: {
    textAlign: 'center',
    color: colors.textSecondary,
    maxWidth: 320,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.xxl,
    marginTop: spacing.lg,
  },
  metric: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 26,
  },
  metricLabel: {
    color: colors.textTertiary,
  },
  error: {
    color: colors.warning,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  controls: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  pickerLabel: {
    color: colors.textTertiary,
    textAlign: 'center',
  },
  sinkRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  chip: {
    flex: 1,
    height: 56,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.borderDivider,
    backgroundColor: colors.bgElevated,
  },
  chipSelected: {
    borderColor: colors.textSecondary,
    backgroundColor: colors.bgSurface,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipLabel: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: colors.textPrimary,
  },
  chipBadge: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 14,
  },
  sinkHint: {
    textAlign: 'center',
    color: colors.textTertiary,
  },
});
