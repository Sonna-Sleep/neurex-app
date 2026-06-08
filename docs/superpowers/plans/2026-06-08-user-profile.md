# User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect first name + date of birth + biological sex during onboarding (one-question-per-card, skippable), store it on the Supabase auth user, feed age + sex into cloud sleep staging, and show/edit it in a reworked Account screen.

**Architecture:** Profile lives in Supabase `auth.user_metadata` (keys `first_name`, `dob`, `sex`) — no new table. The app reads/writes it via a small `profile.ts` lib; a new `Profile` onboarding screen (3 cards) sits between sign-in and Pair. The backend reads the same metadata with its service-role admin client during staging and passes `age`/`male` to YASA.

**Tech Stack:** React Native 0.81 / Expo SDK 54, TypeScript, Supabase JS, Zustand (app); Python, Modal, supabase-py, YASA, pytest (backend).

**Repos & branches:**
- App: `C:\Users\Lenovo\neurex-app`, branch `feat/user-profile` (already created).
- Backend: `C:\Users\Lenovo\neurex-backend`, create `feat/staging-profile-metadata` off `main`.

**Test commands:**
- Backend: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests -q`
- App typecheck: `cd "C:/Users/Lenovo/neurex-app" && npm run typecheck`
- App smoke: `cd "C:/Users/Lenovo/neurex-app" && npx ts-node --transpile-only --project scripts/tsconfig.scripts.json scripts/smoke-profile.ts`

**Note on the Home greeting:** the spec mentioned a Home greeting, but Home has no greeting element today (only an empty-state headline). To avoid redesigning Home, the greeting is **deferred** — `firstName` is surfaced in Account instead. (Flagged to the user.)

---

## File Structure

**App**
- Create `src/lib/profile.ts` — read/write profile over `user_metadata`; `ageFromDob`. One responsibility: the profile data layer.
- Create `scripts/smoke-profile.ts` — node smoke for `profile.ts` against a mock client.
- Create `src/screens/onboarding/components/ProfileCard.tsx` — one onboarding card (eyebrow, title, child input, Continue + Skip).
- Create `src/screens/onboarding/components/DateOfBirthInput.tsx` — pure-JS DD/MM/YYYY input with validation (no native dep).
- Create `src/screens/onboarding/Profile.tsx` — sequences the 3 cards, saves, routes to Pair.
- Modify `src/navigation/types.ts` — add `Profile: undefined`.
- Modify `src/navigation/OnboardingNavigator.tsx` — register `Profile`.
- Modify `src/screens/onboarding/Auth.tsx` (3 spots) + `EmailSent.tsx` (1 spot) — post-auth `navigate('Pair')` → `navigate('Profile')`.
- Modify `src/state/session.ts` — extend `User` with optional `firstName`/`dob`/`sex`; add `patchUser`.
- Modify `src/lib/auth/useAuthListener.ts` — populate profile fields from `user_metadata`.
- Modify `src/screens/account/AccountScreen.tsx` — device→info rework + Edit.

**Backend (`neurex-backend`)**
- Modify `backend/modal/supabase_admin.py` — `get_user_metadata`.
- Modify `backend/modal/staging.py` — `stage()` accepts `age`/`male`, passes YASA metadata.
- Modify `backend/modal/pipeline.py` — read metadata, derive age/sex, pass to `stage_fn`.
- Modify `backend/tests/fakes.py`, `test_admin_iface.py`, `test_pipeline.py`, `test_staging.py`.

---

## Part A — Backend: staging metadata

### Task A1: `SupabaseAdmin.get_user_metadata`

**Files:** Modify `backend/modal/supabase_admin.py`, `backend/tests/fakes.py`, `backend/tests/test_admin_iface.py`; Test `backend/tests/test_profile_metadata.py` (new).

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_profile_metadata.py`:

```python
from backend.tests.fakes import FakeAdmin


def test_get_user_metadata_returns_seeded():
    a = FakeAdmin()
    a.seed_metadata("u1", {"first_name": "Alex", "dob": "1990-06-15", "sex": "male"})
    assert a.get_user_metadata("u1") == {"first_name": "Alex", "dob": "1990-06-15", "sex": "male"}


def test_get_user_metadata_unknown_user_is_empty():
    assert FakeAdmin().get_user_metadata("nobody") == {}
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests/test_profile_metadata.py -q`
Expected: FAIL (`FakeAdmin` has no `seed_metadata`/`get_user_metadata`).

