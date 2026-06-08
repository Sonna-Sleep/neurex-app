import React, { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { colors, spacing } from '../../theme/tokens';
import type { OnboardingStackParamList } from '../../navigation/types';
import { ProfileCard } from './components/ProfileCard';
import { DateOfBirthInput } from './components/DateOfBirthInput';
import { saveProfile, type Sex } from '../../lib/profile';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Profile'>;

export function Profile({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [dob, setDob] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);

  const done = async () => {
    try {
      await saveProfile({
        firstName: firstName.trim() || null,
        dob: dob ?? null,
        sex: sex ?? null,
      });
    } catch (e) {
      Alert.alert("Couldn't save your profile", e instanceof Error ? e.message : String(e));
    } finally {
      navigation.navigate('Pair');
    }
  };

  const next = () => (step < 2 ? setStep(step + 1) : done());
  const skipAll = () => navigation.navigate('Pair');

  if (step === 0) {
    return (
      <ProfileCard eyebrow="about you" title="What should we call you?"
        canContinue={firstName.trim().length > 0} onContinue={next} onSkip={() => setStep(1)} isLast={false}>
        <TextInput style={styles.text} value={firstName} onChangeText={setFirstName}
          placeholder="First name" placeholderTextColor={colors.textTertiary} autoFocus />
      </ProfileCard>
    );
  }
  if (step === 1) {
    return (
      <ProfileCard eyebrow="about you" title="When were you born?"
        subtitle="Used to make your sleep staging more accurate."
        canContinue={dob !== null} onContinue={next} onSkip={() => setStep(2)} isLast={false}>
        <DateOfBirthInput value={dob} onChange={setDob} />
      </ProfileCard>
    );
  }
  return (
    <ProfileCard eyebrow="about you" title="Biological sex"
      subtitle="Improves sleep-staging accuracy. You can skip this."
      canContinue={sex !== null} onContinue={done} onSkip={skipAll} isLast>
      <View style={styles.choices}>
        {(['male', 'female', 'unspecified'] as Sex[]).map((opt) => (
          <Button key={opt}
            label={opt === 'unspecified' ? 'prefer not to say' : opt}
            variant={sex === opt ? 'primary' : 'ghost'}
            onPress={() => setSex(opt)} />
        ))}
      </View>
    </ProfileCard>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.textPrimary, fontSize: 22, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider },
  choices: { gap: spacing.sm },
});
