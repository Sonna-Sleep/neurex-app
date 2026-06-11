// Flat ESLint config — Expo's recommended ruleset for React Native + TypeScript.
// Run:  npm run lint        (add -- --fix to auto-fix)
// Docs: https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'ios/**',
      'android/**',
      '.expo/**',
      'modules/*/android/build/**',
    ],
  },
  {
    // Tune the defaults to be useful rather than noisy. Apostrophes in display
    // copy are fine; keep the SDK-compatible Expo hook rules at their defaults.
    rules: {
      'react/no-unescaped-entities': 'off',
    },
  },
]);
