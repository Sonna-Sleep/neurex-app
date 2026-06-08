import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { Welcome } from '../screens/onboarding/Welcome';
import { Auth } from '../screens/onboarding/Auth';
import { EmailSent } from '../screens/onboarding/EmailSent';
import { Profile } from '../screens/onboarding/Profile';
import { Pair } from '../screens/onboarding/Pair';
import { HowItWorks } from '../screens/onboarding/HowItWorks';
import { NotificationsPermission } from '../screens/onboarding/NotificationsPermission';
import type { OnboardingStackParamList } from './types';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    >
      <Stack.Screen name="Welcome" component={Welcome} />
      <Stack.Screen name="Auth" component={Auth} />
      <Stack.Screen name="EmailSent" component={EmailSent} />
      <Stack.Screen name="Profile" component={Profile} />
      <Stack.Screen name="Pair" component={Pair} />
      <Stack.Screen name="HowItWorks" component={HowItWorks} />
      <Stack.Screen
        name="NotificationsPermission"
        component={NotificationsPermission}
      />
    </Stack.Navigator>
  );
}
