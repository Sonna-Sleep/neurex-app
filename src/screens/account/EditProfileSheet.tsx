import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '../../components/Segmented';
import { Avatar } from '../../components/Avatar';
import { Eyebrow } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { saveProfile, type Sex } from '../../lib/profile';
import { pickAndSaveAvatar, removeAvatar } from '../../lib/avatar';
import { DateOfBirthInput } from '../onboarding/components/DateOfBirthInput';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unspecified', label: 'Other' },
];

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const avatarUri = useSession((s) => s.avatarUri);
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
    // Intentional modal-open draft reset.
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
      {/* A RN Modal renders outside the app's SafeAreaProvider, so SafeAreaView
          insets would be 0 (content slides under the status bar). Give the modal
          its own provider so the top inset is real. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Top bar — close on the left, Save on the right (reachable, iOS-style) */}
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
          <Text style={styles.topTitle}>Edit profile</Text>
          <Pressable onPress={save} hitSlop={12} disabled={busy}>
            <Text style={[styles.save, busy && styles.saveDisabled]}>
              {busy ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Live avatar preview — monogram updates as the name field changes */}
          <View style={styles.avatarBlock}>
            <Pressable onPress={pickAndSaveAvatar} hitSlop={8}>
              <Avatar uri={avatarUri} name={firstName || 'You'} size={96} />
            </Pressable>
            <View style={styles.avatarActions}>
              <Pressable onPress={pickAndSaveAvatar} hitSlop={8}>
                <Text style={styles.photoBtn}>{avatarUri ? 'Edit photo' : 'Add photo'}</Text>
              </Pressable>
              {avatarUri ? (
                <Pressable onPress={removeAvatar} hitSlop={8}>
                  <Text style={styles.removeBtn}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

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
            <Segmented options={SEX_OPTIONS} value={sex} onChange={setSex} />
          </View>
        </ScrollView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  close: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  topTitle: {
    fontFamily: systemFontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  save: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  saveDisabled: {
    color: colors.textTertiary,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  avatarBlock: {
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  avatarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  photoBtn: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  removeBtn: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textTertiary,
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
});
