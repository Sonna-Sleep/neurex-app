// Registers this device's Expo push token so the backend can send the
// "Your night is ready" push when a session finishes overnight (the app can't
// fire a local notification while it's fully closed). The token + platform are
// upserted into Supabase `user_push_tokens` (RLS-scoped to the user).
//
// Permission itself is requested during onboarding (NotificationsPermission);
// here we only read a token when it's already granted.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { getSupabase } from '../auth/supabase';
import appConfig from '../../../app.json';

const projectId = appConfig.expo.extra?.eas?.projectId;

let tokenListenerAttached = false;

async function upsertToken(userId: string, token: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from('user_push_tokens')
    .upsert(
      { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
}

export async function unregisterPushToken(): Promise<void> {
  if (!projectId) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('user_push_tokens').delete().eq('token', token);
  } catch (e) {
    if (__DEV__) console.warn('[push] registration failed', e);
    // Best-effort — sign-out must not be blocked by a failed token delete.
  }
}

export async function registerPushToken(userId: string): Promise<void> {
  if (!projectId) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) await upsertToken(userId, token);

    // iOS can rotate the underlying device token; re-fetch the Expo push token
    // (which may have changed) and keep the row current. Attach once per process.
    // NOTE: t.data is the raw APNs/FCM token — upsert that directly and the
    // backend's Expo push batch breaks. Always re-derive via getExpoPushTokenAsync.
    if (!tokenListenerAttached) {
      tokenListenerAttached = true;
      Notifications.addPushTokenListener(() => {
        Notifications.getExpoPushTokenAsync({ projectId })
          .then(({ data: expoToken }) => upsertToken(userId, expoToken))
          .catch((err) => {
            if (__DEV__) console.warn('[registerPushToken] rotation re-fetch failed', err);
          });
      });
    }
  } catch (e) {
    if (__DEV__) console.warn('[push] registration failed', e);
    // Push is best-effort — a missing token must never block sign-in.
  }
}
