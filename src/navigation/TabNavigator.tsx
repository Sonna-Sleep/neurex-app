import React from 'react';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';

import { SleepScreen } from '../screens/sleep/SleepScreen';
import { JournalNavigator } from './JournalNavigator';
import { AccountScreen } from '../screens/account/AccountScreen';
import { FloatingTabBar } from './FloatingTabBar';
import type { TabParamList } from './types';

// Material top-tabs (positioned at the BOTTOM) give a real native pager:
// screens track your finger and spring into place, on the UI thread — buttery
// at 120Hz. We keep the existing floating bar as the custom tabBar, so lazy
// mount, focus events (JournalScreen's useFocusEffect), the nested Journal
// stack, and the unviewed-night dot all keep working.
const Tab = createMaterialTopTabNavigator<TabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      tabBarPosition="bottom"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        swipeEnabled: true,
        // Keep inactive tabs unmounted until first focus so Sleep streaming /
        // Journal load only run when needed.
        lazy: true,
      }}
    >
      <Tab.Screen name="Sleep" component={SleepScreen} />
      <Tab.Screen name="Journal" component={JournalNavigator} />
      <Tab.Screen name="Profile" component={AccountScreen} />
    </Tab.Navigator>
  );
}
