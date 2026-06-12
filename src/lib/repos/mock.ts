import type { Device, DeviceRepo } from './types';

/**
 * Sessions come from Supabase (see ./supabase.ts); only device state is still
 * local because it's BLE-sourced, not cloud-sourced. Pairing writes the real
 * device serial/id into Zustand; this repo exposes that local pairing state to
 * account/home surfaces that don't need an active BLE connection.
 */
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

  pair(serial: string) {
    this.device = {
      serial,
      battery: 87,
      firmware: '1.0.0',
      lastSyncMs: null,
      paired: true,
    };
  }
}

export const mockDeviceRepo = new MockDeviceRepo();
