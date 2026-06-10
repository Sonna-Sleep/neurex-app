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
      { onConflict: 'user_id,token' },
    );
}

export async function registerPushToken(userId: string): Promise<void> {
  if (!projectId) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) await upsertToken(userId, token);

    // iOS can rotate the token; keep the row current. Attach once per process.
    if (!tokenListenerAttached) {
      tokenListenerAttached = true;
      Notifications.addPushTokenListener((t) => {
        upsertToken(userId, t.data).catch(() => undefined);
      });
    }
  } catch {
    // Push is best-effort — a missing token must never block sign-in.
  }
}
