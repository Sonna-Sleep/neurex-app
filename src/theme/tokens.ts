import { Platform } from 'react-native';

export const colors = {
  bgPrimary: '#000000',
  bgSurface: '#0F0F0F',
  bgElevated: '#1A1A1A',
  borderSubtle: '#2A2A2A',
  borderDivider: '#3A3A3A',
  textPrimary: '#FFFFFF',
  textSecondary: '#8A8A8A',
  textTertiary: '#6B6B6B',
  ctaBg: '#FFFFFF',
  ctaText: '#000000',
  warning: '#E5C07B',
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
  serifHero: {
    fontFamily: systemFontFamily,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -1.5,
    fontWeight: '300' as const,
    color: colors.textPrimary,
  },
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
  card: 20,
  small: 8,
} as const;

export const layout = {
  screenPadding: 24,
  hairline: 1,
} as const;