- [ ] **Step 3: Extend `FakeAdmin`** — append to the class in `fakes.py`:

```python
    def seed_metadata(self, uid: str, metadata: dict):
        if not hasattr(self, "_metadata"):
            self._metadata = {}
        self._metadata[uid] = dict(metadata)

    def get_user_metadata(self, uid: str) -> dict:
        return dict(getattr(self, "_metadata", {}).get(uid, {}))
```

- [ ] **Step 4: Implement on `SupabaseAdmin`** — append method in `supabase_admin.py`:

```python
    def get_user_metadata(self, uid: str) -> dict:
        """Read the auth user's user_metadata (profile). Returns {} on any error
        so staging is never blocked by a profile lookup."""
        try:
            res = self.client.auth.admin.get_user_by_id(uid)
            user = getattr(res, "user", None)
            return dict(getattr(user, "user_metadata", None) or {}) if user else {}
        except Exception:  # noqa: BLE001 — profile is best-effort
            return {}
```

- [ ] **Step 5: Update `test_admin_iface.py`** — add `get_user_metadata` to the `_NEW` tuple (next to the deletion methods):

```python
_NEW = ("verify_user_token", "list_due_deletions", "delete_storage_prefix",
        "delete_user_sessions", "delete_auth_user", "purge_user",
        "upsert_deletion_request", "get_user_metadata")
```

- [ ] **Step 6: Run — verify PASS**

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests/test_profile_metadata.py backend/tests/test_admin_iface.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Lenovo/neurex-backend"
git add backend/modal/supabase_admin.py backend/tests/fakes.py backend/tests/test_admin_iface.py backend/tests/test_profile_metadata.py
git commit -m "feat(backend): SupabaseAdmin.get_user_metadata (profile for staging)"
```

### Task A2: `stage()` accepts age/male → YASA metadata

**Files:** Modify `backend/modal/staging.py`; Test `backend/tests/test_staging.py`.

- [ ] **Step 1: Write the failing test** — add to `test_staging.py`:

```python
def test_stage_accepts_metadata_without_error():
    # 12+ epochs of synthetic data so it passes MIN_EPOCHS; age/male must not break it.
    import numpy as np
    from backend.modal import staging
    fs = staging.DEFAULT_FS
    n = int(staging.EPOCH_SEC * fs) * (staging.MIN_EPOCHS + 2)
    idx = np.arange(n, dtype="<u4")
    uv = (50 * np.sin(np.arange(n) / 10.0)).astype("<f4")
    eeg = np.empty(n, dtype=[("ms", "<u4"), ("uv", "<f4")])
    eeg["ms"] = idx; eeg["uv"] = uv
    res = staging.stage(eeg.tobytes(), None, age=34, male=True)
    assert res.epochs and res.score is not None
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests/test_staging.py::test_stage_accepts_metadata_without_error -q`
Expected: FAIL (`stage()` has no `age`/`male` kwargs).

- [ ] **Step 3: Implement** — change the `stage` signature + the `SleepStaging` call in `staging.py`. Replace the `def stage(...)` line:

```python
def stage(eeg: bytes, eog: bytes | None, *, fs: float = DEFAULT_FS,
          age: int | None = None, male: bool | None = None) -> StagingResult:
```

And replace the `sls = yasa.SleepStaging(...)` line with:

```python
    metadata = {}
    if age is not None:
        metadata["age"] = age
    if male is not None:
        metadata["male"] = male
    sls = yasa.SleepStaging(raw, eeg_name="Fpz", eog_name=eog_name,
                            metadata=metadata or None)
```

- [ ] **Step 4: Run — verify PASS** (and the existing staging smoke still passes)

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests/test_staging.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Lenovo/neurex-backend"
git add backend/modal/staging.py backend/tests/test_staging.py
git commit -m "feat(backend): stage() passes age/sex metadata to YASA when present"
```

### Task A3: `run_pipeline` reads profile → age/sex

**Files:** Modify `backend/modal/pipeline.py`; Test `backend/tests/test_pipeline.py`.

