import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { SleepScreen } from '../screens/sleep/SleepScreen';
import { JournalNavigator } from './JournalNavigator';
import { AccountScreen } from '../screens/account/AccountScreen';
import { FloatingTabBar } from './FloatingTabBar';
import { dateRailGestureRef, tabSwipe } from './gestureRefs';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

// Horizontal travel before the swipe activates — high enough that taps and the
// date-rail's small drags never trip it, low enough to feel responsive.
const ACTIVE_OFFSET_X = 22;
// If the finger goes mostly vertical first, FAIL so the vertical ScrollViews
// (night report, sleep screen) keep the gesture.
const FAIL_OFFSET_Y = 14;
// Touches starting within this many px of the left edge yield to the nested
// native-stack back gesture (don't switch tabs on an edge-back drag).
const EDGE_BACK_DEAD_ZONE = 28;
// Commit a tab change past this fraction of the width OR on a fling.
const COMMIT_FRACTION = 0.25;
const FLING_VELOCITY = 550;

/**
 * Bottom-tab navigator wrapped in a full-screen horizontal-swipe Pan so you can
 * swipe between Sleep / Journal / Profile. The Pan reads the LIVE tab index that
 * FloatingTabBar publishes (it can't use tab-navigator context from out here)
 * and drives the SAME navigate + tabPress the bar does on tap — so lazy mount,
 * focus, freezeOnBlur and the unviewed-night dot are all preserved. The Pan
 * yields to the Journal date-rail (requireExternalGestureToFail) and to vertical
 * scrolls (failOffsetY), and only activates on a deliberate horizontal drag.
 */
export function TabNavigator() {
  const { width } = useWindowDimensions();

  const commit = useCallback((delta: number) => {
    const target = tabSwipe.routeNames[tabSwipe.index + delta];
    if (target) tabSwipe.navigateTo(target);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Run callbacks on the JS thread — no Reanimated worklet needed (this app
        // has no other worklets, so this avoids any worklet-transform dependency).
        // The handler only fires once on release, so the JS hop costs nothing.
        .runOnJS(true)
        .activeOffsetX([-ACTIVE_OFFSET_X, ACTIVE_OFFSET_X])
        .failOffsetY([-FAIL_OFFSET_Y, FAIL_OFFSET_Y])
        .minPointers(1)
        .maxPointers(1)
        // A horizontal drag that STARTS on the Journal date-rail scrolls the
        // rail; the tab swipe only takes over if the rail can't consume it.
        .requireExternalGestureToFail(dateRailGestureRef)
        .onEnd((e) => {
          const startX = e.absoluteX - e.translationX;
          const passed = Math.abs(e.translationX) > width * COMMIT_FRACTION;
          const flung = Math.abs(e.velocityX) > FLING_VELOCITY;
          if (!passed && !flung) return;
          // A right-swipe that began at the left edge belongs to the stack back.
          if (e.translationX > 0 && startX < EDGE_BACK_DEAD_ZONE) return;
          commit(e.translationX < 0 ? 1 : -1);
        }),
    [width, commit],
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.fill} collapsable={false}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            // Keep inactive tabs unmounted until first focus, then frozen (not
            // unmounted) so a swipe back is instant and BLE/scroll state survives.
            lazy: true,
            freezeOnBlur: true,
            // The swipe owns the motion; an instant tab swap reads as a page flip.
            animation: 'none',
          }}
          tabBar={(props) => <FloatingTabBar {...props} />}
        >
          <Tab.Screen name="Sleep" component={SleepScreen} />
          <Tab.Screen name="Journal" component={JournalNavigator} />
          <Tab.Screen name="Profile" component={AccountScreen} />
        </Tab.Navigator>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
