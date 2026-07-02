import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TesterLog } from '../lib/cloud/sessionMetadata';

type DiagnosticsState = {
  // The last tester-log, kept so the form pre-fills (change ONE variable per run).
  lastTesterLog: TesterLog | null;
  setLastTesterLog: (log: TesterLog | null) => void;
};

export const useDiagnostics = create<DiagnosticsState>()(
  persist(
    (set) => ({
      lastTesterLog: null,
      setLastTesterLog: (lastTesterLog) => set({ lastTesterLog }),
    }),
    {
      name: 'neurex-diagnostics',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        lastTesterLog: s.lastTesterLog,
      }),
    },
  ),
);
