export const brandColors = {
  primaryPlum: '#4B2438',
  deepPlum: '#2A101D',
  softPlum: '#6D4357',
  chili: '#D91F26',
  brightChili: '#F12A2F',
  emberOrange: '#FF5A1F',
  yellowOrange: '#FFB000',
  saffron: '#F2B400',
  sapphire: '#2457D6',
  emerald: '#00A66A',
  warmOffWhite: '#FAF8F6',
  darkBackground: '#120D10',
  darkSurface: '#1C1519',
  darkSurfaceMuted: '#21181D',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  textOnAction: string;
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
  focusRing: string;
  shadow: string;
}

export const lightColors: ThemeColors = {
  background: brandColors.warmOffWhite,
  surface: '#FFFFFF',
  surfaceMuted: '#F4F0F2',
  surfaceElevated: '#FFFFFF',
  textPrimary: '#21181D',
  textSecondary: '#665B60',
  textOnAction: '#FFFFFF',
  border: '#E0D6DB',
  borderStrong: '#C9B8C1',
  brand: brandColors.primaryPlum,
  brandStrong: brandColors.deepPlum,
  brandSoft: brandColors.softPlum,
  action: brandColors.primaryPlum,
  actionPressed: brandColors.deepPlum,
  actionEmphasis: brandColors.brightChili,
  protein: brandColors.primaryPlum,
  proteinAccent: brandColors.brightChili,
  calories: brandColors.emberOrange,
  caloriesAccent: brandColors.yellowOrange,
  carbs: brandColors.saffron,
  fat: brandColors.sapphire,
  fiber: brandColors.emerald,
  caloriesLabel: '#C53A00',
  carbsLabel: '#8A6500',
  fatLabel: '#1F46B0',
  fiberLabel: '#007A4D',
  positive: '#087A50',
  warning: '#8A6500',
  destructive: '#B4232B',
  focusRing: brandColors.sapphire,
  shadow: 'rgba(42, 16, 29, 0.08)',
};

export const darkColors: ThemeColors = {
  background: brandColors.darkBackground,
  surface: brandColors.darkSurface,
  surfaceMuted: brandColors.darkSurfaceMuted,
  surfaceElevated: '#2A2025',
  textPrimary: '#FFF8FB',
  textSecondary: '#D0C2C9',
  textOnAction: '#FFFFFF',
  border: '#473740',
  borderStrong: '#6B5260',
  brand: '#B986A0',
  brandStrong: '#F0C7DA',
  brandSoft: '#A4758C',
  action: brandColors.softPlum,
  actionPressed: brandColors.primaryPlum,
  actionEmphasis: '#FF5D62',
  protein: '#B986A0',
  proteinAccent: '#FF5D62',
  calories: '#FF7A33',
  caloriesAccent: '#FFC247',
  carbs: '#FFD24A',
  fat: '#5F86FF',
  fiber: '#35D48B',
  caloriesLabel: '#FF9A61',
  carbsLabel: '#FFD24A',
  fatLabel: '#84A2FF',
  fiberLabel: '#5CDF9D',
  positive: '#5CDF9D',
  warning: '#FFD24A',
  destructive: '#FF777C',
  focusRing: '#84A2FF',
  shadow: 'rgba(0, 0, 0, 0.36)',
};
