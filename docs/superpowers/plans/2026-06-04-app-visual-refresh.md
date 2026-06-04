# App Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the whole app to "Refined Midnight on Obsidian" — base `#0A0A0A` instead of pure black, refreshed surfaces/borders/text, consistent hairline-bordered cards, and optional Hypnogram lane labels — with zero behavior changes.

**Architecture:** Token-first. Almost every screen/component already reads color from `src/theme/tokens.ts`, so rebasing the palette there re-skins the app in one edit. The remaining work is: one stray hardcoded `#000`, adding the `Card` hairline border to a few hand-rolled card surfaces, and adding left lane labels to the (already-correct) Hypnogram. Purely presentational.

**Tech Stack:** React Native 0.81 / Expo SDK 54, TypeScript, `react-native-svg` 15.12.1 (Hypnogram). No unit-test runner in this app, so **verification = `npx tsc --noEmit` (compile) + release build + on-device visual check**, not unit tests — this change has no behavioral logic to assert.

**Spec:** `docs/superpowers/specs/2026-06-04-app-visual-refresh-design.md`
**Branch:** `feat/ui-refresh` (already created)
**All commands run from:** `cd "/c/Users/Lenovo/neurex-app"`

---

## File Structure

- **Modify** `src/theme/tokens.ts` — palette rebase (the core change; drives everything).
- **Modify** `src/navigation/OnboardingNavigator.tsx` — replace stray `#000` literal with token.
- **Modify** `src/screens/home/components/Hypnogram.tsx` — add left lane labels + inset chart so labels don't overlap bands.
- **Modify** hand-rolled card surfaces that use `colors.bgSurface` without a border (confirmed: `src/screens/home/components/StimImpactCard.tsx`; audit the rest) — add the `Card` hairline border for consistency on the lighter base.
- **Do NOT touch:** `src/components/GoogleLogo.tsx` (intentional Google brand colors), any `lib/**` (BLE/cloud/repos), navigation logic, screen logic.

---

### Task 1: Rebase the palette (the core re-skin)

**Files:**
- Modify: `src/theme/tokens.ts:3-15`

- [ ] **Step 1: Replace the `colors` object**

Replace the entire `export const colors = { ... } as const;` block (lines 3–15) with:

```ts
export const colors = {
  bgPrimary: '#0A0A0A',
  bgSurface: '#141414',
  bgElevated: '#1C1C1C',
  borderSubtle: '#242424',
  borderDivider: '#333333',
  textPrimary: '#FFFFFF',
  textSecondary: '#9A9A9A',
  textTertiary: '#6E6E6E',
  ctaBg: '#FFFFFF',
  ctaText: '#000000',
  warning: '#E5C07B',
} as const;
```

Leave `stageOpacity`, `stageColors`, fonts, `typeScale`, `spacing`, `radii`, `layout` unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/theme/tokens.ts
git commit -m "style(theme): rebase palette to Obsidian #0A0A0A (Refined Midnight)"
```

---

### Task 2: Remove the one stray hardcoded background

**Files:**
- Modify: `src/navigation/OnboardingNavigator.tsx:20`

- [ ] **Step 1: Confirm the `colors` import exists**

Run: `grep -n "from '../theme/tokens'" src/navigation/OnboardingNavigator.tsx`
- If it prints a line that includes `colors`, do nothing.
- If it prints nothing (no token import), add this near the other imports at the top of the file:

```ts
import { colors } from '../theme/tokens';
```

- [ ] **Step 2: Replace the literal**

Change line 20 from:

```ts
        contentStyle: { backgroundColor: '#000' },
```

to:

```ts
        contentStyle: { backgroundColor: colors.bgPrimary },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/navigation/OnboardingNavigator.tsx
git commit -m "style(nav): route onboarding background through token (no hardcoded #000)"
```

---

### Task 3: Hypnogram — add left lane labels (Wake/Light/REM/Deep)

The component already orders lanes correctly and tints by stage. This adds left-axis labels and insets the chart by `LABEL_W` so labels don't overlap the bands. Replace the whole file to keep the x-scale changes consistent.

**Files:**
- Modify (full replace): `src/screens/home/components/Hypnogram.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { colors, stageColors } from '../../../theme/tokens';
import type { Epoch, SleepStage } from '../../../lib/repos';

type Props = {
  epochs: Epoch[];
  startMs: number;
  endMs: number;
};

const HEIGHT = 220;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 22; // space for the bottom time axis
const LABEL_W = 36; // left gutter reserved for lane labels
const LANES: SleepStage[] = ['wake', 'light', 'rem', 'deep'];
const LANE_LABEL: Record<SleepStage, string> = {
  wake: 'WAKE',
  light: 'LIGHT',
  rem: 'REM',
  deep: 'DEEP',
};
// Hour labels nearer than this (in px) to either chart edge are dropped so
// they don't collide with the bed/wake labels anchored at the edges.
const EDGE_CLEARANCE_PX = 56;

