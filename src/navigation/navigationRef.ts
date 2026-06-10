// Imperative navigation handle, used from outside React components — e.g. a
// push-notification tap that must deep-link to the user's nights, even on a
// cold start. Wired into the NavigationContainer in RootNavigator.

import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Open the user's nights after tapping a "report ready" push. Deep-links to the
 * Journal tab, where the just-staged night surfaces via the focus-refetch.
 * No-op until the navigator is mounted. */
export function openSession(sessionId: string): void {
  if (!navigationRef.isReady()) return;
  if (__DEV__) console.log('[push] opening night', sessionId);
  navigationRef.navigate('Main', { screen: 'Journal' });
}
