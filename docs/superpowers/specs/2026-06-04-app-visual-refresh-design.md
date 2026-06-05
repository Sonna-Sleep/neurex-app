# App Visual Refresh — "Refined Midnight on Obsidian"

- **Date:** 2026-06-04
- **Status:** Approved (direction + base + north-star), ready for implementation plan
- **Branch:** `feat/ui-refresh`
- **Repo:** `neurex-app`

## Goal

Make the whole app look more polished and intentional without changing any
behavior. Refine the existing dark, minimal, Oura-inspired aesthetic ("Refined
Midnight"), re-based on a **dark-gray Obsidian** background instead of pure
black, applied consistently across every screen.

## Non-goals (explicit)

- **No behavior, data, or logic changes.** BLE/recording (`lib/ble/*`), cloud
  sync (`lib/cloud/cloudSync.ts`), repos, and the Supabase/Modal pipeline are
  untouched. This is purely presentational (colors, spacing, hierarchy, one
  chart component).
- No new screens, no navigation changes, no new dependencies (unless the
  hypnogram rewrite needs `react-native-svg`, which is evaluated in the plan).
- No animation system, no score ring, no accent-color change — these were
  considered and deliberately left out to preserve the minimal direction.

## Locked decisions

- **Direction:** A · Refined Midnight — pure-dark, thin oversized numbers,
  hairline rules, uppercase tracked labels, generous negative space, stage
  colors used for *data only* (never chrome).
- **Base shade:** Obsidian **`#0A0A0A`** (a whisper off black — confirmed via
  side-by-side mockups; darker than charcoal, not fully black).
- **Hypnogram lane order:** top → bottom = **Wake · Light · REM · Deep**, each
  segment tinted by its stage. (Approved.)

## Palette (the foundation — `src/theme/tokens.ts`)

One token change re-skins most of the app, since every screen consumes these.

| Token | Current | New | Role |
|---|---|---|---|
| `bgPrimary` | `#000000` | **`#0A0A0A`** | screen base |
| `bgSurface` | `#0F0F0F` | **`#141414`** | card surface (one step up) |
| `bgElevated` | `#1A1A1A` | **`#1C1C1C`** | elevated surface |
| `borderSubtle` | `#2A2A2A` | **`#242424`** | hairline border |
| `borderDivider` | `#3A3A3A` | **`#333333`** | divider / connectors |
| `textPrimary` | `#FFFFFF` | `#FFFFFF` | (unchanged) |
| `textSecondary` | `#8A8A8A` | **`#9A9A9A`** | brighter for legibility |
| `textTertiary` | `#6B6B6B` | **`#6E6E6E`** | labels/eyebrows |
| `ctaBg`/`ctaText` | white/black | (unchanged) | primary button |
| `warning` | `#E5C07B` | (unchanged) | warnings |

**Stage colors + opacity unchanged** (data hero): deep `#3B82F6`, light
`#60A5FA`, rem `#A78BFA`, wake `#E5E7EB`; opacities wake .25 / rem .45 / light
.65 / deep 1.0.

**Principle:** surfaces always sit one step lighter than the base and carry a
`borderSubtle` hairline, so depth/hierarchy still reads on the lighter base.

## Typography (`src/theme/tokens.ts`, `typography.tsx`) — unchanged

Keep the system-font stack, thin (300/200) oversized display/hero numbers,
tracked uppercase eyebrows, the 104px hero score and 44px stat number. No
changes — it already matches the direction. Documented here so the plan doesn't
touch it.

## Hypnogram — already on-target, re-skin only

**Discovery during spec review:** `src/screens/home/components/Hypnogram.tsx`
already implements the approved design. It uses `react-native-svg` (15.12.1, a
current dependency), already orders lanes top→bottom **Wake · Light · REM ·
Deep** (`LANES = ['wake','light','rem','deep']`), already tints each contiguous
run by `stageColors[stage]`, draws connectors between level changes, and has a
bottom time axis (bedtime/wake-time at the edges, 2-hour ticks between). It
already reads its colors from tokens (`colors.borderSubtle`,
`colors.textSecondary`).

So there is **no rewrite**. It inherits the palette change automatically. The
only deltas to consider, both optional polish:

- **Left lane labels** (WAKE/LIGHT/REM/DEEP) in `textTertiary`, like the
  mockup — the real component currently relies on vertical position alone. Adding
  them is the one small enhancement worth doing.
- **Band weight:** the real component draws ~20px-tall `Rect` bands; the mockup
  used thinner strokes. Keep the existing bands (they read well and pair with the
  time axis) unless the on-device check says otherwise. No change by default.

Inputs/props stay identical, so `HomeScreen` needs no change.

## Per-screen polish (audit + tighten on the new base)

Each is a token-driven re-skin plus a spacing/hierarchy pass. The work per
screen is mostly: replace any **hardcoded** color literals with tokens, confirm
cards use `bgSurface` + `borderSubtle`, and tighten spacing to the mockup.

- **Home** (`HomeScreen.tsx` + `NightSummary`, `StageBreakdown`,
  `StimImpactCard`, `ProcessingCard`, `RecordingCard`, `ConnectDeviceCard`,
  `SignalPreview`): hero score spacing, stage breakdown bars on `#161616`
  tracks, stim card on `bgSurface`, empty state.
- **History** (`HistoryScreen.tsx`): rows on Obsidian, device tag + score +
  stage bar, hairline dividers (device tag already added in `feat/cloud-sync`).
- **Session detail** (`SessionDetailScreen.tsx`): consistent cards/sections.
- **Account** (`AccountScreen.tsx`, `DualRecordSection.tsx`, `DebugSection.tsx`):
  consistent surfaces, borders, spacing.
- **Onboarding** (`Welcome`, `HowItWorks`, `NotificationsPermission`,
  `EmailSent`, `Pair`, `Auth`): consistent base + cards.
- **Shared components** (`Card`, `Button`, `StatusPill`, `Skeleton`,
  `typography.tsx`): match the new palette; `Skeleton` shimmer base = `bgSurface`.

## Implementation approach

1. **Tokens first** — update `tokens.ts`; most screens re-skin for free.
2. **Hardcoded-color audit** — grep the codebase for hex literals
   (`#000`, `#0F0F0F`, `#1A1A1A`, etc.) outside `tokens.ts` and route them
   through tokens. **This is the bulk of the work.**
3. **Hypnogram** — add optional left lane labels; otherwise it inherits the
   re-skin (no rewrite).
4. **Per-screen spacing pass** — tighten to the mockup.
5. **Verify** — `tsc --noEmit`, release build, install, eyeball each screen on
   device.

## Acceptance criteria

- No pure-`#000000` or stale `#0F0F0F/#1A1A1A` backgrounds remain; all colors
  flow through `tokens.ts`.
- Hypnogram still renders correctly on the new palette (lanes Wake→Deep,
  stage-tinted, time axis intact); optional left lane labels added.
- `npx tsc --noEmit` clean; release APK builds and installs.
- BLE, recording, cloud-sync, and pipeline code are byte-unchanged (diff shows
  only `theme/`, screen/component presentational edits, and `Hypnogram`).
- On-device visual check of Home, History, Session detail, Account/dual-record,
  and onboarding against the north-star.

## Risks / notes

- **Hardcoded colors** scattered in components are the main hidden work — the
  grep audit must be thorough so nothing stays pure-black on the new base.
- **Contrast:** verify `textSecondary`/`textTertiary` remain legible on
  `#0A0A0A` (the bump to `#9A9A9A` addresses this).
- **No logic changes anywhere** — the Hypnogram already implements the design,
  so this refresh is entirely palette + presentational. Lowest-risk class of
  change.
- North-star reference mockups live in the brainstorm session
  (`directions.html`, `bg-shade-v2.html`, `northstar-home-v2.html`).
