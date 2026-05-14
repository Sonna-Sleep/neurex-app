export type SleepStage = 'wake' | 'rem' | 'light' | 'deep';

export type Epoch = {
  startMs: number;
  durationSec: number;
  stage: SleepStage;
};

export type StimPulse = {
  tMs: number;
  epochIndex: number;
};

export type Session = {
  id: string;
  startMs: number;
  endMs: number;
  tib: number;
  tst: number;
  waso: number;
  efficiency: number;
  /** Count of distinct wake intrusions after sleep onset. */
  awakenings: number;
  stageMinutes: Record<SleepStage, number>;
  epochs: Epoch[];
  stimPulses: StimPulse[];
  /**
   * % increase in delta-band power (0.5–4 Hz) in 5s post-stim windows
   * vs matched non-stim NREM baseline epochs the same night.
   * null until the staging pipeline has produced a value.
   */
  stimImpactPct: number | null;
  /** 0..99, never 100. Capped by design (psychological retention hook). */
  score: number | null;
};

export type Device = {
  serial: string;
  battery: number;
  firmware: string;
  lastSyncMs: number | null;
  paired: boolean;
};

export interface SessionRepo {
  list(): Promise<Session[]>;
  latest(): Promise<Session | null>;
  byId(id: string): Promise<Session | null>;
}

export interface DeviceRepo {
  current(): Promise<Device | null>;
  unpair(): Promise<void>;
}
