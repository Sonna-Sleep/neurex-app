// Imperative navigation handle so code outside the React tree (a notification
// tap handler) can route into the app. Attached to the NavigationContainer in
// RootNavigator.
import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Open one night's SessionDetail inside the Journal tab. No-ops until the
// container is ready and the main (post-onboarding) navigator is mounted.
export function openNight(sessionId: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Main', {
    screen: 'Journal',
    params: { screen: 'SessionDetail', params: { sessionId } },
  });
}
