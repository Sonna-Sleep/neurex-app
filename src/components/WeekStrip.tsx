// A row of 7 day-circles for one week. A day with a recording gets a ring in
// its score-band color; the selected day is filled. Tap a day to select it.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, systemFontFamily } from '../theme/tokens';
import { scoreBand } from './ScoreRing';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Local YYYY-MM-DD key for a date. */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Monday of the week containing `d`. */
export function weekStartOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Mon=0 … Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}

type Props = {
  weekStart: Date;
  scoresByDate: Record<string, number | null>;
  hasByDate: Record<string, boolean>;
  selectedKey: string;
  onSelect: (date: Date) => void;
};

export function WeekStrip({ weekStart, scoresByDate, hasByDate, selectedKey, onSelect }: Props) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    return d;
  });

  return (
    <View style={styles.row}>
      {days.map((d, i) => {
        const key = dateKey(d);
        const has = hasByDate[key];
        const selected = key === selectedKey;
        const band = has ? scoreBand(scoresByDate[key] ?? null) : null;
        return (
          <Pressable key={key} style={styles.col} onPress={() => onSelect(d)} hitSlop={4}>
            <View
              style={[
                styles.circle,
                band ? { borderColor: band.color, borderWidth: 2 } : null,
                selected && styles.circleSelected,
              ]}
            >
              <Text style={[styles.letter, (selected || has) && styles.letterActive]}>{LETTERS[i]}</Text>
            </View>
            <Text style={[styles.date, selected && styles.dateActive]}>{d.getDate()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  col: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: {
    backgroundColor: colors.bgElevated,
  },
  letter: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  letterActive: {
    color: colors.textPrimary,
  },
  date: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    color: colors.textTertiary,
  },
  dateActive: {
    color: colors.textSecondary,
  },
});
