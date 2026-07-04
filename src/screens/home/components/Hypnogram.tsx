import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { colors, signalQualityColors, stageColors } from '../../../theme/tokens';
import type { CoreSleepStage, Epoch } from '../../../lib/repos';
import { collapseHypnogramRuns, isCoreSleepStage } from './hypnogramRuns';
import { axisTicks, LABEL_W, makeXAt, stagedEndMs } from './timelineScale';

type Props = {
  epochs: Epoch[];
  startMs: number;
  endMs: number;
};

const HEIGHT = 220;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 22; // space for the bottom time axis
const LANES: CoreSleepStage[] = ['wake', 'light', 'rem', 'deep'];
const LANE_LABEL: Record<CoreSleepStage, string> = {
  wake: 'WAKE',
  light: 'LIGHT',
  rem: 'REM',
  deep: 'DEEP',
};
// Hour labels nearer than this (in px) to either chart edge are dropped so
// they don't collide with the bed/wake labels anchored at the edges.
const EDGE_CLEARANCE_PX = 56;
const NO_SIGNAL_LABEL_MIN_W = 74;

export function Hypnogram({ epochs, startMs, endMs }: Props) {
  const [width, setWidth] = useState(0);
  const drawH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const chartEndMs = useMemo(() => stagedEndMs(epochs, startMs, endMs), [epochs, startMs, endMs]);
  const xAt = useMemo(
    () => makeXAt(startMs, chartEndMs, width),
    [startMs, chartEndMs, width],
  );
  const chartLeft = LABEL_W;

  // Each stage occupies a horizontal band; awake on top, deep at the bottom.
  const SLOT_H = drawH / LANES.length;
  const BAND_H = 20;
  const laneTop = (stage: CoreSleepStage) =>
    PADDING_TOP + LANES.indexOf(stage) * SLOT_H + (SLOT_H - BAND_H) / 2;
  const laneCenter = (stage: CoreSleepStage) => laneTop(stage) + BAND_H / 2;
  const baselineY = PADDING_TOP + drawH;
  const axisY = baselineY + 15;

  // Collapse epochs into contiguous runs, including no-signal gaps.
  const runs = useMemo(() => collapseHypnogramRuns(epochs), [epochs]);
  const ticks = useMemo(() => axisTicks(startMs, chartEndMs), [startMs, chartEndMs]);

  return (
    <View style={styles.container}>
      <View
        style={styles.chart}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {/* Left lane labels: Wake -> Light -> REM -> Deep. */}
          {LANES.map((stage) => (
            <SvgText
              key={`label-${stage}`}
              x={0}
              y={laneCenter(stage) + 3}
              fontSize={10}
              fill={colors.textSecondary}
              textAnchor="start"
              fontWeight="600"
            >
              {LANE_LABEL[stage]}
            </SvgText>
          ))}

          {/* Vertical hour gridlines */}
          {ticks.map((tick) => {
            const x = xAt(tick.ms);
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

          {/* No-signal blocks are data-quality gaps, not Wake. Draw them behind
              the sleep lanes so the missing signal is visible without becoming
              part of the stage breakdown. */}
          {runs.map((run, i) => {
            if (run.stage !== 'excluded') return null;
            const x1 = xAt(startMs + run.startMs);
            const x2 = xAt(startMs + run.startMs + run.durationMs);
            const w = Math.max(x2 - x1, 0.75);
            return (
              <React.Fragment key={`excluded-${i}`}>
                <Rect
                  x={x1}
                  y={PADDING_TOP}
                  width={w}
                  height={drawH}
                  rx={3}
                  fill={signalQualityColors.noSignalFill}
                  opacity={0.72}
                />
                {w >= NO_SIGNAL_LABEL_MIN_W ? (
                  <SvgText
                    x={x1 + w / 2}
                    y={PADDING_TOP + drawH / 2 + 4}
                    fontSize={9}
                    fill={signalQualityColors.noSignalText}
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    NO SIGNAL
                  </SvgText>
                ) : null}
              </React.Fragment>
            );
          })}

          {/* Stage bands only — the old vertical connector lines turned every
              rapid stage flip into a full-height streak, reading as a barcode.
              The bands alone make a clean, legible stage plot. */}
          {runs.map((run, i) => {
            if (!isCoreSleepStage(run.stage)) return null;
            // Epoch startMs is recording-relative (0-based, written by the
            // backend), so shift by the absolute session start before mapping —
            // otherwise bands land ~startMs off-screen and the chart looks empty.
            const x1 = xAt(startMs + run.startMs);
            const x2 = xAt(startMs + run.startMs + run.durationMs);
            return (
              <Rect
                key={i}
                x={x1}
                y={laneTop(run.stage)}
                width={Math.max(x2 - x1, 0.75)}
                height={BAND_H}
                rx={2}
                fill={stageColors[run.stage]}
              />
            );
          })}

          {/* Bottom time axis: staged EEG coverage at the edges, hours between. */}
          <SvgText
            x={chartLeft}
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
            {fmt(chartEndMs)}
          </SvgText>
          {ticks
            .map((tick) => ({ tick, x: xAt(tick.ms) }))
            .filter(
              ({ x }) =>
                x > chartLeft + EDGE_CLEARANCE_PX &&
                x < width - EDGE_CLEARANCE_PX,
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
    </View>
  );
}

function fmt(ms: number) {
  const d = new Date(ms);
  const h12 = ((d.getHours() + 11) % 12) + 1;
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  chart: {
    width: '100%',
    height: HEIGHT,
  },
});
