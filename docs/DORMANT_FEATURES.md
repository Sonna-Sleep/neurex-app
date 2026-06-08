# Dormant features

Features whose code is intentionally kept in the repo but **not wired into the UI** —
so we don't lose the work, and can revive them quickly if needed. Each entry says
what it is, why it's dormant, and exactly how to turn it back on.

---

## Dual-headband recording (two devices on one phone)

**Status:** Dormant since **2026-06-07**. The app is single-device from the user's
perspective — there is no way to connect/record two headbands at once.

**Why:** Product decision to ship a single-device experience. The dual path was a
two-person overnight stopgap (Aleksas + Goda on one phone); it was removed from the
UI rather than maintained as a user-facing feature.

**What's kept (intact, not deleted):**
- `src/screens/account/DualRecordSection.tsx` — the UI (scan / start / stop two
  headbands, plus per-recording cloud sync). No longer rendered anywhere.
- `src/lib/ble/multiController.ts` — the engine (connects to two devices, each to
  its own EEG/EOG file). Its only consumer was `DualRecordSection`.
- Passive dual-aware handling elsewhere (`lib/cloud/cloudSync.ts`,
  `lib/ble/recovery.ts`, `screens/history/HistoryScreen.tsx`,
  `lib/ble/constants.ts`) is left in place — it only *handles* dual-named data if
  it exists and never *exposes* the connect-two ability.

**How to revive:**
1. In `src/screens/account/AccountScreen.tsx`, re-add
   `import { DualRecordSection } from './DualRecordSection';` and render
   `<DualRecordSection />` where the dormant breadcrumb comment is.
2. That's it — the component and `multiController` are unchanged and still wired to
   each other. Verify with `npm run typecheck`.

**Removed in:** branch `feat/single-device-only`.
