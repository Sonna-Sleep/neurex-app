import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

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
              The mask starts glowing 30 minutes before this time.
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
      </Card>
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
});
