import { mockDeviceRepo, mockSessionRepo } from './mock';
import type { DeviceRepo, SessionRepo } from './types';

export const sessionRepo: SessionRepo = mockSessionRepo;
export const deviceRepo: DeviceRepo = mockDeviceRepo;

export type { Device, Session, SleepStage, Epoch, StimPulse } from './types';
