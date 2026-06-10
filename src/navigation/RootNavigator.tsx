import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useSession } from '../state/session';
import { colors } from '../theme/tokens';
import { OnboardingNavigator } from './OnboardingNavigator';
import { TabNavigator } from './TabNavigator';
import { RecordScreen } from '../screens/record/RecordScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bgPrimary,
    card: colors.bgPrimary,
    text: colors.textPrimary,
    border: colors.borderSubtle,
    primary: colors.textPrimary,
    notification: colors.warning,
  },
};

export function RootNavigator() {
  const onboardingComplete = useSession((s) => s.onboardingComplete);
  const hydrated = useSession((s) => s.hydrated);

  if (!hydrated) return null;

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {onboardingComplete ? (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="Record" component={RecordScreen} />
            {/* Standard push (not a modal) so it never traps: iOS edge-swipe
                back works and BackButton returns to the tabs. */}
          </>
        ) : (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
