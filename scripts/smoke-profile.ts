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

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectDeepEqual(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  message: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

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
  const { ageFromDob, getProfile, saveProfile } = await import('../src/lib/profile');

  expect(ageFromDob('1990-01-01')! >= 30, 'age from 1990 should be at least 30');
  expectEqual(ageFromDob(null), null, 'null dob');
  expectEqual(ageFromDob('not-a-date'), null, 'invalid dob');
  expectEqual(ageFromDob(`${new Date().getFullYear() + 1}-01-01`), null, 'future dob');

  const c = mockClient();
  expectDeepEqual(await getProfile(c), { firstName: null, dob: null, sex: null }, 'empty profile');
  await saveProfile({ firstName: 'Alex', dob: '1990-06-15', sex: 'male' }, c);
  expectDeepEqual(
    await getProfile(c),
    { firstName: 'Alex', dob: '1990-06-15', sex: 'male' },
    'saved profile',
  );
  console.log('smoke-profile OK');
})();
