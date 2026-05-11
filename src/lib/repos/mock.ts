import { seedMockSession } from '../seed';
import type { Device, DeviceRepo, Session, SessionRepo } from './types';

// 14 nights of demo data with believable variation; index 0 is most recent.
const QUALITY_PATTERN = [
  1.0, 0.85, 0.92, 0.7, 0.88, 0.95, 0.6, 0.9, 0.82, 0.97, 0.75, 0.89, 0.93, 0.68,
];

class MockSessionRepo implements SessionRepo {
  private seeded: Session[] = QUALITY_PATTERN.map((q, i) =>
    seedMockSession(i, q),
  );

  async list(): Promise<Session[]> {
    return this.seeded;
  }

  async latest(): Promise<Session | null> {
    return this.seeded[0] ?? null;
  }

  async byId(id: string): Promise<Session | null> {
    return this.seeded.find((s) => s.id === id) ?? null;
  }
}

class MockDeviceRepo implements DeviceRepo {
  private device: Device | null = {
    serial: 'NRX-DEMO-0001',
    battery: 78,
    firmware: '1.0.0',
    lastSyncMs: Date.now() - 6 * 3600 * 1000,
    paired: true,
  };

  async current(): Promise<Device | null> {
    return this.device;
  }

  async unpair(): Promise<void> {
    this.device = null;
  }

  setPaired(serial: string) {
    this.device = {
      serial,
      battery: 87,
      firmware: '1.0.0',
      lastSyncMs: null,
      paired: true,
    };
  }
}

export const mockSessionRepo = new MockSessionRepo();
export const mockDeviceRepo = new MockDeviceRepo();
