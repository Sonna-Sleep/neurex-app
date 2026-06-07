# App Store Hard Requirements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four App-Store review blockers — in-app account deletion (30-day grace + immediate), iOS privacy manifest, export-compliance flag, and a privacy policy — built, tested, and (for the backend) deployed today, so submission day needs only the Apple account.

**Architecture:** Account deletion uses a self-service `account_deletion_requests` table (RLS-scoped to the owner). The app schedules deletion by writing its own row (no privileged call) and offers an immediate path that hits a Modal endpoint; a Modal scheduled sweep performs the privileged purge in the fixed order **Storage → sessions rows → auth user** (Supabase refuses to delete a user who still owns Storage objects). Privacy manifest + export flag are `app.json` config; the policy is a committed Markdown doc behind one swappable URL constant.

**Tech Stack:** Backend — Python, Modal, supabase-py (service role), pytest. App — React Native 0.81 / Expo SDK 54, TypeScript, Supabase JS, Zustand. DB — Supabase Postgres + RLS.

**Two repos:**
- App: `C:\Users\Lenovo\neurex-app` (branch `feat/app-store-readiness`)
- Backend: `C:\Users\Lenovo\neurex-backend` (branch: create `feat/account-deletion` off `main`)

**Test commands:**
- Backend: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests -q` (run from `C:\Users\Lenovo\neurex-backend`)
- App typecheck: `npm run typecheck` (from `C:\Users\Lenovo\neurex-app`)
- App smoke: `npx ts-node --transpile-only scripts/smoke-account-deletion.ts`

---

## File Structure

**Backend (`neurex-backend`)**
- Create `supabase/migrations/0002_account_deletion_requests.sql` — table + RLS (also copied into the app repo's migrations; single source applied once to `uunerbr`).
- Modify `backend/modal/supabase_admin.py` — add `verify_user_token`, `list_due_deletions`, `_list_all_files`, `delete_storage_prefix`, `delete_user_sessions`, `delete_auth_user`, `purge_user`.
- Modify `backend/modal/web.py` — add `delete_account(token, admin)` logic seam + `POST /account/delete` route + `run_purge(admin)` seam + scheduled `purge_deletions` Modal function.
- Modify `backend/tests/fakes.py` — extend `FakeAdmin` with auth-users set, deletion-requests, storage tree, and the new methods (records purge order).
- Create `backend/tests/test_account_deletion.py` — purge ordering, due-list boundary, endpoint auth, sweep resilience.

**App (`neurex-app`)**
- Create `src/lib/legal.ts` — `LEGAL_URLS` constant (swappable).
- Create `src/lib/accountDeletion.ts` — deletion lifecycle (DI on the Supabase client + fetch).
- Create `src/screens/account/DeleteAccountSection.tsx` — danger-zone UI + confirm modal.
- Modify `src/screens/account/AccountScreen.tsx` — render `DeleteAccountSection`; make legal text tappable.
- Modify `src/lib/auth/useAuthListener.ts` — cancel a pending deletion on successful sign-in.
- Modify `app.json` — `expo.ios.privacyManifests` + `expo.ios.config.usesNonExemptEncryption`.
- Create `scripts/smoke-account-deletion.ts` — exercises `accountDeletion.ts` against a mock client.
- Create `docs/legal/privacy-policy.md` — the policy text.
- Create `supabase/migrations/0002_account_deletion_requests.sql` — same SQL as backend copy.

---

## Part A — Backend: privileged purge + endpoint + sweep

### Task A1: DB migration — `account_deletion_requests` table + RLS

**Files:**
- Create: `C:\Users\Lenovo\neurex-backend\supabase\migrations\0002_account_deletion_requests.sql`
- Create (copy): `C:\Users\Lenovo\neurex-app\supabase\migrations\0002_account_deletion_requests.sql`

- [ ] **Step 1: Write the migration SQL** (identical in both files)

```sql
-- Self-service account deletion requests. A row exists only while a deletion is
-- pending. RLS scopes every app operation to the owner; the service-role sweep
-- (Modal) bypasses RLS and reads all due rows.
create table if not exists public.account_deletion_requests (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after  timestamptz not null
);

alter table public.account_deletion_requests enable row level security;

-- Owner may see their own pending request.
create policy "own_select" on public.account_deletion_requests
  for select using (auth.uid() = user_id);

-- Owner may create their own request (schedule deletion).
create policy "own_insert" on public.account_deletion_requests
  for insert with check (auth.uid() = user_id);

