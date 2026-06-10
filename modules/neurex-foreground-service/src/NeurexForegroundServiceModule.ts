import { requireOptionalNativeModule } from 'expo';

export type NeurexForegroundServiceModule = {
  /** Returns true if the start intent was dispatched (context present, no
   * exception). false means the service could not be started — the caller
   * should warn the user that background recording isn't protected. */
  start(title: string, body: string): boolean;
  stop(): void;
};

// requireOptionalNativeModule returns null when the native module isn't
// present (iOS — module is Android-only; Expo Go; web). Callers must guard.
export default requireOptionalNativeModule<NeurexForegroundServiceModule>(
  'NeurexForegroundService',
);
