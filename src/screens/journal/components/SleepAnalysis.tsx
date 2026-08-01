import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Rect } from 'react-native-svg';

import type { PositionSegment, Session, SleepPosition } from '../../../lib/repos';
import { colors, radii, spacing, stageColors, systemFontFamily } from '../../../theme/tokens';
import { Eyebrow, Secondary } from '../../../theme/typography';
import { InteractiveLineChart } from './InteractiveLineChart';

type Props = { session: Session; history: Session[] };

const POSITION_META: Record<SleepPosition, { label: string; color: string; rotation: number }> = {
  left: { label: 'Left', color: '#73A6D8', rotation: -18 },
  right: { label: 'Right', color: '#A18AD8', rotation: 18 },
  back: { label: 'Back', color: '#77B59F', rotation: 0 },
  stomach: { label: 'Stomach', color: '#C49A72', rotation: 180 },
  unknown: { label: 'Unknown', color: colors.textTertiary, rotation: 0 },
};

export function SleepAnalysis({ session, history }: Props) {
  return (
    <View style={styles.stack}>
      <SleepAmountCard session={session} />
      <ContinuityCard session={session} />
      <RecoveryCard session={session} history={history} />
      <CardioCard session={session} />
      <MotionCard session={session} />
      <EyeMovementCard session={session} />
      <SoundCard session={session} />
    </View>
  );
}

function SleepAmountCard({ session }: { session: Session }) {
  const goodSleep = session.tst;
  const max = Math.max(session.tib, goodSleep ?? 0, 1);
  return (
    <InsightCard eyebrow="sleep amount" title="Time in bed and good sleep">
      <BarMetric label="In bed" value={session.tib} max={max} color={colors.textSecondary} />
      <BarMetric label="Good sleep" value={goodSleep} max={max} color={colors.accent} />
      <Secondary style={styles.explanation}>
        Good sleep is staged sleep time: light, deep, and REM, excluding awake and no-signal periods.
      </Secondary>
    </InsightCard>
  );
}

function ContinuityCard({ session }: { session: Session }) {
  return (
    <InsightCard eyebrow="continuity" title="How settled the night felt">
      <View style={styles.metricGrid}>
        <Metric label="Fell asleep in" value={formatMinutes(session.sol)} />
        <Metric label="Wake count" value={formatCount(session.awakenings)} />
        <Metric label="Awake after sleep" value={formatMinutes(session.waso)} />
        <Metric label="Sleep efficiency" value={session.efficiency == null ? '—' : `${Math.round(session.efficiency)}%`} />
      </View>
    </InsightCard>
  );
}

function RecoveryCard({ session, history }: Props) {
  const previous = history
    .filter((item) => item.id !== session.id && item.endMs < session.endMs && item.tst != null)
    .sort((a, b) => b.endMs - a.endMs)
    .slice(0, 14);

  if (previous.length < 3 || session.tst == null) {
    return (
      <InsightCard eyebrow="sleep balance" title="Your recovery pattern">
        <EmptyState
          title="Building your baseline"
          body="After four recorded nights, this compares sleep duration and stage ratios with your own recent pattern."
        />
      </InsightCard>
    );
  }

  const typicalMinutes = average(previous.map((item) => item.tst ?? 0));
  const balance = session.tst - typicalMinutes;
  const currentDeep = stageRatio(session, 'deep');
  const currentRem = stageRatio(session, 'rem');
  const baselineDeep = average(previous.map((item) => stageRatio(item, 'deep')).filter(isNumber));
  const baselineRem = average(previous.map((item) => stageRatio(item, 'rem')).filter(isNumber));

  return (
    <InsightCard eyebrow="sleep balance" title="Your recovery pattern">
      <View style={styles.balanceHero}>
        <Text style={[styles.balanceValue, balance < 0 && styles.balanceNegative]}>
          {balance >= 0 ? '+' : '−'}{formatMinutes(Math.abs(balance), false)}
        </Text>
        <Secondary>vs your prior {previous.length}-night average</Secondary>
      </View>
      <RatioRow label="Deep sleep" current={currentDeep} baseline={baselineDeep} color={stageColors.deep} />
      <RatioRow label="REM sleep" current={currentRem} baseline={baselineRem} color={stageColors.rem} />
      <Secondary style={styles.explanation}>
        Stage balance can shift for several nights after a short or disrupted night. This is a personal trend, not a prescribed sleep target.
      </Secondary>
    </InsightCard>
  );
}

