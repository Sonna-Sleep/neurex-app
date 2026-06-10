import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { SleepScreen } from '../screens/sleep/SleepScreen';
import { JournalNavigator } from './JournalNavigator';
import { AccountScreen } from '../screens/account/AccountScreen';
import { FloatingTabBar } from './FloatingTabBar';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Sleep" component={SleepScreen} />
      <Tab.Screen name="Journal" component={JournalNavigator} />
      <Tab.Screen name="Profile" component={AccountScreen} />
    </Tab.Navigator>
  );
}
