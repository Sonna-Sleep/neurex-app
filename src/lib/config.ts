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

// Segments-first overnight upload. ON by default: the app writes rolling
// segNNNN.bin files, uploads each closed segment during the recording, and
// deletes only after the backend confirms byte+hash match. Set
// EXPO_PUBLIC_CHUNKED_UPLOAD=0 only as an emergency fallback to the legacy local
// EEG.BIN writer.
export const CHUNKED_UPLOAD_ENABLED = process.env.EXPO_PUBLIC_CHUNKED_UPLOAD !== '0';

// Seconds of audio per rolled segment / per upload cycle. 1800 s = 30 min in
// production; override to a small value (e.g. 60) in a debug build to verify the
// upload→confirm→delete cycle in minutes instead of hours.
export const CHUNK_SECONDS = Number(process.env.EXPO_PUBLIC_CHUNK_SECONDS) || 1800;

// Diagnostic raw-bit capture (all-8-channel integer ground truth, ~3.7x the eeg
// size). The build-time DEFAULT for the 'auto' setting: ON for the internal/dev
// fleet build (so every test night keeps re-decodable ground truth), OFF for a
// production build (prod users don't upload raw they didn't opt into). The
// per-user setting ('on'/'off'/'auto') overrides this — see ble/diagnosticCapture.
// NOTE: the app can't read the device MAC on iOS, so build-type (not a MAC
// allowlist) is the reliable fleet-vs-prod discriminator.
export const DIAGNOSTIC_CAPTURE_DEFAULT =
  process.env.EXPO_PUBLIC_DIAGNOSTIC_CAPTURE === '1' ||
  (typeof __DEV__ !== 'undefined' && __DEV__);
