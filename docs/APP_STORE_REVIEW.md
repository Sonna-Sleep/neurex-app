# App Store Review Notes — Neurex

Use this when filling out the **App Review Information** form in App Store
Connect. Keep it current as features change.

## Background Bluetooth (Core Bluetooth central mode)

Paste this into the **Notes** field on the App Review submission:

```
Bluetooth background usage:

The Neurex app uses Core Bluetooth in central mode to sync sleep
recordings from a paired Neurex EEG headband (our companion hardware
device). When the user takes the headband off in the morning, the
headband advertises that recorded data is ready for transfer. The app
uses standard Core Bluetooth state preservation/restoration
(CBCentralManagerOptionRestoreIdentifierKey) so iOS can wake the app
briefly, pull the recording over a custom GATT service, upload it to our
cloud backend, and surface a local notification to the user.

Implementation details for review:
- restoreStateIdentifier is set on the central manager (constant
  "neurex-ble-bg")
- All scans specify our proprietary Neurex GATT service UUID — we never
  scan for arbitrary peripherals
- File transfers are wrapped in beginBackgroundTask so we respect iOS
  background time limits
- Bluetooth permission strings (NSBluetoothAlwaysUsageDescription and
  NSBluetoothPeripheralUsageDescription) are user-facing and explain the
  data flow
- If Bluetooth is off or the permission is denied, the app surfaces a
  dedicated screen with a link to Settings rather than failing silently

Test account credentials:
[FILL IN: test email + magic link or test password]

Reproducing background sync (review tip):
1. Sign in with the test account
2. Complete the pairing flow with the provided test headband
3. Close (but do not force-quit) the app
4. Press the headband button to start a brief test recording (≈60 s)
5. After the recording ends, the headband begins advertising; iOS
   relaunches the Neurex app into the background, the app pulls the
   recording over BLE, uploads it, and triggers a local notification
   "Your night is ready"

If review hardware is unavailable, please contact us
(contact@neurex.tech) — we can ship a test headband for review.
```

## Permission strings (current copy in app.json)

| Key | Copy |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | "Neurex uses Bluetooth to sync your sleep data from the headband." |
| `NSBluetoothPeripheralUsageDescription` | "Neurex uses Bluetooth to communicate with your headband." |

Both are user-facing in the permission prompt — keep them clear and
specific to the actual usage. Apple rejects vague strings like "for
features" or "for the app to work."

## Background modes declared (current `app.json`)

```json
"UIBackgroundModes": ["bluetooth-central", "fetch", "processing"]
```

- `bluetooth-central` — required for state preservation/restoration
- `fetch` — used for periodic refresh of session data from Supabase
- `processing` — reserved for future on-device post-processing

## Submission screenshot checklist

Apple wants to see the BLE permission prompt in your screenshots if
that's a primary user flow. For Neurex:

- [ ] Onboarding "Pair your headband" screen
- [ ] iOS Bluetooth permission prompt (after tapping "Pair")
- [ ] Home screen showing a processed night
- [ ] "Bluetooth needed" screen (the fallback when permission is denied)

## Other review-relevant features

When you add these, document them in this file BEFORE submitting:

- [ ] Push notifications (NSNotifications usage, server-side trigger)
- [ ] HealthKit integration (if you ship Apple Health export)
- [ ] In-app purchases (RevenueCat / Pro tier)
- [ ] Account deletion endpoint (Apple now requires this in-app)

## Rejection-trigger checklist (review before each submission)

- [ ] Every entitlement / background mode used is justified in the
      Notes field above
- [ ] Permission strings are specific (not generic)
- [ ] Silent BLE failures are impossible — every error path leads to a
      user-visible screen
- [ ] No background scans without service UUIDs
- [ ] App still works (degraded) when Bluetooth is off
- [ ] Test account works (Apple actually logs in)
- [ ] Reproduction steps in the Notes field are actionable in <5
      minutes
