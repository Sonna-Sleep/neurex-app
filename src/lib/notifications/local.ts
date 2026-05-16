// Local notifications fired from inside the app. Used to ping the user when
// a long-running async task (upload + cloud processing) finishes, in case
// they switched to another app while waiting.
//
// Uses the permissions already granted via the onboarding flow
// (NotificationsPermission.tsx); does not request them again here.

import * as Notifications from 'expo-notifications';

export async function notifyProcessingComplete(sessionId: string): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Your night is ready',
      body: 'Tap to see how you slept.',
      data: { sessionId },
    },
    trigger: null,
  });
}
