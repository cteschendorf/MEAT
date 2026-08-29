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

export const typography = {
  caption: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
} as const;

export const minimumTouchTarget = 44;
