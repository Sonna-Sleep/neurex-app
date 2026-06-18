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

// ── band classification ───────────────────────────────────────────────────
assert.equal(classifyContact(noise(N, 20), FS, 60).band, 'green', 'clean ~20µV → green');
assert.equal(classifyContact(new Array(N).fill(0), FS, 60).band, 'red', 'flat/dead → red');
const railed = Array.from({ length: N }, (_, i) => (i % 2 ? 1 : -1) * 2_249_000);
assert.equal(classifyContact(railed, FS, 60).band, 'red', 'railed → red');
assert.equal(classifyContact(noise(N, 100), FS, 60).band, 'yellow', '~100µV RMS → yellow');
assert.equal(classifyContact(noise(N, 200), FS, 60).band, 'orange', '~200µV RMS → orange');
assert.equal(classifyContact(noise(N, 400), FS, 60).band, 'red', '~400µV RMS → red');

// Mains hum fails ONLY at the configured frequency (proves the band targets it).
const hum = add(noise(N, 15, 7), sine(N, 100, 60));
assert.equal(classifyContact(hum, FS, 60).band, 'orange', '60Hz hum at mains=60 → orange');
assert.equal(classifyContact(hum, FS, 50).band, 'green', 'same signal clean in the 50Hz band');

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
