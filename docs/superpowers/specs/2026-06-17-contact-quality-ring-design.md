# Live Contact-Quality Ring — Design

**Date:** 2026-06-17 · **Repo:** neurex-app · **Status:** approved, pre-implementation

## Goal
Give the 218px circle on the Sleep screen ([RecordingCard.tsx](../../../src/screens/home/components/RecordingCard.tsx)) a **glowing colored outline that reflects real-time electrode contact quality**, so a user adjusts the headband until it's green *before* committing to an overnight recording — and can see contact during the night. Brings the standalone `precheck.py` checks (railing / mains hum / DC / RMS) into the app, live.

## Band scale (worst-dimension-wins)
| Band | Meaning | Driver (first-pass thresholds, tunable constants) |
|---|---|---|
| 🟢 green | good | no railing, RMS ≈ 5–80 µV, low mains hum |
| 🟡 yellow | usable | RMS slightly high (80–120 µV) or moderate hum (20–40 µV) |
| 🟠 orange | not good enough | high hum (>40 µV) or RMS 120–300 µV or occasional rail |
| 🔴 red | bad | railed / flat (RMS <0.5 µV) / no contact / RMS >300 µV |

Computed over a ~3 s rolling window of `fp1_uV`. Metrics: **railing** (fraction `|µV|`>100 000), **AC RMS** (linear-detrended), **mains hum** (RMS at the line freq via a cheap **Goertzel** filter, not full FFT). DC drift is implicitly covered by RMS/railing and omitted from the live band to avoid flicker. **Hysteresis:** a new band must persist ~1 s before the ring changes color.

## Components
1. **`src/lib/ble/contactQuality.ts`** — pure + unit-tested. `classifyContact(uv: number[], fs, mainsHz) → { band, metrics }` + a small stateful `ContactQualityTracker` (rolling buffer + hysteresis). No React, no BLE → fully testable with synthetic signals.
2. **`src/lib/ble/useContactQuality.ts`** — hook that feeds `onPacket` samples into the tracker, recomputes ~3×/sec, exposes the current band. Used by both preview and recording.
3. **Preview path (non-writing stream)** — when paired + on the Sleep screen + not recording, auto-connect a **preview** that subscribes + decodes for quality only (NO EEG.BIN, NO session) reusing the existing packet decoder. On **Start**: tear down preview → existing `startSession` (records); the hook switches to the recording stream's `onPacket`. On screen blur / unpair: disconnect the preview.
4. **`src/screens/home/components/ContactRing.tsx`** — wraps the 218px circle: a **measured SVG ring** (stroke = band color) + soft outer glow, smooth color fade between bands. Mirrors Goda's measured-SVG TabHighlight approach (Android border-rounding gotcha). Optional tiny caption.
5. **Mains frequency** — `mainsHzFromLocale()` via expo-localization: Americas → 60, else → 50. No settings UI (YAGNI); a constant override is exposed for tuning.

## Behavior
- Paired, on Sleep screen, idle → preview auto-connects → ring glows live; user seats the band until green, taps Start.
- Recording → ring keeps updating from the recording stream (free; recording path untouched).
- Not paired / off screen → no ring, preview disconnected.

## Safety / scope (non-negotiable)
- Fully additive. **No change** to EEG.BIN / scale.json / upload / staging / the recording stream.
- Preview is a separate, disposable BLE connection; it never writes a file or creates a session.
- One packet decoder reused (no duplicate parsing).
- Fetch origin/main before edits (Goda pushes continuously); never touch eas.json / 4.md / credentials.

## Testing
- `contactQuality` unit tests (synthetic clean→green, railed→red, humming→orange, flat→red, RMS-high→orange/yellow, hysteresis holds a band ~1 s). Mirrors the precheck test style.
- typecheck + lint + a `smoke:contact-quality` script if the harness supports it.

## File structure
- New: `src/lib/ble/contactQuality.ts`, `src/lib/ble/useContactQuality.ts`, `src/screens/home/components/ContactRing.tsx`, `scripts/smoke-contact-quality.ts`, `src/lib/ble/mainsHz.ts`.
- Modified: `RecordingCard.tsx` (wrap the circle with `ContactRing`), the preview connect/teardown wiring (a small preview controller, e.g. `src/lib/ble/contactPreview.ts`), and the BLE stream layer only as needed to expose a non-writing preview (smallest possible change to `real.ts`/`streamController.ts`).
