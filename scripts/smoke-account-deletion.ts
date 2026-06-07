// Smoke: exercise accountDeletion against an in-memory mock Supabase client.
// Run: npm run smoke:account-deletion
//   (= ts-node --transpile-only --project scripts/tsconfig.scripts.json
//      scripts/smoke-account-deletion.ts)
//
// `./_expo-fs-stub` MUST be imported first: it stubs `expo-file-system` (whose
// package main is RN TS source node can't load) before accountDeletion pulls it
// in, so localWipe runs as a genuine no-op instead of crashing. Library code is
// exercised unmodified.
import './_expo-fs-stub';
process.env.EXPO_PUBLIC_MODAL_ENDPOINT_URL = 'https://example.test';
import assert from 'node:assert';
import {
  requestScheduledDeletion, getPendingDeletion, cancelPendingDeletion, deleteImmediately,
} from '../src/lib/accountDeletion';

function mockClient(uid: string | null) {
  const rows: Record<string, any> = {};
  return {
    _rows: rows,
    auth: {
      getUser: async () => ({ data: { user: uid ? { id: uid } : null } }),
      getSession: async () => ({ data: { session: uid ? { access_token: 'tok' } : null } }),
    },
    from() {
      return {
        upsert: async (r: any) => { rows[r.user_id] = r; return { error: null }; },
        delete() { return { eq: async (_c: string, v: string) => { delete rows[v]; return { error: null }; } }; },
        select() { return { eq: (_c: string, v: string) => ({ maybeSingle: async () => ({ data: rows[v] ?? null, error: null }) }) }; },
      };
    },
  } as any;
}

(async () => {
  const c = mockClient('u1');
  assert.strictEqual(await getPendingDeletion(c), null);
  const { purgeAfterMs } = await requestScheduledDeletion(c);
  assert.ok(purgeAfterMs > Date.now());
  const p = await getPendingDeletion(c);
  assert.ok(p && p.userId === 'u1');
  assert.strictEqual(await cancelPendingDeletion(c), true);
  assert.strictEqual(await getPendingDeletion(c), null);

  // immediate: mock fetch. localWipe runs against the stubbed FS (no-op).
  const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  await deleteImmediately(c, okFetch);
  const badFetch = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
  await assert.rejects(() => deleteImmediately(c, badFetch));
  console.log('smoke-account-deletion OK');
})();
