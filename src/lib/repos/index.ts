import { mockDeviceRepo } from './mock';
import { supabaseSessionRepo } from './supabase';
import type { DeviceRepo, SessionRepo } from './types';

// Sessions come from Supabase. Device state stays local (it's BLE-sourced,
// not cloud-sourced); the repo mirrors the paired BLE device stored on-device.
export const sessionRepo: SessionRepo = supabaseSessionRepo;
export const deviceRepo: DeviceRepo = mockDeviceRepo;

export type {
  CoreSleepStage,
  Device,
  Epoch,
  HeadMovement,
  HeadMovementEpoch,
  HeadMovementInsights,
  Session,
  SleepStage,
} from './types';
