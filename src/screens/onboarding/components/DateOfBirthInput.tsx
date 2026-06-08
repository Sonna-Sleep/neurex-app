import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Eyebrow } from '../../../theme/typography';
import { colors, spacing } from '../../../theme/tokens';

type Props = { value: string | null; onChange: (iso: string | null) => void };

// Builds an ISO 'YYYY-MM-DD' only when D/M/Y form a real, in-range date.
function isoOrNull(d: string, m: string, y: string): string | null {
  const dd = Number(d), mm = Number(m), yy = Number(y);
  if (!dd || !mm || !yy || y.length !== 4) return null;
  const dt = new Date(yy, mm - 1, dd);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  const age = new Date().getFullYear() - yy;
  if (age < 13 || age > 120) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function DateOfBirthInput({ value, onChange }: Props) {
  const [d, setD] = React.useState(value ? value.slice(8, 10) : '');
  const [m, setM] = React.useState(value ? value.slice(5, 7) : '');
  const [y, setY] = React.useState(value ? value.slice(0, 4) : '');

  // Re-sync the visible fields when the parent changes `value` while we stay
  // mounted (e.g. the Account edit sheet reopening). Only re-seed when the
  // incoming value disagrees with what the fields already represent, so a
  // parent that echoes our own onChange ISO back doesn't clobber in-progress
  // typing of an as-yet-incomplete date.
  React.useEffect(() => {
    if (value === isoOrNull(d, m, y)) return;
    setD(value ? value.slice(8, 10) : '');
    setM(value ? value.slice(5, 7) : '');
    setY(value ? value.slice(0, 4) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (nd: string, nm: string, ny: string) => {
    setD(nd); setM(nm); setY(ny);
    onChange(isoOrNull(nd, nm, ny));
  };

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Eyebrow>day</Eyebrow>
        <TextInput style={styles.input} value={d} onChangeText={(t) => update(t.replace(/\D/g, '').slice(0, 2), m, y)}
          keyboardType="number-pad" placeholder="DD" placeholderTextColor={colors.textTertiary} maxLength={2} />
      </View>
      <View style={styles.field}>
        <Eyebrow>month</Eyebrow>
        <TextInput style={styles.input} value={m} onChangeText={(t) => update(d, t.replace(/\D/g, '').slice(0, 2), y)}
          keyboardType="number-pad" placeholder="MM" placeholderTextColor={colors.textTertiary} maxLength={2} />
      </View>
      <View style={[styles.field, styles.year]}>
        <Eyebrow>year</Eyebrow>
        <TextInput style={styles.input} value={y} onChangeText={(t) => update(d, m, t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad" placeholder="YYYY" placeholderTextColor={colors.textTertiary} maxLength={4} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, gap: spacing.xs },
  year: { flex: 1.4 },
  input: {
    color: colors.textPrimary, fontSize: 20, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider,
  },
});