-- Owner may cancel (delete) their own request by logging back in.
create policy "own_delete" on public.account_deletion_requests
  for delete using (auth.uid() = user_id);

-- Re-scheduling overwrites purge_after; allow owner update of their own row.
create policy "own_update" on public.account_deletion_requests
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sweep query helper: rows whose grace window has elapsed.
create index if not exists idx_adr_purge_after
  on public.account_deletion_requests (purge_after);
```

- [ ] **Step 2: Apply to the `uunerbr` project**

Prefer the linked CLI (run from `C:\Users\Lenovo\neurex-app`):
```
supabase db push
```
If the CLI is not linked/available, open the Supabase Dashboard for project `uunerbr` → SQL Editor → paste the SQL above → Run.

- [ ] **Step 3: Verify the table + RLS exist**

In SQL Editor (or `supabase db` query):
```sql
select tablename, rowsecurity from pg_tables where tablename = 'account_deletion_requests';
select policyname from pg_policies where tablename = 'account_deletion_requests' order by policyname;
```
Expected: one table with `rowsecurity = true`; policies `own_delete, own_insert, own_select, own_update`.

- [ ] **Step 4: Commit (both repos)**

```bash
# neurex-backend
git add supabase/migrations/0002_account_deletion_requests.sql
git commit -m "feat(db): account_deletion_requests table + RLS"
# neurex-app
git add supabase/migrations/0002_account_deletion_requests.sql
git commit -m "feat(db): account_deletion_requests table + RLS (mirror)"
```

---

### Task A2: `SupabaseAdmin` purge + verify methods

**Files:**
- Modify: `C:\Users\Lenovo\neurex-backend\backend\modal\supabase_admin.py`
- Modify: `C:\Users\Lenovo\neurex-backend\backend\tests\fakes.py`
- Test: `C:\Users\Lenovo\neurex-backend\backend\tests\test_account_deletion.py`

- [ ] **Step 1: Extend `FakeAdmin` in `fakes.py`** (append inside the class)

```python
    # --- account-deletion fakes ---
    # Extra state seeded via kwargs in tests:
    #   auth_users: set[str]            existing auth uids
    #   deletion_requests: list[dict]   {"user_id","purge_after"} rows
    #   storage_files already modeled by self.files (keys are object paths)
    # purge_order records the sequence of side effects for ordering assertions.
    def _ensure_deletion_state(self):
        if not hasattr(self, "auth_users"):
            self.auth_users = set()
        if not hasattr(self, "deletion_requests"):
            self.deletion_requests = []
        if not hasattr(self, "purge_order"):
            self.purge_order = []

    def verify_user_token(self, token: str):
        # Test convention: token == f"valid:{uid}" is accepted, anything else None.
        if token and token.startswith("valid:"):
            return token.split("valid:", 1)[1]
        return None

    def list_due_deletions(self, now_iso: str) -> list[str]:
        self._ensure_deletion_state()
        return [r["user_id"] for r in self.deletion_requests
                if r["purge_after"] <= now_iso]

    def delete_storage_prefix(self, uid: str) -> int:
        self._ensure_deletion_state()
        victims = [k for k in self.files if k.startswith(f"{uid}/")]
        for k in victims:
            del self.files[k]
        self.purge_order.append(("storage", uid))
        return len(victims)

    def delete_user_sessions(self, uid: str) -> None:
        self._ensure_deletion_state()
        self.rows = {k: v for k, v in self.rows.items() if v.get("user_id") != uid}
        self.purge_order.append(("sessions", uid))

    def delete_auth_user(self, uid: str) -> None:
        self._ensure_deletion_state()
        # Mirror Supabase: refuse if the user still owns Storage objects.
        if any(k.startswith(f"{uid}/") for k in self.files):
            raise RuntimeError("cannot delete user who owns storage objects")
        self.auth_users.discard(uid)
        self.deletion_requests = [r for r in self.deletion_requests
                                  if r["user_id"] != uid]
        self.purge_order.append(("auth", uid))

    def purge_user(self, uid: str) -> None:
        self.delete_storage_prefix(uid)
        self.delete_user_sessions(uid)
        self.delete_auth_user(uid)
```

- [ ] **Step 2: Write the failing tests** in `backend/tests/test_account_deletion.py`

```python
from backend.modal.web import delete_account, run_purge
from backend.tests.fakes import FakeAdmin


def _admin_with(uid, files=None, purge_after=None):
    a = FakeAdmin(files=dict(files or {}))
    a._ensure_deletion_state()
    a.auth_users.add(uid)
    if purge_after is not None:
        a.deletion_requests.append({"user_id": uid, "purge_after": purge_after})
    return a


