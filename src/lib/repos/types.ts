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
  stageMinutes: Record<SleepStage, number>;
  epochs: Epoch[];
  stimPulses: StimPulse[];
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
