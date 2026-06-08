// Test-only preload: stub React-Native-only modules BEFORE accountDeletion
// imports them, so the library can load + run under plain node/ts-node.
//
// Two stubs, both for the same reason — these resolve to React-Native source
// (or pull the whole RN graph) that node cannot parse:
//   - `expo-file-system`: package main is RN TS source with no node build.
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
    constructor(..._parts: unknown[]) {}
    delete(): void {}
  },
};

// Mock client is always injected in the smoke, so this fallback never runs.
const supabaseStub = { getSupabase: () => null };

const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
  if (request === 'expo-file-system') return expoFsStub;
  // accountDeletion imports it as `./auth/supabase`; match by suffix so we don't
  // depend on the exact relative string.
  if (request.endsWith('auth/supabase') || request.endsWith('auth/supabase.ts')) {
    return supabaseStub;
  }
  return origLoad.call(this, request, ...rest);
};
