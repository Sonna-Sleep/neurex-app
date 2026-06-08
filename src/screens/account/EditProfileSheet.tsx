import React, { useState } from 'react';
import { Alert, Modal, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { SerifHeadline, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { saveProfile, type Sex } from '../../lib/profile';
import { DateOfBirthInput } from '../onboarding/components/DateOfBirthInput';

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [dob, setDob] = useState<string | null>(user?.dob ?? null);
  const [sex, setSex] = useState<Sex | null>((user?.sex as Sex) ?? null);
  const [busy, setBusy] = useState(false);

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
      <View style={styles.container}>
        <SerifHeadline style={styles.h}>Edit profile</SerifHeadline>
        <Eyebrow>first name</Eyebrow>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName}
          placeholder="First name" placeholderTextColor={colors.textTertiary} />
        <Eyebrow>date of birth</Eyebrow>
        <DateOfBirthInput value={dob} onChange={setDob} />
        <Eyebrow>biological sex</Eyebrow>
        <View style={styles.choices}>
          {(['male', 'female', 'unspecified'] as Sex[]).map((opt) => (
            <Button key={opt} label={opt === 'unspecified' ? 'prefer not to say' : opt}
              variant={sex === opt ? 'primary' : 'ghost'} onPress={() => setSex(opt)} />
          ))}
        </View>
        <View style={styles.actions}>
          <Button label={busy ? 'saving…' : 'save'} onPress={save} disabled={busy} />
          <Button label="cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, padding: layout.screenPadding, gap: spacing.sm },
  h: { marginTop: spacing.xxl, marginBottom: spacing.md },
  input: { color: colors.textPrimary, fontSize: 18, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider },
  choices: { gap: spacing.sm },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
