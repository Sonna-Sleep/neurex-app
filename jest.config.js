/**
 * Jest config — two projects so pure-TS unit tests and RN-component tests can
 * coexist without one's runtime contaminating the other:
 *
 *   - `node`: ts-jest (CommonJS), `node` env. Pure TypeScript unit tests that do
 *     NOT need the React Native / Expo runtime. Matches `*.test.ts`.
 *   - `rn`: the `jest-expo` preset. RN-component render tests that mount real
 *     components with React Native + reanimated. Matches `*.test.tsx`.
 *
 * Splitting by extension keeps every existing `.test.ts` on the fast node path
 * untouched; only `.tsx` render tests pay the jest-expo startup cost.
 */
module.exports = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
      clearMocks: true,
    },
    {
      displayName: 'rn',
      preset: 'jest-expo',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.rn.js'],
      // Expo/RN ships untranspiled ESM in node_modules; let babel-jest transform it.
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated|react-native-worklets))',
      ],
      clearMocks: true,
    },
  ],
};