def test_purge_user_orders_storage_before_auth():
    a = _admin_with("u1", files={"u1/night/eeg.bin": b"x", "u1/night/eog.bin": b"y"})
    a.seed("s1", "u1")
    a.purge_user("u1")
    kinds = [k for k, _ in a.purge_order]
    assert kinds == ["storage", "sessions", "auth"]
    assert "u1" not in a.auth_users
    assert a.rows == {}
    assert not any(k.startswith("u1/") for k in a.files)


def test_delete_auth_user_refuses_while_storage_remains():
    a = _admin_with("u1", files={"u1/n/eeg.bin": b"x"})
    try:
        a.delete_auth_user("u1")
        assert False, "expected refusal"
    except RuntimeError as e:
        assert "storage" in str(e)


def test_list_due_deletions_boundary():
    a = FakeAdmin(); a._ensure_deletion_state()
    a.deletion_requests = [
        {"user_id": "due", "purge_after": "2026-06-01T00:00:00+00:00"},
        {"user_id": "future", "purge_after": "2026-12-01T00:00:00+00:00"},
    ]
    due = a.list_due_deletions("2026-06-07T00:00:00+00:00")
    assert due == ["due"]


def test_delete_account_endpoint_rejects_bad_token():
    a = _admin_with("u1")
    status, body = delete_account("garbage", a)
    assert status == 401 and body["deleted"] is False


def test_delete_account_endpoint_purges_on_valid_token():
    a = _admin_with("u1", files={"u1/n/eeg.bin": b"x"})
    a.seed("s1", "u1")
    status, body = delete_account("valid:u1", a)
    assert status == 200 and body["deleted"] is True
    assert "u1" not in a.auth_users and a.rows == {}


def test_run_purge_continues_past_a_failing_uid(monkeypatch):
    a = _admin_with("good", files={"good/n/eeg.bin": b"x"}, purge_after="2026-01-01T00:00:00+00:00")
    a.auth_users.add("bad")
    a.deletion_requests.append({"user_id": "bad", "purge_after": "2026-01-01T00:00:00+00:00"})
    real_purge = a.purge_user
    def flaky(uid):
        if uid == "bad":
            raise RuntimeError("boom")
        return real_purge(uid)
    monkeypatch.setattr(a, "purge_user", flaky)
    n = run_purge(a, now_iso="2026-06-07T00:00:00+00:00")
    assert n == 1  # only "good" succeeded; sweep didn't abort
    assert "good" not in a.auth_users
```

- [ ] **Step 3: Run tests — verify they FAIL**

Run: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests/test_account_deletion.py -q`
Expected: ImportError / FAIL (`delete_account`, `run_purge` not defined; real methods missing). FakeAdmin tests for `purge_user`/`list_due_deletions` should already pass.

- [ ] **Step 4: Implement the real methods** — append to `SupabaseAdmin` in `supabase_admin.py`

```python
    # --- account deletion (service-role; ordered Storage -> sessions -> auth) ---
    def verify_user_token(self, token: str) -> str | None:
        """Resolve the uid from a user JWT, or None if the token is invalid.
        Uses GoTrue get_user — validates the bearer token regardless of the
        apikey the client was built with, so no extra secret is needed."""
        try:
            res = self.client.auth.get_user(token)
            user = getattr(res, "user", None)
            return getattr(user, "id", None) if user else None
        except Exception:
            return None

    def list_due_deletions(self, now_iso: str) -> list[str]:
        res = (self.client.table("account_deletion_requests")
               .select("user_id").lte("purge_after", now_iso).execute())
        return [r["user_id"] for r in (res.data or [])]

    def _list_all_files(self, prefix: str) -> list[str]:
        """Recursively collect every object path under `prefix` in the bucket.
        Storage .list is one level deep; folders have no id, files do."""
        out: list[str] = []
        for item in self._list(prefix):
            name = item.get("name")
            if not name:
                continue
            path = f"{prefix}/{name}" if prefix else name
            if item.get("id") is None:          # folder → recurse
                out.extend(self._list_all_files(path))
            else:
                out.append(path)
        return out

    def delete_storage_prefix(self, uid: str) -> int:
        paths = self._list_all_files(uid)
        for i in range(0, len(paths), 100):     # remove in batches
            self.client.storage.from_(self.bucket).remove(paths[i:i + 100])
        return len(paths)

    def delete_user_sessions(self, uid: str) -> None:
        self.client.table("sessions").delete().eq("user_id", uid).execute()

    def delete_auth_user(self, uid: str) -> None:
        # Storage must already be cleared (Supabase refuses otherwise). The
        # on-delete-cascade FK removes the account_deletion_requests row.
        self.client.auth.admin.delete_user(uid)

    def purge_user(self, uid: str) -> None:
        self.delete_storage_prefix(uid)
        self.delete_user_sessions(uid)
        self.delete_auth_user(uid)
```

