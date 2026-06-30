# Lull bundled soundscape asset

`BundledSink` (`src/lull/audio/BundledSink.ts`) is the offline fallback audio
sink for the Lull wind-down. It loads and loops a single soundscape bed and
fades its volume to silence as the user falls asleep.

## What goes here

Drop a **loopable** soundscape file named exactly:

```
assets/lull/soundscape.m4a
```

Requirements:

- **Loopable** — the end must flow seamlessly back into the start. A continuous
  bed (pink noise, rain, brown noise, fan) loops cleanly; anything with a
  recognizable beat or melodic phrase will click at the loop point.
- **Format:** AAC in an `.m4a` container (small, hardware-decoded on iOS, and
  works with `expo-av`). 44.1 kHz, mono or stereo, ~96–128 kbps is plenty for a
  noise bed.
- **Length:** 30–120 s is enough; `expo-av` loops it via `isLooping: true`, so a
  longer file only costs bundle size.
- **Level:** mastered a few dB below full scale with no hard clipping, so the
  Lull volume ramp has clean headroom to fade.

## Why this is a placeholder

This repo cannot commit a binary audio asset as part of the automated port, so
the actual `soundscape.m4a` is **not yet present**. Until it is dropped here:

- `BundledSink` requires the asset through a **guarded `require`**. If the file
  is missing, the sink **logs a warning and degrades gracefully** (its volume /
  stop calls become no-ops) — it does **not** crash the app.
- Once you add `soundscape.m4a`, the guarded `require` resolves to the real
  asset automatically; no code change is needed.

## After adding the asset

`expo-av` and the iOS `audio` background mode are native; adding (or first
bundling) the asset requires a fresh **EAS / dev-client build**, not just a JS
reload.
