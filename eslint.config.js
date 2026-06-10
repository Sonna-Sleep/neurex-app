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
    // Tune the defaults to be useful rather than noisy. The newer
    // eslint-plugin-react-hooks ships React-Compiler *readiness* advisories
    // (refs/purity/set-state-in-effect) that flag many legitimate patterns —
    // keep them as warnings, not blocking errors. Apostrophes in display copy
    // are fine. The classic correctness rules (rules-of-hooks, exhaustive-deps)
    // stay at their config-expo defaults.
    rules: {
      'react/no-unescaped-entities': 'off',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]);
