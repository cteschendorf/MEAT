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
  sm: 10,
  md: 16,
  lg: 22,
  capsule: 999,
} as const;

export const iconSizes = {
  compact: 16,
  control: 20,
  navigation: 24,
  brand: 36,
  metric: 40,
} as const;

export const typography = {
  caption: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
  wordmark: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const, letterSpacing: 1.1 },
  metricPrimary: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  metricSecondary: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  metricCompact: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '600' as const,
    fontVariant: ['tabular-nums'] as const,
  },
} as const;

export const minimumTouchTarget = 44;
