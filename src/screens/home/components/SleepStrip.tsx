import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { Secondary } from '../../../theme/typography';
import { colors, radii, spacing, stageColors } from '../../../theme/tokens';
import type { Epoch, SleepStage } from '../../../lib/repos';

type Props = {
  epochs: Epoch[];
  startMs: number;
  endMs: number;
};

// Free-tier hero visual: a single horizontal ribbon of colored stage segments
// across the night. Same data as the Pro Hypnogram but flat — "what happened
// tonight" at a glance, no Y-axis to parse. Spec §4 free-tier.
const HEIGHT = 36;

export function SleepStrip({ epochs, startMs, endMs }: Props) {
  const [width, setWidth] = useState(0);
  const totalMs = endMs - startMs || 1;
  const runs = useMemo(() => collapseRuns(epochs), [epochs]);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.chart}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {runs.map((run, i) => {
              const x1 = ((run.startMs - startMs) / totalMs) * width;
              const x2 =
                ((run.startMs + run.durationMs - startMs) / totalMs) * width;
              return (
                <Rect
                  key={i}
                  x={x1}
                  y={0}
                  width={Math.max(x2 - x1, 0.5)}
                  height={HEIGHT}
                  fill={stageColors[run.stage]}
                />
              );
            })}
          </Svg>
        )}
      </View>

      <View style={styles.timeRow}>
        <View style={styles.timeChip}>
          <Secondary style={styles.timeText}>{fmt(startMs)}</Secondary>
        </View>
        <View style={styles.timeChip}>
          <Secondary style={styles.timeText}>{fmt(endMs)}</Secondary>
        </View>
      </View>
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

function fmt(ms: number) {
  const d = new Date(ms);
  const h12 = ((d.getHours() + 11) % 12) + 1;
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  chart: {
    width: '100%',
    height: HEIGHT,
    borderRadius: radii.small,
    overflow: 'hidden',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
});
