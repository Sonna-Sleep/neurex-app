// Local notifications fired from inside the app. Used to ping the user when
// a long-running async task (upload + cloud processing) finishes, in case
// they switched to another app while waiting.
//
// Uses the permissions already granted via the onboarding flow
// (NotificationsPermission.tsx); does not request them again here.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const NIGHT_READY_CHANNEL_ID = 'night-ready';

async function ensureNightReadyChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NIGHT_READY_CHANNEL_ID, {
    name: 'Night ready',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

export async function notifyProcessingComplete(sessionId: string): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await ensureNightReadyChannel();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Your night is ready',
      body: 'Tap to see how you slept.',
      data: { sessionId },
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: NIGHT_READY_CHANNEL_ID, seconds: 1 } : null,
  });
}

// Recording-alert channel: DEFAULT importance + SILENT (no sound/vibration) so a
// mid-night disconnect surfaces in the shade for the morning without waking the
// sleeper. Distinct from night-ready so the user can mute it separately.
const RECORDING_ALERT_CHANNEL_ID = 'recording-alerts';

async function ensureRecordingAlertChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(RECORDING_ALERT_CHANNEL_ID, {
    name: 'Recording alerts',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: undefined, // silent — don't wake the sleeper
  });
}

async function fireRecordingAlert(title: string, body: string): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await ensureRecordingAlertChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: Platform.OS === 'android' ? { channelId: RECORDING_ALERT_CHANNEL_ID, seconds: 1 } : null,
  });
}

/** Fired the instant the device's BLE link drops mid-recording (before the
 * reconnect grace window), so the user knows it dropped. */
export function notifyDeviceDisconnected(): void {
  void fireRecordingAlert('Device disconnected', 'Trying to reconnect…');
}

/** Fired when a recording is auto-stopped (device didn't reconnect, or battery
 * died) so the user isn't left thinking it's still recording. */
export function notifyRecordingStopped(reason: 'device-lost' | 'battery'): void {
  const body =
    reason === 'battery'
      ? 'Your device battery ran out — recording saved.'
      : 'Your device disconnected and didn’t reconnect — recording saved.';
  void fireRecordingAlert('Recording stopped', body);
}
