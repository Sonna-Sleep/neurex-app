/**
 * Live-tap registry for the Lull engine.
 *
 * The BLE stream controller owns the only live EEG feed; Lull must observe it
 * without disturbing recording. Rather than have `streamController` import the
 * concrete `LullEngine` (and risk a cycle / pull audio+DSP into the BLE path),
 * the engine registers a lightweight feed callback here. The stream controller
 * forwards each packet's samples to whatever is registered — and it's a pure
 * no-op when Lull is idle (nothing registered).
 *
 * Single active tap by design: only one wind-down session runs at a time.
 */

import type { EegSample } from '../../lib/ble/types';

type LullFeed = (samples: EegSample[]) => void;

let activeFeed: LullFeed | null = null;

/** Register the active Lull feed (called by LullEngine on start). */
export function setLullFeed(feed: LullFeed | null): void {
  activeFeed = feed;
}

/** Clear the active feed if it matches the given one (avoids clobbering a newer
 *  session's tap when an older engine tears down out of order). */
export function clearLullFeed(feed: LullFeed): void {
  if (activeFeed === feed) activeFeed = null;
}

/**
 * Forward live samples to the active Lull engine, if any. Called from the BLE
 * stream controller's `onPacket`. A no-op (and never throws) when Lull is idle.
 */
export function feedLull(samples: EegSample[]): void {
  const feed = activeFeed;
  if (!feed) return;
  try {
    feed(samples);
  } catch {
    // A bug in the Lull pipeline must never take down recording.
  }
}

/** True when a Lull engine is actively tapping the stream. */
export function isLullActive(): boolean {
  return activeFeed !== null;
}
