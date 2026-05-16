// Glue between iOS's state-restoration callback and the sync pipeline.
//
// When iOS cold-starts the app in the background because a paired
// peripheral advertised, it invokes our `restoreStateFunction` with the
// list of connected peripherals it preserved. The handler below decides
// what to do with that.
//
// CURRENT STATE: firmware GATT spec isn't ready, so we don't actually
// pull anything yet — this function just logs and returns. The wiring
// stays in place so once `real.ts` knows how to read the chunk
// characteristic, the background flow needs no architectural change.

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

  // TODO(firmware-handoff): for each restored peripheral, kick off:
  //   1. Begin iOS background task (await UIApplication.beginBackgroundTask)
  //   2. Subscribe to the file-ready notify characteristic
  //   3. Stream chunks into expo-file-system (writeAsBinaryString or stream API)
  //   4. POST the assembled file to uploadRecording()
  //   5. End background task
  //
  // The whole pipeline already exists from earlier branches — once
  // real.ts has a working `pull()` implementation, call that here:
  //
  //   for (const p of peripherals) {
  //     scheduleBackgroundSync(p.id);
  //   }
  //
  // For now we no-op so the wiring doesn't crash in a dev build.
}
