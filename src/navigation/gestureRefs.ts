// Shared gesture/navigation state so the full-screen tab-swipe Pan (TabNavigator)
// can (a) read the LIVE focused tab + navigate without being inside the tab
// navigator's React context, and (b) yield to the Journal horizontal date-rail
// ScrollView so a drag that starts on the rail scrolls the rail instead of
// switching tabs.
import type { MutableRefObject } from 'react';
import type { GestureType } from 'react-native-gesture-handler';

// Attached to a Gesture.Native().withRef(...) wrapping the date-rail. The tab
// Pan calls .requireExternalGestureToFail() against it. withRef wants
// MutableRefObject<GestureType | undefined>, so build it explicitly.
export const dateRailGestureRef: MutableRefObject<GestureType | undefined> = {
  current: undefined,
};

// Published by FloatingTabBar (which receives the tab navigator's state +
// navigation). The swipe Pan reads index/routeNames and calls navigateTo on
// commit — mirroring the exact tabPress + navigate the bar itself does on tap.
export const tabSwipe: {
  index: number;
  routeNames: string[];
  navigateTo: (name: string) => void;
} = {
  index: 0,
  routeNames: [],
  navigateTo: () => {},
};
