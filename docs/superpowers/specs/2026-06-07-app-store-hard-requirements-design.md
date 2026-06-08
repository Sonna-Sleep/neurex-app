# App Store submission — hard requirements

**Date:** 2026-06-07
**Status:** Approved design
**Scope:** The four App-Store-review *blockers* that can be built (and mostly deployed) before the Apple Developer Program membership is approved, so submission day is friction-free.

## Goal

Make Neurex submittable the moment the Apple account is approved. Everything in this spec is doable **today** without the account; the only things that genuinely wait for the account (App Store Connect record, App Privacy form entry, build upload, `eas submit`, and hosting the policy URL) are explicitly out of scope here.

## The four requirements

1. **In-app account deletion** (App Store Guideline 5.1.1(v)) — currently absent.
2. **Privacy manifest** (`PrivacyInfo.xcprivacy`, required for all submissions since 2024) — currently absent.
3. **Export-compliance declaration** — avoid the per-submission encryption prompt.
4. **Privacy policy** — a real policy + tappable in-app links (currently plain text).

---

## 1. Account deletion

### Compliance constraints (verified against Apple docs, 2026-06-07)
- Users must be able to **initiate** deletion in-app and have the account **and personal data** erased — temporary deactivation is insufficient.
- A grace period is allowed **only if an immediate-delete option also exists**. So we ship **both**: a 30-day scheduled delete (default, protects against accidental taps) *and* an immediate permanent delete.
- The app must tell the user the timeframe and confirm completion.

### Technical constraint (verified, Supabase)
`auth.admin.delete_user()` **fails if the user still owns Storage objects.** Purge order is therefore fixed: **Storage → DB rows → auth user.**

### Data model — new table `account_deletion_requests`
| column | type | notes |
|---|---|---|
| `user_id` | `uuid` | PK, `references auth.users(id) on delete cascade` |
| `requested_at` | `timestamptz` | `default now()` |
| `purge_after` | `timestamptz` | `now()+30d` for scheduled; not used for the immediate path (that purges synchronously) |

**RLS** (enabled): a user may `insert` / `select` / `delete` only rows where `user_id = auth.uid()`. The service-role sweep bypasses RLS. No `update` policy (cancel = delete the row; re-request = upsert).

### Flows
**Schedule deletion (default).** App upserts its own row (`purge_after = now()+30d`), signs out, and shows: *"Your account and all data will be permanently deleted on <date>. Log in before then to cancel."* No privileged call — pure RLS-protected row write.

**Delete immediately.** App calls Modal `POST /account/delete` with `Authorization: Bearer <user JWT>`. Backend verifies the token (resolves the uid from the token itself — a user can only delete themselves), purges synchronously, returns `{ deleted: true }`. App wipes local data, signs out, confirms *"Your account and all data have been permanently deleted."*

**Cancel.** On the next successful login the app checks `account_deletion_requests` for its own row; if present, deletes it (RLS) and shows *"Welcome back — your scheduled account deletion has been cancelled."*

**Purge (scheduled, privileged).** A new Modal scheduled function (sibling of `reconcile`) selects rows where `purge_after <= now()` and, per uid, runs the fixed-order purge. One failing uid never aborts the sweep (same resilience pattern as `reconcile`). After the auth user is deleted, the request row is removed by the `on delete cascade`.

### Purge scope (what "all data" means)
Per uid: all objects under `recordings/{uid}/` in Storage → all `sessions` rows with `user_id = uid` → the `auth.users` record. (`sessions` is the only user-owned app table today; device data is local-only. Any future user-keyed table with an FK to `auth.users` is cleaned by cascade.)

### Components & interfaces
**App**
- `src/lib/accountDeletion.ts` — `requestScheduledDeletion()`, `deleteImmediately()`, `getPendingDeletion()`, `cancelPendingDeletion()`, `localWipe()`. One responsibility: the deletion lifecycle. Depends on the Supabase client + the Modal endpoint URL.
- `src/screens/account/DeleteAccountSection.tsx` — danger-zone UI + confirm modal offering "Schedule (30 days)" and the destructive "Delete immediately." Rendered by `AccountScreen`.
- Login-time cancel check — in the existing auth-listener/session path: after sign-in, call `getPendingDeletion()`; if pending, `cancelPendingDeletion()` and surface the toast.

