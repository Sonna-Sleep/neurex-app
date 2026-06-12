// Smoke: exercise push token ownership without a React Native runtime.
// Run: npm run smoke:push
import Module from 'node:module';

type Row = { user_id: string; token: string; platform: string; updated_at: string };

let currentExpoToken = 'ExponentPushToken[first]';
let tokenListener: ((token: { data: string }) => void) | null = null;

const rows = new Map<string, Row>();
const key = (userId: string, token: string) => `${userId}:${token}`;

const supabaseStub = {
  from(table: string) {
    if (table !== 'user_push_tokens') throw new Error(`unexpected table ${table}`);
    return {
      async upsert(row: Row) {
        rows.set(key(row.user_id, row.token), row);
        return { error: null };
      },
      delete() {
        const filters: Record<string, string> = {};
        return {
          eq(column: string, value: string) {
            filters[column] = value;
            if (filters.user_id && filters.token) {
              rows.delete(key(filters.user_id, filters.token));
              return Promise.resolve({ error: null });
            }
            return this;
          },
        };
      },
    };
  },
};

const notificationsStub = {
  async getPermissionsAsync() {
    return { status: 'granted' };
  },
  async getExpoPushTokenAsync() {
    return { data: currentExpoToken };
  },
  addPushTokenListener(listener: (token: { data: string }) => void) {
    tokenListener = listener;
    return { remove() {} };
  },
};

const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
  if (request === 'react-native') return { Platform: { OS: 'ios' } };
  if (request === 'expo-notifications') return notificationsStub;
  if (request.endsWith('auth/supabase') || request.endsWith('auth/supabase.ts')) {
    return { getSupabase: () => supabaseStub };
  }
  return origLoad.call(this, request, ...rest);
};

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function emitToken(data: string): void {
  const listener = tokenListener as ((token: { data: string }) => void) | null;
  if (!listener) throw new Error('push token listener was not attached');
  listener({ data });
}

(async () => {
  const { registerPushToken, clearPushTokenRegistration } = await import(
    '../src/lib/push/registerPushToken'
  );

  await registerPushToken('u1');
  expect(rows.has(key('u1', 'ExponentPushToken[first]')), 'initial token should belong to u1');

  currentExpoToken = 'ExponentPushToken[rotated-u1]';
  emitToken('raw-apns-token-u1');
  await new Promise((r) => setTimeout(r, 0));
  expect(rows.has(key('u1', 'ExponentPushToken[rotated-u1]')), 'rotated token should use u1');

  currentExpoToken = 'ExponentPushToken[u2]';
  await registerPushToken('u2');
  currentExpoToken = 'ExponentPushToken[rotated-u2]';
  emitToken('raw-apns-token-u2');
  await new Promise((r) => setTimeout(r, 0));
  expect(rows.has(key('u2', 'ExponentPushToken[u2]')), 'fresh token should belong to u2');
  expect(rows.has(key('u2', 'ExponentPushToken[rotated-u2]')), 'rotated token should use u2');
  expect(!rows.has(key('u1', 'ExponentPushToken[rotated-u2]')), 'rotation must not use stale u1');

  await clearPushTokenRegistration();
  expect(!rows.has(key('u2', 'ExponentPushToken[u2]')), 'clear should delete current device token');
  expect(
    !rows.has(key('u2', 'ExponentPushToken[rotated-u2]')),
    'clear should delete rotated tokens registered in this process',
  );

  currentExpoToken = 'ExponentPushToken[after-clear]';
  emitToken('raw-apns-token-after-clear');
  await new Promise((r) => setTimeout(r, 0));
  expect(!rows.has(key('u2', 'ExponentPushToken[after-clear]')), 'clear should disable listener writes');

  console.log('smoke-push OK');
})();
