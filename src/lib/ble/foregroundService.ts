// Platform-safe wrapper around the Android connectedDevice foreground service.
//
// On iOS / Expo Go / web the native module is absent (requireOptionalNativeModule
// returns null), so both calls become no-ops — call sites never branch on
// platform. iOS background is handled separately (deferred; see spec).

import { NeurexForegroundServiceModule } from '../../../modules/neurex-foreground-service';

const DEFAULT_TITLE = 'Neurex';
const DEFAULT_BODY = 'Recording your sleep…';

export function startForegroundService(opts?: { title?: string; body?: string }): void {
  try {
    NeurexForegroundServiceModule?.start(
      opts?.title ?? DEFAULT_TITLE,
      opts?.body ?? DEFAULT_BODY,
    );
  } catch (e) {
    if (__DEV__) console.warn('[fgs] start failed:', e);
  }
}

export function stopForegroundService(): void {
  try {
    NeurexForegroundServiceModule?.stop();
  } catch (e) {
    if (__DEV__) console.warn('[fgs] stop failed:', e);
  }
}
