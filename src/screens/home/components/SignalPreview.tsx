// Live signal-quality preview shown on Home before the user starts a real
// recording. Connects to the paired headband, streams ~62.5 Hz packets
// without writing to disk, and renders a 2-second scrolling Fpz waveform
// alongside two simple quality indicators:
//   - rail: % of samples hitting the ADS1299 clip rail (electrode lifted)
//   - hum:  rough 60 Hz strength via a 1-pole bandpass tracker
//
// Goal: let the user confirm electrodes are making good contact BEFORE
// committing to a 30-min recording.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Svg, { Polyline, Rect } from 'react-native-svg';

import { Button } from '../../../components/Button';
import { Body, Eyebrow, Secondary } from '../../../theme/typography';
import { colors, spacing, radii } from '../../../theme/tokens';
import { bleClient } from '../../../lib/ble';
import type { ConnectedDevice, PreviewHandle } from '../../../lib/ble/types';
import { EEG_SAMPLE_RATE_HZ, EEG_UV_PER_LSB } from '../../../lib/ble/constants';

// Number of samples in the scrolling window. 2 s × 250 Hz.
const WINDOW_SAMPLES = EEG_SAMPLE_RATE_HZ * 2;
// ADS1299 clip rail at gain 24, ±4.5 V ref → ±187 mV → ±187000 µV.
const RAIL_UV = (4.5 / 24) * 1e6;
// Display dimensions for the SVG plot.
const PLOT_WIDTH = 320;
const PLOT_HEIGHT = 80;
// Vertical scale: ±50 µV is a comfortable EEG window; clip anything beyond.
const PLOT_RANGE_UV = 50;

type PreviewState = 'idle' | 'connecting' | 'streaming' | 'error';

type Props = {
  deviceId: string;
};

