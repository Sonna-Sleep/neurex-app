// Setup for the `rn` (jest-expo) project — RN-component render tests.
//
// Mocks the native modules that have no JS implementation under the jsdom test
// runtime so screens can mount without a device:
//   - react-native-reanimated: the library's own Jest mock (synchronous,
//     no UI thread) — animations resolve to plain style values.
//   - expo-keep-awake: no-op the activate/deactivate calls.
//   - react-native-safe-area-context: provide a stable inset frame.

// Reanimated ships an official Jest mock.
jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

// Keep-awake touches a native module; stub it out.
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
  useKeepAwake: jest.fn(),
}));

// Safe-area: render children with a fixed inset so layout is deterministic.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});
