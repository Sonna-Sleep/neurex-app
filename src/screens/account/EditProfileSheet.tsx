import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { SerifHeadline, Eyebrow } from '../../theme/typography';
import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { saveProfile, type Sex } from '../../lib/profile';
import { DateOfBirthInput } from '../onboarding/components/DateOfBirthInput';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'male' },
  { value: 'female', label: 'female' },
  { value: 'unspecified', label: 'other' },
];

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [dob, setDob] = useState<string | null>(user?.dob ?? null);
  const [sex, setSex] = useState<Sex | null>((user?.sex as Sex) ?? null);
  const [busy, setBusy] = useState(false);

  // The Modal is always mounted (visibility toggled via `visible`), so the
  // useState initializers above run only at first mount. Re-seed local state
  // from the saved profile each time the sheet opens, otherwise abandoned
  // edits from a previous cancel would still be pre-filled and could be saved.
  useEffect(() => {
    if (!visible) return;
    setFirstName(user?.firstName ?? '');
    setDob(user?.dob ?? null);
    setSex((user?.sex as Sex) ?? null);
  }, [visible, user]);

  const save = async () => {
    setBusy(true);
    try {
      await saveProfile({ firstName: firstName.trim() || null, dob, sex });
      onClose();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <SerifHeadline style={styles.title}>Edit profile</SerifHeadline>

        <View style={styles.field}>
          <Eyebrow>first name</Eyebrow>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colors.textTertiary}
          />
        </View>

        <View style={styles.field}>
          <Eyebrow>date of birth</Eyebrow>
          <DateOfBirthInput value={dob} onChange={setDob} />
        </View>

        <View style={styles.field}>
          <Eyebrow>biological sex</Eyebrow>
          <View style={styles.segment}>
            {SEX_OPTIONS.map((opt) => {
              const active = sex === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSex(opt.value)}
                  style={[styles.seg, active && styles.segActive]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.actions}>
          <Button label={busy ? 'saving…' : 'save'} onPress={save} disabled={busy} />
          <Pressable onPress={onClose} hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  title: {
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
  field: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  input: {
    color: colors.textPrimary,
    fontSize: 18,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderDivider,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.button,
    padding: 4,
    gap: 4,
  },
  seg: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segActive: {
    backgroundColor: colors.ctaBg,
  },
  segText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segTextActive: {
    color: colors.ctaText,
  },
  actions: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  cancel: {
    paddingVertical: spacing.xs,
  },
  cancelText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
