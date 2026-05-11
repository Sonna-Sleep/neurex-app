import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { Eyebrow, Secondary } from '../../../theme/typography';
import { colors, spacing, stageColors, radii } from '../../../theme/tokens';
import type { Epoch, SleepStage, StimPulse } from '../../../lib/repos';

type Props = {
  epochs: Epoch[];
  stimPulses: StimPulse[];
  startMs: number;
  endMs: number;
};

const HEIGHT = 220;
const PADDING_TOP = 28; // space for axis labels
const PADDING_BOTTOM = 0;
const LANES: SleepStage[] = ['wake', 'rem', 'light', 'deep'];

export function Hypnogram({ epochs, stimPulses, startMs, endMs }: Props) {
  const [width, setWidth] = useState(0);
  const drawH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const totalMs = endMs - startMs || 1;

  // Stage levels: deep at bottom (highest "value"), wake at top.
  const laneY = (stage: SleepStage) => {
    const idx = LANES.indexOf(stage);
    return PADDING_TOP + (drawH * idx) / (LANES.length - 1);
  };
  const baselineY = PADDING_TOP + drawH;

  // Collapse epochs into contiguous runs of the same stage.
  const runs = useMemo(() => collapseRuns(epochs), [epochs]);
  const ticks = useMemo(() => axisTicks(startMs, endMs), [startMs, endMs]);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.chart}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {/* Vertical hour gridlines + labels */}
            {ticks.map((tick) => {
              const x = ((tick.ms - startMs) / totalMs) * width;
              return (
                <React.Fragment key={tick.ms}>
                  <Line
                    x1={x}
                    x2={x}
                    y1={PADDING_TOP - 6}
                    y2={baselineY}
                    stroke={colors.borderSubtle}
                    strokeWidth={1}
                    opacity={0.6}
                  />
                  <SvgText
                    x={x}
                    y={PADDING_TOP - 12}
                    fontSize={11}
                    fill={colors.textTertiary}
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    {tick.label}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* Filled stepped stage rectangles */}
            {runs.map((run, i) => {
              const x1 = ((run.startMs - startMs) / totalMs) * width;
              const x2 =
                ((run.startMs + run.durationMs - startMs) / totalMs) * width;
              const y = laneY(run.stage);
              return (
                <Rect
                  key={i}
                  x={x1}
                  y={y}
                  width={Math.max(x2 - x1, 0.5)}
                  height={baselineY - y}
                  fill={stageColors[run.stage]}
                />
              );
            })}
          </Svg>
        )}
      </View>

      {/* Bedtime / waketime chips */}
      <View style={styles.timeRow}>
        <View style={styles.timeChip}>
          <Secondary style={styles.timeText}>{fmt(startMs)}</Secondary>
        </View>
        <View style={styles.timeChip}>
          <Secondary style={styles.timeText}>{fmt(endMs)}</Secondary>
        </View>
      </View>

      {/* Boost (stim pulses) */}
      <View style={styles.boost}>
        <Eyebrow>boost</Eyebrow>
        <BoostTicks
          stimPulses={stimPulses}
          startMs={startMs}
          endMs={endMs}
        />
      </View>
    </View>
  );
}

function BoostTicks({
  stimPulses,
  startMs,
  endMs,
}: {
  stimPulses: StimPulse[];
  startMs: number;
  endMs: number;
}) {
  const [w, setW] = useState(0);
  const totalMs = endMs - startMs || 1;
  const H = 28;
  return (
    <View
      style={styles.boostTrack}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 && (
        <Svg width={w} height={H}>
          <Line
            x1={0}
            x2={w}
            y1={H - 1}
            y2={H - 1}
            stroke={colors.borderSubtle}
            strokeWidth={1}
          />
          {stimPulses.map((p, i) => {
            const x = ((p.tMs - startMs) / totalMs) * w;
            return (
              <Rect
                key={i}
                x={x}
                y={4}
                width={1.5}
                height={H - 8}
                fill={colors.textSecondary}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
}

function collapseRuns(epochs: Epoch[]) {
  const runs: { stage: SleepStage; startMs: number; durationMs: number }[] = [];
  for (const e of epochs) {
    const last = runs[runs.length - 1];
    if (last && last.stage === e.stage) {
      last.durationMs += e.durationSec * 1000;
    } else {
      runs.push({
        stage: e.stage,
        startMs: e.startMs,
        durationMs: e.durationSec * 1000,
      });
    }
  }
  return runs;
}

function axisTicks(startMs: number, endMs: number) {
  const ticks: { ms: number; label: string }[] = [];
  const start = new Date(startMs);
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  if (first.getHours() % 2 !== 0) first.setHours(first.getHours() + 1);
  if (first.getTime() < startMs) first.setHours(first.getHours() + 2);
  for (let t = first.getTime(); t <= endMs; t += 2 * 3600 * 1000) {
    const d = new Date(t);
    const h12 = ((d.getHours() + 11) % 12) + 1;
    const ampm = d.getHours() < 12 ? 'AM' : 'PM';
    ticks.push({ ms: t, label: `${h12} ${ampm}` });
  }
  return ticks;
}

function fmt(ms: number) {
  const d = new Date(ms);
  const h12 = ((d.getHours() + 11) % 12) + 1;
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  chart: {
    width: '100%',
    height: HEIGHT,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -spacing.sm,
  },
  timeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.small,
    backgroundColor: colors.bgSurface,
  },
  timeText: {
    color: colors.textPrimary,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  boost: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  boostTrack: {
    width: '100%',
    height: 28,
  },
});
