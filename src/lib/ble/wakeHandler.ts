// Glue between iOS's state-restoration callback and the recording pipeline.
//
// When iOS cold-starts the app in the background because a paired peripheral
// advertised (or to hand back a connection it preserved while the app was
// killed mid-night), it invokes our `restoreStateFunction` with the list of
// connected peripherals. If one of them matches the session that was recording
// when we were killed, we resume streaming onto the SAME on-disk file so the
// night continues uninterrupted.

import type { BleRestoredState } from 'react-native-ble-plx';

/**
 * Called by `manager.ts`'s `restoreStateFunction`. Receives whatever
 * peripherals iOS preserved across the previous app session.
 *
 * Keep this function FAST (a few hundred ms ceiling). Apple uses execution
 * time during state restoration to judge whether the app is well-behaved;
 * slow restorations get throttled. Defer any actual work (file pull,
 * upload) to an async background task spawned from here.
 */
export function onIosStateRestored(state: BleRestoredState | null): void {
  if (!state) return;
  const peripherals = state.connectedPeripherals ?? [];
  if (peripherals.length === 0) {
    if (__DEV__) console.log('[ble/wake] restored with no connected peripherals');
    return;
  }

  if (__DEV__) {
    console.log(
      '[ble/wake] restored connections:',
      peripherals.map((p) => p.id),
    );
  }

  // Fire-and-forget: keep THIS callback fast (iOS judges the app by how quickly
  // it returns during restoration) and do the real work async.
  void resumeRecordingFromRestore(peripherals.map((p) => p.id));
}

/**
 * If a recording was active when iOS killed us, and the device it was using is
 * among the restored peripherals, resume streaming onto the same session file.
 *
 * Dynamic imports break the manager → wakeHandler → streamController → manager
 * import cycle: this only runs at restoration time (never at module load), so
 * the bindings are fully resolved by the time it's called.
 */
async function resumeRecordingFromRestore(restoredIds: string[]): Promise<void> {
  try {
    const { getActiveRecording } = await import('../cloud/recovery');
    const meta = await getActiveRecording();
    if (!meta?.deviceId || !restoredIds.includes(meta.deviceId)) {
      if (__DEV__) console.log('[ble/wake] no matching active recording to resume');
      return;
    }
    const { resumeSessionAfterRestore } = await import('./streamController');
    await resumeSessionAfterRestore(meta);
  } catch (e) {
    if (__DEV__) console.warn('[ble/wake] resume after restore failed', e);
  }
}
