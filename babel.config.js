// Babel config for the Expo app + jest-expo.
//
// `babel-preset-expo` is what Expo applies by default in a managed project, so
// declaring it here is idempotent for Metro/runtime — it just makes the config
// explicit so `jest-expo` (RN-component tests) can transform RN/Expo/reanimated
// sources. The reanimated v4 worklets babel plugin is bundled inside
// babel-preset-expo, so no separate plugin entry is needed.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