- [ ] **Step 5: Run the FakeAdmin-only tests again — verify PASS** (endpoint/sweep still fail until A3/A4)

Run: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests/test_account_deletion.py -q -k "purge_user or refuses or boundary"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/modal/supabase_admin.py backend/tests/fakes.py backend/tests/test_account_deletion.py
git commit -m "feat(backend): SupabaseAdmin purge_user/verify_user_token/list_due_deletions + fakes"
```

---

### Task A3: `POST /account/delete` immediate endpoint

**Files:**
- Modify: `C:\Users\Lenovo\neurex-backend\backend\modal\web.py`

- [ ] **Step 1: Add the logic seam + route** to `web.py` (after the `webhook` handler, before `run_reconcile`)

```python
def delete_account(token: str, admin) -> tuple[int, dict]:
    """Immediate, permanent account deletion. Pure logic seam (tested without
    Modal/HTTP): verify the caller's JWT, then purge everything they own."""
    uid = admin.verify_user_token(token)
    if not uid:
        return 401, {"deleted": False, "error": "invalid token"}
    admin.purge_user(uid)
    return 200, {"deleted": True}
```

```python
@web_app.post("/account/delete")
async def account_delete(request: Request, authorization: str = Header(default="")):
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    from .supabase_admin import SupabaseAdmin
    status, body = delete_account(token, SupabaseAdmin())
    if status != 200:
        raise HTTPException(status_code=status, detail=body.get("error", "error"))
    return body
```

- [ ] **Step 2: Run the endpoint tests — verify PASS**

Run: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests/test_account_deletion.py -q -k "endpoint"`
Expected: PASS (`delete_account` now importable; bad token → 401, valid → purge).

- [ ] **Step 3: Commit**

```bash
git add backend/modal/web.py
git commit -m "feat(backend): POST /account/delete immediate-deletion endpoint"
```

---

### Task A4: Scheduled purge sweep

**Files:**
- Modify: `C:\Users\Lenovo\neurex-backend\backend\modal\web.py`
- Modify: `C:\Users\Lenovo\neurex-backend\backend\modal\config.py`

- [ ] **Step 1: Add the period tunable** to `config.py`

```python
PURGE_PERIOD_HOURS = 6        # how often the account-deletion purge sweep runs
DELETION_GRACE_DAYS = 30      # cooling-off window before a scheduled delete fires
```

- [ ] **Step 2: Add `run_purge` seam** to `web.py` (after `run_reconcile`)

```python
def run_purge(admin, now_iso: str | None = None) -> int:
    """Purge every account whose grace window elapsed. Returns the count purged.
    One bad uid never aborts the sweep (mirrors run_reconcile)."""
    if now_iso is None:
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
    purged = 0
    for uid in admin.list_due_deletions(now_iso):
        try:
            admin.purge_user(uid)
            purged += 1
        except Exception as e:  # noqa: BLE001 — keep sweeping other accounts
            print(f"[purge] failed for {uid}: {e}")
    return purged
```

- [ ] **Step 3: Add the scheduled Modal function** inside the `try: import modal` block in `web.py` (after the `reconcile` function), using the light image

```python
    @app.function(
        image=light_image,
        schedule=modal.Period(hours=PURGE_PERIOD_HOURS),
        secrets=[modal.Secret.from_name("neurex-backend")],
    )
    def purge_deletions():
        from .supabase_admin import SupabaseAdmin
        n = run_purge(SupabaseAdmin())
        print(f"[purge] purged {n} account(s)")
```

Add `PURGE_PERIOD_HOURS` to the existing config import line at the top of `web.py`:
```python
from .config import (UPLOADED_GRACE_MIN, PROCESSING_TIMEOUT_MIN,
                     RECONCILE_PERIOD_MIN, PURGE_PERIOD_HOURS)
```

- [ ] **Step 4: Run the sweep test — verify PASS**