**Backend (`neurex-backend`)**
- `SupabaseAdmin`: `list_due_deletions(now) -> list[uid]`, `purge_user(uid)` (Storage→sessions→auth, fixed order), and the small storage/sessions/auth helpers it composes.
- `POST /account/delete` route on `web_app`: verify JWT → uid → `purge_user(uid)` → `{deleted: true}`; `401` on bad/absent token.
- Scheduled `purge_deletions()` function (Modal `Period`), mirroring `reconcile`'s resilience.

### Error handling
- Network/server failure on either path → user stays signed in, sees a retryable error; nothing partially deleted from the app's perspective (the immediate purge is ordered so a mid-failure leaves the auth user intact and retryable).
- Sweep: per-uid try/except, logged, continues.
- Re-tapping delete while already pending → idempotent upsert.

### Testing
- Backend unit tests (existing `fakes.py`): `purge_user` enforces Storage-before-auth ordering; `list_due_deletions` boundary at `purge_after`; `/account/delete` rejects missing/invalid JWT and purges on valid; sweep continues past a failing uid.
- App: `accountDeletion.ts` against a mock Supabase — schedule writes the row, cancel deletes it, immediate calls the endpoint, `localWipe` clears the known stores.

---

## 2. Privacy manifest — `app.json` → `expo.ios.privacyManifests`

Declares the required-reason APIs the app/its libs use, plus tracking + collected-data types. Reason codes verified against Apple docs 2026-06-07; cross-checked against `node_modules/**/PrivacyInfo.xcprivacy` during implementation (Apple under-parses statically-linked pod manifests, so common ones are duplicated here).

```json
"privacyManifests": {
  "NSPrivacyTracking": false,
  "NSPrivacyTrackingDomains": [],
  "NSPrivacyAccessedAPITypes": [
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",   "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",  "NSPrivacyAccessedAPITypeReasons": ["C617.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime", "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace",      "NSPrivacyAccessedAPITypeReasons": ["E174.1"] }
  ],
  "NSPrivacyCollectedDataTypes": [
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeEmailAddress",
      "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
    { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeHealthFitness",
      "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] }
  ]
}
```
The declared data types must match the App Privacy form filled in App Store Connect tomorrow — see §5.

## 3. Export compliance — `app.json` → `expo.ios.config`
```json
"config": { "usesNonExemptEncryption": false }
```
The app uses only standard HTTPS/TLS, which is exempt. This sets `ITSAppUsesNonExemptEncryption=false` and removes the manual encryption question on every submission.

## 4. Privacy policy
- **Draft + commit** `docs/legal/privacy-policy.md` today: identity & contact (`contact@neurex.tech`); data collected (email; EEG/EOG raw recordings + derived sleep metrics; minimal device/diagnostic); processors (Supabase, US-East-1; Modal); purposes; retention; **deletion rights incl. the new in-app flow**; GDPR note on US data region; no tracking/ads; children (not directed at under-13). Wellness, **not** medical/diagnostic, framing.
- **Host:** deferred (user choice). The app references a single swappable constant `LEGAL_URLS.privacyPolicy` so hosting later is a one-line change.
- **Wire links:** Account screen's "privacy policy · terms · about" become tappable rows opening the URL(s) via `Linking`; `terms`/`about` may point at the same policy page initially.

---

## 5. Prepared-but-out-of-scope (paste into App Store Connect tomorrow)
Captured here so they're ready, but not built today:
- **App Privacy "nutrition label":** Email = Contact Info, linked, not tracking; Health (sleep) = Health & Fitness, linked, not tracking; purpose App Functionality. Must match §2.
- **Category:** Health & Fitness (not Medical — keeps wellness framing, avoids the stricter medical-review path).
- **Export compliance** at submission: already answered via §3.
- Build upload + `eas submit`, ASC app record, privacy-policy URL field (needs §4 hosting).

## Today vs tomorrow
**Today (no account):** DB migration + RLS on `uunerbr`; backend `purge_user`/sweep/endpoint **built, tested, deployed**; app deletion lib + UI + login-cancel; `app.json` privacy manifest + export flag; privacy-policy draft committed; Account links wired to the swappable URL. **Result: nothing left for deletion/privacy/export tomorrow.**
**Tomorrow (needs account):** create ASC record, fill App Privacy form, set the policy URL once hosted, `eas submit`.

## Out of scope
Push-notification (APNs) key — only if remote push is added (local notifications need none). iOS screenshots — need a Mac/simulator. Sign in with Apple — not required (email magic-link only, no social login).
