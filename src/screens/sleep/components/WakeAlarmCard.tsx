import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';

import { Card } from '../../../components/Card';
import { syncWakeLightForActiveSession } from '../../../lib/ble/streamController';
import { useSession, type WakeAlarmSetting } from '../../../state/session';
import { Secondary, SerifHeadline } from '../../../theme/typography';
import { colors, radii, spacing } from '../../../theme/tokens';

const DEFAULT_WAKE_ALARM: WakeAlarmSetting = { hour: 7, minute: 30, enabled: false };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function wrap(value: number, size: number): number {
  return (value + size) % size;
}

type AlarmUpdate =
  | Partial<WakeAlarmSetting>
  | ((current: WakeAlarmSetting) => WakeAlarmSetting);

export function WakeAlarmCard() {
  const wakeAlarm = useSession((state) => state.wakeAlarm);
  const setWakeAlarm = useSession((state) => state.setWakeAlarm);
  const alarm = wakeAlarm ?? DEFAULT_WAKE_ALARM;
  const streaming = useSession((state) => state.streaming);
  const storedRuntime = useSession((state) => state.smartWakeRuntime);
  const history = useSession((state) => state.smartWakeHistory);
  const runtime =
    streaming && storedRuntime?.sessionId === streaming.sessionId ? storedRuntime : null;

  const updateAlarm = (update: AlarmUpdate) => {
    const currentAlarm = useSession.getState().wakeAlarm ?? DEFAULT_WAKE_ALARM;
    const nextAlarm =
      typeof update === 'function' ? update(currentAlarm) : { ...currentAlarm, ...update };
    setWakeAlarm(nextAlarm);
    void syncWakeLightForActiveSession();
  };

  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <SerifHeadline style={styles.title}>Wake-up light</SerifHeadline>
            <Secondary style={styles.subtitle}>
              Uses a live ORP-like arousal trend, with a guaranteed fallback 15 minutes later.
            </Secondary>
          </View>
          <Switch
            value={alarm.enabled}
            onValueChange={(enabled) => updateAlarm({ enabled })}
            accessibilityLabel="Wake-up light alarm toggle"
            trackColor={{ false: colors.borderDivider, true: colors.accent }}
            thumbColor={colors.textPrimary}
          />
        </View>

        <View style={styles.controlsRow}>
          <Stepper
            label={pad2(alarm.hour)}
            valueLabel="Wake-up hour"
            decLabel="Decrease wake-up hour"
            incLabel="Increase wake-up hour"
            onDec={() => updateAlarm((current) => ({ ...current, hour: wrap(current.hour - 1, 24) }))}
            onInc={() => updateAlarm((current) => ({ ...current, hour: wrap(current.hour + 1, 24) }))}
          />
          <Text style={styles.separator}>:</Text>
          <Stepper
            label={pad2(alarm.minute)}
            valueLabel="Wake-up minute"
            decLabel="Decrease wake-up minute"
            incLabel="Increase wake-up minute"
            onDec={() => updateAlarm((current) => ({ ...current, minute: wrap(current.minute - 5, 60) }))}
            onInc={() => updateAlarm((current) => ({ ...current, minute: wrap(current.minute + 5, 60) }))}
          />
        </View>
        {alarm.enabled && runtime ? (
          <View style={styles.livePanel}>
            <Text style={styles.liveTitle}>Live smart wake</Text>
            <ScoreChart
              history={history}
              wakeWindowStartMs={runtime.wakeWindowStartMs}
              fallbackDeadlineMs={runtime.fallbackDeadlineMs}
              triggeredAtMs={runtime.triggeredAtMs}
            />
            <View style={styles.metricsGrid}>
              <Metric label="ORP-like" value={formatScore(runtime.rawScore)} />
              <Metric label="Smoothed" value={formatScore(runtime.smoothedScore)} />
              <Metric label="Confidence" value={`${Math.round(runtime.confidence * 100)}%`} />
              <Metric label="Artifacts" value={`${Math.round(runtime.artifactBurden * 100)}%`} />
              <Metric label="State" value={runtime.state.replaceAll('_', ' ')} />
              <Metric label="Movement" value={runtime.imuMotionActive ? 'settling' : 'clear'} />
              <Metric label="Window" value={formatClock(runtime.wakeWindowStartMs)} />
              <Metric label="Fallback" value={formatClock(runtime.fallbackDeadlineMs)} />
            </View>
            <Text style={styles.disclaimer}>
              Exploratory arousal signal—not clinical ORP or a medical sleep stage.
            </Text>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function formatScore(value: number | null): string {
  return value === null ? 'calibrating' : value.toFixed(2);
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ScoreChart({
  history,
  wakeWindowStartMs,
  fallbackDeadlineMs,
  triggeredAtMs,
}: {
  history: { atMs: number; raw: number | null; smooth: number | null }[];
  wakeWindowStartMs: number;
  fallbackDeadlineMs: number;
  triggeredAtMs: number | null;
}) {
  const width = 300;
  const height = 78;
  if (history.length < 2) {
    return <View style={styles.chartEmpty}><Text style={styles.chartEmptyText}>Calibrating live EEG…</Text></View>;
  }
  const start = history[0].atMs;
  const end = Math.max(start + 1, history[history.length - 1].atMs);
  const x = (ms: number) => ((ms - start) / (end - start)) * width;
  const points = (field: 'raw' | 'smooth') => history
    .filter((p) => p[field] !== null)
    .map((p) => `${x(p.atMs).toFixed(1)},${(height - ((p[field] as number) / 2.5) * height).toFixed(1)}`)
    .join(' ');
  const shadeStart = Math.max(0, Math.min(width, x(wakeWindowStartMs)));
  const shadeEnd = Math.max(0, Math.min(width, x(fallbackDeadlineMs)));
  const triggerX = triggeredAtMs === null ? null : Math.max(0, Math.min(width, x(triggeredAtMs)));
  return (
    <View style={styles.chart} accessibilityLabel="Live ORP-like score chart">
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {shadeEnd > shadeStart ? (
          <Rect x={shadeStart} y={0} width={shadeEnd - shadeStart} height={height} fill="rgba(124,156,224,0.10)" />
        ) : null}
        <Polyline points={points('raw')} fill="none" stroke={colors.textTertiary} strokeWidth={1} opacity={0.55} />
        <Polyline points={points('smooth')} fill="none" stroke={colors.accent} strokeWidth={2} />
        {triggerX !== null ? <Line x1={triggerX} x2={triggerX} y1={0} y2={height} stroke={colors.warning} strokeWidth={1.5} /> : null}
      </Svg>
    </View>
  );
}

function Stepper({
  label,
  valueLabel,
  decLabel,
  incLabel,
  onDec,
  onInc,
}: {
  label: string;
  valueLabel: string;
  decLabel: string;
  incLabel: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onInc}
        accessibilityRole="button"
        accessibilityLabel={incLabel}
        hitSlop={8}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
      <View style={styles.valueWrap} accessible accessibilityLabel={`${valueLabel}: ${label}`}>
        <Text style={styles.valueText}>{label}</Text>
      </View>
      <Pressable
        onPress={onDec}
        accessibilityRole="button"
        accessibilityLabel={decLabel}
        hitSlop={8}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]}
      >
        <Text style={styles.stepGlyph}>-</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingTop: spacing.md,
  },
  card: {
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
  subtitle: {
    color: colors.textSecondary,
  },
  controlsRow: {
    minHeight: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  separator: {
    color: colors.textSecondary,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
    paddingBottom: spacing.xs,
  },
  stepper: {
    width: 104,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonPressed: {
    opacity: 0.88,
  },
  stepGlyph: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 24,
    fontWeight: '500',
  },
  valueWrap: {
    width: '100%',
    minHeight: 56,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  valueText: {
    color: colors.textPrimary,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
    textAlign: 'center',
  },
  livePanel: {
    borderTopWidth: 1,
    borderTopColor: colors.borderDivider,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  liveTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  chart: {
    height: 78,
    overflow: 'hidden',
    borderRadius: radii.small,
    backgroundColor: colors.bgElevated,
  },
  chartEmpty: {
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.small,
    backgroundColor: colors.bgElevated,
  },
  chartEmptyText: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metric: {
    width: '47%',
    gap: 2,
  },
  metricLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textTransform: 'capitalize',
  },
  disclaimer: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
});
