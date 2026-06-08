// Run: npx ts-node --transpile-only --project scripts/tsconfig.scripts.json scripts/smoke-profile.ts
import './_expo-fs-stub';
// session.ts wires zustand `persist` to AsyncStorage, whose CommonJS backend
// writes via window.localStorage. saveProfile -> patchUser fires that write, so
// give node a tiny in-memory localStorage; otherwise the persist flush rejects
// with "window is not defined" after the assertions already passed.
const mem = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    get length() { return mem.size; },
  },
};
import assert from 'node:assert';
import { ageFromDob, getProfile, saveProfile } from '../src/lib/profile';

assert.strictEqual(ageFromDob('1990-01-01')! >= 30, true);
assert.strictEqual(ageFromDob(null), null);
assert.strictEqual(ageFromDob('not-a-date'), null);
assert.strictEqual(ageFromDob(`${new Date().getFullYear() + 1}-01-01`), null); // future

function mockClient() {
  const meta: Record<string, unknown> = {};
  return {
    auth: {
      getUser: async () => ({ data: { user: { user_metadata: { ...meta } } } }),
      updateUser: async ({ data }: any) => { Object.assign(meta, data); return { error: null }; },
    },
  } as any;
}

(async () => {
  const c = mockClient();
  assert.deepStrictEqual(await getProfile(c), { firstName: null, dob: null, sex: null });
  await saveProfile({ firstName: 'Alex', dob: '1990-06-15', sex: 'male' }, c);
  assert.deepStrictEqual(await getProfile(c), { firstName: 'Alex', dob: '1990-06-15', sex: 'male' });
  console.log('smoke-profile OK');
})();
