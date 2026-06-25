import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TesterLog } from '../lib/cloud/sessionMetadata';

// Whether to capture the immutable all-channel raw stream for re-decodable ground
// truth. 'auto' follows the build default (ON for the internal fleet build, OFF
// for prod) — see ble/diagnosticCapture + config.DIAGNOSTIC_CAPTURE_DEFAULT.
export type DiagnosticCaptureSetting = 'on' | 'off' | 'auto';

type DiagnosticsState = {
  diagnosticCapture: DiagnosticCaptureSetting;
  // The last tester-log, kept so the form pre-fills (change ONE variable per run).
  lastTesterLog: TesterLog | null;
  setDiagnosticCapture: (s: DiagnosticCaptureSetting) => void;
  setLastTesterLog: (log: TesterLog | null) => void;
};

export const useDiagnostics = create<DiagnosticsState>()(
  persist(
    (set) => ({
      diagnosticCapture: 'auto',
      lastTesterLog: null,
      setDiagnosticCapture: (diagnosticCapture) => set({ diagnosticCapture }),
      setLastTesterLog: (lastTesterLog) => set({ lastTesterLog }),
    }),
    {
      name: 'neurex-diagnostics',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        diagnosticCapture: s.diagnosticCapture,
        lastTesterLog: s.lastTesterLog,
      }),
    },
  ),
);
