// Pre-bed signal check. Shown the moment the user taps "start session": it
// streams the live signal (no disk I/O) and gives ONE plain verdict — yellow
// "checking…" until contact/stability/signal/connection all hold for a few
// seconds, then green "you're all set — sleep well". A "start anyway" escape
// hatch means no one is ever trapped. The live waveform stays visible because
// seeing their own brainwave is the most reassuring confirmation of all.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Svg, { Polyline, Rect } from 'react-native-svg';

import { Button } from '../../../components/Button';
import { Body, Eyebrow, Secondary } from '../../../theme/typography';
import { colors, spacing, radii } from '../../../theme/tokens';
import { bleClient } from '../../../lib/ble';
import type { ConnectedDevice, PreviewHandle } from '../../../lib/ble/types';
import { EEG_SAMPLE_RATE_HZ } from '../../../lib/ble/constants';
import { SignalQualityTracker, type SignalQuality } from '../../../lib/ble/signalQuality';

const WINDOW_SAMPLES = EEG_SAMPLE_RATE_HZ * 2; // 2 s scrolling display window
const SMOOTH_WIN = 13; // cosmetic moving-average (~50 ms) — display only
const MIN_HALF_RANGE_UV = 12;
const PLOT_HEIGHT = 150;

type Phase = 'connecting' | 'streaming' | 'error';

type Props = {
  deviceId: string;
  /** Proceed to the real recording (green verdict, or "start anyway"). */
  onProceed: () => void;
  /** Back out of the check without recording. */
  onCancel: () => void;
};

function smoothWave(arr: number[], win: number): number[] {
  const n = arr.length;
  if (n < win) return arr;
  const half = Math.floor(win / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < n) {
        s += arr[j];
        c++;
      }
    }
    out[i] = s / c;
  }
  return out;
}

export function PreBedCheck({ deviceId, onProceed, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [samples, setSamples] = useState<number[]>([]);
  const [quality, setQuality] = useState<SignalQuality | null>(null);
  const [plotW, setPlotW] = useState(320);

  const deviceRef = useRef<ConnectedDevice | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const bufferRef = useRef<number[]>([]);
  const trackerRef = useRef(new SignalQualityTracker());
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
    let cancelled = false;
    (async () => {
      try {
        const device = await bleClient.connect(deviceId);
        if (cancelled) {
          await device.disconnect().catch(() => undefined);
          return;
        }
        deviceRef.current = device;
        const handle = await device.startPreview({
          onPacket: (pkt) => {
            trackerRef.current.pushSeq(pkt.seq);
            for (const s of pkt.samples) {
              trackerRef.current.pushSample(s.fpz_uV);
              bufferRef.current.push(s.fpz_uV);
              if (bufferRef.current.length > WINDOW_SAMPLES) bufferRef.current.shift();
            }
          },
          onError: (err) => {
            setErrorMsg(err.message);
            setPhase('error');
          },
        });
        handleRef.current = handle;
        setPhase('streaming');
        flushTimer.current = setInterval(() => {
          setSamples([...bufferRef.current]);
          setQuality(trackerRef.current.evaluate(Date.now()));
        }, 100);
      } catch (e) {
        if (!cancelled) {
          setErrorMsg((e as Error).message);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      void cleanup();
    };
  }, [deviceId, cleanup]);

  const ready = quality?.ready ?? false;
  const tip =
    phase === 'error'
      ? errorMsg ?? 'Connection lost'
      : phase === 'connecting'
        ? 'Connecting to your sleep mask…'
        : quality?.tip ?? 'Checking your signal…';
  const dotColor = ready ? colors.positive : phase === 'error' ? colors.danger : colors.warning;

  // Display pipeline (cosmetic): smooth → center → auto-scale to fill height.
  const wave = smoothWave(samples, SMOOTH_WIN);
  let mean = 0;
  for (const v of wave) mean += v;
  mean = wave.length ? mean / wave.length : 0;
  let halfRange = MIN_HALF_RANGE_UV;
  for (const v of wave) {
    const d = Math.abs(v - mean);
    if (d > halfRange) halfRange = d;
  }
  halfRange *= 1.15;
  const pad = 8;
  const usableH = PLOT_HEIGHT - pad * 2;
  const points = wave
    .map((uV, i) => {
      const x = (i / Math.max(1, wave.length - 1)) * plotW;
      const norm = (uV - mean) / halfRange;
      const y = PLOT_HEIGHT / 2 - norm * (usableH / 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <View style={styles.wrap}>
      <Eyebrow>{ready ? 'ready' : 'signal check'}</Eyebrow>
      <View
        style={styles.plotWrap}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0 && w !== plotW) setPlotW(w);
        }}
      >
        <Svg width={plotW} height={PLOT_HEIGHT}>
          <Rect x={0} y={0} width={plotW} height={PLOT_HEIGHT} fill={colors.bgSurface} rx={6} />
          <Polyline
            points={`0,${PLOT_HEIGHT / 2} ${plotW},${PLOT_HEIGHT / 2}`}
            fill="none"
            stroke={colors.textSecondary}
            strokeWidth={0.5}
            opacity={0.25}
          />
          {phase !== 'connecting' && wave.length > 1 ? (
            <Polyline
              points={points}
              fill="none"
              stroke={colors.textPrimary}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
        </Svg>
      </View>

      <View style={styles.statusRow}>
        {phase === 'connecting' ? (
          <ActivityIndicator color={colors.textSecondary} />
        ) : (
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        )}
        <Body style={[styles.status, { color: ready ? colors.textPrimary : colors.textSecondary }]}>
          {tip}
        </Body>
      </View>

      <View style={styles.actions}>
        {ready ? (
          <Button label="Start recording" onPress={onProceed} />
        ) : (
          <Button label="Start anyway" variant="ghost" onPress={onProceed} />
        )}
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
      {phase === 'error' ? (
        <Secondary style={styles.hint}>You can still start — the check is just a heads-up.</Secondary>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  plotWrap: {
    alignSelf: 'stretch',
    paddingVertical: spacing.xs,
    borderRadius: radii.small,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  status: {
    flexShrink: 1,
    fontSize: 16,
  },
  actions: {
    gap: spacing.sm,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: 12,
  },
});
