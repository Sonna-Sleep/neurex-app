// Handles a tapped "your report is ready" notification by deep-linking to that
// night. Covers both paths:
//   - warm: the app is running → addNotificationResponseReceivedListener fires.
//   - cold: the tap launched the app → getLastNotificationResponseAsync returns
//     the launching response once.
// Mounted at the navigation root (RootNavigator), which owns navigationRef.

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { openSession } from '../../navigation/navigationRef';

function sessionIdFrom(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { sessionId?: unknown } | undefined;
  return typeof data?.sessionId === 'string' ? data.sessionId : null;
}

export function usePushDeepLinks(): void {
  useEffect(() => {
    let handledColdStart = false;

    // Cold start: the notification that launched the app.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const sid = sessionIdFrom(response);
        if (sid) {
          handledColdStart = true;
          openSession(sid);
        }
      })
      .catch(() => undefined);

    // Warm taps while the app is alive.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      // The cold-start handler above already consumed the launching tap; ignore
      // an identical immediate re-delivery of it.
      if (handledColdStart) {
        handledColdStart = false;
        return;
      }
      const sid = sessionIdFrom(response);
      if (sid) openSession(sid);
    });

    return () => sub.remove();
  }, []);
}
