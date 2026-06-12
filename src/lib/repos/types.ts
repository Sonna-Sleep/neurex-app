export type CoreSleepStage = 'wake' | 'rem' | 'light' | 'deep';
export type SleepStage = CoreSleepStage | 'excluded';

export type Epoch = {
  startMs: number;
  durationSec: number;
  stage: SleepStage;
};

export type Session = {
  id: string;
  startMs: number;
  endMs: number;
  /** Time-in-bed, minutes. Always available — derived from recording bounds. */
  tib: number;
  /** Total-sleep-time, minutes. null until the staging pipeline has produced a value. */
  tst: number | null;
  /** Wake-after-sleep-onset, minutes. null until staging. */
  waso: number | null;
  /** Sleep efficiency, percent (0..100). null until staging. */
  efficiency: number | null;
  /** Count of distinct wake intrusions after sleep onset. null until staging. */
  awakenings: number | null;
  stageMinutes: Partial<Record<SleepStage, number>>;
  epochs: Epoch[];
  /** 0..99, never 100. Capped by design (psychological retention hook). */
  score: number | null;
  /** 0..1 mean per-epoch YASA staging confidence. null until staged. */
  confidence: number | null;
  /** Sleep onset latency, minutes (time to fall asleep). null until staged / never slept. */
  sol: number | null;
  /** Minutes removed from metrics because the signal was off-head/no-contact/railed. */
  excludedMinutes: number;
  /** Offset from start where usable signal ended, when backend can identify it. */
  signalEndMs: number | null;
  /** Cloud Storage path {user_id}/{readable-label}; lets the app download the raw files. null for legacy rows. */
  storagePrefix: string | null;
  /** uploaded | processing | ready | failed — drives "analyzing…" vs results in the list. */
  status: string;
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
  pair(serial: string): void;
  unpair(): Promise<void>;
}
