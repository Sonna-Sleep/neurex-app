import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { colors, stageColors } from '../../../theme/tokens';
import type { Epoch, SleepStage } from '../../../lib/repos';

type Props = {
  epochs: Epoch[];
  startMs: number;
  endMs: number;
};

const HEIGHT = 220;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 22; // space for the bottom time axis
const LANES: SleepStage[] = ['wake', 'light', 'rem', 'deep'];
// Hour labels nearer than this (in px) to either chart edge are dropped so
// they don't collide with the bed/wake labels anchored at the edges.
const EDGE_CLEARANCE_PX = 56;

export function Hypnogram({ epochs, startMs, endMs }: Props) {
  const [width, setWidth] = useState(0);
  const drawH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const totalMs = endMs - startMs || 1;

  // Each stage occupies a horizontal band; wake on top, deep at the bottom.
  const SLOT_H = drawH / LANES.length;
  const BAND_H = 20;
  const laneTop = (stage: SleepStage) =>
    PADDING_TOP + LANES.indexOf(stage) * SLOT_H + (SLOT_H - BAND_H) / 2;
  const laneCenter = (stage: SleepStage) => laneTop(stage) + BAND_H / 2;
  const baselineY = PADDING_TOP + drawH;
  const axisY = baselineY + 15;

  // Collapse epochs into contiguous runs of the same stage.
  const runs = useMemo(() => collapseRuns(epochs), [epochs]);
  const ticks = useMemo(() => axisTicks(startMs, endMs), [startMs, endMs]);

  return (
    <View
      style={styles.chart}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {/* Vertical hour gridlines */}
          {ticks.map((tick) => {
            const x = ((tick.ms - startMs) / totalMs) * width;
            return (
              <Line
                key={tick.ms}
                x1={x}
                x2={x}
                y1={PADDING_TOP}
                y2={baselineY}
                stroke={colors.borderSubtle}
                strokeWidth={1}
                opacity={0.6}
              />
            );
          })}

          {/* Stepped stage bands with connectors between level changes */}
          {runs.map((run, i) => {
            const x1 = ((run.startMs - startMs) / totalMs) * width;
            const x2 =
              ((run.startMs + run.durationMs - startMs) / totalMs) * width;
            const next = runs[i + 1];
            return (
              <React.Fragment key={i}>
                <Rect
                  x={x1}
                  y={laneTop(run.stage)}
                  width={Math.max(x2 - x1, 0.75)}
                  height={BAND_H}
                  rx={2}
                  fill={stageColors[run.stage]}
                />
                {next && (
                  <Line
                    x1={x2}
                    x2={x2}
                    y1={laneCenter(run.stage)}
                    y2={laneCenter(next.stage)}
                    stroke={colors.textSecondary}
                    strokeWidth={1.5}
                    opacity={0.5}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* Bottom time axis: bedtime + waketime at the edges, hours between */}
          <SvgText
            x={0}
            y={axisY}
            fontSize={11}
            fill={colors.textSecondary}
            textAnchor="start"
            fontWeight="600"
          >
            {fmt(startMs)}
          </SvgText>
          <SvgText
            x={width}
            y={axisY}
            fontSize={11}
            fill={colors.textSecondary}
            textAnchor="end"
            fontWeight="600"
          >
            {fmt(endMs)}
          </SvgText>
          {ticks
            .map((tick) => ({
              tick,
              x: ((tick.ms - startMs) / totalMs) * width,
            }))
            .filter(
              ({ x }) =>
                x > EDGE_CLEARANCE_PX && x < width - EDGE_CLEARANCE_PX,
            )
            .map(({ tick, x }) => (
              <SvgText
                key={tick.ms}
                x={x}
                y={axisY}
                fontSize={11}
                fill={colors.textTertiary}
                textAnchor="middle"
                fontWeight="500"
              >
                {tick.label}
              </SvgText>
            ))}
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
  chart: {
    width: '100%',
    height: HEIGHT,
  },
});