- [ ] **Step 1: Write the failing test** — add to `test_pipeline.py` (uses the existing fake stage_fn pattern; capture kwargs):

```python
def test_pipeline_passes_age_and_sex_from_profile():
    from backend.modal.pipeline import run_pipeline, SessionRecord
    from backend.tests.fakes import FakeAdmin
    PREFIX = "u1/sess1"
    a = FakeAdmin(files={f"{PREFIX}/eeg.bin": b"x" * 8})
    a.seed("sess1", "u1")
    a.seed_metadata("u1", {"dob": "1990-01-01", "sex": "female"})
    captured = {}
    def fake_stage(eeg, eog, *, age=None, male=None):
        captured["age"] = age; captured["male"] = male
        from backend.modal.models import StagingResult
        return StagingResult(tib=0, tst=0, waso=0, efficiency=0, awakenings=0,
                             stage_minutes={"wake":0,"rem":0,"light":0,"deep":0},
                             epochs=[], stim_pulses=[], stim_impact_pct=None, score=0)
    run_pipeline(SessionRecord(id="sess1", user_id="u1", storage_prefix=PREFIX), a, stage_fn=fake_stage)
    assert captured["male"] is False                 # 'female' -> male=False
    assert captured["age"] is not None and captured["age"] >= 30


def test_pipeline_no_profile_passes_none():
    from backend.modal.pipeline import run_pipeline, SessionRecord
    from backend.tests.fakes import FakeAdmin
    PREFIX = "u2/sess2"
    a = FakeAdmin(files={f"{PREFIX}/eeg.bin": b"x" * 8})
    a.seed("sess2", "u2")
    captured = {}
    def fake_stage(eeg, eog, *, age=None, male=None):
        captured["age"] = age; captured["male"] = male
        from backend.modal.models import StagingResult
        return StagingResult(tib=0, tst=0, waso=0, efficiency=0, awakenings=0,
                             stage_minutes={"wake":0,"rem":0,"light":0,"deep":0},
                             epochs=[], stim_pulses=[], stim_impact_pct=None, score=0)
    run_pipeline(SessionRecord(id="sess2", user_id="u2", storage_prefix=PREFIX), a, stage_fn=fake_stage)
    assert captured["age"] is None and captured["male"] is None
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests/test_pipeline.py -q -k "age_and_sex or no_profile"`
Expected: FAIL (pipeline calls `stage_fn(eeg, eog)` with no age/male; fake requires kwargs default None so it would pass None — assert `male is False` fails).

- [ ] **Step 3: Implement** — in `pipeline.py`, add a helper and read the profile. Add near the top (after imports):

```python
def _age_from_dob(dob: str | None) -> int | None:
    if not dob:
        return None
    try:
        from datetime import date
        y, m, d = (int(x) for x in dob.split("-"))
        today = date.today()
        age = today.year - y - ((today.month, today.day) < (m, d))
        return age if 0 < age < 120 else None
    except Exception:  # noqa: BLE001
        return None
```

Replace `result = stage_fn(eeg, eog)` with:

```python
        meta = admin.get_user_metadata(record.user_id)
        age = _age_from_dob(meta.get("dob"))
        sex = meta.get("sex")
        male = True if sex == "male" else False if sex == "female" else None
        result = stage_fn(eeg, eog, age=age, male=male)
```

- [ ] **Step 4: Run — verify PASS, then full suite**

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests -q`
Expected: all pass (the existing `stage_fn` fakes in other pipeline tests must accept `age`/`male` kwargs — update any that don't to `def fake_stage(eeg, eog, *, age=None, male=None)`).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Lenovo/neurex-backend"
git add backend/modal/pipeline.py backend/tests/test_pipeline.py
git commit -m "feat(backend): run_pipeline feeds age/sex from user profile into staging"
```

---

## Part B — App: profile lib + session

### Task B1: `profile.ts` + session extension + smoke

**Files:** Create `src/lib/profile.ts`, `scripts/smoke-profile.ts`; Modify `src/state/session.ts`, `src/lib/auth/useAuthListener.ts`.

- [ ] **Step 1: Extend the session `User` + add `patchUser`** — in `src/state/session.ts`, change the `User` type:

