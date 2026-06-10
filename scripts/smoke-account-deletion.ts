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

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectRejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

(async () => {
  const {
    requestScheduledDeletion,
    getPendingDeletion,
    cancelPendingDeletion,
    deleteImmediately,
  } = await import('../src/lib/accountDeletion');

  const c = mockClient('u1');
  expectEqual(await getPendingDeletion(c), null, 'initial pending deletion');
  const { purgeAfterMs } = await requestScheduledDeletion(c);
  expect(purgeAfterMs > Date.now(), 'purgeAfterMs should be in the future');
  const p = await getPendingDeletion(c);
  expect(p && p.userId === 'u1', 'pending deletion should belong to u1');
  expectEqual(await cancelPendingDeletion(c), true, 'cancelPendingDeletion');
  expectEqual(await getPendingDeletion(c), null, 'pending deletion after cancel');

  // immediate: mock fetch. localWipe runs against the stubbed FS (no-op).
  const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  await deleteImmediately(c, okFetch);
  const badFetch = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
  await expectRejects(() => deleteImmediately(c, badFetch), 'bad immediate delete should reject');
  console.log('smoke-account-deletion OK');
})();
