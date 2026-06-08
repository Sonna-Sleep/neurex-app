# User profile — onboarding, staging, and account

**Date:** 2026-06-08
**Status:** Approved design
**Scope:** Collect a small user profile (first name, date of birth, biological sex) during onboarding with a polished one-question-per-card flow, store it on the Supabase auth user, feed age + sex into cloud sleep staging for better accuracy, and surface/edit it in a reworked Account screen.

## Goal

Give people a warm onboarding moment that also makes the product better: the profile we collect (age + sex) improves YASA's sleep-staging accuracy, and the first name personalizes the app. Replace the mostly-empty "device" section in Account with useful info (account details + about + support).

## Decisions (locked in brainstorming)
- **Fields:** first name, date of birth, biological sex. (No sleep goal.)
- **Flow:** one question per card (swipe-through), placed right after sign-in, before Pair. Skippable; editable later.
- **Staging:** age + sex feed YASA.
- **Storage:** Supabase auth `user_metadata` (no new table).

---

## 1. Data model & storage

Profile lives in the Supabase **auth user's `user_metadata`** (not a new table):

```ts
type Profile = {
  firstName: string | null;
  dob: string | null;   // ISO 'YYYY-MM-DD'
  sex: 'male' | 'female' | 'unspecified' | null;
};
```

- Written client-side with `supabase.auth.updateUser({ data: { first_name, dob, sex } })`.
- Read client-side from the session user's `user_metadata`.
- Read server-side (for staging) by the service-role admin client.
- **Why `user_metadata`:** no migration (avoids a second Management-API trip to `uunerbr`), the backend already has admin access to the auth user, and the profile is tiny. Store **dob** (not a fixed age) so age stays correct over time.

Keys in `user_metadata`: `first_name`, `dob`, `sex`.

## 2. Onboarding profile step

A new `Profile` screen in the onboarding stack, shown **after sign-in, before `Pair`**:
- Today the post-auth path is `navigate('Pair')` (in `Auth.tsx` and `EmailSent.tsx`). Change those to `navigate('Profile')`. `Profile` continues to `Pair` when done or skipped.
- **Three cards, one field each**, advancing with a Continue button (and a subtle **Skip** on each):
  1. **First name** — text input.
  2. **Date of birth** — date picker (reasonable bounds; ≥13 years old, ≤120).
  3. **Biological sex** — three choices: Male / Female / Prefer not to say. Copy notes it improves sleep-staging accuracy.
- On finishing the last card (or "skip all"), write whatever was provided to `user_metadata` and navigate to `Pair`. Partial completion is fine — only set the keys the user filled.
- Reuses the existing onboarding visual style (match `HowItWorks` / `NotificationsPermission`). New `ProfileCard` sub-component renders a single card; the `Profile` screen sequences them.

**Skippable, not a wall.** Skipping leaves the keys unset; staging falls back to no-metadata, and the user can fill them later in Account.

## 3. Staging integration (age + sex → YASA)

- `SupabaseAdmin.get_user_metadata(uid) -> dict` — reads the auth user's `user_metadata` via `client.auth.admin.get_user_by_id(uid)`; returns `{}` on any error (never blocks staging).
- `run_pipeline` reads the profile for `record.user_id`, derives `age` from `dob` (years at staging time; `None` if absent/unparseable), maps `sex=='male'`→`male=True`, `'female'`→`False`, else `None`, and passes `age`/`male` to `stage()`.
- `stage(eeg, eog, *, fs=DEFAULT_FS, age=None, male=None)` — when `age` and/or `male` are present, pass `metadata={'age': age, 'male': male}` to `yasa.SleepStaging(...)`; otherwise call it exactly as today. (YASA improves auto-staging with this metadata.)
- **Graceful fallback:** any missing/invalid profile field → that key is omitted; a fully-absent profile → identical behavior to today. A failure reading metadata is swallowed (staging proceeds without it).
- `FakeAdmin.get_user_metadata` mirrors this for tests; `AdminProtocol` + `test_admin_iface` updated.

## 4. Account screen rework

Remove the headband **device** section. Replace with three info sections + keep the rest:

- **account** — first name, email, age (derived from dob), biological sex. An **Edit** affordance opens an editor (reuses the profile card inputs as a simple form) that writes back to `user_metadata`. Fields the user hasn't set show a subtle "add" prompt.
- **about** — one short line: what Neurex is (wellness sleep tracking with the headband).
- **support** — `contact@neurex.tech`, tappable (opens mail).
- **app** — version (unchanged).
- Unchanged: legal (privacy policy + about links), delete-account section, log out.

The `profile` (email-only) section is folded into the new **account** section.

## 5. Home greeting

Where Home shows a heading/welcome, use the first name when present: "Good morning, {firstName}" (time-of-day aware if that's already how Home greets; otherwise a simple "Hi, {firstName}"). Falls back to the current copy when no name is set.

## Components & files

**App**
- `src/lib/profile.ts` — `getProfile()`, `saveProfile(partial)`, `ageFromDob(dob)`. One responsibility: read/write the profile over `user_metadata` (Supabase client injected for testability). Updates the session `user` after save.
- `src/screens/onboarding/Profile.tsx` — sequences the three cards; handles skip + save + navigation to `Pair`.
- `src/screens/onboarding/components/ProfileCard.tsx` — one card (title, input slot, Continue, Skip).
- `src/navigation/OnboardingNavigator.tsx` + `types.ts` — register `Profile`.
- `src/screens/onboarding/Auth.tsx`, `EmailSent.tsx` — post-auth `navigate('Pair')` → `navigate('Profile')`.
- `src/state/session.ts` — extend `User` with `firstName`, `dob`, `sex`; populate from `user_metadata` in `useAuthListener`.
- `src/screens/account/AccountScreen.tsx` — device→info rework + Edit.
- Home greeting (the relevant Home component).

**Backend (`neurex-backend`)**
- `backend/modal/supabase_admin.py` — `get_user_metadata`.
- `backend/modal/pipeline.py` — read profile, derive age/sex, pass to `stage_fn`.
- `backend/modal/staging.py` — `stage()` accepts `age`/`male`, passes YASA metadata.
- `backend/tests/fakes.py`, `test_admin_iface.py`, `test_pipeline.py`, `test_staging.py` — coverage below.

## Error handling
- Profile save failure → non-blocking toast; user can continue/retry; nothing else breaks.
- Backend metadata read failure or absent profile → staging proceeds with no metadata (today's behavior).
- DOB parse/age out of plausible range → treat as unset for staging.

## Testing
- **App:** `profile.ts` smoke (mock Supabase) — save writes the three keys, get reads them back, `ageFromDob` boundary (leap year, future date → null). Typecheck.
- **Backend:** `pipeline` passes age/male when metadata present and omits when absent (unit, FakeAdmin seeded with/without metadata); `stage()` accepts/ignores metadata without error; `get_user_metadata` returns `{}` on error; iface parity.

## Out of scope
- A `profiles` table (using `user_metadata` instead).
- Sleep goal / chronotype / height / weight.
- Editing biological-sex semantics beyond the three options.
- Retroactively re-staging past nights when a profile is added later (only new sessions use it).
