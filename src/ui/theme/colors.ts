export const brandColors = {
  // The Figma Make concept's own four-tier dark ladder, each step a little
  // lighter than the last: canvas, then chrome (bars, sheets), then card
  // (content), then elevated (chips and swatches nested inside a card).
  bg: '#080808',
  surfaceDark: '#111111',
  cardDark: '#191919',
  elevatedDark: '#222222',
  raisedDark: '#333333',
  border: '#2A2A2A',
  borderMed: '#333333',
  text: '#F0F0F0',
  textSecondary: '#888888',
  textMuted: '#444444',
  // Gold — the single accent. No second brand hue exists in this system;
  // goldDim is a deeper step of the same color, not a different one.
  gold: '#C8A45A',
  goldDim: '#A07840',
  goldFaint: 'rgba(200, 164, 90, 0.12)',
  // Status colors, kept out of the gold family on purpose — a caution or an
  // over-budget state needs to read as "not the accent" at a glance.
  positive: '#4A9A6A',
  overBudget: '#CC5533',
  caution: '#D9A441',
  // Warm off-white companions for light mode. Not literally "parchment" —
  // that was the previous system's dedicated light information-panel motif,
  // which this one drops — just a warm neutral instead of stark white.
  warmBackground: '#F5F1E8',
  warmMuted: '#EDE6D8',
  warmBorder: '#DDD3C0',
  warmBorderStrong: '#C7BA9E',
  ink: '#181410',
  inkSecondary: '#6B6156',
  goldDeep: '#8C6633',
  goldDeeper: '#6E4F25',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  chrome: string;
  chromeBorder: string;
  textPrimary: string;
  textSecondary: string;
  textOnAction: string;
  textOnDestructive: string;
  textOnChrome: string;
  textSecondaryOnChrome: string;
  accentOnChrome: string;
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
 * The light appearance follows the same "one gold accent" rule as dark, on
 * warm off-white surfaces instead of stark white — the brief calls for warm
 * neutrals in light mode, not a return to plain iOS white. The raw gold
 * (`#C8A45A`) is too pale to read as text or a border against a light
 * background, so light mode deepens it (`goldDeep` / `goldDeeper`) rather
 * than using the same value dark mode does.
 */
export const lightColors: ThemeColors = {
  background: brandColors.warmBackground,
  surface: '#FFFFFF',
  surfaceMuted: brandColors.warmMuted,
  surfaceElevated: '#FFFFFF',
  chrome: '#FFFFFF',
  chromeBorder: brandColors.warmBorder,
  textPrimary: brandColors.ink,
  textSecondary: brandColors.inkSecondary,
  textOnAction: '#FFFFFF',
  // Destructive buttons stay a saturated red in both themes, so they always
  // want light text — unlike `textOnAction`, which flips with the accent.
  textOnDestructive: '#FFFFFF',
  textOnChrome: brandColors.ink,
  textSecondaryOnChrome: brandColors.inkSecondary,
  accentOnChrome: brandColors.goldDeep,
  border: brandColors.warmBorder,
  borderStrong: brandColors.warmBorderStrong,
  brand: brandColors.goldDeep,
  brandStrong: brandColors.goldDeeper,
  brandSoft: brandColors.goldDim,
  action: brandColors.goldDeep,
  actionPressed: brandColors.goldDeeper,
  actionEmphasis: brandColors.goldDim,
  protein: brandColors.goldDeep,
  proteinAccent: brandColors.goldDeep,
  calories: brandColors.ink,
  caloriesAccent: brandColors.goldDeep,
  carbs: brandColors.ink,
  fat: brandColors.ink,
  fiber: brandColors.ink,
  caloriesLabel: brandColors.ink,
  carbsLabel: brandColors.ink,
  fatLabel: brandColors.ink,
  fiberLabel: brandColors.ink,
  positive: '#3C7A54',
  warning: '#A8791F',
  destructive: '#B33A1F',
  destructiveAction: '#9C3119',
  destructiveActionPressed: '#7D2714',
  focusRing: brandColors.goldDeep,
  shadow: 'rgba(24, 20, 16, 0.14)',
};

/**
 * Figma Make, latest generation: a monochromatic near-black canvas with a
 * single gold accent, replacing the earlier "Version 4" TWA-red/parchment
 * system. There is no light informational panel in this concept — every
 * surface is a step of the same dark ladder (`background` → `chrome` →
 * `surface` → `surfaceMuted` → `surfaceElevated`, darkest to lightest) — and
 * no second brand hue: gold carries selection, action, and protein emphasis
 * everywhere at once, exactly as the previous system used TWA red.
 */
export const darkColors: ThemeColors = {
  background: brandColors.bg,
  surface: brandColors.cardDark,
  surfaceMuted: brandColors.elevatedDark,
  surfaceElevated: brandColors.raisedDark,
  chrome: brandColors.surfaceDark,
  chromeBorder: brandColors.border,
  textPrimary: brandColors.text,
  textSecondary: brandColors.textSecondary,
  // Gold sits mid-lightness against this near-black canvas, so its own
  // buttons take dark text rather than the light text a saturated red fill
  // would have needed — this is the one field the palette swap actually
  // flips the polarity of.
  textOnAction: brandColors.bg,
  textOnDestructive: '#FFFFFF',
  textOnChrome: brandColors.text,
  // `textMuted` reads at under 2:1 against this chrome — too faint for an
  // inactive tab icon to clear even non-text contrast — so the tab bar uses
  // the same secondary tone the rest of dark mode's chrome text does.
  textSecondaryOnChrome: brandColors.textSecondary,
  accentOnChrome: brandColors.gold,
  border: brandColors.border,
  borderStrong: brandColors.borderMed,
  brand: brandColors.gold,
  brandStrong: brandColors.gold,
  brandSoft: brandColors.goldDim,
  action: brandColors.gold,
  actionPressed: brandColors.goldDim,
  actionEmphasis: brandColors.gold,
  protein: brandColors.gold,
  proteinAccent: brandColors.gold,
  // Every other metric stays full-contrast neutral text — protein is the
  // only one that gets the accent, same rule as before, different accent.
  calories: brandColors.text,
  caloriesAccent: brandColors.gold,
  carbs: brandColors.text,
  fat: brandColors.text,
  fiber: brandColors.text,
  caloriesLabel: brandColors.text,
  carbsLabel: brandColors.text,
  fatLabel: brandColors.text,
  fiberLabel: brandColors.text,
  positive: brandColors.positive,
  warning: brandColors.caution,
  destructive: brandColors.overBudget,
  destructiveAction: '#B84726',
  destructiveActionPressed: '#96391E',
  focusRing: brandColors.gold,
  shadow: 'rgba(0, 0, 0, 0.45)',
};
