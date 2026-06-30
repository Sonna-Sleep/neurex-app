import { create } from 'zustand';

/**
 * Lull engine UI/control state.
 *
 * Transient by design — the Lull session lives only while the user is falling
 * asleep, so this store is in-memory (no persist middleware, unlike
 * `src/state/session.ts`). It mirrors the same `create<T>()(...)` pattern used
 * there for consistency.
 */

/** Where the Lull engine is in the wind-down lifecycle. */
export type LullPhase = 'idle' | 'calibrating' | 'winddown' | 'asleep';

/** Which audio backend the engine is currently driving. */
export type LullSink = 'spotify' | 'bundled';

type LullState = {
  /** Current lifecycle phase. */
  phase: LullPhase;
  /** Smoothed wakefulness / sleepiness score (W). Higher = more awake. */
  W: number;
  /** Current normalized output volume in [0, 1]. */
  volume: number;
  /** Active audio sink. */
  sink: LullSink;

  setPhase: (phase: LullPhase) => void;
  setW: (W: number) => void;
  setVolume: (volume: number) => void;
  setSink: (sink: LullSink) => void;
  /** Restore the store to its initial idle state (e.g. on session end). */
  reset: () => void;
};

const INITIAL: Pick<LullState, 'phase' | 'W' | 'volume' | 'sink'> = {
  phase: 'idle',
  W: 0,
  volume: 1,
  sink: 'bundled',
};

export const useLull = create<LullState>()((set) => ({
  ...INITIAL,

  setPhase: (phase) => set({ phase }),
  setW: (W) => set({ W }),
  // Clamp to the valid linear-gain range so a bad caller can't drive the sink
  // out of bounds.
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  setSink: (sink) => set({ sink }),
  reset: () => set({ ...INITIAL }),
}));
