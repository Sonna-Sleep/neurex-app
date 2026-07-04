# Task 1 Report: Pure notice module + tests

## Summary

Implemented a pure `sessionNotice` model for BLE session-end notices. The module exports the required data types, low-battery threshold, auto-end and recovered notice builders, elapsed-duration formatting, and exact user-facing notice copy without React Native imports or new dependencies.

## Files changed

- `src/lib/ble/sessionNotice.ts`
- `src/lib/ble/__tests__/sessionNotice.test.ts`
- `.superpowers/sdd/briefs/task-1-report.md`

## Red test evidence

Command:

```powershell
npm test -- sessionNotice --runInBand
```

Initial red result:

```text
FAIL node src/lib/ble/__tests__/sessionNotice.test.ts
Cannot find module '../sessionNotice' from 'src/lib/ble/__tests__/sessionNotice.test.ts'
Test Suites: 1 failed, 1 total
Tests:       0 total
```

Behavioral red result after adding compile-only placeholders:

```text
FAIL node src/lib/ble/__tests__/sessionNotice.test.ts
Tests:       17 failed, 4 passed, 21 total
Examples:
- Expected recovered marker reason "device-lost", received "interrupted"
- Expected disconnectAtMs fallback 5000, received 0
- Expected formatElapsed(3599000) to be "59m 59s", received ""
- Expected notice title "Your night ended early", received ""
```

## Green test evidence

Command:

```powershell
npm test -- sessionNotice --runInBand
```

Result:

```text
PASS node src/lib/ble/__tests__/sessionNotice.test.ts
Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
Snapshots:   0 total
```

Command:

```powershell
npm run typecheck
```

Result:

```text
tsc --noEmit
Exit code: 0
```

Graph maintenance command:

```powershell
graphify update .
```

Result:

```text
[graphify watch] Rebuilt: 1012 nodes, 1958 edges, 73 communities
Code graph updated.
```

## Commit hash

PENDING

## Self-review

- Confirmed the implementation is pure TypeScript with no React Native imports, native changes, dependencies, timers, or `Date.now()` calls.
- Verified both builders preserve all required fields and use the specified `disconnectAtMs` fallbacks.
- Verified recovered notices select `device-lost` only when a marker disconnect timestamp exists, otherwise `interrupted`.
- Verified notice copy matches the required strings, including the em dash and middle dot punctuation.
- Verified low-battery hints appear only for `device-lost` notices at `LOW_BATTERY_HINT_PCT` or lower.
- Verified elapsed durations use seconds under a minute, minutes plus seconds under an hour, and hours plus minutes plus seconds at one hour or more.
- Verified calendar phrasing for same day, previous day across midnight, older weekdays, interrupted `around` prefix, and negative-duration clamping.

## Concerns

None.
