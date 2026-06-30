# Lull (app side)

This directory holds the iPhone-app port of the Lull sleep-onset audio engine.
The Python source of truth lives in the **algoritmai** repo at
`tools/lull/` (`sleepiness.py`, `volume.py`, `gen_golden.py`).

## Synced fixtures — DO NOT hand-edit

These files are copied **verbatim** from algoritmai and must stay byte-identical.
Do not add comments or reformat them (JSON has no comment syntax anyway):

| App copy | Source of truth (algoritmai) |
| --- | --- |
| `src/lull/lull_params.json` | `tools/lull/lull_params.json` |
| `src/lull/core/__tests__/golden/lull_vectors.json` | `tools/lull/tests/golden/lull_vectors.json` |

When the Phase-1 Python params or golden vectors change, re-copy them here and
re-run the core golden test. The golden vectors are the contract: the TS core
must reproduce the Python output bit-for-bit (within the documented tolerance).

## Running the core golden test

There is **no jest** in this repo. Pure-TS unit tests run via `ts-node` using
`scripts/tsconfig.scripts.json` (it has `resolveJsonModule: true` and includes
`../src/**/*.ts`), the same pattern the existing `smoke:*` scripts use, e.g.:

```
npx ts-node --transpile-only --project scripts/tsconfig.scripts.json src/lull/core/__tests__/golden.test.ts
```

(A later agent adds the actual `golden.test.ts` runner; this note records how to
invoke it.)
