// Platform-safe wrapper around the Android connectedDevice foreground service.
//
// On iOS / Expo Go / web the native module is absent (requireOptionalNativeModule
// returns null), so both calls become no-ops — call sites never branch on
// platform. iOS background is handled separately (deferred; see spec).

import { NeurexForegroundServiceModule } from '../../../modules/neurex-foreground-service';

const DEFAULT_TITLE = 'Neurex';
const DEFAULT_BODY = 'Recording your sleep…';

/**
 * Start the Android keep-alive foreground service. Returns whether background
 * recording is protected:
 *   - true  on iOS/web/Expo Go (module absent — nothing to start, not a failure;
 *           iOS background is handled by the bluetooth-central mode + restore).
 *   - the native result on Android: true if the start intent dispatched, false
 *     if it threw (e.g. ForegroundServiceStartNotAllowed) — the caller surfaces
 *     a warning so the night doesn't die silently when the screen locks.
 */
export function startForegroundService(opts?: {
  title?: string;
  body?: string;
  /** Epoch ms the recording started — drives the live elapsed chronometer in the
   *  notification. Defaults to now. */
  startMs?: number;
}): boolean {
  const mod = NeurexForegroundServiceModule;
  if (!mod) return true; // iOS / web / Expo Go — no Android service to start
  try {
    const ok = mod.start(
      opts?.title ?? DEFAULT_TITLE,
      opts?.body ?? DEFAULT_BODY,
      opts?.startMs ?? Date.now(),
    );
    return ok !== false; // older builds returned void → treat undefined as ok
  } catch (e) {
    if (__DEV__) console.warn('[fgs] start failed:', e);
    return false;
  }
}

export function stopForegroundService(): void {
  try {
    NeurexForegroundServiceModule?.stop();
  } catch (e) {
    if (__DEV__) console.warn('[fgs] stop failed:', e);
  }
}

/**
 * Best-effort: ask Android to exempt the app from Doze battery optimization so an
 * overnight BLE recording isn't throttled with the screen off. No-op on iOS/web
 * (module absent), on older native builds that lack the method, and when already
 * exempt (the native side checks first and won't re-prompt). The connectedDevice
 * foreground service is the primary keep-alive; this is extra insurance for long
 * unattended nights.
 */
export function ensureBatteryOptimizationExemption(): void {
  const mod = NeurexForegroundServiceModule;
  if (!mod || typeof mod.requestIgnoreBatteryOptimizations !== 'function') return;
  try {
    mod.requestIgnoreBatteryOptimizations();
  } catch (e) {
    if (__DEV__) console.warn('[fgs] battery-opt request failed:', e);
  }
}
