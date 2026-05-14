import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HistoryScreen } from '../screens/history/HistoryScreen';
import { SessionDetailScreen } from '../screens/history/SessionDetailScreen';
import type { HistoryStackParamList } from './types';

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export function HistoryNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="HistoryList" component={HistoryScreen} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} />
    </Stack.Navigator>
  );
}
