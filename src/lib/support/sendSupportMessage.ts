// Submits a Contact-support message to the `support_messages` table.
//
// Insert-only by RLS: the signed-in user can file a message (user_id defaults
// to auth.uid() server-side) but can't read anyone's, including their own —
// support reads them via the dashboard / service-role tooling. Platform and
// app version ride along so a reply doesn't have to ask "which build?".

import { Platform } from 'react-native';

import { getSupabase } from '../auth/supabase';
import appConfig from '../../../app.json';

export async function sendSupportMessage(email: string, message: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Not connected — try again in a moment.');
  const { error } = await supabase.from('support_messages').insert({
    email,
    message,
    platform: Platform.OS,
    app_version: appConfig.expo.version,
  });
  if (error) throw new Error(`Couldn't send your message: ${error.message}`);
}
