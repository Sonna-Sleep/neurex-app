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
