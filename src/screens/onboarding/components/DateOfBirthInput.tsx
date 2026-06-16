import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Eyebrow } from '../../../theme/typography';
import { colors, spacing } from '../../../theme/tokens';
import { cleanSegment, isoFromParts, partsFromIso } from '../../../lib/dob';

type Props = { value: string | null; onChange: (iso: string | null) => void };

export function DateOfBirthInput({ value, onChange }: Props) {
  const seed = partsFromIso(value);
  const [d, setD] = React.useState(seed.d);
  const [m, setM] = React.useState(seed.m);
  const [y, setY] = React.useState(seed.y);

  // Re-sync the visible fields when the parent replaces `value` out-of-band
  // (e.g. the account edit sheet reopening). Only re-seed when the incoming
  // value disagrees with what the fields already represent, so a parent that
  // echoes our own onChange ISO back doesn't clobber in-progress typing of an
  // as-yet-incomplete date.
  React.useEffect(() => {
    if (value === isoFromParts(d, m, y)) return;
    const p = partsFromIso(value);
    setD(p.d);
    setM(p.m);
    setY(p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Emit the ISO from one place, derived from the three fields. Doing this in an
  // effect — rather than inside each field's onChangeText — is what makes the
  // input lag-safe: a keystroke handler now touches ONLY its own field and never
  // reads the other two from a render closure. Under JS-thread jank several
  // keystrokes can fire before React re-renders; the previous shared-`update`
  // path then wrote stale (empty) day/month back while the year was typed,
  // wiping them. One setter per field makes that impossible.
  React.useEffect(() => {
    onChange(isoFromParts(d, m, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, m, y]);

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Eyebrow>day</Eyebrow>
        <TextInput style={styles.input} value={d} onChangeText={(t) => setD(cleanSegment(t, 2))}
          keyboardType="number-pad" placeholder="DD" placeholderTextColor={colors.textTertiary} maxLength={2} />
      </View>
      <View style={styles.field}>
        <Eyebrow>month</Eyebrow>
        <TextInput style={styles.input} value={m} onChangeText={(t) => setM(cleanSegment(t, 2))}
          keyboardType="number-pad" placeholder="MM" placeholderTextColor={colors.textTertiary} maxLength={2} />
      </View>
      <View style={[styles.field, styles.year]}>
        <Eyebrow>year</Eyebrow>
        <TextInput style={styles.input} value={y} onChangeText={(t) => setY(cleanSegment(t, 4))}
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
