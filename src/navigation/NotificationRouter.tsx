// Routes a tapped "Your night is ready" notification to that night's
// SessionDetail. `useLastNotificationResponse` covers both a warm tap (app
// already running) and a cold launch (app was killed and opened via the
// notification). Renders nothing.
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

import { useSession } from '../state/session';
import { openNight } from './navigationRef';

export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const onboardingComplete = useSession((s) => s.onboardingComplete);
  // The hook returns the same response object across renders; guard so one tap
  // routes once (and so it re-tries once onboarding/nav becomes ready).
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !onboardingComplete) return;
    const id = response.notification.request.identifier;
    const sessionId = response.notification.request.content.data?.sessionId;
    if (typeof sessionId !== 'string' || handled.current === id) return;
    handled.current = id;
    openNight(sessionId);
  }, [response, onboardingComplete]);

  return null;
}
