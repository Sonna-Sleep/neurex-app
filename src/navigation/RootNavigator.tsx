import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useSession } from '../state/session';
import { colors } from '../theme/tokens';
import { OnboardingNavigator } from './OnboardingNavigator';
import { TabNavigator } from './TabNavigator';
import { navigationRef } from './navigationRef';
import { NotificationRouter } from './NotificationRouter';
import { useRecoverOnLaunch } from '../lib/cloud/useRecoverOnLaunch';
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

  // Recover + upload any night left on disk by a crash/kill/failed upload.
  // Called unconditionally before any early return so hook order stays stable.
  useRecoverOnLaunch();

  if (!hydrated) return null;

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {onboardingComplete ? (
          <Stack.Screen name="Main" component={TabNavigator} />
        ) : (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        )}
      </Stack.Navigator>
      <NotificationRouter />
    </NavigationContainer>
  );
}