```ts
type User = {
  id: string;
  email: string | null;
  name: string | null;
  firstName?: string | null;
  dob?: string | null;            // ISO 'YYYY-MM-DD'
  sex?: 'male' | 'female' | 'unspecified' | null;
};
```

Add to the `SessionState` type (near `setAuth`):

```ts
  patchUser: (patch: Partial<User>) => void;
```

Add the action (near `setAuth` in the store body):

```ts
      patchUser: (patch) =>
        set((s) => (s.user ? { user: { ...s.user, ...patch } } : {})),
```

- [ ] **Step 2: Populate profile from `user_metadata`** — in `src/lib/auth/useAuthListener.ts`, replace both `setAuth({ id: u.id, email: u.email ?? null, name: null })` calls with a helper that reads metadata. Add this function above the hook:

```ts
function toUser(u: { id: string; email?: string | null; user_metadata?: any }) {
  const m = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    name: null,
    firstName: m.first_name ?? null,
    dob: m.dob ?? null,
    sex: m.sex ?? null,
  };
}
```

Replace the two `setAuth({ id: u.id, email: u.email ?? null, name: null })` occurrences with `setAuth(toUser(u))`.

- [ ] **Step 3: Create `src/lib/profile.ts`:**

```ts
// Reads/writes the user profile stored on the Supabase auth user's
// user_metadata (keys first_name/dob/sex). Client injected for testability.
import { getSupabase } from './auth/supabase';
import { useSession } from '../state/session';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Sex = 'male' | 'female' | 'unspecified';
export type Profile = {
  firstName: string | null;
  dob: string | null;            // 'YYYY-MM-DD'
  sex: Sex | null;
};

function client(injected?: SupabaseClient | null): SupabaseClient {
  const c = injected ?? getSupabase();
  if (!c) throw new Error('Supabase not configured');
  return c;
}

/** Years from an ISO dob, or null if absent/invalid/out of range. */
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age > 0 && age < 120 ? age : null;
}

export async function getProfile(injected?: SupabaseClient | null): Promise<Profile> {
  const { data } = await client(injected).auth.getUser();
  const m = (data.user?.user_metadata ?? {}) as any;
  return { firstName: m.first_name ?? null, dob: m.dob ?? null, sex: m.sex ?? null };
}

/** Persist only the provided fields to user_metadata, then update the session. */
export async function saveProfile(
  patch: Partial<Profile>,
  injected?: SupabaseClient | null,
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.firstName !== undefined) data.first_name = patch.firstName;
  if (patch.dob !== undefined) data.dob = patch.dob;
  if (patch.sex !== undefined) data.sex = patch.sex;
  const { error } = await client(injected).auth.updateUser({ data });
  if (error) throw new Error(error.message);
  useSession.getState().patchUser({
    ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
    ...(patch.dob !== undefined ? { dob: patch.dob } : {}),
    ...(patch.sex !== undefined ? { sex: patch.sex } : {}),
  });
}
```

- [ ] **Step 4: Create `scripts/smoke-profile.ts`:**

```ts
// Run: npx ts-node --transpile-only --project scripts/tsconfig.scripts.json scripts/smoke-profile.ts
import './_expo-fs-stub';
import assert from 'node:assert';
import { ageFromDob, getProfile, saveProfile } from '../src/lib/profile';

assert.strictEqual(ageFromDob('1990-01-01')! >= 30, true);
assert.strictEqual(ageFromDob(null), null);
assert.strictEqual(ageFromDob('not-a-date'), null);
assert.strictEqual(ageFromDob(`${new Date().getFullYear() + 1}-01-01`), null); // future

function mockClient() {
  const meta: Record<string, unknown> = {};
  return {
    auth: {
      getUser: async () => ({ data: { user: { user_metadata: { ...meta } } } }),
      updateUser: async ({ data }: any) => { Object.assign(meta, data); return { error: null }; },
    },
  } as any;
}

(async () => {
  const c = mockClient();
  assert.deepStrictEqual(await getProfile(c), { firstName: null, dob: null, sex: null });
  await saveProfile({ firstName: 'Alex', dob: '1990-06-15', sex: 'male' }, c);
  assert.deepStrictEqual(await getProfile(c), { firstName: 'Alex', dob: '1990-06-15', sex: 'male' });
  console.log('smoke-profile OK');
})();
```

