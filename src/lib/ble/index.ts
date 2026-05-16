// Public entry for the BLE module. Re-exports the interface types plus
// the current active implementation. Today that's a stub; when firmware
// BLE ships, change ONE LINE here (import the real client instead of
// stubBleClient) and the rest of the app picks it up unchanged.

export * from './types';
export { stubBleClient as bleClient } from './stub';
