import { Platform } from 'react-native';

export const colors = {
  // Warm near-black base (a brown undertone, not pure black) so the app reads
  // like twilight rather than a cold tech dashboard. Surfaces/borders carry the
  // same warmth so the shift feels intentional across every screen.
  bgPrimary: '#0E0B09',
  bgSurface: '#17130F',
  bgElevated: '#201A15',
  borderSubtle: '#2B2421',
  borderDivider: '#39312B',
  textPrimary: '#F7F4F1',
  textSecondary: '#9C958C',
  textTertiary: '#6F685F',
  ctaBg: '#F7F4F1',
  ctaText: '#0E0B09',
  warning: '#E5C07B',
  danger: '#E5484D',
  // Calm, low-saturation green for "all good" cues (signal check, synced).
  // Muted on purpose so it reads reassuring at night, not alarm-bright.
  positive: '#6FB98F',
  // Warm amber/taupe accent for "good morning"/score moments. Used sparingly.
  accentWarm: '#D9B08C',
} as const;

export const stageOpacity = {
  wake: 0.25,
  rem: 0.45,
  light: 0.65,
  deep: 1.0,
} as const;

// Stage colors. Deep is the brand hero (vivid indigo), light blends through
// blue, REM picks up a lavender accent (dreaming), wake is a calm warm grey.
export const stageColors = {
  deep: '#3B82F6',
  light: '#60A5FA',
  rem: '#A78BFA',
  wake: '#E5E7EB',
} as const;

// Match neurex.tech: SF Pro Display on iOS, Roboto on Android (platform default sans).
// We don't ship a custom font; system stack handles everything.
export const systemFontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

// Legacy shim. All variants now map to the platform system font.
// Weight is controlled via the `fontWeight` style prop, not the family.
export const fonts = {
  sans: systemFontFamily,
  sansMedium: systemFontFamily,
  sansSemibold: systemFontFamily,
} as const;

export const typeScale = {
  serifDisplay: {
    fontFamily: systemFontFamily,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.6,
    fontWeight: '300' as const,
    color: colors.textPrimary,
  },
  serifHeadline: {
    fontFamily: systemFontFamily,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.3,
    fontWeight: '300' as const,
    color: colors.textPrimary,
  },
  sansEyebrow: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    fontWeight: '500' as const,
    color: colors.textTertiary,
    textTransform: 'uppercase' as const,
  },
  sansBody: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
    color: colors.textPrimary,
  },
  sansSecondary: {
    fontFamily: systemFontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  sansButton: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600' as const,
  },
  // Hero score display (Home: 0-99 sleep score). Tightly-tracked, thin
  // weight, oversized — the visual centerpiece of the dashboard.
  serifHero: {
    fontFamily: systemFontFamily,
    fontSize: 104,
    fontWeight: '300' as const,
    letterSpacing: -4,
    lineHeight: 108,
    color: colors.textPrimary,
  },
  // Stat numbers for compact result cards. Smaller than hero but still
  // display-grade. Carries a touch more weight than the hero so figures read
  // authoritative, not fragile.
  statNumber: {
    fontFamily: systemFontFamily,
    fontSize: 44,
    fontWeight: '400' as const,
    letterSpacing: -1,
    lineHeight: 48,
    color: colors.textPrimary,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radii = {
  pill: 999,
  // Primary button radius — deliberately NOT a full pill, so buttons read as a
  // considered, signature shape rather than the default rounded-everything look.
  button: 14,
  card: 18,
  small: 8,
} as const;

export const layout = {
  screenPadding: 24,
  hairline: 1,
} as const;
