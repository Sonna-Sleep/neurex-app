// Journal tab stack: the calendar (JournalHome) plus a per-night SessionDetail
// route, so a notification tap (or any deep link) can open one night directly
// with a native back button.
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { JournalScreen } from '../screens/journal/JournalScreen';
import { SessionDetailScreen } from '../screens/journal/SessionDetailScreen';
import { colors } from '../theme/tokens';
import type { JournalStackParamList } from './types';

const Stack = createNativeStackNavigator<JournalStackParamList>();

export function JournalNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgPrimary },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="JournalHome" component={JournalScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} options={{ title: 'Night' }} />
    </Stack.Navigator>
  );
}
