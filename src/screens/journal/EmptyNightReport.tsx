// Placeholder report shown when the selected day has no recording. Mirrors the
// real NightReport layout (score ring, in-bed/asleep, sleep-stages chart, stage
// breakdown, details) but blank — so tapping an empty day shows the familiar
// structure instead of a jarring one-liner. The chart area says "No recording".
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Eyebrow, Secondary } from '../../theme/typography';
import { colors, radii, signalQualityColors, spacing, systemFontFamily } from '../../theme/tokens';
import { ScoreRing } from '../../components/ScoreRing';
import { StageBreakdown } from '../home/components/StageBreakdown';
import { SleepAnalysisPreview } from './components/SleepAnalysis';

const LANE_LABELS = ['WAKE', 'LIGHT', 'REM', 'DEEP'];
const DETAILS = ['Went to bed', 'Woke up', 'Asleep after', 'Confidence'];

export function EmptyNightReport() {
  return (
    <View style={styles.report}>
      {/* Score ring + in-bed / asleep — all blank. */}
      <View style={styles.scoreRow}>
        <ScoreRing score={null} size={150} showLabel={false} />
        <View style={styles.stats}>
          <Stat label="In bed" />
          <Stat label="Asleep" />
        </View>
      </View>

      {/* Sleep-stages section: empty chart skeleton with lane labels. */}
      <View style={styles.section}>
        <Eyebrow>sleep stages</Eyebrow>
        <View style={styles.chartPlaceholder}>
          <View style={styles.laneLabels}>
            {LANE_LABELS.map((l) => (
              <Text key={l} style={styles.laneLabel}>
                {l}
              </Text>
            ))}
          </View>
          <View style={styles.chartEmpty}>
            <Text style={styles.noRecording}>No recording</Text>
          </View>
        </View>
      </View>

      {/* Stage breakdown — empty data renders every stage at 0m / 0%. */}
      <StageBreakdown stageMinutes={{}} />

      <SleepAnalysisPreview />

      {/* Details — all tiles blank. */}
      <View style={styles.section}>
        <Eyebrow>details</Eyebrow>
        <View style={styles.detailGrid}>
          {DETAILS.map((label) => (
            <DetailTile key={label} label={label} />
          ))}
        </View>
      </View>
    </View>
  );
}

function Stat({ label }: { label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>—</Text>
      <Secondary style={styles.statLabel}>{label}</Secondary>
    </View>
  );
}

function DetailTile({ label }: { label: string }) {
  return (
    <View style={styles.detailTile}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>—</Text>
    </View>
  );
}

// Metrics here intentionally mirror NightReport.tsx so a real night and an empty
// day share the exact same footprint and the layout never jumps when switching.
const styles = StyleSheet.create({
  report: {
    gap: spacing.xl,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  stats: {
    flex: 1,
    gap: spacing.lg,
  },
  stat: {
    gap: 2,
  },
  statValue: {
    fontFamily: systemFontFamily,
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.5,
    color: colors.textTertiary,
  },
  statLabel: {
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.md,
  },
  chartPlaceholder: {
    flexDirection: 'row',
    height: 200,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    overflow: 'hidden',
    paddingVertical: spacing.md,
    paddingLeft: spacing.sm,
  },
  laneLabels: {
    width: 40,
    justifyContent: 'space-between',
  },
  laneLabel: {
    fontFamily: systemFontFamily,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  chartEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noRecording: {
    fontFamily: systemFontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: signalQualityColors.noSignalText,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  detailTile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 76,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  detailValue: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  detailLabel: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.textTertiary,
  },
});
