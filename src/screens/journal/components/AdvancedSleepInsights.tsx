import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import Svg, { Line, Path } from 'react-native-svg';

import type { InsightMetric, InsightSensor, Session } from '../../../lib/repos';
import { exportRecordingBundle } from '../../../lib/files/recordingBundleExport';
import { Eyebrow, Secondary } from '../../../theme/typography';
import { colors, radii, spacing, systemFontFamily } from '../../../theme/tokens';
import { InteractiveLineChart } from './InteractiveLineChart';

type Props = { session: Session };
type EnvironmentKey = 'temperatureC' | 'co2Ppm' | 'humidityPercent';
type ExportState = 'idle' | 'working' | 'done' | 'error';

const SENSOR_LABEL: Record<InsightSensor, string> = {
  eeg: 'EEG',
  eog: 'EOG',
  imu: 'Motion',
  ppg: 'PPG',
  audio: 'Audio',
  environment: 'Room',
};

const EVENT_META = {
  pinkNoise: { label: 'Pink noise', color: '#9B7DE0' },
  windDownAudio: { label: 'Wind down', color: '#5FA8E8' },
  wakeLight: { label: 'Wake light', color: '#E0B560' },
  other: { label: 'Other', color: colors.textTertiary },
} as const;

const WINDOW_META = {
  morningLight: { label: 'Morning light', color: '#E0B560' },
  exercise: { label: 'Exercise', color: '#5FB89C' },
  lastMeal: { label: 'Finish eating', color: '#C9A77F' },
  screensOff: { label: 'Dim screens', color: '#9B7DE0' },
} as const;

export function AdvancedSleepInsights({ session }: Props) {
  return (
    <View style={styles.stack}>
      <SectionIntro
        eyebrow="experimental lab"
        title="Brain, context, and closed-loop response"
        body="Built for early data-mask testers. Every estimate keeps its source, coverage, and uncertainty visible."
      />
      <BrainCard session={session} />
      <ClosedLoopCard session={session} />
      <EnvironmentCard session={session} />
      <CircadianCard session={session} />
      <DataQualityCard session={session} />
    </View>
  );
}

export function AdvancedSleepPreview() {
  return (
    <View style={styles.stack}>
      <SectionIntro
        eyebrow="experimental lab"
        title="Brain, context, and closed-loop response"
        body="Advanced panels populate as Neurex learns from EEG, room sensors, and intervention events."
      />
      <Panel eyebrow="brain microstructure" title="Arousals, spindles, and slow waves">
        <StaticTabs labels={['Arousals', 'Spindles', 'Slow waves']} />
        <PlaceholderGraph label="Awaiting EEG microstructure analysis" color="#7C9CE0" />
      </Panel>
      <Panel eyebrow="closed loop" title="Did the intervention respond?">
        <EmptyInterventionTimeline />
      </Panel>
      <Panel eyebrow="environment" title="What changed your sleep?">
        <StaticTabs labels={['Temp', 'CO₂', 'Humidity']} />
        <PlaceholderGraph label="Awaiting room sensor data" color="#5FB89C" />
        <EmptyCorrelation />
      </Panel>
      <Panel eyebrow="circadian timing" title="Your estimated body clock">
        <EmptyCircadianTimeline />
      </Panel>
      <Panel eyebrow="data integrity" title="Know what to trust">
        <CoverageRow label="EEG" value={null} />
        <CoverageRow label="EOG" value={null} />
        <CoverageRow label="Motion" value={null} />
        <Secondary>Signal coverage, model version, and export controls appear with a completed recording.</Secondary>
      </Panel>
    </View>
  );
}

