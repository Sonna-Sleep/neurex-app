import React, { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Segmented } from '../../components/Segmented';
import { colors, spacing } from '../../theme/tokens';
import type { OnboardingStackParamList } from '../../navigation/types';
import { ProfileCard } from './components/ProfileCard';
import { DateOfBirthInput } from './components/DateOfBirthInput';
import { saveProfile, type Sex } from '../../lib/profile';
import { useSession } from '../../state/session';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unspecified', label: 'Other' },
];

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Profile'>;

export function Profile({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [dob, setDob] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);

  const done = () => {
    const patch = { firstName: firstName.trim() || null, dob: dob ?? null, sex: sex ?? null };
    // Reflect the choices in the session immediately and move on. A stalled
    // auth.updateUser must NEVER strand the user on this screen (it has), so
    // persistence is fire-and-forget — saveProfile re-patches the session on
    // success and the metadata re-syncs on the next auth refresh.
    useSession.getState().patchUser(patch);
    navigation.navigate('Pair');
    saveProfile(patch).catch((e) => {
      if (__DEV__) console.warn('[onboarding] profile save failed (will re-sync):', e);
    });
  };

  const next = () => (step < 2 ? setStep(step + 1) : done());

  if (step === 0) {
    return (
      <ProfileCard title="What should we call you?"
        canContinue={firstName.trim().length > 0} onContinue={next} isLast={false}>
        <TextInput style={styles.text} value={firstName} onChangeText={setFirstName}
          placeholder="First name" placeholderTextColor={colors.textTertiary} autoFocus />
      </ProfileCard>
    );
  }
  if (step === 1) {
    return (
      <ProfileCard title="When were you born?"
        subtitle="Required for sleep staging."
        canContinue={dob !== null} onContinue={next} isLast={false}>
        <DateOfBirthInput value={dob} onChange={setDob} />
      </ProfileCard>
    );
  }
  return (
    <ProfileCard title="Biological sex"
      subtitle="Used for sleep-staging accuracy."
      canContinue={sex !== null} onContinue={done} isLast>
      <Segmented options={SEX_OPTIONS} value={sex} onChange={setSex} />
    </ProfileCard>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.textPrimary, fontSize: 22, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider },
});
