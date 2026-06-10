// Pure validation for the in-app Contact support form — NO React Native /
// Expo imports, so it's unit-testable in plain Node (scripts/smoke-support.ts).

export const MESSAGE_MAX = 5000; // matches the DB check constraint

// Pragmatic email shape: something@something.tLD, no whitespace. Full RFC 5322
// is famously unverifiable client-side; this catches typos without rejecting
// real addresses (plus-tags, subdomains).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SupportInput =
  | { ok: true; email: string; message: string }
  | { ok: false; error: string };

export function validateSupport(emailRaw: string, messageRaw: string): SupportInput {
  const email = emailRaw.trim();
  const message = messageRaw.trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'Enter a valid email so we can reply to you.' };
  }
  if (message.length === 0) {
    return { ok: false, error: 'Write a message first.' };
  }
  if (message.length > MESSAGE_MAX) {
    return { ok: false, error: `Message is too long (max ${MESSAGE_MAX} characters).` };
  }
  return { ok: true, email, message };
}
