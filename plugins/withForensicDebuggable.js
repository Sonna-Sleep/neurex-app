const { withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = 'neurex-forensic-debuggable';

function enabled() {
  return String(process.env.NEUREX_FORENSIC_DEBUGGABLE || '').toLowerCase() === 'true';
}

function withForensicDebuggableManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]?.$;
    if (!app) return cfg;
    if (enabled()) app['android:debuggable'] = 'true';
    else delete app['android:debuggable'];
    return cfg;
  });
}

function withForensicDebuggableGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    src = src.replace(
      /release\s*\{\s*\n/,
      (m) =>
        `${m}            // @generated ${MARKER}: opt-in data recovery build; normal builds stay non-debuggable.\n` +
        `            debuggable = (System.getenv('NEUREX_FORENSIC_DEBUGGABLE') ?: 'false').toBoolean()\n`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withForensicDebuggable(config) {
  config = withForensicDebuggableManifest(config);
  config = withForensicDebuggableGradle(config);
  return config;
};
