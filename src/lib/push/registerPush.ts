// Expo Push registration. On sign-in we acquire the device's Expo push token and
// upsert it into the `push_tokens` table so the backend can notify this user
// when their sleep report is ready — even with the app fully closed.
//
// Everything here is best-effort: in Expo Go, on a simulator, or before the
// APNs key is uploaded to Expo, token acquisition can fail. A failure must never
// crash or block the app — push is an enhancement on top of the in-app result
// delivery, not a dependency of it.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { getSupabase } from '../auth/supabase';

// Show the banner + list entry even when the app is foregrounded; no sound/badge
// (a sleep app shouldn't ping aggressively). Set once at module load.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Avoid a redundant upsert for the same token within a session.
let syncedToken: string | null = null;

function resolveProjectId(): string | undefined {
  // EAS injects easConfig at build time; expoConfig.extra.eas.projectId is the
  // source in app.json. Prefer whichever is present.
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return fromExtra ?? fromEas;
}

/** Acquire (requesting permission if needed) the Expo push token and persist it
 * for the signed-in user. Safe to call repeatedly. */
export async function registerForPush(): Promise<void> {
  try {
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return; // user declined — nothing to register

    const projectId = resolveProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token || token === syncedToken) return;

    const supabase = getSupabase();
    if (!supabase) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: uid,
        token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );
    if (error) {
      if (__DEV__) console.warn('[push] token upsert failed:', error.message);
      return;
    }
    syncedToken = token;
    if (__DEV__) console.log('[push] registered Expo push token');
  } catch (e) {
    // Expo Go / simulator / missing APNs key → token acquisition throws. Swallow.
    if (__DEV__) console.warn('[push] register skipped:', e);
  }
}

/** Clear the in-session token cache (call on sign-out so the next user re-syncs). */
export function resetPushRegistration(): void {
  syncedToken = null;
}
