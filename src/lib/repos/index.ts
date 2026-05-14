import { mockDeviceRepo } from './mock';
import { supabaseSessionRepo } from './supabase';
import type { DeviceRepo, SessionRepo } from './types';

// Sessions come from Supabase. Device state stays local (it's BLE-sourced,
// not cloud-sourced) — still the mock until real BLE lands.
export const sessionRepo: SessionRepo = supabaseSessionRepo;
export const deviceRepo: DeviceRepo = mockDeviceRepo;

export type { Device, Session, SleepStage, Epoch, StimPulse } from './types';
