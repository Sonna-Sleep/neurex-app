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

// Real-time Lull WebSocket endpoint. A SEPARATE Modal subdomain from
// MODAL_ENDPOINT_URL (dedicated asgi web function), so it cannot be derived from
// it. EAS Build injects the prod value; this public fallback keeps OTA bundles
// from shipping an empty URL.
export const LULL_WS_URL =
  process.env.EXPO_PUBLIC_LULL_WS_URL ||
  'wss://goda-smulk--neurex-backend-lull-realtime-app.modal.run/lull/ws';
