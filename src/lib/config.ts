// Public client config for the production beta app.
//
// EAS Build injects these through profile env, but EAS Update does not read
// eas.json build env. Keep production-safe public fallbacks so OTA updates
// cannot ship a bundle with an empty Supabase/Modal config.
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://uunerbrscbswbzyxtdpg.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_g7T0SDF7LgJ3kjhRCQ7ToQ_ofPwMVOt';

export const MODAL_ENDPOINT_URL =
  process.env.EXPO_PUBLIC_MODAL_ENDPOINT_URL ||
  'https://goda-smulk--neurex-backend-fastapi-app.modal.run';

export const ALLOW_DEV_BYPASS =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_DEV_BYPASS === '1';

// 30-min chunked upload during recording (Feature 2). OFF by default: when off,
// the recording is written to one EEG.BIN and uploaded after the night (the
// proven path, unchanged). When on, the night is written as rolling segNNNN.bin
// files that upload + delete-after-confirm DURING the recording, keeping on-device
// storage low. Gated so it can ship dark and be flipped on for the overnight
// verification build before becoming the default.
export const CHUNKED_UPLOAD_ENABLED = process.env.EXPO_PUBLIC_CHUNKED_UPLOAD === '1';

// Seconds of audio per rolled segment / per upload cycle. 1800 s = 30 min in
// production; override to a small value (e.g. 60) in a debug build to verify the
// upload→confirm→delete cycle in minutes instead of hours.
export const CHUNK_SECONDS = Number(process.env.EXPO_PUBLIC_CHUNK_SECONDS) || 1800;
