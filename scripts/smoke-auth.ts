/**
 * Supabase smoke test. Run with:
 *   npm run smoke:auth -- you@example.com
 *
 * Sends a magic-link to the given email. You should receive an email within
 * ~10 seconds. The link won't actually sign you in here (this is Node, not the
 * app) but the request reaching Supabase + you getting the email proves URL +
 * anon key are correct.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run smoke:auth -- you@example.com');
    process.exit(1);
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
    process.exit(1);
  }

  console.log(`Sending magic link to ${email} via ${url}...`);
  const client = createClient(url, key);

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: 'neurex://auth-callback',
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }

  console.log('OK: magic-link sent. Check your inbox.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
