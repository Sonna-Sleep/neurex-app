import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { HeadMovement as HeadMovementData, HeadMovementEpoch } from '../../../lib/repos';
import { Secondary } from '../../../theme/typography';
import {
  colors,
  headMovementColors,
  signalQualityColors,
  spacing,
  systemFontFamily,
} from '../../../theme/tokens';
import {
  axisTicks,
  headMovementChartEndMs,
  LABEL_W,
  makeXAt,
} from './timelineScale';
import {
  coverageGaps,
  formatDrift,
  formatShiftCount,
  formatStillest,
  movementToH,
  rawTiltExtent,
  tiltToY,
} from './headMovementHelpers';

type Props = {
  headMovement: HeadMovementData | null;
  startMs: number;
  endMs: number;
};

const HEIGHT = 220;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 22;
const LANE_GAP = 12;
const EDGE_CLEARANCE_PX = 56;
const EPOCH_MS = 30_000;
const LABELS = [
  { key: 'tilt', label: 'tilt' },
  { key: 'movement', label: 'move' },
] as const;
const EMPTY_EPOCHS: HeadMovementEpoch[] = [];

export function HeadMovement({ headMovement, startMs, endMs }: Props) {
  const [width, setWidth] = useState(0);
  const epochs = headMovement?.epochs ?? EMPTY_EPOCHS;
  const hasData = epochs.length > 0;
  const drawH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const laneH = (drawH - LANE_GAP) / 2;
  const tiltLaneTop = PADDING_TOP;
  const movementLaneTop = tiltLaneTop + laneH + LANE_GAP;
  const baselineY = PADDING_TOP + drawH;
  const axisY = baselineY + 15;
  const chartEndMs = useMemo(
    () => headMovementChartEndMs(epochs, startMs, endMs),
    [epochs, startMs, endMs],
  );
  const xAt = useMemo(
    () => makeXAt(startMs, chartEndMs, width),
    [startMs, chartEndMs, width],
  );
  const ticks = useMemo(() => axisTicks(startMs, chartEndMs), [startMs, chartEndMs]);
  const gaps = useMemo(() => coverageGaps(epochs, startMs), [epochs, startMs]);
  const maxAbsDeg = useMemo(() => rawTiltExtent(epochs), [epochs]);
  const pitchPath = useMemo(
    () =>
      buildTiltPath({
        epochs,
        xAt,
        startMs,
        laneTop: tiltLaneTop,
        laneH,
        maxAbsDeg,
        pickDeg: (epoch) => epoch.pitch,
      }),
    [epochs, laneH, maxAbsDeg, startMs, tiltLaneTop, xAt],
  );
  const rollPath = useMemo(
    () =>
      buildTiltPath({
        epochs,
        xAt,
        startMs,
        laneTop: tiltLaneTop,
        laneH,
        maxAbsDeg,
        pickDeg: (epoch) => epoch.roll,
      }),
    [epochs, laneH, maxAbsDeg, startMs, tiltLaneTop, xAt],
  );
  const insights = useMemo(() => {
    if (!headMovement || headMovement.epochs.length === 0) return [];

    return [
      formatStillest(headMovement.insights.stillestStretch),
      formatDrift(headMovement.insights.tiltDrift),
      formatShiftCount(headMovement.insights.shiftCount),
    ].filter(Boolean);
  }, [headMovement]);

  return (
    <View style={styles.container}>
      <View
        style={styles.chart}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {LABELS.map((item, index) => {
              const laneTop = index === 0 ? tiltLaneTop : movementLaneTop;
              return (
                <SvgText
                  key={item.key}
                  x={0}
                  y={laneTop + laneH / 2 + 3}
                  fontSize={10}
                  fontFamily={systemFontFamily}
                  fill={colors.textSecondary}
                  textAnchor="start"
                  fontWeight="600"
                >
                  {item.label}
                </SvgText>
              );
            })}

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

            <Line
              x1={LABEL_W}
              x2={width}
              y1={tiltLaneTop + laneH / 2}
              y2={tiltLaneTop + laneH / 2}
              stroke={colors.borderDivider}
              strokeWidth={1}
              opacity={0.6}
            />

            {gaps.map((gap, index) => {
              const x1 = xAt(gap.startMs);
              const x2 = xAt(gap.endMs);
              return (
                <Rect
                  key={`gap-${index}`}
                  x={x1}
                  y={movementLaneTop}
                  width={Math.max(x2 - x1, 0.75)}
                  height={laneH}
                  rx={2}
                  fill={signalQualityColors.noSignalFill}
                  opacity={0.78}
                />
              );
            })}

            {hasData
              ? epochs.map((epoch, index) => {
                  if (epoch.coverage === 0) return null;

                  const x1 = xAt(startMs + epoch.startMs);
                  const x2 = xAt(startMs + epoch.startMs + EPOCH_MS);
                  const barH = movementToH(epoch.movement, laneH);
                  return (
                    <Rect
                      key={`movement-${index}`}
                      x={x1}
                      y={movementLaneTop + laneH - barH}
                      width={Math.max(x2 - x1, 0.75)}
                      height={Math.max(barH, 1)}
                      rx={1.5}
                      fill={headMovementColors.movementFill}
                      opacity={0.95}
                    />
                  );
                })
              : null}

            {pitchPath ? (
              <Path
                d={pitchPath}
                fill="none"
                stroke={headMovementColors.pitch}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {rollPath ? (
              <Path
                d={rollPath}
                fill="none"
                stroke={headMovementColors.roll}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}

            {!hasData ? (
              <SvgText
                x={LABEL_W + (width - LABEL_W) / 2}
                y={PADDING_TOP + drawH / 2 + 4}
                fontSize={14}
                fontFamily={systemFontFamily}
                fill={signalQualityColors.noSignalText}
                textAnchor="middle"
                fontWeight="600"
              >
                No head-movement data for this night
              </SvgText>
            ) : null}

            <SvgText
              x={LABEL_W}
              y={axisY}
              fontSize={11}
              fontFamily={systemFontFamily}
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
              fontFamily={systemFontFamily}
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
                  x > LABEL_W + EDGE_CLEARANCE_PX &&
                  x < width - EDGE_CLEARANCE_PX,
              )
              .map(({ tick, x }) => (
                <SvgText
                  key={`axis-${tick.ms}`}
                  x={x}
                  y={axisY}
                  fontSize={11}
                  fontFamily={systemFontFamily}
                  fill={colors.textTertiary}
                  textAnchor="middle"
                  fontWeight="500"
                >
                  {tick.label}
                </SvgText>
              ))}
          </Svg>
        ) : null}
      </View>

      {insights.length > 0 ? (
        <View style={styles.insights}>
          {insights.map((line) => (
            <Secondary key={line} style={styles.insightText}>
              {line}
            </Secondary>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function buildTiltPath({
  epochs,
  xAt,
  startMs,
  laneTop,
  laneH,
  maxAbsDeg,
  pickDeg,
}: {
  epochs: HeadMovementEpoch[];
  xAt: (ms: number) => number;
  startMs: number;
  laneTop: number;
  laneH: number;
  maxAbsDeg: number;
  pickDeg: (epoch: HeadMovementEpoch) => number;
}) {
  const segments: string[] = [];
  let current: string[] = [];

  for (const epoch of epochs) {
    if (epoch.coverage === 0) {
      if (current.length > 0) {
        segments.push(current.join(' '));
        current = [];
      }
      continue;
    }

    const x = xAt(startMs + epoch.startMs);
    const y = tiltToY(pickDeg(epoch), laneTop, laneH, maxAbsDeg);
    current.push(`${current.length === 0 ? 'M' : 'L'} ${x} ${y}`);
  }

  if (current.length > 0) segments.push(current.join(' '));
  return segments.join(' ');
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
    gap: spacing.sm,
  },
  chart: {
    width: '100%',
    height: HEIGHT,
  },
  insights: {
    gap: spacing.xs,
  },
  insightText: {
    color: colors.textSecondary,
  },
});
