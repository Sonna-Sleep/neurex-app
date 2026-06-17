// Smoke assertions for the upload-mutex timeout: one stalled transmission must
// NOT permanently hold the global upload lock and block every future upload.
// Run: npm run smoke:upload-lock
import {
  withUploadLock,
  uploadLockStats,
  __resetUploadLockStats,
} from '../src/lib/cloud/uploadLock';

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
  __resetUploadLockStats();

  // 1. Serialization: a slow first upload runs fully before the second starts.
  {
    const order: string[] = [];
    const a = withUploadLock(async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
      return 'a';
    });
    const b = withUploadLock(async () => {
      order.push('b-start');
      return 'b';
    });
    const [ra, rb] = await Promise.all([a, b]);
    ok(ra === 'a' && rb === 'b', 'both uploads return their values');
    ok(
      order.join(',') === 'a-start,a-end,b-start',
      'second waits for the first to finish (serialized)',
    );
    ok(uploadLockStats().timeouts === 0, 'no timeout on healthy serialized uploads');
  }

  // 2. A failing upload still releases the lock for the next one.
  {
    __resetUploadLockStats();
    let bRan = false;
    const a = withUploadLock(async () => {
      throw new Error('boom');
    });
    await a.catch(() => {});
    const b = await withUploadLock(async () => {
      bRan = true;
      return 'b';
    });
    ok(bRan && b === 'b', 'a rejection does not wedge the queue');
    ok(uploadLockStats().timeouts === 0, 'a rejecting predecessor is not a timeout');
  }

  // 3. THE FIX: a STUCK upload (never resolves) must not block forever. With a
  //    short timeout the next upload proceeds and the surfaced counter ticks.
  {
    __resetUploadLockStats();
    let timeoutSeen = 0;
    // Stuck predecessor — never settles. Its own predecessor is resolved, so it
    // never times out; it just never RELEASES, wedging whoever waits on it.
    const stuck = withUploadLock(() => new Promise<string>(() => {}), 20, () => {});
    // Keep the floating promise from being flagged as unhandled.
    stuck.catch(() => {});
    let nextRan = false;
    // `next` is the WAITER — it gives up on the stuck predecessor after the
    // timeout, so ITS onTimeout fires with the surfaced counter value.
    const next = await withUploadLock(
      async () => {
        nextRan = true;
        return 'next';
      },
      20,
      (n) => {
        timeoutSeen = n;
      },
    );
    ok(nextRan && next === 'next', 'next upload proceeds despite a stuck predecessor');
    ok(uploadLockStats().timeouts === 1, 'stuck predecessor bumps the surfaced counter');
    ok(timeoutSeen === 1, 'onTimeout callback fires with the counter value');
  }

  // 4. A subsequent HEALTHY upload after a timeout still works (chain intact).
  {
    const r = await withUploadLock(async () => 'ok-after-timeout', 20, () => {});
    ok(r === 'ok-after-timeout', 'queue keeps working after a timeout');
  }

  if (failures) {
    console.error(`\n${failures} UPLOAD-LOCK ASSERTION(S) FAILED`);
    process.exit(1);
  }
  console.log('\nALL UPLOAD-LOCK ASSERTIONS PASSED');
}

void main();
