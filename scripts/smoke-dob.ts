// Pure-logic checks for the date-of-birth helpers + a regression for the
// "typing the year wiped day/month" clobber. Run: npm run smoke:dob
import assert from 'node:assert/strict';

import { ageOn, cleanSegment, isoFromParts, partsFromIso } from '../src/lib/dob';

// Fixed "today" so the age gate is deterministic regardless of when this runs.
const NOW = new Date(2026, 5, 15); // 2026-06-15 (month is 0-based)

let pass = 0;
function ok(name: string, cond: boolean): void {
  assert(cond, `FAIL: ${name}`);
  pass += 1;
  console.log(`  ok  ${name}`);
}

// ── date validation ─────────────────────────────────────────────────────────
ok('valid adult date → ISO', isoFromParts('15', '06', '1990', NOW) === '1990-06-15');
ok('single-digit day/month padded', isoFromParts('5', '6', '1990', NOW) === '1990-06-05');
ok('incomplete year → null', isoFromParts('15', '06', '19', NOW) === null);
ok('empty fields → null', isoFromParts('', '', '', NOW) === null);
ok('31 June (no such day) → null', isoFromParts('31', '06', '1990', NOW) === null);
ok('29 Feb non-leap → null', isoFromParts('29', '02', '1990', NOW) === null);
ok('29 Feb leap → ISO', isoFromParts('29', '02', '2000', NOW) === '2000-02-29');

// ── age gate (month/day aware; this is what year-only math got wrong) ─────────
ok('exactly 13 today → allowed', isoFromParts('15', '06', '2013', NOW) === '2013-06-15');
ok('turns 13 tomorrow → rejected', isoFromParts('16', '06', '2013', NOW) === null);
ok('turned 13 yesterday → allowed', isoFromParts('14', '06', '2013', NOW) === '2013-06-14');
ok('age exactly 120 → allowed', isoFromParts('15', '06', '1906', NOW) === '1906-06-15');
ok('older than 120 → null', isoFromParts('15', '06', '1905', NOW) === null);
ok('birthday next month → still 12 (rejected)', ageOn(2013, 7, 1, NOW) === 12);

// ── round trip ────────────────────────────────────────────────────────────────
{
  const p = partsFromIso('1990-06-15');
  ok('partsFromIso splits', p.d === '15' && p.m === '06' && p.y === '1990');
  ok('round-trips', isoFromParts(p.d, p.m, p.y, NOW) === '1990-06-15');
  const e = partsFromIso(null);
  ok('null → empty parts', e.d === '' && e.m === '' && e.y === '');
}

// ── input sanitising ──────────────────────────────────────────────────────────
ok('cleanSegment strips non-digits', cleanSegment('1a2', 2) === '12');
ok('cleanSegment caps length', cleanSegment('20066', 4) === '2006');

// ── REGRESSION: typing one field must NEVER clear another ─────────────────────
// Under JS-thread lag several keystrokes fire against the SAME committed snapshot
// before React re-renders. The OLD input had each handler rewrite all three
// fields from that (stale) snapshot, so typing the year wrote empty day/month
// back. The NEW input updates only the typed field, so siblings survive.
type Parts = { d: string; m: string; y: string };

// OLD behaviour: year handler set d/m/y from a snapshot it closed over.
function oldYearKeystroke(staleSnapshot: Parts, typedYear: string): Parts {
  return { d: staleSnapshot.d, m: staleSnapshot.m, y: cleanSegment(typedYear, 4) };
}
// NEW behaviour: year handler runs setY only; d/m are untouched live state.
function newYearKeystroke(liveState: Parts, typedYear: string): Parts {
  return { ...liveState, y: cleanSegment(typedYear, 4) };
}

{
  const live: Parts = { d: '15', m: '06', y: '' }; // user already entered day + month
  const stale: Parts = { d: '', m: '', y: '' }; // snapshot a lagging handler closed over

  const oldResult = oldYearKeystroke(stale, '2006');
  ok(
    'OLD path WIPES day/month under lag (documents the bug)',
    oldResult.d === '' && oldResult.m === '' && oldResult.y === '2006',
  );

  const newResult = newYearKeystroke(live, '2006');
  ok(
    'NEW path PRESERVES day/month',
    newResult.d === '15' && newResult.m === '06' && newResult.y === '2006',
  );
}

console.log(`\n${pass} checks passed`);