> Note: `scripts/_expo-fs-stub.ts` already exists (from the account-deletion work); `profile.ts` transitively imports `./auth/supabase` which the stub handles. `saveProfile` touches `useSession` (zustand) which loads fine under node.

- [ ] **Step 5: Add the npm script** — in `package.json` `scripts`, add:

```json
    "smoke:profile": "ts-node --transpile-only --project scripts/tsconfig.scripts.json scripts/smoke-profile.ts",
```

- [ ] **Step 6: Run smoke + typecheck — verify PASS**

Run: `cd "C:/Users/Lenovo/neurex-app" && npm run smoke:profile && npm run typecheck`
Expected: prints `smoke-profile OK`; typecheck no errors.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Lenovo/neurex-app"
git add src/lib/profile.ts scripts/smoke-profile.ts package.json src/state/session.ts src/lib/auth/useAuthListener.ts
git commit -m "feat(app): profile lib over user_metadata + session profile fields"
```

---

## Part C — App: onboarding profile flow

### Task C1: ProfileCard + DateOfBirthInput + Profile screen + registration

**Files:** Create `src/screens/onboarding/components/ProfileCard.tsx`, `src/screens/onboarding/components/DateOfBirthInput.tsx`, `src/screens/onboarding/Profile.tsx`; Modify `src/navigation/types.ts`, `src/navigation/OnboardingNavigator.tsx`.

- [ ] **Step 1: Create `ProfileCard.tsx`** (matches the onboarding style — see `EmailSent.tsx`):

```tsx
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../../components/Button';
import { SerifDisplay, Body, Eyebrow } from '../../../theme/typography';
import { colors, layout, spacing } from '../../../theme/tokens';

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  canContinue: boolean;
  onContinue: () => void;
  onSkip: () => void;
  isLast: boolean;
  children: React.ReactNode;
};

export function ProfileCard({
  eyebrow, title, subtitle, canContinue, onContinue, onSkip, isLast, children,
}: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <SerifDisplay style={styles.title}>{title}</SerifDisplay>
        {subtitle ? <Body style={styles.subtitle}>{subtitle}</Body> : null}
        <View style={styles.input}>{children}</View>
      </View>
      <View style={styles.actions}>
        <Button label={isLast ? 'finish' : 'continue'} onPress={onContinue} disabled={!canContinue} />
        <Button label="skip" variant="ghost" onPress={onSkip} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, paddingHorizontal: layout.screenPadding },
  center: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary },
  input: { marginTop: spacing.lg },
  actions: { paddingBottom: spacing.xl, gap: spacing.sm },
});
```

- [ ] **Step 2: Create `DateOfBirthInput.tsx`** (pure JS, no native dep):

```tsx
import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Eyebrow } from '../../../theme/typography';
import { colors, spacing } from '../../../theme/tokens';

type Props = { value: string | null; onChange: (iso: string | null) => void };

