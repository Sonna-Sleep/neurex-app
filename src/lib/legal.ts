// Single source for legal URLs surfaced in the app (Account → legal).
// `privacyPolicy` is the live page required by the App Store — hosted on GitHub
// Pages for now; swap to https://neurex.tech/privacy if you move it to your own
// domain (one-line change, no other edits needed).
export const LEGAL_URLS = {
  privacyPolicy: 'https://aleksaspetro.github.io/neurex-legal/',
  about: 'https://neurex.tech',
} as const;
