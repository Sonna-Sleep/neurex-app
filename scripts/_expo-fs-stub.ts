// Test-only preload: stub React-Native-only modules BEFORE accountDeletion
// imports them, so the library can load + run under plain node/ts-node.
//
// These stubs all exist for the same reason — they resolve to React-Native
// source (or pull the whole RN graph) that node cannot parse:
//   - `expo-file-system`: package main is RN TS source with no node build.
//   - `expo-file-system/legacy`: imported by the chunk-upload driver for
//     uploadAsync; profile/recovery smokes only need the module to load.
//   - `@react-native-async-storage/async-storage`: session/recovery state
//     persists through AsyncStorage in the app, but smokes use in-memory state.
//   - `expo-crypto`: chunkUploadStore imports it for hashing; tests that need
//     the hash can use the node-backed digest below without loading Expo native
//     modules.
//   - `react-native` / `expo-notifications`: pulled in transitively via
//     session.ts's signOut -> clearPushTokenRegistration (registerPushToken.ts). Their
//     package main is RN/ESM TS source node can't parse. The smokes never call
//     push code, so a minimal stub that just lets the module LOAD is enough.
//   - `./auth/supabase`: drags in @react-native-async-storage → react-native.
//     The smoke always INJECTS a mock client, so getSupabase is only the unused
//     fallback path; stubbing it keeps RN out of the node graph without changing
//     any tested behavior.
//
// Imported for its side effect only; keep it ABOVE the accountDeletion import.
import Module from 'node:module';
import { createHash } from 'node:crypto';

const mem = new Map<string, string>();

const expoFsStub = {
  Paths: { document: '/tmp/neurex-smoke' },
  Directory: class {
    exists = false;
    list(): unknown[] { return []; }
    delete(): void {}
    create(): void {}
  },
  File: class {
    exists = false;
    size = 0;
    modificationTime = Date.now();
    uri = '/tmp/neurex-smoke/file';
    constructor(...parts: unknown[]) {
      const last = parts[parts.length - 1];
      if (typeof last === 'string') this.uri = last;
    }
    create(): void { this.exists = true; }
    delete(): void { this.exists = false; }
    write(): void { this.exists = true; }
    textSync(): string { return ''; }
    open() {
      return { readBytes: () => new Uint8Array(0), close() {} };
    }
  },
};

const legacyFsStub = {
  FileSystemUploadType: { BINARY_CONTENT: 'BINARY_CONTENT' },
  FileSystemSessionType: { FOREGROUND: 'FOREGROUND' },
  uploadAsync: async () => ({ status: 200, body: '{}' }),
};

const asyncStorageStub = {
  getItem: async (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: async (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: async (k: string) => { mem.delete(k); },
  clear: async () => { mem.clear(); },
  multiRemove: async (keys: string[]) => { keys.forEach((k) => mem.delete(k)); },
};

const cryptoStub = {
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, data: ArrayBuffer | Uint8Array) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const buf = createHash('sha256').update(bytes).digest();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  },
};

const notificationsStub = {
  getPermissionsAsync: async () => ({ status: 'denied' }),
  getExpoPushTokenAsync: async () => ({ data: null }),
  addPushTokenListener: () => ({ remove() {} }),
};

const reactNativeStub = {
  Platform: { OS: 'ios', select: (o: { ios?: unknown; default?: unknown }) => o.ios ?? o.default },
};

// Mock client is always injected in the smoke, so this fallback never runs.
const supabaseStub = { getSupabase: () => null };

const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
  if (request === 'expo-file-system/legacy') return legacyFsStub;
  if (request === 'expo-file-system') return expoFsStub;
  if (request === '@react-native-async-storage/async-storage') return asyncStorageStub;
  if (request === 'expo-crypto') return cryptoStub;
  if (request === 'react-native') return reactNativeStub;
  if (request === 'expo-notifications') return notificationsStub;
  // accountDeletion imports it as `./auth/supabase`; match by suffix so we don't
  // depend on the exact relative string.
  if (request.endsWith('auth/supabase') || request.endsWith('auth/supabase.ts')) {
    return supabaseStub;
  }
  return origLoad.call(this, request, ...rest);
};