// Builds an ISO 'YYYY-MM-DD' only when D/M/Y form a real, in-range date.
function isoOrNull(d: string, m: string, y: string): string | null {
  const dd = Number(d), mm = Number(m), yy = Number(y);
  if (!dd || !mm || !yy || y.length !== 4) return null;
  const dt = new Date(yy, mm - 1, dd);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  const age = new Date().getFullYear() - yy;
  if (age < 13 || age > 120) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function DateOfBirthInput({ value, onChange }: Props) {
  const [d, setD] = React.useState(value ? value.slice(8, 10) : '');
  const [m, setM] = React.useState(value ? value.slice(5, 7) : '');
  const [y, setY] = React.useState(value ? value.slice(0, 4) : '');

  const update = (nd: string, nm: string, ny: string) => {
    setD(nd); setM(nm); setY(ny);
    onChange(isoOrNull(nd, nm, ny));
  };

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Eyebrow>day</Eyebrow>
        <TextInput style={styles.input} value={d} onChangeText={(t) => update(t.replace(/\D/g, '').slice(0, 2), m, y)}
          keyboardType="number-pad" placeholder="DD" placeholderTextColor={colors.textTertiary} maxLength={2} />
      </View>
      <View style={styles.field}>
        <Eyebrow>month</Eyebrow>
        <TextInput style={styles.input} value={m} onChangeText={(t) => update(d, t.replace(/\D/g, '').slice(0, 2), y)}
          keyboardType="number-pad" placeholder="MM" placeholderTextColor={colors.textTertiary} maxLength={2} />
      </View>
      <View style={[styles.field, styles.year]}>
        <Eyebrow>year</Eyebrow>
        <TextInput style={styles.input} value={y} onChangeText={(t) => update(d, m, t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad" placeholder="YYYY" placeholderTextColor={colors.textTertiary} maxLength={4} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, gap: spacing.xs },
  year: { flex: 1.4 },
  input: {
    color: colors.textPrimary, fontSize: 20, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider,
  },
});
```

- [ ] **Step 3: Create `Profile.tsx`** (sequences the 3 cards):

```tsx
import React, { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../../components/Button';
import { Body } from '../../theme/typography';
import { colors, spacing } from '../../theme/tokens';
import type { OnboardingStackParamList } from '../../navigation/types';
import { ProfileCard } from './components/ProfileCard';
import { DateOfBirthInput } from './components/DateOfBirthInput';
import { saveProfile, type Sex } from '../../lib/profile';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Profile'>;

export function Profile({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [dob, setDob] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);

  const done = async () => {
    try {
      await saveProfile({
        firstName: firstName.trim() || null,
        dob: dob ?? null,
        sex: sex ?? null,
      });
    } catch (e) {
      Alert.alert("Couldn't save your profile", e instanceof Error ? e.message : String(e));
    } finally {
      navigation.navigate('Pair');
    }
  };

  const next = () => (step < 2 ? setStep(step + 1) : done());
  const skipAll = () => navigation.navigate('Pair');

  if (step === 0) {
    return (
      <ProfileCard eyebrow="about you" title="What should we call you?"
        canContinue={firstName.trim().length > 0} onContinue={next} onSkip={() => setStep(1)} isLast={false}>
        <TextInput style={styles.text} value={firstName} onChangeText={setFirstName}
          placeholder="First name" placeholderTextColor={colors.textTertiary} autoFocus />
      </ProfileCard>
    );
  }
  if (step === 1) {
    return (
      <ProfileCard eyebrow="about you" title="When were you born?"
        subtitle="Used to make your sleep staging more accurate."
        canContinue={dob !== null} onContinue={next} onSkip={() => setStep(2)} isLast={false}>
        <DateOfBirthInput value={dob} onChange={setDob} />
      </ProfileCard>
    );
  }
  return (
    <ProfileCard eyebrow="about you" title="Biological sex"
      subtitle="Improves sleep-staging accuracy. You can skip this."
      canContinue={sex !== null} onContinue={done} onSkip={skipAll} isLast>
      <View style={styles.choices}>
        {(['male', 'female', 'unspecified'] as Sex[]).map((opt) => (
          <Button key={opt}
            label={opt === 'unspecified' ? 'prefer not to say' : opt}
            variant={sex === opt ? 'solid' : 'ghost'}
            onPress={() => setSex(opt)} />
        ))}
      </View>
    </ProfileCard>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.textPrimary, fontSize: 22, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider },
  choices: { gap: spacing.sm },
});
```

> If `Button` has no `variant: 'solid'`, use its default (omit `variant` for the selected one and `variant="ghost"` for others). Confirm against `src/components/Button.tsx` and adjust the `variant={...}` expression accordingly.

- [ ] **Step 4: Register the screen** — in `src/navigation/types.ts`, add to `OnboardingStackParamList` (after `EmailSent`):

```ts
  Profile: undefined;
```

In `src/navigation/OnboardingNavigator.tsx`, add the import and the screen (after `EmailSent`):

```tsx
import { Profile } from '../screens/onboarding/Profile';
```
```tsx
        <Stack.Screen name="Profile" component={Profile} />
```

- [ ] **Step 5: Typecheck — verify PASS**

Run: `cd "C:/Users/Lenovo/neurex-app" && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Lenovo/neurex-app"
git add src/screens/onboarding/Profile.tsx src/screens/onboarding/components/ProfileCard.tsx src/screens/onboarding/components/DateOfBirthInput.tsx src/navigation/types.ts src/navigation/OnboardingNavigator.tsx
git commit -m "feat(app): onboarding profile flow (name/dob/sex cards)"
```

### Task C2: Route into Profile after sign-in

**Files:** Modify `src/screens/onboarding/Auth.tsx`, `src/screens/onboarding/EmailSent.tsx`.

- [ ] **Step 1: Redirect post-auth to Profile** — in `Auth.tsx`, change the **three** post-auth navigations from `navigation.navigate('Pair')` to `navigation.navigate('Profile')`:
  - the `useEffect` on `authStatus === 'signed-in'`,
  - inside `continueWithMockUser`,
  - inside `handleGoogle` success (`if (u) { setAuth(...); navigation.navigate('Profile'); }`).

  Leave `navigation.navigate('EmailSent', ...)` unchanged.

- [ ] **Step 2: Redirect EmailSent** — in `EmailSent.tsx`, change the `useEffect` `navigation.navigate('Pair')` to `navigation.navigate('Profile')`.

- [ ] **Step 3: Typecheck — verify PASS**

Run: `cd "C:/Users/Lenovo/neurex-app" && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/Lenovo/neurex-app"
git add src/screens/onboarding/Auth.tsx src/screens/onboarding/EmailSent.tsx
git commit -m "feat(app): route to Profile step after sign-in (before Pair)"
```

---

## Part D — App: Account screen rework

### Task D1: Remove device, add account/about/support + edit

**Files:** Modify `src/screens/account/AccountScreen.tsx`.

- [ ] **Step 1: Replace the `profile` + `device` sections with the new `account` section, and add `about` + `support`.** In `AccountScreen.tsx`:

  Add imports:
```tsx
import { Linking } from 'react-native'; // merge into existing react-native import if present
import { ageFromDob, saveProfile } from '../../lib/profile';
```

  Remove the `device`/`deviceRepo` usage (the `useState<Device>` + `useEffect(deviceRepo.current...)` + the `device` Section). Replace the `profile` Section and `device` Section with:

```tsx
        <Section eyebrow="account">
          <View style={styles.col}>
            <Body>{user?.firstName ?? 'add your name'}</Body>
            <Body style={styles.muted}>{user?.email ?? 'guest'}</Body>
            <Body style={styles.muted}>
              {ageFromDob(user?.dob) ? `${ageFromDob(user?.dob)} years` : 'add birth date'}
              {user?.sex && user.sex !== 'unspecified' ? ` · ${user.sex}` : ''}
            </Body>
            <Body style={styles.link} onPress={() => navigation.navigate('EditProfile')}>edit</Body>
          </View>
        </Section>

        <Section eyebrow="about">
          <Body style={styles.muted}>
            Neurex tracks your sleep with a dry-electrode EEG headband and shows your stages and a nightly score.
          </Body>
        </Section>

        <Section eyebrow="support">
          <Body style={styles.link} onPress={() => Linking.openURL('mailto:contact@neurex.tech')}>contact@neurex.tech</Body>
        </Section>
```

> **Edit affordance:** the simplest in-scope edit is to reuse the onboarding cards. If adding an `EditProfile` route is too heavy for this task, replace the `edit` line's `onPress` with an inline `Alert.prompt`-free approach: navigate to the existing `Profile` flow is onboarding-only. **Recommended minimal:** implement `edit` as a small modal in this screen using the same `DateOfBirthInput` + a name `TextInput` + sex buttons, calling `saveProfile(...)`. If the modal grows the file too much, extract `src/screens/account/EditProfileSheet.tsx`. Pick the modal-in-a-new-file approach and wire `edit` to open it.

- [ ] **Step 2: Create `src/screens/account/EditProfileSheet.tsx`** — a `Modal` reusing the profile inputs:

```tsx
import React, { useState } from 'react';
import { Alert, Modal, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { SerifHeadline, Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { saveProfile, type Sex } from '../../lib/profile';
import { DateOfBirthInput } from '../onboarding/components/DateOfBirthInput';

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [dob, setDob] = useState<string | null>(user?.dob ?? null);
  const [sex, setSex] = useState<Sex | null>((user?.sex as Sex) ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await saveProfile({ firstName: firstName.trim() || null, dob, sex });
      onClose();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <SerifHeadline style={styles.h}>Edit profile</SerifHeadline>
        <Eyebrow>first name</Eyebrow>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName}
          placeholder="First name" placeholderTextColor={colors.textTertiary} />
        <Eyebrow>date of birth</Eyebrow>
        <DateOfBirthInput value={dob} onChange={setDob} />
        <Eyebrow>biological sex</Eyebrow>
        <View style={styles.choices}>
          {(['male', 'female', 'unspecified'] as Sex[]).map((opt) => (
            <Button key={opt} label={opt === 'unspecified' ? 'prefer not to say' : opt}
              variant={sex === opt ? 'solid' : 'ghost'} onPress={() => setSex(opt)} />
          ))}
        </View>
        <View style={styles.actions}>
          <Button label={busy ? 'saving…' : 'save'} onPress={save} disabled={busy} />
          <Button label="cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, padding: layout.screenPadding, gap: spacing.sm },
  h: { marginTop: spacing.xxl, marginBottom: spacing.md },
  input: { color: colors.textPrimary, fontSize: 18, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderDivider },
  choices: { gap: spacing.sm },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
```

  In `AccountScreen.tsx`, import it, add `const [editing, setEditing] = useState(false);`, change the `edit` link `onPress` to `() => setEditing(true)`, and render `<EditProfileSheet visible={editing} onClose={() => setEditing(false)} />`. Remove the now-unused `navigation.navigate('EditProfile')` reference and the `Device`/`deviceRepo` imports.

- [ ] **Step 3: Typecheck — verify PASS**

Run: `cd "C:/Users/Lenovo/neurex-app" && npm run typecheck`
Expected: no errors. (If `colors.borderDivider` / `Button variant 'solid'` don't exist, adjust to existing tokens/variants — confirm against `theme/tokens.ts` and `components/Button.tsx`.)

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/Lenovo/neurex-app"
git add src/screens/account/AccountScreen.tsx src/screens/account/EditProfileSheet.tsx
git commit -m "feat(app): Account rework — remove device, add account/about/support + edit profile"
```

---

## Part E — Verification

### Task E: Whole-feature verification

- [ ] **Step 1: Backend suite green**

Run: `cd "C:/Users/Lenovo/neurex-backend" && PYTHONUTF8=1 "C:/Users/Lenovo/neurex-backend/.venv/Scripts/python.exe" -m pytest backend/tests -q`
Expected: all pass.

- [ ] **Step 2: App typecheck + smokes green**

Run:
```
cd "C:/Users/Lenovo/neurex-app" && npm run typecheck && npm run smoke:profile && npm run smoke:account-deletion
```
Expected: no type errors; `smoke-profile OK`; `smoke-account-deletion OK`.

- [ ] **Step 3: Confirm routing + no orphan references**

Run: `cd "C:/Users/Lenovo/neurex-app" && grep -rn "navigate('Pair')" src/screens/onboarding && grep -rn "deviceRepo" src/screens/account/AccountScreen.tsx`
Expected: no post-auth `navigate('Pair')` left in Auth/EmailSent (only the Profile screen navigates to Pair); no `deviceRepo` left in AccountScreen.

---

## Self-review notes (coverage vs spec)
- Spec §1 storage (user_metadata `first_name`/`dob`/`sex`) → B1 (`profile.ts`), A1 (`get_user_metadata`). ✅
- Spec §2 onboarding cards + placement + skippable → C1 (cards/screen), C2 (routing). ✅
- Spec §3 staging (age/sex → YASA, fallback) → A2 (`stage`), A3 (`run_pipeline` + `_age_from_dob`). ✅
- Spec §4 Account rework (device→account/about/support + edit) → D1. ✅
- Spec §5 Home greeting → **deferred** (Home has no greeting element; flagged). 
- Type consistency: `Profile`/`Sex`, `saveProfile`/`getProfile`/`ageFromDob`, `get_user_metadata`, `stage(age,male)`, `patchUser` consistent across app + backend tasks. ✅
- DOB pure-JS (no native dep) → existing `gradlew assembleRelease` build path unchanged (no prebuild). ✅