export function SignalPreview({ deviceId }: Props) {
  const [state, setState] = useState<PreviewState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [samples, setSamples] = useState<number[]>([]);
  const [railPct, setRailPct] = useState(0);
  const [humStrength, setHumStrength] = useState(0);

  const deviceRef = useRef<ConnectedDevice | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  // Mutable ring buffer for the scroll display. We use a ref + flush every
  // ~100 ms to setState, instead of setState per packet, to avoid burning
  // re-renders at 62 Hz.
  const bufferRef = useRef<number[]>([]);
  const railCounterRef = useRef({ rail: 0, total: 0 });
  // 1-pole bandpass tracker for 60 Hz. dx/dt ≈ sample diff at 250 Hz.
  // We track the absolute difference between consecutive samples as a
  // proxy for high-frequency energy — works well enough as a hum hint
  // without pulling in a real FFT.
  const humRef = useRef({ acc: 0, n: 0 });
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(async () => {
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = null;
    try {
      await handleRef.current?.stop();
    } catch {
      /* ignore */
    }
    handleRef.current = null;
    try {
      await deviceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    deviceRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const start = useCallback(async () => {
    setErrorMsg(null);
    setSamples([]);
    bufferRef.current = [];
    railCounterRef.current = { rail: 0, total: 0 };
    humRef.current = { acc: 0, n: 0 };
    setState('connecting');
    try {
      const device = await bleClient.connect(deviceId);
      deviceRef.current = device;
      let prevSample: number | null = null;
      const handle = await device.startPreview({
        onPacket: (pkt) => {
          for (const s of pkt.samples) {
            bufferRef.current.push(s.fpz_uV);
            if (bufferRef.current.length > WINDOW_SAMPLES) {
              bufferRef.current.shift();
            }
            railCounterRef.current.total++;
            if (Math.abs(s.fpz_uV) >= RAIL_UV * 0.95) {
              railCounterRef.current.rail++;
            }
            if (prevSample !== null) {
              humRef.current.acc += Math.abs(s.fpz_uV - prevSample);
              humRef.current.n++;
            }
            prevSample = s.fpz_uV;
          }
        },
        onError: (err) => {
          setErrorMsg(err.message);
          setState('error');
        },
      });
      handleRef.current = handle;
      setState('streaming');
      flushTimer.current = setInterval(() => {
        setSamples([...bufferRef.current]);
        const c = railCounterRef.current;
        setRailPct(c.total > 0 ? Math.round((c.rail / c.total) * 100) : 0);
        const h = humRef.current;
        setHumStrength(h.n > 0 ? Math.round(h.acc / h.n) : 0);
      }, 100);
    } catch (e) {
      setErrorMsg((e as Error).message);
      setState('error');
    }
  }, [deviceId]);

  const stop = useCallback(async () => {
    await cleanup();
    setState('idle');
    setSamples([]);
    setRailPct(0);
    setHumStrength(0);
  }, [cleanup]);

  if (state === 'idle') {
    return (
      <View style={styles.idleRow}>
        <Button label="preview signal" variant="ghost" onPress={start} />
      </View>
    );
  }

  if (state === 'connecting') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={colors.textSecondary} />
        <Body style={styles.subtext}>Connecting for preview…</Body>
      </View>
    );
  }

  // streaming or error — render plot + indicators
  const points = samples
    .map((uV, i) => {
      const x = (i / Math.max(1, samples.length - 1)) * PLOT_WIDTH;
      const clamped = Math.max(-PLOT_RANGE_UV, Math.min(PLOT_RANGE_UV, uV));
      const y =
        PLOT_HEIGHT / 2 -
        (clamped / PLOT_RANGE_UV) * (PLOT_HEIGHT / 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const railColor =
    railPct < 5
      ? colors.textSecondary
      : railPct < 25
      ? colors.warning
      : colors.warning;
  const railLabel =
    railPct < 5 ? 'good contact' : railPct < 25 ? 'unstable' : 'electrode lifted';
  // Hum strength is in µV/sample; rough thresholds derived empirically from
  // dry-electrode benches: <5 = clean, 5-15 = some mains pickup, >15 = bad.
  const humLabel =
    humStrength < 5 ? 'clean' : humStrength < 15 ? '60 Hz hum' : 'high noise';
  const humColor =
    humStrength < 5
      ? colors.textSecondary
      : humStrength < 15
      ? colors.warning
      : colors.warning;

  return (
    <View style={styles.previewWrap}>
      <View style={styles.previewHeader}>
        <Eyebrow>signal preview · fpz</Eyebrow>
        <Secondary style={styles.subtext}>{samples.length} samples</Secondary>
      </View>
      <View style={styles.plotWrap}>
        <Svg width={PLOT_WIDTH} height={PLOT_HEIGHT}>
          <Rect
            x={0}
            y={0}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            fill={colors.bgSurface}
            rx={4}
          />
          {samples.length > 1 ? (
            <Polyline
              points={points}
              fill="none"
              stroke={colors.textPrimary}
              strokeWidth={1.2}
            />
          ) : null}
        </Svg>
      </View>
      <View style={styles.indicators}>
        <View style={styles.indicator}>
          <Secondary style={[styles.indicatorLabel, { color: railColor }]}>
            contact
          </Secondary>
          <Body style={{ color: railColor }}>{railLabel}</Body>
        </View>
        <View style={styles.indicator}>
          <Secondary style={[styles.indicatorLabel, { color: humColor }]}>
            noise
          </Secondary>
          <Body style={{ color: humColor }}>{humLabel}</Body>
        </View>
      </View>
      {errorMsg ? <Body style={styles.error}>{errorMsg}</Body> : null}
      <Button label="stop preview" variant="ghost" onPress={stop} />
    </View>
  );
}

const styles = StyleSheet.create({
  idleRow: {
    alignItems: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  subtext: {
    color: colors.textSecondary,
  },
  previewWrap: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  plotWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radii.small,
  },
  indicators: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  indicator: {
    flex: 1,
    gap: 2,
  },
  indicatorLabel: {
    fontSize: 11,
    letterSpacing: 0.4,
  },
  error: {
    color: colors.warning,
    fontSize: 13,
  },
});
