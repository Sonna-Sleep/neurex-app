// Singleton that turns the live FP1 µV stream into a contact band for the UI.
// Both the recording path (streamController.onPacket) and the pre-Start preview
// feed it; a React hook (useContactQuality) reads it. Decoupled from BLE + React
// so either side can drive it without knowing about the other.

import { EEG_SAMPLE_RATE_HZ } from './constants';
import { type ContactBand, ContactQualityTracker } from './contactQuality';
import { detectMainsHz } from './mainsHz';

export type ContactState = {
  band: ContactBand;
  /** True while fresh samples are arriving (so the ring shows only with live data). */
  active: boolean;
};

const FRESH_MS = 2500; // data older than this → not active (stalled link)
const UPDATE_MS = 300; // ~3×/sec recompute

let tracker: ContactQualityTracker | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastFedAt = 0;
let state: ContactState = { band: 'red', active: false };
const subs = new Set<() => void>();

function emit(): void {
  for (const f of subs) f();
}

function setState(next: ContactState): void {
  if (next.band !== state.band || next.active !== state.active) {
    state = next; // new ref only on real change → stable getSnapshot for useSyncExternalStore
    emit();
  }
}

/** Begin (or keep) computing contact quality. Idempotent — preview→recording
 *  handoff calls it again without restarting the tracker. */
export function startContactQuality(): void {
  if (!tracker) tracker = new ContactQualityTracker(EEG_SAMPLE_RATE_HZ, detectMainsHz());
  if (timer) return;
  timer = setInterval(() => {
    if (!tracker) return;
    const band = tracker.update();
    setState({ band, active: Date.now() - lastFedAt < FRESH_MS });
  }, UPDATE_MS);
}

/** Feed decoded FP1 µV samples (from onPacket or the preview stream). */
export function feedContactQuality(fp1Uv: readonly number[]): void {
  if (!tracker || fp1Uv.length === 0) return;
  tracker.push(fp1Uv);
  lastFedAt = Date.now();
}

/** Stop and reset (no consumer left). */
export function stopContactQuality(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  tracker?.reset();
  tracker = null;
  lastFedAt = 0;
  setState({ band: 'red', active: false });
}

export function getContactState(): ContactState {
  return state;
}

export function subscribeContact(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
