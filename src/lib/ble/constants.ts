// BLE service + characteristic UUIDs for the Neurex headband.
//
// THESE ARE PLACEHOLDERS. Aleksas's firmware GATT design hasn't shipped
// yet; once it does, swap these constants for the real UUIDs (no other
// code change needed — every BLE call references these symbols).
//
// Treat NEUREX_BLE_RESTORE_IDENTIFIER as immutable across app versions.
// iOS keys all preserved state to it; if it ever changes, every paired
// user's restored connections silently vanish.

// TODO(firmware-handoff): replace with Aleksas's real GATT service UUID.
export const PLACEHOLDER_SERVICE_UUID = '4e555245-5845-5f53-4556-432d31303031';

// TODO(firmware-handoff): replace with Aleksas's real characteristic UUIDs.
// Names are illustrative — actual responsibilities to be confirmed with the
// firmware spec.
export const PLACEHOLDER_CHARACTERISTICS = {
  /** Read once to learn how many bytes the upcoming recording transfer is. */
  fileSize: '4e555245-5845-5f43-4852-2d46494c455a',
  /** Notify channel that fires when a fresh recording is available to pull. */
  fileReady: '4e555245-5845-5f43-4852-2d46494c4552',
  /** Read repeatedly to pull the recording in chunks. */
  chunk: '4e555245-5845-5f43-4852-2d43484e4b30',
};

/**
 * iOS Core Bluetooth state-preservation identifier. Used as the
 * `restoreStateIdentifier` option when constructing BleManager.
 *
 * IMMUTABLE — iOS keys all restored state to this string. Changing it
 * means iOS forgets every previously-paired peripheral on every user's
 * device. Treat like a database primary key.
 */
export const NEUREX_BLE_RESTORE_IDENTIFIER = 'neurex-ble-bg' as const;
