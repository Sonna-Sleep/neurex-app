import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import type { InsightPoint } from '../../../lib/repos';
import { colors, systemFontFamily } from '../../../theme/tokens';

type Props = {
  series: InsightPoint[];
  color?: string;
  unit: string;
  valueDigits?: number;
  durationSec: number;
};

const HEIGHT = 132;
const TOP = 14;
const BOTTOM = 22;

export function InteractiveLineChart({
  series,
  color = colors.accent,
  unit,
  valueDigits = 0,
  durationSec,
}: Props) {
  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const widthRef = useRef(0);
  const points = useMemo(
    () => series.filter((point) => Number.isFinite(point.offsetSec) && Number.isFinite(point.value)),
    [series],
  );
  const values = points.map((point) => point.value);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const rawSpan = maxValue - minValue;
  const verticalPadding = rawSpan > 0 ? rawSpan * 0.15 : Math.max(Math.abs(maxValue) * 0.05, 1);
  const plotMin = minValue - verticalPadding;
  const plotMax = maxValue + verticalPadding;
  const valueSpan = plotMax - plotMin;
  const chartDuration = Math.max(durationSec, points.at(-1)?.offsetSec ?? 1, 1);
  const plotHeight = HEIGHT - TOP - BOTTOM;

  const xFor = (offsetSec: number) => (offsetSec / chartDuration) * width;
  const yFor = (value: number) => TOP + ((plotMax - value) / valueSpan) * plotHeight;

  const selectAt = (x: number) => {
    if (!points.length || widthRef.current <= 0) return;
    const offset = Math.max(0, Math.min(1, x / widthRef.current)) * chartDuration;
    let nearest = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].offsetSec - offset) < Math.abs(points[nearest].offsetSec - offset)) {
        nearest = i;
      }
    }
    setSelectedIndex(nearest);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event) => selectAt(event.nativeEvent.locationX),
        onPanResponderMove: (event) => selectAt(event.nativeEvent.locationX),
      }),
    // selectAt intentionally closes over the current render's data and scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartDuration, points, width],
  );

  const selected = selectedIndex == null ? null : points[selectedIndex] ?? null;
  const selectedX = selected ? xFor(selected.offsetSec) : 0;
  const selectedY = selected ? yFor(selected.value) : 0;
  const summary = points.length
    ? `${minValue.toFixed(valueDigits)} to ${maxValue.toFixed(valueDigits)} ${unit}`
    : `No ${unit} readings`;

  return (
    <View>
      <View style={styles.readoutRow}>
        <Text style={styles.readout}>
          {selected ? `${selected.value.toFixed(valueDigits)} ${unit}` : summary}
        </Text>
        <Text style={styles.hint}>
          {selected ? formatOffset(selected.offsetSec) : 'Drag to explore'}
        </Text>
      </View>
      <View
        style={styles.chart}
        onLayout={(event) => {
          const nextWidth = event.nativeEvent.layout.width;
          widthRef.current = nextWidth;
          setWidth(nextWidth);
        }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Overnight trend, ${summary}`}
        {...panResponder.panHandlers}
      >
        {width > 0 && points.length > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {[0.25, 0.75].map((fraction) => (
              <Line
                key={fraction}
                x1={0}
                x2={width}
                y1={TOP + plotHeight * fraction}
                y2={TOP + plotHeight * fraction}
                stroke={colors.borderSubtle}
                strokeWidth={1}
              />
            ))}
            <Polyline
              points={points.map((point) => `${xFor(point.offsetSec)},${yFor(point.value)}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {selected ? (
              <>
                <Line
                  x1={selectedX}
                  x2={selectedX}
                  y1={TOP}
                  y2={HEIGHT - BOTTOM}
                  stroke={colors.textSecondary}
                  strokeWidth={1}
                  opacity={0.65}
                />
                <Circle cx={selectedX} cy={selectedY} r={5} fill={colors.bgSurface} stroke={color} strokeWidth={3} />
              </>
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axisRow} pointerEvents="none">
        <Text style={styles.axis}>Bedtime</Text>
        <Text style={styles.axis}>Wake</Text>
      </View>
    </View>
  );
}

function formatOffset(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes.toString().padStart(2, '0')}m in` : `${minutes}m in`;
}

const styles = StyleSheet.create({
  readoutRow: {
    minHeight: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  readout: {
    fontFamily: systemFontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  hint: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    color: colors.textTertiary,
  },
  chart: {
    height: HEIGHT,
    width: '100%',
  },
  axisRow: {
    marginTop: -BOTTOM,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axis: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    color: colors.textTertiary,
  },
});