export function Hypnogram({ epochs, startMs, endMs }: Props) {
  const [width, setWidth] = useState(0);
  const drawH = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const totalMs = endMs - startMs || 1;

  // Chart plots in [LABEL_W, width]; the left gutter holds lane labels.
  const chartLeft = LABEL_W;
  const chartW = Math.max(width - LABEL_W, 1);
  const xAt = (ms: number) =>
    chartLeft + ((ms - startMs) / totalMs) * chartW;

  // Each stage occupies a horizontal band; wake on top, deep at the bottom.
  const SLOT_H = drawH / LANES.length;
  const BAND_H = 20;
  const laneTop = (stage: SleepStage) =>
    PADDING_TOP + LANES.indexOf(stage) * SLOT_H + (SLOT_H - BAND_H) / 2;
  const laneCenter = (stage: SleepStage) => laneTop(stage) + BAND_H / 2;
  const baselineY = PADDING_TOP + drawH;
  const axisY = baselineY + 15;

  // Collapse epochs into contiguous runs of the same stage.
  const runs = useMemo(() => collapseRuns(epochs), [epochs]);
  const ticks = useMemo(() => axisTicks(startMs, endMs), [startMs, endMs]);

  return (
    <View
      style={styles.chart}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {/* Left lane labels: Wake (top) -> Deep (bottom) */}
          {LANES.map((stage) => (
            <SvgText
              key={`label-${stage}`}
              x={0}
              y={laneCenter(stage) + 3}
              fontSize={9}
              fill={colors.textTertiary}
              textAnchor="start"
              fontWeight="500"
            >
              {LANE_LABEL[stage]}
            </SvgText>
          ))}

          {/* Vertical hour gridlines */}
          {ticks.map((tick) => {
            const x = xAt(tick.ms);
            return (
              <Line
                key={tick.ms}
                x1={x}
                x2={x}
                y1={PADDING_TOP}
                y2={baselineY}
                stroke={colors.borderSubtle}
                strokeWidth={1}
                opacity={0.6}
              />
            );
          })}

          {/* Stepped stage bands with connectors between level changes */}
          {runs.map((run, i) => {
            const x1 = xAt(run.startMs);
            const x2 = xAt(run.startMs + run.durationMs);
            const next = runs[i + 1];
            return (
              <React.Fragment key={i}>
                <Rect
                  x={x1}
                  y={laneTop(run.stage)}
                  width={Math.max(x2 - x1, 0.75)}
                  height={BAND_H}
                  rx={2}
                  fill={stageColors[run.stage]}
                />
                {next && (
                  <Line
                    x1={x2}
                    x2={x2}
                    y1={laneCenter(run.stage)}
                    y2={laneCenter(next.stage)}
                    stroke={colors.textSecondary}
                    strokeWidth={1.5}
                    opacity={0.5}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* Bottom time axis: bedtime + waketime at the edges, hours between */}
          <SvgText
            x={chartLeft}
            y={axisY}
            fontSize={11}
            fill={colors.textSecondary}
            textAnchor="start"
            fontWeight="600"
          >
            {fmt(startMs)}
          </SvgText>
          <SvgText
            x={width}
            y={axisY}
            fontSize={11}
            fill={colors.textSecondary}
            textAnchor="end"
            fontWeight="600"
          >
            {fmt(endMs)}
          </SvgText>
          {ticks
            .map((tick) => ({ tick, x: xAt(tick.ms) }))
            .filter(
              ({ x }) =>
                x > chartLeft + EDGE_CLEARANCE_PX &&
                x < width - EDGE_CLEARANCE_PX,
            )
            .map(({ tick, x }) => (
              <SvgText
                key={tick.ms}
                x={x}
                y={axisY}
                fontSize={11}
                fill={colors.textTertiary}
                textAnchor="middle"
                fontWeight="500"
              >
                {tick.label}
              </SvgText>
            ))}
        </Svg>
      )}
    </View>
  );
}

function collapseRuns(epochs: Epoch[]) {
  const runs: { stage: SleepStage; startMs: number; durationMs: number }[] = [];
  for (const e of epochs) {
    const last = runs[runs.length - 1];
    if (last && last.stage === e.stage) {
      last.durationMs += e.durationSec * 1000;
    } else {
      runs.push({
        stage: e.stage,
        startMs: e.startMs,
        durationMs: e.durationSec * 1000,
      });
    }
  }
  return runs;
}

function axisTicks(startMs: number, endMs: number) {
  const ticks: { ms: number; label: string }[] = [];
  const start = new Date(startMs);
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  if (first.getHours() % 2 !== 0) first.setHours(first.getHours() + 1);
  if (first.getTime() < startMs) first.setHours(first.getHours() + 2);
  for (let t = first.getTime(); t <= endMs; t += 2 * 3600 * 1000) {
    const d = new Date(t);
    const h12 = ((d.getHours() + 11) % 12) + 1;
    const ampm = d.getHours() < 12 ? 'AM' : 'PM';
    ticks.push({ ms: t, label: `${h12} ${ampm}` });
  }
  return ticks;
}

function fmt(ms: number) {
  const d = new Date(ms);
  const h12 = ((d.getHours() + 11) % 12) + 1;
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}

const styles = StyleSheet.create({
  chart: {
    width: '100%',
    height: HEIGHT,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/screens/home/components/Hypnogram.tsx
git commit -m "style(hypnogram): add Wake/Light/REM/Deep lane labels + inset chart"
```

---

### Task 4: Card-surface consistency (hairline borders)

The shared `Card` uses `bgSurface` + a `borderSubtle` hairline. Some components hand-roll a card surface with `bgSurface` but no border — on the lighter Obsidian base they should carry the same hairline so depth reads consistently. Confirmed case: `StimImpactCard`. Then audit for any others.

**Files:**
- Modify: `src/screens/home/components/StimImpactCard.tsx`
- Audit: all `src/**/*.tsx`

- [ ] **Step 1: Fix StimImpactCard's surface**

In `src/screens/home/components/StimImpactCard.tsx`, the import already pulls `layout`? Confirm: ensure the tokens import includes `layout`. Change the import (around lines 5–11) to include `layout`:

```ts
import {
  colors,
  layout,
  radii,
  spacing,
  systemFontFamily,
  typeScale,
} from '../../../theme/tokens';
```

Then update the `wrap` style (around lines 70–75) from:

```ts
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
  },
```

to:

```ts
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.borderSubtle,
  },
```

- [ ] **Step 2: Audit for other hand-rolled surfaces**

Run: `grep -rn "backgroundColor: colors.bgSurface" src/`

For each match, open the file and check the same StyleSheet entry. If it has `borderRadius` (i.e. it's acting as a card) but **no** `borderWidth`/`borderColor`, add:

```ts
    borderWidth: layout.hairline,
    borderColor: colors.borderSubtle,
```

(ensuring `layout` is imported from `../theme/tokens` or the correct relative path). Skip entries that are full-bleed surfaces (no `borderRadius`) — those aren't cards. If `StimImpactCard` is the only card-like match, that's fine — note it and move on.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -u src/
git commit -m "style(cards): hairline borders on hand-rolled card surfaces for consistency"
```

---

### Task 5: Build, install, and verify on device against the north-star

No unit tests exist for presentation; the real verification is a release build + eyeball. The phone (`P21271002566`) is connected via adb.

- [ ] **Step 1: Build the release APK**

```bash
cd "/c/Users/Lenovo/neurex-app/android" && ./gradlew.bat assembleRelease --console=plain
```
Expected: `BUILD SUCCESSFUL`. (On the Bash tool use `run_in_background: true`; it takes ~1–2 min.)

- [ ] **Step 2: Install in-place (preserves app data)**

```bash
adb install -r "/c/Users/Lenovo/neurex-app/android/app/build/outputs/apk/release/app-release.apk"
```
Expected: `Success`.

- [ ] **Step 3: Launch and visually verify each screen**

```bash
adb shell monkey -p tech.neurex.app -c android.intent.category.LAUNCHER 1
```

Walk through and confirm against `northstar-home-v2.html`:
- **Home** — Obsidian base (not pure black), hero score, hypnogram with **left lane labels** (Wake/Light/REM/Deep) and stage tint, stage breakdown bars, Neurex-boost card with a visible hairline border.
- **History** — rows on Obsidian, device tag + score + stage bar, hairline dividers.
- **Session detail**, **Account → dual record**, **Onboarding** — surfaces step up from the base with hairline borders; no pure-black panels; text legible.
- **Tab bar** — background matches the base, borders subtle.

- [ ] **Step 4: Fix any visible divergence (spacing/contrast only)**

If a screen visibly diverges from the north-star (e.g. a panel still reads pure-black, a card lacks its border, text too dim), make the minimal token/style fix, re-run `npx tsc --noEmit`, rebuild, reinstall, and re-check. Keep changes presentational. Commit each fix:

```bash
git add -u src/
git commit -m "style: <screen> polish to match north-star"
```

- [ ] **Step 5: Final confirmation**

Run: `npx tsc --noEmit`
Expected: exit 0. Confirm `git status` is clean and the diff touches only `theme/`, `navigation/OnboardingNavigator.tsx`, `screens/**` presentational styles, and `Hypnogram.tsx` — nothing under `lib/`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** palette rebase (Task 1) ✓; hardcoded-color audit — only stray was `OnboardingNavigator` (Task 2) ✓; Hypnogram already on-target, left labels added (Task 3) ✓; card/surface consistency (Task 4) ✓; per-screen verification + spacing pass (Task 5) ✓; non-goal "no logic changes" enforced by Task 5 Step 5 diff check ✓.
- **Placeholder scan:** none — every code step shows full code; Task 4 audit gives the exact grep + the worked StimImpactCard example.
- **Type consistency:** token names match `tokens.ts` exactly; Hypnogram keeps identical props (`epochs/startMs/endMs`) and helper names (`collapseRuns`, `axisTicks`, `fmt`, `laneCenter`).
