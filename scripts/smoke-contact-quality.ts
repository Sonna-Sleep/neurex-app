import assert from 'node:assert/strict';

import {
  acRms,
  classifyContact,
  ContactQualityTracker,
  goertzelRms,
  railFraction,
} from '../src/lib/ble/contactQuality';
import { mainsHzFromTimezone } from '../src/lib/ble/mainsHz';

const FS = 250;
const N = FS * 3; // 3 s window

// Deterministic uniform noise with a target RMS (uniform[-A,A] has RMS A/√3).
function noise(n: number, rmsUv: number, seed = 1): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (1103515245 * s + 12345) & 0x7fffffff;
    const u = (s / 0x7fffffff) * 2 - 1;
    out.push(u * rmsUv * Math.sqrt(3)); // uniform[-A,A] has RMS A/√3 → scale to rmsUv
  }
  return out;
}
function sine(n: number, ampUv: number, freq: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(ampUv * Math.sin((2 * Math.PI * freq * i) / FS));
  return out;
}
function add(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i]);
}

// ── pure helpers ──────────────────────────────────────────────────────────
assert.equal(railFraction([0, 0, 0], 100), 0);
assert.equal(railFraction([200, -200, 0, 0], 100), 0.5);
assert.equal(railFraction([], 100), 1);

const ramp = Array.from({ length: 1000 }, (_, i) => i * 3);
assert.ok(acRms(ramp) < 1e-6, 'acRms removes a linear baseline');

const g60 = goertzelRms(sine(N, 100, 60), FS, 60);
assert.ok(g60 > 60 && g60 < 80, `goertzel finds 60Hz tone (~70.7), got ${g60.toFixed(1)}`);
assert.ok(goertzelRms(sine(N, 100, 60), FS, 50) < 10, 'no energy in the 50Hz band');

// ── band classification (shared constants: DEAD=3, MOTION=150, RAIL=0.20, HUM=15) ────
// Broadband noise passes through the 1-45 Hz bandpass at ~58% of the original
// amplitude (1-45 Hz = 44 Hz out of 0-125 Hz Nyquist = 35% of power → ~59% RMS).
// Goertzel also picks up 60 Hz energy in broadband noise proportional to amplitude.
//
// Green: clean ~20µV → brain-band RMS ≈12 µV (well within 3–75 µV green zone)
assert.equal(classifyContact(noise(N, 20), FS, 60).band, 'green', 'clean ~20µV → green');
// Red: flat/dead (RMS < DEAD_RMS_UV=3)
assert.equal(classifyContact(new Array(N).fill(0), FS, 60).band, 'red', 'flat/dead → red');
// Red: railed (railFrac > RAIL_FRAC=0.20)
const railed = Array.from({ length: N }, (_, i) => (i % 2 ? 1 : -1) * 2_249_000);
assert.equal(classifyContact(railed, FS, 60).band, 'red', 'railed → red');
// Yellow: noise(120) → bandpassed RMS≈73 µV; hum≈8.8 µV > humYellowHigh(7.5) → yellow
assert.equal(classifyContact(noise(N, 120), FS, 60).band, 'yellow', '~120µV input → yellow (hum>7.5)');
// Orange: noise(150) → bandpassed RMS≈91 µV; hum≈10.9 µV > humOrangeHigh(10) → orange
assert.equal(classifyContact(noise(N, 150), FS, 60).band, 'orange', '~150µV input → orange (hum>10)');
// Red: noise(400) → bandpassed RMS≈243 µV > MOTION=150; hum≈29 µV > HUM_ABS=15 → red
assert.equal(classifyContact(noise(N, 400), FS, 60).band, 'red', '~400µV input → red (motion+hum)');

// Mains hum: Goertzel on original signal (not bandpassed) so 60Hz is detectable.
// HUM_ABS_UV=15; sine 100µV peak @60Hz ≈ 70.7µV RMS >> 15 → red at 60Hz mains.
const hum = add(noise(N, 15, 7), sine(N, 100, 60));
assert.equal(classifyContact(hum, FS, 60).band, 'red', '60Hz hum >>HUM_ABS_UV at mains=60 → red');
assert.equal(classifyContact(hum, FS, 50).band, 'green', 'same signal clean in the 50Hz band');

// ── drift-filtering (the key fix): brain signal on big slow drift → green ──────────
// 4 s window, 21µV@10Hz EEG riding an 8000µV offset + 4000µV slow 0.02Hz oscillation.
// Without bandpass: acRms would see the drift and could misclassify.
// With bandpass 1-45Hz: drift is stripped; brain RMS ≈21µV → green.
const fs4 = 250, mains4 = 60, n4 = fs4 * 4;
const t4 = (i: number) => i / fs4;
const clean = Array.from({ length: n4 }, (_, i) =>
  8000 + 4000 * Math.sin(2 * Math.PI * 0.02 * t4(i)) + 21 * Math.sin(2 * Math.PI * 10 * t4(i)));
assert.equal(classifyContact(clean, fs4, mains4).band, 'green',
  'clean 21µV@10Hz + big slow drift → green (bandpass removes drift)');

// Flat signal at 8000µV DC with tiny noise: brain-band RMS < DEAD_RMS_UV=3 → red.
const flatDc = Array.from({ length: n4 }, () => 8000 + (Math.random() - 0.5) * 0.4);
assert.equal(classifyContact(flatDc, fs4, mains4).band, 'red',
  'flat DC + sub-µV noise → red (dead electrode)');

// ── mains-from-timezone ─────────────────────────────────────────────────────
assert.equal(mainsHzFromTimezone('America/Los_Angeles'), 60);
assert.equal(mainsHzFromTimezone('America/New_York'), 60);
assert.equal(mainsHzFromTimezone('Europe/Vilnius'), 50);
assert.equal(mainsHzFromTimezone('Asia/Seoul'), 60);
assert.equal(mainsHzFromTimezone(null), 50);

// ── tracker hysteresis (no flicker) ─────────────────────────────────────────
const tr = new ContactQualityTracker(FS, 60, 3, 3);
tr.push(noise(N, 20));
let last = 'red';
for (let i = 0; i < 3; i++) last = tr.update(); // needs 3 consecutive to switch
assert.equal(last, 'green', 'green sticks after 3 consecutive good updates');
tr.push(railed); // window now railed
assert.equal(tr.update(), 'green', 'one bad update does NOT flip (hysteresis holds)');
tr.update();
assert.equal(tr.update(), 'red', 'flips to red after 3 consecutive bad updates');

console.log('ALL CONTACT-QUALITY ASSERTIONS PASSED');
