# App Store Review Notes — Neurex

Use this when filling out the App Review Information form in App Store Connect.
Keep it current as features change.

## Background Bluetooth

Paste this into the Notes field on the App Review submission:

```text
Bluetooth background usage:

Neurex is a companion app for the Neurex EEG sleep mask. During a sleep session,
the app connects to the paired mask over Core Bluetooth central mode and streams
EEG data while the user sleeps. The app writes the recording locally on the
phone, uploads it to our cloud backend when the session stops or is recovered,
and notifies the user when the staged sleep report is ready.

Implementation details for review:
- restoreStateIdentifier is set on the central manager ("neurex-ble-bg")
- Scans specify the proprietary Neurex GATT service UUID
- The app declares bluetooth-central so iOS can preserve/restore the BLE central
  connection during an overnight recording
- The app declares fetch for periodic refresh/recovery of session data
- Bluetooth permission strings explain that the app communicates with the sleep
  mask and syncs sleep data
- If Bluetooth is off or permission is denied, the app surfaces a dedicated
  screen with a link to Settings

Test account credentials:
[FILL IN: test email + magic link or test password]

Review path:
1. Sign in with the test account.
2. If review hardware is available, pair the Neurex sleep mask and start a
   session from Home. Let it run at least 5 minutes, then stop it.
3. The app uploads the EEG recording, the backend analyzes it, and the staged
   night appears in Journal.
4. If hardware is unavailable, use the demo account above to view a preloaded
   completed night in Journal. Account deletion is available at
   Account -> delete account.

If review hardware is unavailable, please contact contact@neurex.tech and we can
coordinate hardware access.
```

## Permission Strings

Current copy in `app.json`:

| Key | Copy |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | "Neurex uses Bluetooth to sync your sleep data from the sleep mask." |
| `NSBluetoothPeripheralUsageDescription` | "Neurex uses Bluetooth to communicate with your sleep mask." |
| `NSPhotoLibraryUsageDescription` | "Neurex uses your photos so you can set a profile picture." |

## Background Modes

Current `app.json`:

```json
"UIBackgroundModes": ["bluetooth-central", "fetch"]
```

- `bluetooth-central` — Core Bluetooth central state preservation/restoration
- `fetch` — periodic refresh/recovery of session data from Supabase

## Submission Screenshot Checklist

- [ ] Onboarding/pairing screen for the sleep mask
- [ ] iOS Bluetooth permission prompt after tapping Pair
- [ ] Home screen
- [ ] Journal with a processed night
- [ ] Account screen with delete-account entry point

## Rejection-Trigger Checklist

- [ ] Every entitlement/background mode is justified in the Notes field
- [ ] Permission strings are specific to the sleep mask and profile photo usage
- [ ] BLE error paths show a user-visible message or fallback screen
- [ ] Scans use the Neurex service UUID
- [ ] App works in demo mode for review when hardware is not available
- [ ] Test account works and can reach Account -> delete account
