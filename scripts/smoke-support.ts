// Smoke assertions for the support-form validation (in-app Contact support).
// Run: npm run smoke:support
import { validateSupport, MESSAGE_MAX } from '../src/lib/support/validateSupport';

let failures = 0;
function ok(cond: boolean, label: string) {
  if (cond) console.log(`ok ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failures++;
  }
}

// Happy path: trims both fields, lowercases nothing, passes through.
{
  const r = validateSupport('  user@neurex.tech  ', '  My device will not pair.  ');
  ok(r.ok, 'valid input accepted');
  ok(r.ok && r.email === 'user@neurex.tech', 'email trimmed');
  ok(r.ok && r.message === 'My device will not pair.', 'message trimmed');
}

// Email shapes.
ok(!validateSupport('', 'help').ok, 'empty email rejected');
ok(!validateSupport('not-an-email', 'help').ok, 'no-@ email rejected');
ok(!validateSupport('a@b', 'help').ok, 'no-TLD email rejected');
ok(!validateSupport('a b@c.com', 'help').ok, 'space in email rejected');
ok(validateSupport('a.b+tag@sub.domain.co', 'help').ok, 'plus/subdomain email accepted');

// Message bounds.
ok(!validateSupport('a@b.com', '').ok, 'empty message rejected');
ok(!validateSupport('a@b.com', '   ').ok, 'whitespace-only message rejected');
ok(validateSupport('a@b.com', 'x'.repeat(MESSAGE_MAX)).ok, 'message at max accepted');
ok(!validateSupport('a@b.com', 'x'.repeat(MESSAGE_MAX + 1)).ok, 'message over max rejected');

// Errors are human-readable strings.
{
  const r = validateSupport('nope', 'help');
  ok(!r.ok && typeof r.error === 'string' && r.error.length > 5, 'error message provided');
}

if (failures) {
  console.error(`\n${failures} SUPPORT ASSERTION(S) FAILED`);
  process.exit(1);
}
console.log('\nALL SUPPORT ASSERTIONS PASSED');
