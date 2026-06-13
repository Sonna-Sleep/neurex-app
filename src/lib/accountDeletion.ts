// Account-deletion lifecycle. Schedule = a plain RLS-protected row write (no
// privileged backend). Immediate = a Modal endpoint call. Cancel = delete the
// row. The Supabase client + fetch are injected so this is unit-smoke-testable.
//
// Backend contract (neurex-backend migration 0003): table
// `account_deletion_requests` has `user_id uuid primary key` (so upsert updates
// in place and maybeSingle() is safe) with RLS scoping every row to auth.uid().
import { Directory, Paths } from 'expo-file-system';
import { getSupabase } from './auth/supabase';
import { MODAL_ENDPOINT_URL } from './config';
import type { SupabaseClient } from '@supabase/supabase-js';

const DELETE_PATH = '/account/delete';
const GRACE_DAYS = 30;
const TABLE = 'account_deletion_requests';

export type PendingDeletion = { userId: string; purgeAfterMs: number };

function client(injected?: SupabaseClient | null): SupabaseClient {
  const c = injected ?? getSupabase();
  if (!c) throw new Error('Supabase not configured');
  return c;
}

/** Schedule deletion in GRACE_DAYS. Writes the caller's own row (RLS). */
export async function requestScheduledDeletion(
  injected?: SupabaseClient | null,
): Promise<{ purgeAfterMs: number }> {
  const c = client(injected);
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('not signed in');
  const purgeAfter = new Date(Date.now() + GRACE_DAYS * 86400_000);
  const { error } = await c
    .from(TABLE)
    .upsert(
      { user_id: uid, requested_at: new Date().toISOString(), purge_after: purgeAfter.toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(error.message);
  return { purgeAfterMs: purgeAfter.getTime() };
}

/** Immediate, permanent deletion via the Modal endpoint, then local wipe. */
export async function deleteImmediately(
  injected?: SupabaseClient | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!MODAL_ENDPOINT_URL) throw new Error('EXPO_PUBLIC_MODAL_ENDPOINT_URL is not set');
  const c = client(injected);
  const { data } = await c.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');
  const base = MODAL_ENDPOINT_URL.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}${DELETE_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
  await localWipe();
}

/** The caller's pending deletion, or null. */
export async function getPendingDeletion(
  injected?: SupabaseClient | null,
): Promise<PendingDeletion | null> {
  const c = client(injected);
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await c
    .from(TABLE)
    .select('user_id,purge_after')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !data) return null;
  return { userId: data.user_id, purgeAfterMs: new Date(data.purge_after).getTime() };
}

/** Cancel a pending deletion (delete the caller's row). Safe if none exists. */
export async function cancelPendingDeletion(
  injected?: SupabaseClient | null,
): Promise<boolean> {
  const c = client(injected);
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { error } = await c.from(TABLE).delete().eq('user_id', uid);
  return !error;
}

/** Remove on-device recordings + downloads. Auth/store reset is signOut's job. */
export async function localWipe(): Promise<void> {
  for (const name of ['sessions', 'downloads']) {
    try {
      const dir = new Directory(Paths.document, name);
      if (dir.exists) dir.delete();
    } catch {
      // best-effort; a missing dir is fine
    }
  }
}
