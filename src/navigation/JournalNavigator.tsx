// Journal tab stack: latest-night home, full calendar browse, and per-night
// SessionDetail for notifications/deep links.
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { JournalCalendarScreen } from '../screens/journal/JournalCalendarScreen';
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
      <Stack.Screen name="JournalCalendar" component={JournalCalendarScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} options={{ title: 'Night' }} />
    </Stack.Navigator>
  );
}