type CardioKey = 'heartRateBpm' | 'hrvRmssdMs' | 'respirationRate';

function CardioCard({ session }: { session: Session }) {
  const cardio = session.insights?.cardio;
  const options = useMemo(
    () =>
      ([
        { key: 'heartRateBpm' as const, label: 'HR', unit: 'bpm', color: '#E08080', digits: 0 },
        { key: 'hrvRmssdMs' as const, label: 'HRV', unit: 'ms', color: '#8C9FE0', digits: 0 },
        { key: 'respirationRate' as const, label: 'Breathing', unit: '/min', color: '#66B7A3', digits: 1 },
      ]).filter((option) => cardio?.[option.key] != null),
    [cardio],
  );
  const [selectedKey, setSelectedKey] = useState<CardioKey>('heartRateBpm');
  const selected = options.find((option) => option.key === selectedKey) ?? options[0];
  const metric = selected ? cardio?.[selected.key] : undefined;

  return (
    <InsightCard eyebrow="overnight signals" title="Heart and breathing">
      {!selected || !metric ? (
        <EmptyState
          title="Waiting for PPG data"
          body="Heart rate, HRV, and respiration trends will appear here when the analysis pipeline adds them to this night."
        />
      ) : (
        <>
          <View style={styles.segmented}>
            {options.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => setSelectedKey(option.key)}
                style={[styles.segment, selected.key === option.key && styles.segmentSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected: selected.key === option.key }}
              >
                <Text style={[styles.segmentText, selected.key === option.key && styles.segmentTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.metricHeadline}>
            <Text style={styles.largeMetric}>{metric.average == null ? '—' : metric.average.toFixed(selected.digits)}</Text>
            <Secondary>{selected.unit} average</Secondary>
          </View>
          {metric.series?.length ? (
            <InteractiveLineChart
              series={metric.series}
              unit={selected.unit}
              color={selected.color}
              valueDigits={selected.digits}
              durationSec={session.tib * 60}
            />
          ) : (
            <Secondary style={styles.explanation}>An average is available; the overnight time series has not been uploaded.</Secondary>
          )}
        </>
      )}
    </InsightCard>
  );
}

function MotionCard({ session }: { session: Session }) {
  const motion = session.insights?.motion;
  const aggregates = useMemo(() => aggregatePositions(motion?.positions ?? []), [motion?.positions]);
  const positions = aggregates.map((item) => item.position);
  const [selectedPosition, setSelectedPosition] = useState<SleepPosition | null>(null);
  const activePosition = selectedPosition && positions.includes(selectedPosition) ? selectedPosition : positions[0] ?? 'unknown';
  const active = aggregates.find((item) => item.position === activePosition);
  const best = aggregates
    .filter((item) => item.quality != null && item.minutes >= 20)
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))[0];

  return (
    <InsightCard eyebrow="movement & position" title="Toss and turn map">
      {!motion || (motion.turns == null && !motion.positions?.length && !motion.events?.length) ? (
        <EmptyState
          title="Waiting for IMU analysis"
          body="Turns, restlessness, and position-dependent sleep quality will appear here from the mask motion sensor."
        />
      ) : (
        <>
          <View style={styles.motionHero}>
            <PositionAvatar position={activePosition} />
            <View style={styles.motionStats}>
              <Metric label="Position" value={POSITION_META[activePosition].label} />
              <Metric label="Tosses and turns" value={motion.turns == null ? '—' : `${Math.round(motion.turns)}`} />
              <Metric label="Restless" value={formatMinutes(motion.restlessMinutes)} />
            </View>
          </View>
          {motion.positions?.length ? (
            <>
              <PositionTimeline segments={motion.positions} />
              <View style={styles.positionChips}>
                {aggregates.map((item) => (
                  <Pressable
                    key={item.position}
                    onPress={() => setSelectedPosition(item.position)}
                    style={[styles.positionChip, item.position === activePosition && styles.positionChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.position === activePosition }}
                  >
                    <View style={[styles.positionDot, { backgroundColor: POSITION_META[item.position].color }]} />
                    <Text style={styles.positionChipText}>{POSITION_META[item.position].label}</Text>
                    <Text style={styles.positionChipMinutes}>{formatMinutes(item.minutes, false)}</Text>
                  </Pressable>
                ))}
              </View>
              {active?.quality != null ? (
                <Secondary>{`${POSITION_META[active.position].label} sleep quality: ${Math.round(active.quality)}/100`}</Secondary>
              ) : null}
              {best ? (
                <View style={styles.insightCallout}>
                  <Text style={styles.calloutTitle}>{POSITION_META[best.position].label} looked most settled</Text>
                  <Secondary>
                    Observe this across several nights before changing your setup; pillow comfort and fit can affect position.
                  </Secondary>
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </InsightCard>
  );
}

function EyeMovementCard({ session }: { session: Session }) {
  const eye = session.insights?.eyeMovements;
  return (
    <InsightCard eyebrow="eye movement" title="Overnight eye activity">
      {!eye || (eye.events == null && eye.eventsPerHour == null && eye.remDensity == null && !eye.series?.length) ? (
        <EmptyState
          title="Waiting for eye-movement analysis"
          body="Quantified eye events and REM density will appear here when the EEG/EOG pipeline provides them."
        />
      ) : (
        <>
          <View style={styles.metricGrid}>
            <Metric label="Eye events" value={formatCount(eye.events)} />
            <Metric label="Events per hour" value={eye.eventsPerHour == null ? '—' : eye.eventsPerHour.toFixed(1)} />
            <Metric label="REM density" value={eye.remDensity == null ? '—' : `${Math.round(eye.remDensity)}%`} />
          </View>
          {eye.series?.length ? (
            <InteractiveLineChart
              series={eye.series}
              unit="events/min"
              color={stageColors.rem}
              valueDigits={1}
              durationSec={session.tib * 60}
            />
          ) : null}
        </>
      )}
    </InsightCard>
  );
}

function SoundCard({ session }: { session: Session }) {
  const sound = session.insights?.sound;
  return (
    <InsightCard eyebrow="breathing & sound" title="Snoring signals">
      {!sound || (sound.snoringMinutes == null && sound.snoringEpisodes == null && !sound.series?.length) ? (
        <EmptyState
          title="No sound analysis for this night"
          body="Snoring patterns require an enabled microphone or another validated breathing signal."
        />
      ) : (
        <>
          <View style={styles.metricGrid}>
            <Metric label="Snoring" value={formatMinutes(sound.snoringMinutes)} />
            <Metric label="Sound episodes" value={formatCount(sound.snoringEpisodes)} />
            <Metric label="Possible disturbances" value={formatCount(sound.possibleBreathingDisturbances)} />
          </View>
          {sound.series?.length ? (
            <InteractiveLineChart
              series={sound.series}
              unit="sound level"
              color={colors.warning}
              valueDigits={0}
              durationSec={session.tib * 60}
            />
          ) : null}
          <View style={styles.caution}>
            <Secondary>
              Consumer sound patterns cannot diagnose or rule out sleep apnea. Discuss symptoms or repeated concerns with a clinician.
            </Secondary>
          </View>
        </>
      )}
    </InsightCard>
  );
}

function InsightCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyGlyph} />
      <View style={styles.emptyCopy}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Secondary>{body}</Secondary>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Secondary style={styles.metricLabel}>{label}</Secondary>
    </View>
  );
}

function BarMetric({ label, value, max, color }: { label: string; value: number | null; max: number; color: string }) {
  const ratio = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <View style={styles.barMetric}>
      <View style={styles.barLabels}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{formatMinutes(value)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function RatioRow({ label, current, baseline, color }: { label: string; current: number | null; baseline: number; color: string }) {
  const safeCurrent = current ?? 0;
  const scale = Math.max(safeCurrent, baseline, 1);
  return (
    <View style={styles.ratioRow}>
      <View style={styles.barLabels}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{current == null ? '—' : `${Math.round(current)}%`} · typical {Math.round(baseline)}%</Text>
      </View>
      <View style={styles.comparisonTrack}>
        <View style={[styles.baselineFill, { width: `${Math.min(100, (baseline / scale) * 100)}%` }]} />
        <View style={[styles.currentFill, { width: `${Math.min(100, (safeCurrent / scale) * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function PositionAvatar({ position }: { position: SleepPosition }) {
  const meta = POSITION_META[position];
  return (
    <View style={styles.avatarWrap} accessible accessibilityRole="image" accessibilityLabel={`Sleeping on ${meta.label.toLowerCase()} position`}>
      <Svg width={126} height={112} viewBox="0 0 126 112">
        <Rect x={4} y={4} width={118} height={104} rx={22} fill={colors.bgElevated} />
        <Rect x={13} y={13} width={100} height={86} rx={17} fill="none" stroke={colors.borderDivider} strokeWidth={1.5} />
        <G origin="63,56" rotation={meta.rotation}>
          <Circle cx={63} cy={31} r={11} fill={meta.color} opacity={0.95} />
          <Rect x={49} y={44} width={28} height={43} rx={14} fill={meta.color} opacity={0.9} />
          <Line x1={51} y1={55} x2={37} y2={72} stroke={meta.color} strokeWidth={7} strokeLinecap="round" />
          <Line x1={75} y1={55} x2={89} y2={72} stroke={meta.color} strokeWidth={7} strokeLinecap="round" />
        </G>
      </Svg>
    </View>
  );
}

function PositionTimeline({ segments }: { segments: PositionSegment[] }) {
  const endSec = Math.max(...segments.map((segment) => segment.startSec + segment.durationSec), 1);
  return (
    <View>
      <View style={styles.timeline} accessibilityRole="image" accessibilityLabel="Sleep position timeline">
        {segments.map((segment, index) => (
          <View
            key={`${segment.position}-${segment.startSec}-${index}`}
            style={{
              position: 'absolute',
              left: `${(segment.startSec / endSec) * 100}%`,
              width: `${Math.max(0.6, (segment.durationSec / endSec) * 100)}%`,
              top: 0,
              bottom: 0,
              backgroundColor: POSITION_META[segment.position].color,
            }}
          />
        ))}
      </View>
      <View style={styles.timelineLabels}>
        <Text style={styles.axisLabel}>Bedtime</Text>
        <Text style={styles.axisLabel}>Wake</Text>
      </View>
    </View>
  );
}

function aggregatePositions(segments: PositionSegment[]) {
  const map = new Map<SleepPosition, { minutes: number; qualityWeight: number; qualityMinutes: number }>();
  for (const segment of segments) {
    const current = map.get(segment.position) ?? { minutes: 0, qualityWeight: 0, qualityMinutes: 0 };
    const minutes = segment.durationSec / 60;
    current.minutes += minutes;
    if (segment.quality != null) {
      current.qualityWeight += segment.quality * minutes;
      current.qualityMinutes += minutes;
    }
    map.set(segment.position, current);
  }
  return Array.from(map.entries())
    .map(([position, value]) => ({
      position,
      minutes: value.minutes,
      quality: value.qualityMinutes ? value.qualityWeight / value.qualityMinutes : null,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

function stageRatio(session: Session, stage: 'deep' | 'rem'): number | null {
  const minutes = session.stageMinutes[stage];
  if (minutes == null || session.tst == null || session.tst <= 0) return null;
  return (minutes / session.tst) * 100;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function isNumber(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function formatMinutes(value: number | null | undefined, includeMinutesSuffix = true) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours) return `${hours}h ${minutes ? `${minutes}m` : ''}`.trim();
  return includeMinutesSuffix ? `${minutes} min` : `${minutes}m`;
}

function formatCount(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}`;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  cardHeader: { gap: spacing.xs },
  cardTitle: {
    fontFamily: systemFontFamily,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    letterSpacing: -0.25,
    color: colors.textPrimary,
  },
  explanation: { color: colors.textSecondary },
  barMetric: { gap: spacing.sm },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  barLabel: { fontFamily: systemFontFamily, fontSize: 14, color: colors.textSecondary },
  barValue: { fontFamily: systemFontFamily, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  track: { height: 9, borderRadius: 99, overflow: 'hidden', backgroundColor: colors.bgElevated },
  fill: { height: '100%', borderRadius: 99 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    minWidth: '46%',
    flexGrow: 1,
    gap: 2,
    paddingVertical: spacing.sm,
  },
  metricValue: { fontFamily: systemFontFamily, fontSize: 23, fontWeight: '600', color: colors.textPrimary },
  metricLabel: { color: colors.textTertiary },
  balanceHero: { gap: 2 },
  balanceValue: { fontFamily: systemFontFamily, fontSize: 36, lineHeight: 42, fontWeight: '600', letterSpacing: -1, color: colors.positive },
  balanceNegative: { color: colors.warning },
  ratioRow: { gap: spacing.sm },
  comparisonTrack: { height: 12, borderRadius: 99, overflow: 'hidden', backgroundColor: colors.bgElevated, justifyContent: 'center' },
  baselineFill: { position: 'absolute', height: 3, borderRadius: 99, backgroundColor: colors.textTertiary, opacity: 0.65 },
  currentFill: { height: 8, borderRadius: 99 },
  segmented: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: 12, backgroundColor: colors.bgElevated },
  segment: { flex: 1, minHeight: 38, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentSelected: { backgroundColor: colors.borderDivider },
  segmentText: { fontFamily: systemFontFamily, fontSize: 12, fontWeight: '600', color: colors.textTertiary },
  segmentTextSelected: { color: colors.textPrimary },
  metricHeadline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  largeMetric: { fontFamily: systemFontFamily, fontSize: 36, fontWeight: '600', letterSpacing: -1, color: colors.textPrimary },
  motionHero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarWrap: { width: 126, height: 112 },
  motionStats: { flex: 1 },
  timeline: { height: 12, borderRadius: 99, overflow: 'hidden', backgroundColor: colors.bgElevated },
  timelineLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  axisLabel: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textTertiary },
  positionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  positionChip: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  positionChipActive: { borderColor: colors.textSecondary, backgroundColor: colors.bgElevated },
  positionDot: { width: 7, height: 7, borderRadius: 4 },
  positionChipText: { fontFamily: systemFontFamily, fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  positionChipMinutes: { fontFamily: systemFontFamily, fontSize: 11, color: colors.textTertiary },
  insightCallout: { gap: spacing.xs, padding: spacing.md, borderRadius: 14, backgroundColor: colors.bgElevated },
  calloutTitle: { fontFamily: systemFontFamily, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  caution: { padding: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: colors.borderDivider },
  emptyState: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  emptyGlyph: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.borderDivider, backgroundColor: colors.bgElevated },
  emptyCopy: { flex: 1, gap: spacing.xs },
  emptyTitle: { fontFamily: systemFontFamily, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});
