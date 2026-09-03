import type { TextStyle } from 'react-native';

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  xs: 6,
  sm: 8,
  control: 8,
  md: 12,
  card: 12,
  lg: 24,
  sheet: 24,
  capsule: 999,
} as const;

export const iconSizes = {
  compact: 16,
  control: 20,
  navigation: 18,
  brand: 36,
  metric: 40,
} as const;

export const fontFamilies = {
  body: 'DMSans_400Regular',
  bodyLight: 'DMSans_300Light',
  bodyMedium: 'DMSans_500Medium',
  bodySemibold: 'DMSans_600SemiBold',
  display: 'BarlowCondensed_400Regular',
  displayMedium: 'BarlowCondensed_500Medium',
  displaySemibold: 'BarlowCondensed_600SemiBold',
} as const;

export const typography = {
  caption: {
    fontFamily: fontFamilies.body,
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    fontFamily: fontFamilies.bodyLight,
    fontSize: 17,
    lineHeight: 24,
  },
  bodyStrong: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '500' as const,
  },
  title3: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '500' as const,
  },
  title2: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '500' as const,
  },
  title1: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '500' as const,
  },
  largeTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '400' as const,
    letterSpacing: -0.5,
  },
  screenTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '400' as const,
    letterSpacing: -0.5,
    textTransform: 'uppercase' as const,
  },
  wordmark: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '500' as const,
    letterSpacing: 2.5,
  },
  overline: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500' as const,
    letterSpacing: 2.5,
    textTransform: 'uppercase' as const,
  },
  tabLabel: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '500' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
  },
  metricHero: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 58,
    lineHeight: 58,
    fontWeight: '500' as const,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
    letterSpacing: -2,
  },
  metricPrimary: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '500' as const,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
    letterSpacing: -1,
  },
  metricSecondary: {
    fontFamily: fontFamilies.displaySemibold,
    fontSize: 36,
    lineHeight: 38,
    fontWeight: '600' as const,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
    letterSpacing: -0.5,
  },
  metricCompact: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '500' as const,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
} as const;

export const minimumTouchTarget = 44;
