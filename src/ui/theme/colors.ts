export const brandColors = {
  plum: '#6D4357',
  chili: '#D91F26',
  brightChili: '#F12A2F',
  warmOffWhite: '#FAF8F6',
  darkBackground: '#120D10',
} as const;

export const lightColors = {
  background: brandColors.warmOffWhite,
  surface: '#FFFFFF',
  surfaceMuted: '#F1ECEF',
  textPrimary: '#24191F',
  textSecondary: '#695D63',
  border: '#DED4D9',
  brand: brandColors.plum,
  action: brandColors.chili,
  actionEmphasis: brandColors.brightChili,
  positive: '#2F7A52',
  warning: '#9A6515',
  destructive: '#B4232B',
} as const;

export const darkColors = {
  background: brandColors.darkBackground,
  surface: '#1D1519',
  surfaceMuted: '#2A1E24',
  textPrimary: '#F8F2F5',
  textSecondary: '#C8BAC1',
  border: '#44343C',
  brand: '#B986A0',
  action: '#F0474D',
  actionEmphasis: '#FF5A60',
  positive: '#66B98A',
  warning: '#E6B35F',
  destructive: '#FF777C',
} as const;

export type ThemeColors = typeof lightColors;
