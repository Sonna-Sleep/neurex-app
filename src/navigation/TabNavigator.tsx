import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text } from 'react-native';

import { HomeScreen } from '../screens/home/HomeScreen';
import { HistoryNavigator } from './HistoryNavigator';
import { AccountScreen } from '../screens/account/AccountScreen';
import { TabIcon } from '../components/TabIcon';
import { colors, fonts } from '../theme/tokens';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type TabKey = 'home' | 'history' | 'account';

function TabLabel({ label, focused }: { label: TabKey; focused: boolean }) {
  return (
    <Text
      style={[
        styles.tabLabel,
        { color: focused ? colors.textPrimary : colors.textTertiary },
      ]}
    >
      {label}
    </Text>
  );
}

const tabIconColor = (focused: boolean) =>
  focused ? colors.textPrimary : colors.textTertiary;

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: true,
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="home" color={tabIconColor(focused)} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel label="home" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryNavigator}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="history" color={tabIconColor(focused)} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel label="history" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="account" color={tabIconColor(focused)} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel label="account" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    height: 80,
    paddingTop: 8,
  },
  tabLabel: {
    fontFamily: fonts.sansMedium,
    fontWeight: '500',
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
