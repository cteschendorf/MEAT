export const brandColors = {
  twaRed: '#C8201A',
  twaRedLight: '#E02E22',
  clay: '#9C4228',
  travertineDark: '#100D08',
  chrome: '#181410',
  cardDark: '#201C13',
  elevatedDark: '#2A2419',
  parchment: '#F0E8D5',
  parchmentMuted: '#E2D9C4',
  parchmentSubtle: '#8A7C62',
  parchmentBorder: '#C8BDA8',
  ink: '#1A1510',
  inkSecondary: '#5A4E3A',
  warmText: '#E8DFC8',
  warmTextSecondary: '#968267',
  warmBorder: '#2E2618',
  warmBorderStrong: '#524535',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  chrome: string;
  chromeBorder: string;
  macroStrip: string;
  parchment: string;
  parchmentMuted: string;
  parchmentBorder: string;
  textPrimary: string;
  textSecondary: string;
  textOnAction: string;
  textOnChrome: string;
  textSecondaryOnChrome: string;
  accentOnChrome: string;
  textOnParchment: string;
  textSecondaryOnParchment: string;
  energyProgressOnParchment: string;
  energyProgressOverOnParchment: string;
  border: string;
  borderStrong: string;
  brand: string;
  brandStrong: string;
  brandSoft: string;
  action: string;
  actionPressed: string;
  actionEmphasis: string;
  protein: string;
  proteinAccent: string;
  calories: string;
  caloriesAccent: string;
  carbs: string;
  fat: string;
  fiber: string;
  caloriesLabel: string;
  carbsLabel: string;
  fatLabel: string;
  fiberLabel: string;
  positive: string;
  warning: string;
  destructive: string;
  destructiveAction: string;
  destructiveActionPressed: string;
  focusRing: string;
  shadow: string;
}

/**
 * The light appearance is the parchment-side companion to the dark terminal
 * palette. It keeps the same warm materials and red wayfinding accent without
 * forcing a dark appearance when the system is set to light.
 */
export const lightColors: ThemeColors = {
  background: '#F6F0E2',
  surface: '#FFF9EC',
  surfaceMuted: '#E9E0CF',
  surfaceElevated: '#FFFFFF',
  chrome: brandColors.chrome,
  chromeBorder: brandColors.warmBorder,
  macroStrip: brandColors.cardDark,
  parchment: brandColors.parchment,
  parchmentMuted: brandColors.parchmentMuted,
  parchmentBorder: brandColors.parchmentBorder,
  textPrimary: brandColors.ink,
  textSecondary: brandColors.inkSecondary,
  textOnAction: '#FFFFFF',
  textOnChrome: brandColors.warmText,
  textSecondaryOnChrome: brandColors.warmTextSecondary,
  accentOnChrome: '#E85A50',
  textOnParchment: brandColors.ink,
  textSecondaryOnParchment: brandColors.inkSecondary,
  energyProgressOnParchment: brandColors.clay,
  energyProgressOverOnParchment: brandColors.twaRed,
  border: '#D5C9B5',
  borderStrong: '#B7A98F',
  brand: brandColors.twaRed,
  brandStrong: '#9F1915',
  brandSoft: brandColors.clay,
  action: brandColors.twaRed,
  actionPressed: '#9F1915',
  actionEmphasis: brandColors.twaRedLight,
  protein: brandColors.twaRed,
  proteinAccent: brandColors.twaRedLight,
  calories: brandColors.clay,
  caloriesAccent: brandColors.twaRed,
  carbs: brandColors.inkSecondary,
  fat: brandColors.inkSecondary,
  fiber: brandColors.inkSecondary,
  caloriesLabel: brandColors.inkSecondary,
  carbsLabel: brandColors.inkSecondary,
  fatLabel: brandColors.inkSecondary,
  fiberLabel: brandColors.inkSecondary,
  positive: '#3C6E54',
  warning: '#8A5A20',
  destructive: '#B4232B',
  destructiveAction: '#9F1915',
  destructiveActionPressed: '#80120F',
  focusRing: brandColors.twaRed,
  shadow: 'rgba(16, 13, 8, 0.12)',
};

/**
 * Figma Make Version 4: Saarinen-era terminal warmth, parchment information
 * panels, and TWA red used as a restrained navigation/action signal.
 */
export const darkColors: ThemeColors = {
  background: brandColors.travertineDark,
  surface: brandColors.cardDark,
  surfaceMuted: brandColors.chrome,
  surfaceElevated: brandColors.elevatedDark,
  chrome: brandColors.chrome,
  chromeBorder: brandColors.warmBorder,
  macroStrip: brandColors.cardDark,
  parchment: brandColors.parchment,
  parchmentMuted: brandColors.parchmentMuted,
  parchmentBorder: brandColors.parchmentBorder,
  textPrimary: brandColors.warmText,
  textSecondary: brandColors.warmTextSecondary,
  textOnAction: '#FFFFFF',
  textOnChrome: brandColors.warmText,
  textSecondaryOnChrome: brandColors.warmTextSecondary,
  accentOnChrome: '#E85A50',
  textOnParchment: brandColors.ink,
  textSecondaryOnParchment: brandColors.inkSecondary,
  energyProgressOnParchment: brandColors.clay,
  energyProgressOverOnParchment: brandColors.twaRed,
  border: brandColors.warmBorder,
  borderStrong: brandColors.warmBorderStrong,
  // Text accents are lifted for AA contrast on dark cards; solid controls keep
  // the exact TWA red through `action`.
  brand: '#E85A50',
  brandStrong: '#F06B61',
  brandSoft: brandColors.twaRedLight,
  action: brandColors.twaRed,
  actionPressed: '#9F1915',
  actionEmphasis: brandColors.twaRedLight,
  protein: '#E85A50',
  proteinAccent: '#F06B61',
  calories: '#D69A79',
  caloriesAccent: '#F0B493',
  carbs: brandColors.warmText,
  fat: brandColors.warmText,
  fiber: brandColors.warmText,
  caloriesLabel: '#DDB092',
  carbsLabel: brandColors.warmText,
  fatLabel: brandColors.warmText,
  fiberLabel: brandColors.warmText,
  positive: '#83B995',
  warning: '#E4B56C',
  destructive: '#F06B61',
  destructiveAction: '#9F1915',
  destructiveActionPressed: '#80120F',
  focusRing: '#E85A50',
  shadow: 'rgba(0, 0, 0, 0.34)',
};
