// Smoke assertions for the pure connect-timeout helper (M2 fix: a mask that's
// off must fail fast instead of hanging the UI forever).
// Run: npm run smoke:connect-timeout
import { withTimeout, BleTimeoutError } from '../src/lib/ble/connectTimeout';

let failures = 0;
function ok(cond: boolean, label: string) {
  if (cond) console.log(`ok ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failures++;
  }
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  // 1. Resolves before the timeout → value passes through, onTimeout NOT called.
  {
    let timedOut = false;
    const v = await withTimeout(Promise.resolve(42), 50, () => {
      timedOut = true;
    });
    ok(v === 42, 'resolves through when fast');
    ok(!timedOut, 'onTimeout not called on fast resolve');
  }

  // 2. Never resolves → rejects with BleTimeoutError AND runs onTimeout (cancel).
  {
    let timedOut = false;
    const never = new Promise<number>(() => {});
    let err: unknown;
    try {
      await withTimeout(never, 30, () => {
        timedOut = true;
      });
    } catch (e) {
      err = e;
    }
    ok(err instanceof BleTimeoutError, 'rejects with BleTimeoutError on timeout');
    ok(timedOut, 'onTimeout (cancel) called on timeout');
  }

  // 3. ms <= 0 → no timeout (the reconnect path); original value passes through.
  {
    let timedOut = false;
    const v = await withTimeout(
      delay(20).then(() => 7),
      0,
      () => {
        timedOut = true;
      },
    );
    ok(v === 7, 'ms=0 returns original promise value');
    ok(!timedOut, 'ms=0 never times out');
  }

  // 4. Slow resolve AFTER the timeout still rejects, and the late settlement is
  //    swallowed (no unhandled rejection / no crash).
  {
    let timedOut = false;
    let err: unknown;
    const slow = delay(40).then(() => 'late');
    try {
      await withTimeout(slow, 10, () => {
        timedOut = true;
      });
    } catch (e) {
      err = e;
    }
    ok(err instanceof BleTimeoutError, 'slow resolve still times out');
    ok(timedOut, 'onTimeout called for slow resolve');
    await delay(50); // let the late resolution settle — must not throw
    ok(true, 'late settlement handled without unhandled rejection');
  }

  if (failures) {
    console.error(`\n${failures} CONNECT-TIMEOUT ASSERTION(S) FAILED`);
    process.exit(1);
  }
  console.log('\nALL CONNECT-TIMEOUT ASSERTIONS PASSED');
}

void main();