function BrainCard({ session }: Props) {
  const brain = session.insights?.brain;
  const options = useMemo(
    () => [
      {
        key: 'microArousals',
        label: 'Arousals',
        value: brain?.microArousals?.indexPerHour,
        unit: '/hour',
        series: brain?.microArousals?.series,
        color: '#D58D7B',
      },
      {
        key: 'spindles',
        label: 'Spindles',
        value: brain?.spindles?.densityPerMinute,
        unit: '/min',
        series: brain?.spindles?.series,
        color: '#7C9CE0',
      },
      {
        key: 'slowOscillations',
        label: 'Slow waves',
        value: brain?.slowOscillations?.densityPerMinute,
        unit: '/min',
        series: brain?.slowOscillations?.series ?? brain?.slowWaveActivity?.series,
        color: '#9B7DE0',
      },
    ],
    [brain],
  );
  const [selectedKey, setSelectedKey] = useState(options[0].key);
  const selected = options.find((option) => option.key === selectedKey) ?? options[0];
  const hasAny = options.some((option) => option.value != null || option.series?.length);

  return (
    <Panel eyebrow="brain microstructure" title="Arousals, spindles, and slow waves">
      <View style={styles.tabs}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => setSelectedKey(option.key)}
            style={[styles.tab, selected.key === option.key && styles.tabSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: selected.key === option.key }}
          >
            <Text style={[styles.tabText, selected.key === option.key && styles.tabTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {hasAny ? (
        <>
          <MetricHero value={selected.value} unit={selected.unit} />
          {selected.series?.length ? (
            <InteractiveLineChart
              series={selected.series}
              unit={selected.unit}
              color={selected.color}
              valueDigits={1}
              durationSec={session.tib * 60}
            />
          ) : (
            <PlaceholderGraph label={`${selected.label} time series unavailable`} color={selected.color} />
          )}
        </>
      ) : (
        <PlaceholderGraph label="Awaiting EEG microstructure analysis" color={selected.color} />
      )}
      <Secondary>
        Experimental EEG features. Density and arousal estimates are most useful as personal trends, not standalone clinical findings.
      </Secondary>
    </Panel>
  );
}

function ClosedLoopCard({ session }: Props) {
  const closedLoop = session.insights?.closedLoop;
  const events = closedLoop?.events ?? [];
  const hasData =
    events.length > 0 ||
    closedLoop?.deepSleepStimulations != null ||
    closedLoop?.acceptedStimulations != null ||
    closedLoop?.slowWaveDeltaPercent != null;
  return (
    <Panel eyebrow="closed loop" title="Did the intervention respond?">
      {hasData ? (
        <>
          <View style={styles.metricGrid}>
            <SmallMetric label="Stimulations" value={formatCount(closedLoop?.deepSleepStimulations)} />
            <SmallMetric label="Accepted" value={formatCount(closedLoop?.acceptedStimulations)} />
            <SmallMetric
              label="Slow-wave response"
              value={
                closedLoop?.slowWaveDeltaPercent == null
                  ? '—'
                  : `${closedLoop.slowWaveDeltaPercent >= 0 ? '+' : ''}${closedLoop.slowWaveDeltaPercent.toFixed(1)}%`
              }
            />
          </View>
          <InterventionTimeline events={events} durationSec={session.tib * 60} />
        </>
      ) : (
        <EmptyInterventionTimeline />
      )}
      <Secondary>
        Intervention markers show when Neurex acted. Response values require a controlled baseline and should not be interpreted as causal from one night.
      </Secondary>
    </Panel>
  );
}

function EnvironmentCard({ session }: Props) {
  const environment = session.insights?.environment;
  const options = useMemo(
    () => [
      { key: 'temperatureC' as const, label: 'Temp', unit: '°C', digits: 1, color: '#D58D7B' },
      { key: 'co2Ppm' as const, label: 'CO₂', unit: 'ppm', digits: 0, color: '#5FB89C' },
      { key: 'humidityPercent' as const, label: 'Humidity', unit: '%', digits: 0, color: '#5FA8E8' },
    ],
    [],
  );
  const [selectedKey, setSelectedKey] = useState<EnvironmentKey>('temperatureC');
  const selected = options.find((option) => option.key === selectedKey) ?? options[0];
  const metric = environment?.[selected.key] as InsightMetric | undefined;
  const correlations = environment?.correlations ?? [];

  return (
    <Panel eyebrow="environment" title="What changed your sleep?">
      <View style={styles.tabs}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => setSelectedKey(option.key)}
            style={[styles.tab, selected.key === option.key && styles.tabSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: selected.key === option.key }}
          >
            <Text style={[styles.tabText, selected.key === option.key && styles.tabTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {metric ? (
        <>
          <MetricHero value={metricAverage(metric)} unit={selected.unit} digits={selected.digits} />
          {metric.series?.length ? (
            <InteractiveLineChart
              series={metric.series}
              unit={selected.unit}
              color={selected.color}
              valueDigits={selected.digits}
              durationSec={session.tib * 60}
            />
          ) : (
            <PlaceholderGraph label={`${selected.label} time series unavailable`} color={selected.color} />
          )}
        </>
      ) : (
        <PlaceholderGraph label="Awaiting room sensor data" color={selected.color} />
      )}
      <View style={styles.divider} />
      <View style={styles.subheadRow}>
        <Text style={styles.subhead}>Personal correlations</Text>
        <Text style={styles.subtleLabel}>{correlations.length ? `${correlations.length} found` : '7+ nights'}</Text>
      </View>
      {correlations.length ? correlations.map((item) => <CorrelationRow key={`${item.factor}-${item.outcome}`} {...item} />) : <EmptyCorrelation />}
      <Secondary>Correlations show association, not causation. Sample size stays visible so early noisy results are easy to spot.</Secondary>
    </Panel>
  );
}

function CircadianCard({ session }: Props) {
  const circadian = session.insights?.circadian;
  const hasEstimate = circadian?.estimatedDlmoMs != null;
  return (
    <Panel eyebrow="circadian timing" title="Your estimated body clock">
      {hasEstimate ? (
        <>
          <View style={styles.circadianHero}>
            <View>
              <Text style={styles.heroValue}>{formatClock(circadian.estimatedDlmoMs!)}</Text>
              <Secondary>estimated melatonin-onset proxy</Secondary>
            </View>
            <View style={styles.confidenceBadge}>
              <Text style={styles.confidenceValue}>{circadian.confidence == null ? '—' : `${Math.round(circadian.confidence * 100)}%`}</Text>
              <Text style={styles.confidenceLabel}>confidence</Text>
            </View>
          </View>
          <CircadianTimeline
            estimatedMs={circadian.estimatedDlmoMs!}
            uncertaintyMinutes={circadian.uncertaintyMinutes ?? 60}
          />
          {circadian.timingWindows?.length ? (
            <View style={styles.windowList}>
              {circadian.timingWindows.map((window) => {
                const meta = WINDOW_META[window.kind];
                return (
                  <View key={`${window.kind}-${window.startMs}`} style={styles.windowRow}>
                    <View style={[styles.windowDot, { backgroundColor: meta.color }]} />
                    <View style={styles.windowCopy}>
                      <Text style={styles.windowLabel}>{window.label ?? meta.label}</Text>
                      <Text style={styles.windowTime}>{formatWindow(window.startMs, window.endMs)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      ) : (
        <EmptyCircadianTimeline />
      )}
      <Secondary>
        This is a wearable-derived phase estimate with uncertainty—not a laboratory DLMO measurement. Timing guidance appears only when confidence is sufficient.
      </Secondary>
    </Panel>
  );
}

function DataQualityCard({ session }: Props) {
  const quality = session.insights?.quality;
  const inferredEegCoverage = session.tib > 0 ? Math.max(0, 100 - (session.excludedMinutes / session.tib) * 100) : null;
  const coverage: Partial<Record<InsightSensor, number>> = {
    ...(inferredEegCoverage != null ? { eeg: inferredEegCoverage } : {}),
    ...quality?.sensorCoverage,
  };
  const sensors = (Object.keys(coverage) as InsightSensor[]).filter((sensor) => coverage[sensor] != null);
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportError, setExportError] = useState<string | null>(null);

  const exportData = async () => {
    if (exportState === 'working') return;
    setExportState('working');
    setExportError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      const bundle = await exportRecordingBundle(session.id);
      await Sharing.shareAsync(bundle.uri, {
        mimeType: 'application/zip',
        dialogTitle: 'Export Neurex recording data',
      });
      setExportState('done');
    } catch (error) {
      setExportState('error');
      const detail = error instanceof Error ? error.message : 'Export failed.';
      setExportError(detail.includes('not found') || detail.includes('empty') ? 'Raw files are no longer stored on this phone.' : detail);
    }
  };

  return (
    <Panel eyebrow="data integrity" title="Know what to trust">
      <View style={styles.qualityHero}>
        <View>
          <Text style={styles.heroValue}>{quality?.usableSignalPercent == null ? `${Math.round(inferredEegCoverage ?? 0)}%` : `${Math.round(quality.usableSignalPercent)}%`}</Text>
          <Secondary>usable signal</Secondary>
        </View>
        <View style={styles.qualityMeta}>
          <Text style={styles.metaValue}>{session.confidence == null ? '—' : `${Math.round(session.confidence * 100)}%`}</Text>
          <Text style={styles.metaLabel}>stage confidence</Text>
          <Text style={styles.metaValue}>{quality?.modelVersion ?? 'Not reported'}</Text>
          <Text style={styles.metaLabel}>model version</Text>
        </View>
      </View>
      <View style={styles.coverageList}>
        {sensors.length ? sensors.map((sensor) => <CoverageRow key={sensor} label={SENSOR_LABEL[sensor]} value={coverage[sensor] ?? null} />) : <CoverageRow label="Sensor coverage" value={null} />}
      </View>
      <Pressable
        onPress={() => void exportData()}
        style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Export raw recording bundle"
      >
        {exportState === 'working' ? <ActivityIndicator color={colors.ctaText} /> : <Text style={styles.exportButtonText}>{exportState === 'done' ? 'Exported' : 'Export raw bundle'}</Text>}
      </Pressable>
      {exportError ? <Secondary style={styles.errorText}>{exportError}</Secondary> : null}
      <Secondary>Raw EEG/EOG, IMU, manifests, and processing sidecars are included when still stored locally.</Secondary>
    </Panel>
  );
}

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text style={styles.panelTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function SectionIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <View style={styles.sectionIntro}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Secondary>{body}</Secondary>
    </View>
  );
}

function StaticTabs({ labels }: { labels: string[] }) {
  return (
    <View style={styles.tabs}>
      {labels.map((label, index) => (
        <View key={label} style={[styles.tab, index === 0 && styles.tabSelected]}>
          <Text style={[styles.tabText, index === 0 && styles.tabTextSelected]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function MetricHero({ value, unit, digits = 1 }: { value?: number; unit: string; digits?: number }) {
  return (
    <View style={styles.metricHero}>
      <Text style={styles.heroValue}>{value == null ? '—' : value.toFixed(digits)}</Text>
      <Secondary>{unit}</Secondary>
    </View>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.smallMetric}>
      <Text style={styles.smallMetricValue}>{value}</Text>
      <Text style={styles.smallMetricLabel}>{label}</Text>
    </View>
  );
}

function PlaceholderGraph({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.placeholderGraph} accessible accessibilityRole="image" accessibilityLabel={`${label}; no readings yet`}>
      <Svg width="100%" height={126} viewBox="0 0 300 126" preserveAspectRatio="none">
        {[28, 63, 98].map((y) => <Line key={y} x1={0} x2={300} y1={y} y2={y} stroke={colors.borderSubtle} strokeWidth={1} />)}
        <Path d="M0 74 C28 53 48 92 74 72 S119 55 145 76 S187 91 214 67 S260 54 300 71" fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 7" opacity={0.25} />
      </Svg>
      <View style={styles.placeholderLabel}><Text style={styles.placeholderText}>{label}</Text></View>
      <View style={styles.axisRow}><Text style={styles.axisText}>Bedtime</Text><Text style={styles.axisText}>Wake</Text></View>
    </View>
  );
}

function InterventionTimeline({ events, durationSec }: { events: NonNullable<NonNullable<Session['insights']>['closedLoop']>['events']; durationSec: number }) {
  const safeDuration = Math.max(durationSec, events?.at(-1)?.offsetSec ?? 1, 1);
  return (
    <View style={styles.interventionWrap}>
      <View style={styles.interventionTimeline} accessibilityRole="image" accessibilityLabel={`${events?.length ?? 0} intervention events overnight`}>
        <View style={styles.interventionLine} />
        {events?.map((event, index) => (
          <View key={`${event.kind}-${event.offsetSec}-${index}`} style={[styles.eventMarker, { left: `${Math.min(99, (event.offsetSec / safeDuration) * 100)}%`, backgroundColor: EVENT_META[event.kind].color }]} />
        ))}
      </View>
      <View style={styles.axisRow}><Text style={styles.axisText}>Bedtime</Text><Text style={styles.axisText}>Wake</Text></View>
      <View style={styles.legendRow}>
        {Array.from(new Set(events?.map((event) => event.kind) ?? [])).map((kind) => (
          <View key={kind} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: EVENT_META[kind].color }]} /><Text style={styles.legendText}>{EVENT_META[kind].label}</Text></View>
        ))}
      </View>
    </View>
  );
}

function EmptyInterventionTimeline() {
  return (
    <View style={styles.interventionWrap}>
      <View style={styles.interventionTimeline}><View style={styles.interventionLine} /><Text style={styles.centeredPlaceholder}>No intervention events</Text></View>
      <View style={styles.axisRow}><Text style={styles.axisText}>Bedtime</Text><Text style={styles.axisText}>Wake</Text></View>
    </View>
  );
}

function CorrelationRow({ factor, outcome, coefficient, sampleNights }: { factor: string; outcome: string; coefficient: number; sampleNights: number }) {
  const width: `${number}%` = `${Math.min(50, Math.abs(coefficient) * 50)}%`;
  const positive = coefficient >= 0;
  return (
    <View style={styles.correlationRow}>
      <View style={styles.correlationLabels}>
        <Text style={styles.correlationTitle}>{factor}</Text>
        <Text style={styles.correlationMeta}>{positive ? '+' : ''}{coefficient.toFixed(2)} · {sampleNights} nights</Text>
      </View>
      <Text style={styles.correlationOutcome}>{outcome}</Text>
      <View style={styles.correlationTrack}>
        <View style={styles.correlationCenter} />
        <View style={[styles.correlationFill, positive ? { left: '50%', width, backgroundColor: colors.positive } : { right: '50%', width, backgroundColor: colors.warning }]} />
      </View>
    </View>
  );
}

function EmptyCorrelation() {
  return (
    <View style={styles.emptyCorrelation}>
      <View style={styles.correlationTrack}><View style={styles.correlationCenter} /></View>
      <Text style={styles.placeholderText}>Needs repeated nights before showing associations</Text>
    </View>
  );
}

function CircadianTimeline({ estimatedMs, uncertaintyMinutes }: { estimatedMs: number; uncertaintyMinutes: number }) {
  const date = new Date(estimatedMs);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const markerLeft = (minuteOfDay / 1440) * 100;
  const bandWidth = Math.min(35, (uncertaintyMinutes * 2 / 1440) * 100);
  const bandLeft = Math.max(0, Math.min(100 - bandWidth, markerLeft - bandWidth / 2));
  return (
    <View style={styles.circadianWrap}>
      <View style={styles.circadianTrack} accessibilityRole="image" accessibilityLabel={`Estimated circadian phase ${formatClock(estimatedMs)}, plus or minus ${Math.round(uncertaintyMinutes)} minutes`}>
        <View style={[styles.uncertaintyBand, { left: `${bandLeft}%`, width: `${bandWidth}%` }]} />
        <View style={[styles.phaseMarker, { left: `${Math.min(99, markerLeft)}%` }]} />
      </View>
      <View style={styles.quarterLabels}><Text style={styles.axisText}>12 AM</Text><Text style={styles.axisText}>6 AM</Text><Text style={styles.axisText}>12 PM</Text><Text style={styles.axisText}>6 PM</Text></View>
    </View>
  );
}

function EmptyCircadianTimeline() {
  return (
    <View style={styles.circadianWrap}>
      <View style={styles.circadianTrack}><View style={styles.emptyPhaseBand} /><Text style={styles.centeredPlaceholder}>Building your phase estimate</Text></View>
      <View style={styles.quarterLabels}><Text style={styles.axisText}>12 AM</Text><Text style={styles.axisText}>6 AM</Text><Text style={styles.axisText}>12 PM</Text><Text style={styles.axisText}>6 PM</Text></View>
    </View>
  );
}

function CoverageRow({ label, value }: { label: string; value: number | null }) {
  const ratio = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <View style={styles.coverageRow}>
      <View style={styles.coverageLabels}><Text style={styles.coverageLabel}>{label}</Text><Text style={styles.coverageValue}>{value == null ? '—' : `${Math.round(value)}%`}</Text></View>
      <View style={styles.coverageTrack}><View style={[styles.coverageFill, { width: `${ratio}%` }]} /></View>
    </View>
  );
}

function metricAverage(metric: InsightMetric): number | undefined {
  if (metric.average != null) return metric.average;
  if (!metric.series?.length) return undefined;
  return metric.series.reduce((sum, point) => sum + point.value, 0) / metric.series.length;
}

function formatCount(value: number | undefined) {
  return value == null ? '—' : `${Math.round(value)}`;
}

function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatWindow(startMs: number, endMs: number) {
  return `${formatClock(startMs)}–${formatClock(endMs)}`;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  sectionIntro: { gap: spacing.xs, paddingTop: spacing.md },
  sectionTitle: { fontFamily: systemFontFamily, fontSize: 25, lineHeight: 31, fontWeight: '600', letterSpacing: -0.4, color: colors.textPrimary },
  panel: { gap: spacing.md, padding: spacing.md, borderRadius: radii.card, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.bgSurface },
  panelHeader: { gap: spacing.xs },
  panelTitle: { fontFamily: systemFontFamily, fontSize: 21, lineHeight: 27, fontWeight: '600', letterSpacing: -0.25, color: colors.textPrimary },
  tabs: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: 12, backgroundColor: colors.bgElevated },
  tab: { flex: 1, minHeight: 38, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  tabSelected: { backgroundColor: colors.borderDivider },
  tabText: { fontFamily: systemFontFamily, fontSize: 11, fontWeight: '600', color: colors.textTertiary },
  tabTextSelected: { color: colors.textPrimary },
  metricHero: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  heroValue: { fontFamily: systemFontFamily, fontSize: 36, lineHeight: 42, fontWeight: '600', letterSpacing: -1, color: colors.textPrimary },
  placeholderGraph: { height: 150, overflow: 'hidden' },
  placeholderLabel: { position: 'absolute', top: 52, left: 0, right: 0, alignItems: 'center' },
  placeholderText: { fontFamily: systemFontFamily, fontSize: 12, fontWeight: '600', color: colors.textTertiary, textAlign: 'center' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontFamily: systemFontFamily, fontSize: 10, color: colors.textTertiary },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  smallMetric: { flexGrow: 1, minWidth: '30%', gap: 2, paddingVertical: spacing.xs },
  smallMetricValue: { fontFamily: systemFontFamily, fontSize: 22, fontWeight: '600', color: colors.textPrimary },
  smallMetricLabel: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textTertiary },
  interventionWrap: { gap: spacing.xs },
  interventionTimeline: { height: 70, justifyContent: 'center' },
  interventionLine: { height: 4, borderRadius: 2, backgroundColor: colors.borderDivider },
  eventMarker: { position: 'absolute', top: 25, width: 12, height: 20, marginLeft: -6, borderRadius: 6, borderWidth: 2, borderColor: colors.bgSurface },
  centeredPlaceholder: { position: 'absolute', left: 0, right: 0, top: 27, textAlign: 'center', fontFamily: systemFontFamily, fontSize: 11, fontWeight: '600', color: colors.textTertiary },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
  subheadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subhead: { fontFamily: systemFontFamily, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  subtleLabel: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textTertiary },
  correlationRow: { gap: 6 },
  correlationLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  correlationTitle: { flex: 1, fontFamily: systemFontFamily, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  correlationMeta: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textSecondary },
  correlationOutcome: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textTertiary },
  correlationTrack: { height: 10, borderRadius: 5, backgroundColor: colors.bgElevated, overflow: 'hidden' },
  correlationCenter: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: colors.textTertiary },
  correlationFill: { position: 'absolute', top: 2, height: 6, borderRadius: 3 },
  emptyCorrelation: { gap: spacing.sm },
  circadianHero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  confidenceBadge: { minWidth: 74, alignItems: 'flex-end' },
  confidenceValue: { fontFamily: systemFontFamily, fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  confidenceLabel: { fontFamily: systemFontFamily, fontSize: 10, color: colors.textTertiary },
  circadianWrap: { gap: spacing.xs },
  circadianTrack: { height: 62, justifyContent: 'center' },
  uncertaintyBand: { position: 'absolute', top: 19, height: 24, borderRadius: 12, backgroundColor: 'rgba(124, 156, 224, 0.18)' },
  phaseMarker: { position: 'absolute', top: 13, height: 36, width: 3, borderRadius: 2, backgroundColor: colors.accent },
  emptyPhaseBand: { position: 'absolute', left: '64%', width: '14%', top: 19, height: 24, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderDivider },
  quarterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  windowList: { gap: spacing.sm },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  windowDot: { width: 9, height: 9, borderRadius: 5 },
  windowCopy: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  windowLabel: { fontFamily: systemFontFamily, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  windowTime: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textSecondary },
  qualityHero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  qualityMeta: { flex: 1, alignItems: 'flex-end' },
  metaValue: { fontFamily: systemFontFamily, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  metaLabel: { fontFamily: systemFontFamily, fontSize: 10, color: colors.textTertiary, marginBottom: spacing.xs },
  coverageList: { gap: spacing.sm },
  coverageRow: { gap: 6 },
  coverageLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  coverageLabel: { fontFamily: systemFontFamily, fontSize: 12, color: colors.textSecondary },
  coverageValue: { fontFamily: systemFontFamily, fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  coverageTrack: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.bgElevated },
  coverageFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  exportButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.ctaBg, paddingHorizontal: spacing.md },
  exportButtonText: { fontFamily: systemFontFamily, fontSize: 14, fontWeight: '600', color: colors.ctaText },
  pressed: { opacity: 0.75 },
  errorText: { color: colors.warning },
});