Run: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests/test_account_deletion.py -q`
Expected: ALL pass (incl. `test_run_purge_continues_past_a_failing_uid`).

- [ ] **Step 5: Run the full backend suite — no regressions**

Run: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/modal/web.py backend/modal/config.py
git commit -m "feat(backend): scheduled account-deletion purge sweep (run_purge + purge_deletions)"
```

---

### Task A5: Deploy backend to Modal

**Files:** none (deploy action)

- [ ] **Step 1: Deploy** (from `C:\Users\Lenovo\neurex-backend`, with `$env:PYTHONUTF8="1"`)

```
& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m modal deploy backend/modal/web.py
```
Expected: deploy succeeds; output lists the web endpoint + the `purge_deletions` scheduled function and the existing `reconcile`.

- [ ] **Step 2: Smoke the endpoint rejects an unauthenticated call**

```
curl.exe -s -o NUL -w "%{http_code}" -X POST <web-endpoint>/account/delete
```
Expected: `401` (no/invalid bearer token). Do NOT smoke with a real token (it would delete a real account).

- [ ] **Step 3: Confirm the schedule is registered** — `modal app list` / Modal dashboard shows `purge_deletions` on a 6h period. Record the web base URL for the app's existing `EXPO_PUBLIC_MODAL_ENDPOINT_URL` host (the delete route lives on the same app).

---

## Part B — App: deletion lib + UI + login-cancel

### Task B1: `legal.ts` + `accountDeletion.ts` + smoke test

**Files:**
- Create: `C:\Users\Lenovo\neurex-app\src\lib\legal.ts`
- Create: `C:\Users\Lenovo\neurex-app\src\lib\accountDeletion.ts`
- Create: `C:\Users\Lenovo\neurex-app\scripts\smoke-account-deletion.ts`

- [ ] **Step 1: Create `src/lib/legal.ts`**

```typescript
// Single source for legal URLs. Hosting is deferred — swap these to the live
// URLs (e.g. https://neurex.tech/privacy) when the policy is published.
export const LEGAL_URLS = {
  privacyPolicy: 'https://neurex.tech/privacy',
  terms: 'https://neurex.tech/terms',
  about: 'https://neurex.tech',
} as const;
```

- [ ] **Step 2: Create `src/lib/accountDeletion.ts`**

```typescript
// Account-deletion lifecycle. Schedule = a plain RLS-protected row write (no
// privileged backend). Immediate = a Modal endpoint call. Cancel = delete the
// row. The Supabase client + fetch are injected so this is unit-smoke-testable.
import { Directory, Paths } from 'expo-file-system';
import { getSupabase } from './auth/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const MODAL_ENDPOINT_URL = process.env.EXPO_PUBLIC_MODAL_ENDPOINT_URL ?? '';
const DELETE_PATH = '/account/delete';
const GRACE_DAYS = 30;
const TABLE = 'account_deletion_requests';

export type PendingDeletion = { userId: string; purgeAfterMs: number };

function client(injected?: SupabaseClient | null): SupabaseClient {
  const c = injected ?? getSupabase();
  if (!c) throw new Error('Supabase not configured');
  return c;
}

/** Schedule deletion in GRACE_DAYS. Writes the caller's own row (RLS). */
export async function requestScheduledDeletion(
  injected?: SupabaseClient | null,
): Promise<{ purgeAfterMs: number }> {
  const c = client(injected);
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('not signed in');
  const purgeAfter = new Date(Date.now() + GRACE_DAYS * 86400_000);
  const { error } = await c
    .from(TABLE)
    .upsert({ user_id: uid, requested_at: new Date().toISOString(), purge_after: purgeAfter.toISOString() });
  if (error) throw new Error(error.message);
  return { purgeAfterMs: purgeAfter.getTime() };
}

/** Immediate, permanent deletion via the Modal endpoint, then local wipe. */
export async function deleteImmediately(
  injected?: SupabaseClient | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!MODAL_ENDPOINT_URL) throw new Error('EXPO_PUBLIC_MODAL_ENDPOINT_URL is not set');
  const c = client(injected);
  const { data } = await c.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');
  const base = MODAL_ENDPOINT_URL.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}${DELETE_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`delete failed (${res.status})`);
  await localWipe();
}

/** The caller's pending deletion, or null. */
export async function getPendingDeletion(
  injected?: SupabaseClient | null,
): Promise<PendingDeletion | null> {
  const c = client(injected);
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await c
    .from(TABLE)
    .select('user_id,purge_after')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !data) return null;
  return { userId: data.user_id, purgeAfterMs: new Date(data.purge_after).getTime() };
}

/** Cancel a pending deletion (delete the caller's row). Safe if none exists. */
export async function cancelPendingDeletion(
  injected?: SupabaseClient | null,
): Promise<boolean> {
  const c = client(injected);
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { error } = await c.from(TABLE).delete().eq('user_id', uid);
  return !error;
}

/** Remove on-device recordings + downloads. Auth/store reset is signOut's job. */
export async function localWipe(): Promise<void> {
  for (const name of ['sessions', 'downloads']) {
    try {
      const dir = new Directory(Paths.document, name);
      if (dir.exists) dir.delete();
    } catch {
      // best-effort; a missing dir is fine
    }
  }
}
```

