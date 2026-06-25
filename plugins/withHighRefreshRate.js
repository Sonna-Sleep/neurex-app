// Expo config plugin: force the Android window onto the highest-refresh-rate
// display mode (e.g. 120Hz). RN + Fabric does NOT do this automatically — many
// OEMs leave third-party app windows at 60Hz even when the system is in 120Hz
// mode. We set window.attributes.preferredDisplayModeId in MainActivity.onResume.
//
// This plugin makes the native change reproducible across `expo prebuild` and
// keeps it in version control (android/ is gitignored), so it reaches every
// build (including teammates / CI), not just the local working tree.
const { withMainActivity } = require('@expo/config-plugins');

const MARKER = 'neurex-high-refresh-rate';

const ON_RESUME_KT = `
  // @generated begin ${MARKER} — set by plugins/withHighRefreshRate.js
  override fun onResume() {
    super.onResume()
    try {
      val display =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) this.display
        else @Suppress("DEPRECATION") windowManager.defaultDisplay
      val best = display?.supportedModes?.maxByOrNull { it.refreshRate } ?: return
      val params = window.attributes
      if (params.preferredDisplayModeId != best.modeId) {
        params.preferredDisplayModeId = best.modeId
        window.attributes = params
      }
    } catch (_: Throwable) {
      // Never let refresh-rate selection crash the app.
    }
  }
  // @generated end ${MARKER}
`;

module.exports = function withHighRefreshRate(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withHighRefreshRate: expected a Kotlin MainActivity');
    }
    let src = cfg.modResults.contents;
    // Idempotent: skip if our marker OR an equivalent manual edit is present.
    if (src.includes(MARKER) || src.includes('preferredDisplayModeId')) {
      return cfg;
    }
    src = src.replace(
      /class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{/,
      (m) => `${m}\n${ON_RESUME_KT}`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
};
