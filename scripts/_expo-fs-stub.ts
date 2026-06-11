// Test-only preload: stub React-Native-only modules BEFORE accountDeletion
// imports them, so the library can load + run under plain node/ts-node.
//
// These stubs all exist for the same reason — they resolve to React-Native
// source (or pull the whole RN graph) that node cannot parse:
//   - `expo-file-system`: package main is RN TS source with no node build.
//   - `react-native` / `expo-notifications`: pulled in transitively via
//     session.ts's signOut → unregisterPushToken (registerPushToken.ts). Their
//     package main is RN/ESM TS source node can't parse. The smokes never call
//     push code, so a minimal stub that just lets the module LOAD is enough.
//   - `./auth/supabase`: drags in @react-native-async-storage → react-native.
//     The smoke always INJECTS a mock client, so getSupabase is only the unused
//     fallback path; stubbing it keeps RN out of the node graph without changing
//     any tested behavior.
//
// Imported for its side effect only; keep it ABOVE the accountDeletion import.
import Module from 'node:module';

const expoFsStub = {
  Paths: { document: '/tmp/neurex-smoke' },
  Directory: class {
    exists = false;
    delete(): void {}
  },
};

// Mock client is always injected in the smoke, so this fallback never runs.
const supabaseStub = { getSupabase: () => null };

// react-native: only Platform is imported by the (unexercised) push path.
const reactNativeStub = { Platform: { OS: 'ios', select: (o: { ios?: unknown; default?: unknown }) => o.ios ?? o.default } };
// expo-notifications: imported as a namespace; never called in the smokes.
const expoNotificationsStub = {};

const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
  if (request === 'expo-file-system') return expoFsStub;
  if (request === 'react-native') return reactNativeStub;
  if (request === 'expo-notifications') return expoNotificationsStub;
  // accountDeletion imports it as `./auth/supabase`; match by suffix so we don't
  // depend on the exact relative string.
  if (request.endsWith('auth/supabase') || request.endsWith('auth/supabase.ts')) {
    return supabaseStub;
  }
  return origLoad.call(this, request, ...rest);
};
