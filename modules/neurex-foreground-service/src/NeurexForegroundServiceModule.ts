import { requireOptionalNativeModule } from 'expo';

export type NeurexForegroundServiceModule = {
  /** Returns true if the start intent was dispatched (context present, no
   * exception). false means the service could not be started — the caller
   * should warn the user that background recording isn't protected. */
  start(title: string, body: string, startMs: number): boolean;
  stop(): void;
  /** True if the app is already exempt from Doze battery optimization. */
  isIgnoringBatteryOptimizations(): boolean;
  /** Ask the OS to exempt the app from Doze (shows the system dialog only if not
   * already exempt). Returns true if already exempt or the dialog launched. */
  requestIgnoreBatteryOptimizations(): boolean;
};

// requireOptionalNativeModule returns null when the native module isn't
// present (iOS — module is Android-only; Expo Go; web). Callers must guard.
export default requireOptionalNativeModule<NeurexForegroundServiceModule>(
  'NeurexForegroundService',
);
