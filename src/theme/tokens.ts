import { Platform } from 'react-native';

import type { CoreSleepStage } from '../lib/repos/types';

export const colors = {
  // Calm cool-neutral charcoal (Oura-like): deep but never pure black, never
  // brown. Surfaces lift in clear steps so cards read as floating planes.
  bgPrimary: '#0B0D10',
  bgSurface: '#14171C',
  bgElevated: '#1C2027',
  borderSubtle: '#262B33',
  borderDivider: '#333A44',
  // Readable text ladder — primary ~17:1, secondary ~9:1, tertiary ~5:1 on
  // bgPrimary, so supporting text is genuinely legible, not muddy grey.
  textPrimary: '#F4F6F8',
  textSecondary: '#A8B0BC',
  textTertiary: '#727B87',
  ctaBg: '#F4F6F8',
  ctaText: '#0B0D10',
  warning: '#E0B560',
  danger: '#E5484D',
  // Calm green for "all good" cues (synced, successful actions).
  positive: '#5FB89C',
  // Single restrained accent — soft periwinkle, used sparingly for emphasis.
  accent: '#7C9CE0',
} as const;

export const stageOpacity = {
  wake: 0.25,
  rem: 0.45,
  light: 0.65,
  deep: 1.0,
} as const;

// Stage colors — calm and clearly distinct in BOTH hue and lightness so the
// graphs are readable at a glance. Deep = indigo anchor, Light = cyan-blue
// (separated from deep), REM = the lone violet, Awake = warm taupe (NOT white,
// so wake recedes instead of dominating the chart).
export const stageColors = {
  deep: '#4C6FE0',
  light: '#5FA8E8',
  rem: '#9B7DE0',
  wake: '#C9A77F',
} as const;

// Single source of truth for stage order + labels across every visualization.
// Sleep-first order (most restorative → least) so the user reads one consistent
// order in the legend and breakdown.
export const STAGE_META: { key: CoreSleepStage; label: string }[] = [
  { key: 'deep', label: 'Deep' },
  { key: 'rem', label: 'REM' },
  { key: 'light', label: 'Light' },
  { key: 'wake', label: 'Awake' },
];

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

// One weight system: 600 for everything structural (display/headline/score/
// stat/eyebrow/button), 400 for body/secondary. Dropping the old thin 300s is
// what removes the "fragile/cheap" feel.
export const typeScale = {
  serifDisplay: {
    fontFamily: systemFontFamily,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  serifHeadline: {
    fontFamily: systemFontFamily,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  sansEyebrow: {
    fontFamily: systemFontFamily,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    fontWeight: '600' as const,
    color: colors.textTertiary,
    textTransform: 'uppercase' as const,
  },
  sansBody: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    lineHeight: 23,
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
  // Hero score number — sized to sit inside the ~180px score ring. Confident
  // weight so it reads as a verdict, not a faint stat.
  serifHero: {
    fontFamily: systemFontFamily,
    fontSize: 68,
    fontWeight: '600' as const,
    letterSpacing: -2,
    lineHeight: 72,
    color: colors.textPrimary,
  },
  // Stat numbers for compact result cards.
  statNumber: {
    fontFamily: systemFontFamily,
    fontSize: 40,
    fontWeight: '600' as const,
    letterSpacing: -1,
    lineHeight: 44,
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
  card: 20,
  small: 10,
} as const;

export const layout = {
  screenPadding: 24,
  hairline: 1,
} as const;