- [ ] **Step 3: Create `scripts/smoke-account-deletion.ts`**

```typescript
// Smoke: exercise accountDeletion against an in-memory mock Supabase client.
// Run: npx ts-node --transpile-only scripts/smoke-account-deletion.ts
process.env.EXPO_PUBLIC_MODAL_ENDPOINT_URL = 'https://example.test';
import assert from 'node:assert';
import {
  requestScheduledDeletion, getPendingDeletion, cancelPendingDeletion, deleteImmediately,
} from '../src/lib/accountDeletion';

function mockClient(uid: string | null) {
  const rows: Record<string, any> = {};
  return {
    _rows: rows,
    auth: {
      getUser: async () => ({ data: { user: uid ? { id: uid } : null } }),
      getSession: async () => ({ data: { session: uid ? { access_token: 'tok' } : null } }),
    },
    from() {
      return {
        upsert: async (r: any) => { rows[r.user_id] = r; return { error: null }; },
        delete() { return { eq: async (_c: string, v: string) => { delete rows[v]; return { error: null }; } }; },
        select() { return { eq: (_c: string, v: string) => ({ maybeSingle: async () => ({ data: rows[v] ?? null, error: null }) }) }; },
      };
    },
  } as any;
}

(async () => {
  const c = mockClient('u1');
  assert.strictEqual(await getPendingDeletion(c), null);
  const { purgeAfterMs } = await requestScheduledDeletion(c);
  assert.ok(purgeAfterMs > Date.now());
  const p = await getPendingDeletion(c);
  assert.ok(p && p.userId === 'u1');
  assert.strictEqual(await cancelPendingDeletion(c), true);
  assert.strictEqual(await getPendingDeletion(c), null);

  // immediate: mock fetch (skip localWipe filesystem by catching its throw)
  const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  await deleteImmediately(c, okFetch).catch((e) => {
    if (!String(e).includes('document')) throw e; // localWipe has no FS in node — tolerate
  });
  const badFetch = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
  await assert.rejects(() => deleteImmediately(c, badFetch));
  console.log('smoke-account-deletion OK');
})();
```

- [ ] **Step 4: Run the smoke test — verify PASS**

Run: `npx ts-node --transpile-only scripts/smoke-account-deletion.ts`
Expected: prints `smoke-account-deletion OK` (exit 0).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/legal.ts src/lib/accountDeletion.ts scripts/smoke-account-deletion.ts
git commit -m "feat(app): account-deletion lib (schedule/immediate/cancel/wipe) + legal URLs + smoke"
```

---

### Task B2: Delete-account UI + AccountScreen wiring

**Files:**
- Create: `C:\Users\Lenovo\neurex-app\src\screens\account\DeleteAccountSection.tsx`
- Modify: `C:\Users\Lenovo\neurex-app\src\screens\account\AccountScreen.tsx`

- [ ] **Step 1: Create `DeleteAccountSection.tsx`**

```tsx
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Body, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import {
  requestScheduledDeletion, deleteImmediately,
} from '../../lib/accountDeletion';

const GRACE_DAYS = 30;

