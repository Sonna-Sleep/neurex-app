/**
 * Jest config for unit tests.
 *
 * Uses ts-jest (CommonJS) for pure TypeScript unit tests that do NOT need the
 * React Native / Expo runtime — e.g. the Lull audio sinks, where native
 * modules are mocked and `fetch` is stubbed. RN-component tests (if added
 * later) should switch to the `jest-expo` preset.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.jest.json' },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  clearMocks: true,
};
