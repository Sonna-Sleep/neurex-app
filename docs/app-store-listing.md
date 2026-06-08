# App Store Connect — listing & App Privacy (ready to paste)

_Prepared 2026-06-08. Paste into App Store Connect once the developer account is approved._
_Framing rule: **wellness, not medical.** Never claim to diagnose, treat, or prevent any condition — that flips the listing into the stricter medical-review path and invites rejection._

---

## App information
- **Name:** Neurex  *(≤30 chars ✓)*
- **Subtitle:** `Sleep tracking with real EEG`  *(28/30)*
  - Alternatives: `Know your sleep, scientifically` (31 — too long), `Dry-electrode sleep tracking` (28), `Your sleep, measured` (20)
- **Bundle ID:** `tech.neurex.app`
- **Primary category:** Health & Fitness
- **Secondary category:** (leave empty, or Lifestyle) — **avoid "Medical"** (stricter review, and we're wellness)
- **Version:** 1.0.0
- **Copyright:** `© 2026 Neurex`

## URLs
- **Support URL:** `https://neurex.tech` (must resolve — a simple page with a contact is enough; `contact@neurex.tech` for support)
- **Marketing URL:** `https://neurex.tech` (optional)
- **Privacy Policy URL:** `https://aleksaspetro.github.io/neurex-legal/` — **live** (GitHub Pages, repo `aleksaspetro/neurex-legal`). Already wired into `src/lib/legal.ts`. Just paste this into the ASC field. (Swap to `neurex.tech/privacy` later if you move it.)

## Promotional text  *(≤170 chars, editable anytime without review)*
`Track your sleep with a real EEG headband — see your hypnogram, sleep stages, and a nightly score the morning after. Dry electrodes, no gels, no wires to a wall.`  *(160)*

## Description  *(≤4000 chars)*
```
Neurex turns a night's sleep into something you can actually see.

Pair the Neurex headband, wear it to bed, and in the morning the app shows you a clear picture of your night: a stage-by-stage hypnogram (wake, light, REM, deep), time asleep, how efficiently you slept, and a single nightly sleep score to track over time.

Unlike wrist trackers that infer sleep from movement and heart rate, Neurex reads brain activity directly with a comfortable dry-electrode forehead sensor — no gels, no pastes, no clinic. Your recording is analyzed automatically and your results are ready when you wake up.

WHAT YOU GET
• A full-night hypnogram — see exactly when you were in light, deep, and REM sleep
• Sleep stages, time-in-bed, total sleep time, and sleep efficiency
• A nightly sleep score to spot trends across nights
• A simple history of your nights, kept in sync to your account

PRIVACY
Your account is an email address; your recordings and results are stored securely in your account. We don't sell your data and we don't track you across other apps. You can delete your account and all of your data from inside the app at any time (Account → delete account).

Neurex is a wellness product to help you understand your sleep. It is not a medical device and does not diagnose, treat, or prevent any disease.

Requires the Neurex headband.
```

## Keywords  *(≤100 chars total, comma-separated, no spaces between)*
`sleep,sleep tracker,EEG,sleep stages,hypnogram,deep sleep,REM,sleep score,brainwaves,sleep quality`  *(98)*

## Age rating
Run Apple's questionnaire with **all content categories = None**. Medical/Treatment Information = **None** (wellness, no diagnosis) → results in **4+**. Do not select "Unrestricted Web Access" or any mature category.

---

## App Privacy ("nutrition label")
Answer the questionnaire as below. These **must match** the privacy manifest in `app.json` and the privacy policy.

**Does this app collect data?** Yes.

| Data type | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info → **Email Address** | Yes | Yes | No | App Functionality (account/sign-in) |
| Health & Fitness → **Health** (EEG/sleep recordings + derived sleep metrics) | Yes | Yes | No | App Functionality |
| Identifiers → **User ID** (Supabase auth UID) | Yes | Yes | No | App Functionality |

- **Tracking (ATT):** **No.** The app does not track users across apps/websites; no ad SDKs. Do not add an `NSUserTrackingUsageDescription`.
- **Diagnostics / Analytics:** Currently **none** — no analytics or crash-reporting SDK is bundled. If one is added before submission (e.g. Sentry), declare Diagnostics → Crash/Performance Data accordingly.
- **Data NOT collected:** Location (the Android `ACCESS_FINE_LOCATION` permission is required only for BLE scanning and is not used to collect location; iOS BLE needs no location), Contacts, Photos, Browsing History, Financial Info, etc.

---

## App Review information (the part that prevents a "can't test it" rejection)
The app is a companion to a **hardware EEG headband** the reviewer won't have. Without help they can't pair a device or generate a recording, so:

1. **Demo account:** create a real account and pre-load it with at least one completed night (so History shows a hypnogram + score). Put its email/password in the "Sign-In required" demo fields.
2. **Notes for reviewer (suggested):**
   ```
   Neurex is a companion app for the Neurex sleep-EEG headband (hardware). Recording
   requires the physical headband, which reviewers won't have. Please sign in with the
   demo account above to view a previously recorded night: open History to see the
   hypnogram, sleep stages, and sleep score. Account deletion is available at
   Account → delete account (works without the hardware).
   ```
3. Confirm the demo account can reach **Account → delete account** so the reviewer can verify the 5.1.1(v) deletion requirement end to end. (Use the 30-day *schedule* option when demonstrating, not immediate, so the demo account survives review — or make a second throwaway account for the immediate path.)

---

## Pre-submit build checklist (in the IPA you upload)
- [ ] `EXPO_PUBLIC_DEV_BYPASS=0` (hides the "skip login (test)" button in release)
- [ ] `EXPO_PUBLIC_MODAL_ENDPOINT_URL` set in the build env (immediate-delete needs it)
- [ ] `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` set
- [x] Privacy Policy hosted (`https://aleksaspetro.github.io/neurex-legal/`) + `src/lib/legal.ts` wired — just paste the URL into ASC
- [ ] Version `1.0.0`, build number auto-incremented (eas.json `autoIncrement` is on)
- [ ] Export compliance: already declared (`ios.config.usesNonExemptEncryption: false`) — no per-submit prompt
```