export function DeleteAccountSection() {
  const signOut = useSession((s) => s.signOut);
  const [busy, setBusy] = useState(false);

  const onSchedule = async () => {
    setBusy(true);
    try {
      const { purgeAfterMs } = await requestScheduledDeletion();
      const date = new Date(purgeAfterMs).toLocaleDateString();
      Alert.alert(
        'Deletion scheduled',
        `Your account and all data will be permanently deleted on ${date}. Log back in before then to cancel.`,
        [{ text: 'OK', onPress: signOut }],
      );
    } catch (e) {
      Alert.alert('Could not schedule deletion', String(e));
    } finally {
      setBusy(false);
    }
  };

  const onImmediate = async () => {
    setBusy(true);
    try {
      await deleteImmediately();
      Alert.alert(
        'Account deleted',
        'Your account and all data have been permanently deleted.',
        [{ text: 'OK', onPress: signOut }],
      );
    } catch (e) {
      Alert.alert('Could not delete account', String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    Alert.alert(
      'Delete account',
      `This permanently deletes your account and every sleep recording. This cannot be undone.\n\nSchedule deletion in ${GRACE_DAYS} days (cancel anytime by logging in), or delete immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Schedule (${GRACE_DAYS} days)`, onPress: onSchedule },
        { text: 'Delete immediately', style: 'destructive', onPress: onImmediate },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <Eyebrow>danger zone</Eyebrow>
      <View style={styles.body}>
        <Pressable onPress={confirm} disabled={busy} hitSlop={8}>
          <Body style={styles.delete}>
            {busy ? 'working…' : 'delete account'}
          </Body>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  body: { paddingTop: spacing.sm },
  delete: { color: colors.danger ?? '#E5484D' },
});
```

> Note: if `colors.danger` does not exist in `theme/tokens.ts`, add `danger: '#E5484D'` to the palette in the same task and use `colors.danger` directly (drop the `??`).

- [ ] **Step 2: Wire into `AccountScreen.tsx`** — make the legal line tappable and render the new section.

Replace the `legal` Section body:
```tsx
        <Section eyebrow="legal">
          <View style={styles.col}>
            <Body style={styles.link} onPress={() => Linking.openURL(LEGAL_URLS.privacyPolicy)}>privacy policy</Body>
            <Body style={styles.link} onPress={() => Linking.openURL(LEGAL_URLS.terms)}>terms</Body>
            <Body style={styles.link} onPress={() => Linking.openURL(LEGAL_URLS.about)}>about</Body>
          </View>
        </Section>
```

Add imports at the top:
```tsx
import { Linking } from 'react-native';
import { LEGAL_URLS } from '../../lib/legal';
import { DeleteAccountSection } from './DeleteAccountSection';
```

Render `<DeleteAccountSection />` just above the `actions` (log out) block:
```tsx
        <DeleteAccountSection />

        <View style={styles.actions}>
          <Button label="log out" variant="ghost" onPress={signOut} />
        </View>
```

Add a `link` style to the AccountScreen `StyleSheet`:
```tsx
  link: { color: colors.accent ?? colors.textSecondary, textDecorationLine: 'underline' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `colors.accent` is undefined, the `?? colors.textSecondary` fallback keeps it valid.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/account/DeleteAccountSection.tsx src/screens/account/AccountScreen.tsx src/theme/tokens.ts
git commit -m "feat(app): delete-account danger zone + tappable legal links"
```

---

### Task B3: Cancel a pending deletion on login

**Files:**
- Modify: `C:\Users\Lenovo\neurex-app\src\lib\auth\useAuthListener.ts`

- [ ] **Step 1: Cancel-on-sign-in** — in `onAuthStateChange`, when a user signs in, clear any pending deletion. Add the import and the call.

Add import:
```typescript
import { cancelPendingDeletion } from '../accountDeletion';
```

In the `onAuthStateChange` handler, after `setAuth({ ... })` for a present user:
```typescript
      const u = session?.user ?? null;
      if (u) {
        setAuth({ id: u.id, email: u.email ?? null, name: null });
        // Logging back in within the grace window cancels a scheduled deletion.
        cancelPendingDeletion().catch(() => undefined);
      } else setAuth(null);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/useAuthListener.ts
git commit -m "feat(app): cancel pending account deletion on successful login"
```

---

## Part C — Config + privacy policy

### Task C1: Privacy manifest + export compliance in `app.json`

**Files:**
- Modify: `C:\Users\Lenovo\neurex-app\app.json`

- [ ] **Step 1: Add `config` and `privacyManifests`** under `expo.ios` (alongside the existing `bundleIdentifier`, `infoPlist`).

```json
      "config": { "usesNonExemptEncryption": false },
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

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('app.json OK')"`
Expected: `app.json OK`.

- [ ] **Step 3: Verify reason codes against shipped library manifests** (informational — confirms we didn't miss a category our pods declare)

Run: `npx ts-node -e "0" 2>NUL; node -e "const cp=require('child_process'); console.log('scan node_modules for PrivacyInfo.xcprivacy manually if any pod adds a category not listed above')"`
Then: search `node_modules` for `*.xcprivacy` and confirm every `NSPrivacyAccessedAPICategory*` they declare is present in our list above; add any missing category with its reason code.

- [ ] **Step 4: Commit**

```bash
git add app.json
git commit -m "feat(ios): privacy manifest + export-compliance (usesNonExemptEncryption=false)"
```

---

### Task C2: Privacy policy draft

**Files:**
- Create: `C:\Users\Lenovo\neurex-app\docs\legal\privacy-policy.md`

- [ ] **Step 1: Write the policy** (`docs/legal/privacy-policy.md`)

```markdown
# Neurex Privacy Policy

_Last updated: 2026-06-07_

Neurex ("we", "us") makes a sleep-tracking headband and companion app. This
policy explains what we collect, why, and your rights. Contact: contact@neurex.tech.

Neurex is a **wellness** product. It is not a medical device and does not
diagnose, treat, or prevent any disease.

## What we collect
- **Account:** your email address (for sign-in via magic link).
- **Sleep recordings:** EEG and EOG signals recorded by the headband, and the
  sleep metrics derived from them (stages, sleep score, time-in-bed, etc.).
- **Device & diagnostic:** minimal app/device information needed to operate and
  troubleshoot the service.

We do **not** use your data for advertising, and we do **not** track you across
other apps or websites.

## How we use it
To provide the service: store your recordings, run sleep staging, and show you
your results. To maintain and improve reliability and security.

## Where it's stored
Recordings and account data are stored with Supabase (database + file storage)
in the United States (us-east-1) and processed by Modal for sleep staging. Data
is encrypted in transit (HTTPS/TLS). If you are in the EU/EEA, note that your
data is processed in the United States.

## Retention & deletion
You can delete your account and all associated data at any time from the app
(Account → delete account). You may delete immediately, or schedule deletion in
30 days (cancellable by logging back in before then). When deletion completes,
your recordings, derived metrics, and account are permanently removed.

## Your rights
Depending on your region (e.g. GDPR/CCPA), you may have rights to access,
correct, export, or delete your data. Email contact@neurex.tech to exercise them.

## Children
Neurex is not directed to children under 13 and we do not knowingly collect
their data.

## Changes
We may update this policy; material changes will be reflected by the "Last
updated" date above.
```

- [ ] **Step 2: Commit**

```bash
git add docs/legal/privacy-policy.md
git commit -m "docs(legal): privacy policy (hosting deferred; URL via LEGAL_URLS)"
```

---

## Part D — Final verification

### Task D: Whole-suite verification

- [ ] **Step 1: Backend suite green**

Run: `& 'C:\Users\Lenovo\neurex-backend\.venv\Scripts\python.exe' -m pytest backend/tests -q`
Expected: all pass.

- [ ] **Step 2: App typecheck + smokes green**

Run (from `C:\Users\Lenovo\neurex-app`):
```
npm run typecheck
npx ts-node --transpile-only scripts/smoke-account-deletion.ts
```
Expected: no type errors; `smoke-account-deletion OK`.

- [ ] **Step 3: Manifest + app.json sanity**

Run: `node -e "const j=require('./app.json'); const ios=j.expo.ios; console.log(!!ios.config.usesNonExemptEncryption===false, ios.privacyManifests.NSPrivacyAccessedAPITypes.length)"`
Expected: prints `true 4`.

- [ ] **Step 4: Push branches (ask first per repo)**

Confirm with the user which branch/files, then push `feat/account-deletion` (backend) and `feat/app-store-readiness` (app), and open PRs.

---

## Self-review notes (coverage vs spec)
- Spec §1 deletion → Tasks A1–A5 (table+RLS, purge, endpoint, sweep, deploy) + B1–B3 (lib, UI, cancel). ✅
- Spec §1 immediate-option requirement → B2 confirm dialog offers "Delete immediately"; A3 endpoint. ✅
- Spec §1 purge order Storage→DB→auth → enforced in `purge_user` + asserted in `test_purge_user_orders_storage_before_auth`. ✅
- Spec §2 privacy manifest → C1. ✅  Spec §3 export flag → C1. ✅  Spec §4 policy + links → C2 + B1 (`legal.ts`) + B2 (links). ✅
- Spec §5 (App Privacy answers, category, eas submit) → intentionally out of scope (needs Apple account); manifest data-types in C1 mirror the App Privacy answers. ✅
- Local wipe paths (`Paths.document/sessions`, `/downloads`) match `cloudSync.ts`. ✅
- Type consistency: `verify_user_token`/`list_due_deletions`/`purge_user`/`delete_account`/`run_purge` names identical across fakes, real impl, endpoint, sweep, and tests. ✅
```
