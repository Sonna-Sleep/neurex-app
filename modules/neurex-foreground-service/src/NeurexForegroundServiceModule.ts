import { requireOptionalNativeModule } from 'expo';

export type NeurexForegroundServiceModule = {
  start(title: string, body: string): void;
  stop(): void;
};

// requireOptionalNativeModule returns null when the native module isn't
// present (iOS — module is Android-only; Expo Go; web). Callers must guard.
export default requireOptionalNativeModule<NeurexForegroundServiceModule>(
  'NeurexForegroundService',
);
