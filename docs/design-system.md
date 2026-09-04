# MEAT design system

The current system follows the Figma Make concept's monochromatic language: a near-black canvas in dark mode, a warm off-white canvas in light mode, condensed numerals, and one gold accent carrying every brand and action role. It replaces the earlier "Version 4" system, which used a brown-black canvas, parchment information panels, and TWA Red as the accent — that direction is superseded, not a variant to preserve alongside this one.

## Brand roles

- Gold `#C8A45A` (dark mode) / `#8C6633` (light mode) is the sole brand accent. It carries primary actions, selected states, the MEAT wordmark, and protein emphasis. There is no second brand hue anywhere in the system.
- Dark mode is a four-step ladder, each step a little lighter than the last: Background `#080808`, Chrome `#111111` (bars and sheets), Surface `#191919` (cards), Surface Muted `#222222` and Surface Elevated `#333333` (nested chips and swatches).
- Light mode swaps the ladder for warm off-white rather than stark white: Background `#F5F1E8`, Surface `#FFFFFF`, Surface Muted `#EDE6D8`. It is not a return to plain iOS white, and it is not "parchment" in the Version 4 sense — there is no dedicated light information panel in this concept; every surface, light or dark, is just a step of the same ladder.
- Primary text uses `#F0F0F0` on dark surfaces and `#181410` on light surfaces, with `#888888` / `#6B6156` respectively for secondary text.

UI code should consume semantic tokens (`background`, `surface`, `textPrimary`, `action`, etc.) rather than raw brand colors. Gold is not a generic decoration token, and metric meaning must never depend on color alone.

### Metric hierarchy

- The daily nutrition dashboard is one compound card, not a stack of independent metric cards, and not a split between a light and a dark section — every part of it sits on the same dark (or light) ladder.
- Its upper section leads with energy, goal context, remaining calories, and a linear progress bar. Protein is the prominent companion value and uses the gold accent.
- Its lower section presents fiber, carbohydrate, and fat as a compact macro strip. Protein already led the hero above, so it is not repeated here — unlike Version 4's macro strip, which restated it. Dividers, spacing, labels, and reading order provide structure; the macros do not receive individual rainbow colors or illustrative icons.
- Values use condensed, tabular numerals. Every metric retains a complete accessible label with its name, value, unit, and goal state.

### Production artwork

`assets/brand/meat-t-bone-mark.svg` is the canonical, clean vector recreation of the approved Notion T-bone. Do not replace it with emoji, a screenshot crop, or generated artwork. The mark intentionally simplifies the board's texture so its steak silhouette, cream rim, red muscle fields, and oversized T-shaped bone remain legible at small sizes.

Launcher, splash, header, Android adaptive, and monochrome exports live beside the source in `assets/brand`. Their generation and validation contract is documented in `assets/brand/README.md`. These exports are unchanged by the palette swap — they are a separate, previously-approved contract, not part of this re-theme.

## Accessibility

- All interactive controls target at least 44 points.
- Text uses `allowFontScaling` and layouts must tolerate Dynamic Type.
- Meaning must not depend on color alone.
- Disabled state is exposed through accessibility state.
- Loading, empty, and error messaging should use live regions where appropriate.
- Native controls and platform behavior are preferred over custom reimplementations.
- Destructive controls always pair with light text (`textOnDestructive`) rather than the theme's ordinary action text color, since their red fill does not track the accent's polarity flip between light and dark mode. Confirm any new color pairing against `tests/brand-foundation.test.ts`'s WCAG contrast checks before shipping it — a token existing does not mean a given pairing of it is legible.

## Surfaces and controls

The initial primitives are `Surface`, `ActionButton`, `BrandMark`, and `ScreenState`. Product screens should compose these rather than inventing new card/button treatments for each feature. Primary actions use the gold accent. Cards use restrained borders and elevation from the same surface ladder — there is no parchment section to reserve for "information that leads the screen"; everything lives on the ladder.

Compound surfaces, such as the nutrition dashboard, still share one outer border and radius so their sections read as a single component, even though those sections no longer differ by tone the way a parchment/dark split once did. Avoid nested shadows, decorative gradients, and metric-tinted cards.

## Typography

- Barlow Condensed is the display and numeric face. Use it for large headings, nutrition values, and compact numeric lockups.
- DM Sans is the body and control face.
- Small section labels may use uppercase with generous tracking. Keep sentence case for messages, field labels, and controls where fast reading matters.
- Nutrition values use tabular numerals and layouts must remain stable when values change.

## Light and dark mode

`useThemeColors` follows the system color scheme, and product components consume the same semantic roles in either appearance. Both appearances share one gold accent and the same surface-ladder structure; light mode is a warm off-white version of that ladder, not a return to the parchment moment or to plain iOS white, and dark mode is a near-black canvas rather than Version 4's brown-black. The one field that changes character rather than just value is `textOnAction`: dark mode's gold sits mid-lightness against a near-black canvas, so gold buttons take dark text there, while light mode's deeper gold still takes light text as usual. Components should not branch on appearance or reintroduce the former plum, orange, yellow, blue, and green metric palette.

## Motion and haptics

Motion should communicate hierarchy or state change, honor Reduce Motion, and avoid decorative excess. Haptics should be reserved for meaningful confirmation or native-feeling control feedback.

## Styling policy

Use React Native styles and reusable semantic tokens. Tailwind/NativeWind is intentionally not part of the initial architecture.
