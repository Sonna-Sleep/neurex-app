// Reads/writes the user profile stored on the Supabase auth user's
// user_metadata (keys first_name/dob/sex). Client injected for testability.
import { getSupabase } from './auth/supabase';
import { useSession } from '../state/session';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Sex = 'male' | 'female' | 'unspecified';
export type Profile = {
  firstName: string | null;
  dob: string | null;            // 'YYYY-MM-DD'
  sex: Sex | null;
};

function client(injected?: SupabaseClient | null): SupabaseClient {
  const c = injected ?? getSupabase();
  if (!c) throw new Error('Supabase not configured');
  return c;
}

/** Years from an ISO dob, or null if absent/invalid/out of range. */
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age > 0 && age < 120 ? age : null;
}

export async function getProfile(injected?: SupabaseClient | null): Promise<Profile> {
  const { data } = await client(injected).auth.getUser();
  const m = (data.user?.user_metadata ?? {}) as any;
  return { firstName: m.first_name ?? null, dob: m.dob ?? null, sex: m.sex ?? null };
}

/** Persist only the provided fields to user_metadata, then update the session. */
export async function saveProfile(
  patch: Partial<Profile>,
  injected?: SupabaseClient | null,
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.firstName !== undefined) data.first_name = patch.firstName;
  if (patch.dob !== undefined) data.dob = patch.dob;
  if (patch.sex !== undefined) data.sex = patch.sex;
  const { error } = await client(injected).auth.updateUser({ data });
  if (error) throw new Error(error.message);
  useSession.getState().patchUser({
    ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
    ...(patch.dob !== undefined ? { dob: patch.dob } : {}),
    ...(patch.sex !== undefined ? { sex: patch.sex } : {}),
  });
}
