/**
 * RLS smoke test. Run with:
 *   npm run smoke:rls -- <userA-jwt> <userB-jwt>
 *
 * Each JWT is an authenticated user's access token (from a real Supabase
 * session). The script:
 *   1. Inserts a `devices` row as User A.
 *   2. Tries to read User A's devices as User B — must return 0 rows.
 *   3. Tries to update User A's row as User B — must return 0 rows updated.
 *   4. Reads `score_config` as User A — must return 6 rows.
 *   5. Tries to insert into `score_config` as User A — must fail.
 *   6. Tries to fake User A's own sleep_score (migration 12 column grant) — must fail.
 *
 * If any assertion fails the script exits non-zero.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

function clientFor(jwt: string) {
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const [, , jwtA, jwtB] = process.argv;
  if (!jwtA || !jwtB) {
    console.error('Usage: npm run smoke:rls -- <userA-jwt> <userB-jwt>');
    process.exit(1);
  }

  const a = clientFor(jwtA);
  const b = clientFor(jwtB);

  const { data: userA } = await a.auth.getUser();
  const { data: userB } = await b.auth.getUser();
  if (!userA.user || !userB.user) throw new Error('one or both JWTs invalid');
  if (userA.user.id === userB.user.id) throw new Error('JWTs are the same user');

  // 1. A inserts a device
  const hardwareId = `smoke-${Date.now()}`;
  const { data: ins, error: insErr } = await a
    .from('devices')
    .insert({ owner_user_id: userA.user.id, hardware_id: hardwareId, color_variant: 'yellow' })
    .select()
    .single();
  if (insErr) throw new Error(`A insert failed: ${insErr.message}`);
  console.log(`OK insert as A: device ${ins.id}`);

  // 2. B reads A's devices — must be empty
  const { data: read } = await b.from('devices').select('*').eq('hardware_id', hardwareId);
  if (read && read.length > 0) throw new Error(`RLS BREACH: B read A's device row`);
  console.log(`OK isolation: B sees 0 of A's devices`);

  // 3. B tries to update A's row — must return 0 rows updated
  const { data: upd } = await b
    .from('devices')
    .update({ firmware_version: 'pwned' })
    .eq('hardware_id', hardwareId)
    .select();
  if (upd && upd.length > 0) throw new Error(`RLS BREACH: B updated A's device row`);
  console.log(`OK isolation: B's update affected 0 rows`);

  // 4. A reads score_config (public to authenticated users)
  const { data: cfg } = await a.from('score_config').select('*');
  if (!cfg || cfg.length < 6) throw new Error(`score_config has ${cfg?.length ?? 0} rows, expected >=6`);
  console.log(`OK read score_config: ${cfg.length} rows`);

  // 5. A tries to insert into score_config — must fail
  const { error: cfgErr } = await a
    .from('score_config')
    .insert({ key: `smoke-${Date.now()}`, value: { foo: 'bar' } });
  if (!cfgErr) throw new Error(`RLS BREACH: A inserted into score_config`);
  console.log(`OK RLS blocks A from writing score_config (${cfgErr.message})`);

  // 6. A creates a session, then tries to fake its sleep_score — column grant
  //    (migration 12) must block the write while allowing journal_tags.
  const { data: sess, error: sessErr } = await a
    .from('sessions')
    .insert({
      user_id: userA.user.id,
      start_ts: new Date().toISOString(),
      day_assigned: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (sessErr) throw new Error(`A session insert failed: ${sessErr.message}`);

  const { error: fakeErr } = await a
    .from('sessions')
    .update({ sleep_score: 99 })
    .eq('id', sess.id);
  if (!fakeErr) throw new Error(`GRANT BREACH: A updated its own sleep_score`);
  console.log(`OK column grant blocks A from faking sleep_score (${fakeErr.message})`);

  const { error: tagErr } = await a
    .from('sessions')
    .update({ journal_tags: ['smoke-test'] })
    .eq('id', sess.id);
  if (tagErr) throw new Error(`A could not update journal_tags on its own session: ${tagErr.message}`);
  console.log(`OK column grant still allows A to update journal_tags`);

  // Cleanup A's rows
  await a.from('sessions').delete().eq('id', sess.id);
  await a.from('devices').delete().eq('hardware_id', hardwareId);
  console.log(`OK cleanup`);

  console.log('\nAll RLS assertions passed.');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
