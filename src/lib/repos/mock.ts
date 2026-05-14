import type { Device, DeviceRepo } from './types';

/**
 * TEMPORARY device mock — a stand-in until real BLE pairing lands.
 *
 * Sessions come from Supabase (see ./supabase.ts); only device state is still
 * local, because it's BLE-sourced, not cloud-sourced. Delete this file once
 * real BLE provides the device.
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
