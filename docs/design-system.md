# MEAT design system

## Brand roles

- Primary Plum `#4B2438` carries the MEAT wordmark, primary actions, and protein hierarchy. Deep Plum `#2A101D` and Soft Plum `#6D4357` support pressed and secondary brand states.
- Chili Red `#D91F26` and Bright Chili `#F12A2F` communicate protein energy and progress. Chili is not the default button color.
- Calories alone use a two-tone Ember Orange `#FF5A1F` and Yellow-Orange `#FFB000` treatment.
- Carbs, fat, and fiber use one flat color each: Saffron `#F2B400`, Sapphire `#2457D6`, and Emerald `#00A66A`.
- Warm Off-White `#FAF8F6` is the primary light background.
- Dark Background `#120D10`, Surface `#1C1519`, and Muted Surface `#21181D` form the dark neutral foundation.

UI code should consume semantic tokens (`background`, `surface`, `textPrimary`, `action`, etc.) rather than raw brand colors.

### Metric hierarchy

- Protein is primary. Use `protein` for its plum progress treatment and `proteinAccent` only for the T-bone mark and endpoint.
- Calories are the close secondary metric. `calories` and `caloriesAccent` are the only two-tone metric pair.
- Carbs, fat, and fiber are tertiary. Each uses one solid display color and a separate contrast-safe `*Label` token for text.
- Values remain `textPrimary`; metric meaning must never depend on color alone.

### Production artwork

`assets/brand/meat-t-bone-mark.svg` is the canonical, clean vector recreation of the approved Notion T-bone. Do not replace it with emoji, a screenshot crop, or generated artwork. The mark intentionally simplifies the board's texture so its steak silhouette, cream rim, red muscle fields, and oversized T-shaped bone remain legible at small sizes.

Launcher, splash, header, Android adaptive, and monochrome exports live beside the source in `assets/brand`. Their generation and validation contract is documented in `assets/brand/README.md`.

## Accessibility

- All interactive controls target at least 44 points.
- Text uses `allowFontScaling` and layouts must tolerate Dynamic Type.
- Meaning must not depend on color alone.
- Disabled state is exposed through accessibility state.
- Loading, empty, and error messaging should use live regions where appropriate.
- Native controls and platform behavior are preferred over custom reimplementations.

## Surfaces and controls

The initial primitives are `Surface`, `ActionButton`, `BrandMark`, and `ScreenState`. Product screens should compose these rather than inventing new card/button treatments for each feature. Primary actions use plum; chili is reserved for protein emphasis and exceptional energy/progress accents. The elevated surface tone adds a restrained neutral shadow without tinting the card.

## Light and dark mode

`useThemeColors` follows the system color scheme. Both palettes preserve the same semantic roles so product components do not branch on appearance. Dark-mode metric display tokens are brighter than their light counterparts, while surfaces remain neutral rather than metric-tinted.

## Motion and haptics

Motion should communicate hierarchy or state change, honor Reduce Motion, and avoid decorative excess. Haptics should be reserved for meaningful confirmation or native-feeling control feedback.

## Styling policy

Use React Native styles and reusable semantic tokens. Tailwind/NativeWind is intentionally not part of the initial architecture.
