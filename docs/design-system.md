# MEAT design system

Version 4 follows the warm, restrained visual language of Saarinen-era TWA: a nearly black brown canvas, parchment information panels, condensed numerals, and one decisive red accent. It should feel editorial and architectural rather than like a collection of colorful fitness widgets.

## Brand roles

- TWA Red `#C8201A` is the sole brand accent. It carries primary actions, selected states, the MEAT wordmark, and protein emphasis.
- Dark Background `#100D08`, Dark Surface `#181410`, and Dark Card `#201C13` form the layered app canvas.
- Parchment `#F0E8D5` is the intentional light moment for prominent information. Parchment Muted `#E2D9C4` is its progress track and Parchment Border `#C8BDA8` defines its edge.
- On-parchment text uses `#1A1510` for primary content and `#5A4E3A` for supporting content.
- Primary text on dark surfaces uses Warm Ivory `#E8DFC8`. Warm Border `#2E2618` separates dark cards without introducing a cool gray.

UI code should consume semantic tokens (`background`, `surface`, `textPrimary`, `action`, etc.) rather than raw brand colors. Red is not a generic decoration token, and metric meaning must never depend on color alone.

### Metric hierarchy

- The daily nutrition dashboard is one compound card, not a stack of independent metric cards.
- Its parchment upper section leads with energy, goal context, remaining calories, and a linear progress bar. Protein is the prominent companion value and uses TWA Red.
- Its dark lower section presents protein, fiber, carbohydrates, and fat as a compact macro strip. Dividers, spacing, labels, and reading order provide structure; the macros do not receive individual rainbow colors or illustrative icons.
- Values use condensed, tabular numerals. Every metric retains a complete accessible label with its name, value, unit, and goal state.

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

The initial primitives are `Surface`, `ActionButton`, `BrandMark`, and `ScreenState`. Product screens should compose these rather than inventing new card/button treatments for each feature. Primary actions use TWA Red. Dark cards use warm borders and restrained elevation; parchment is reserved for information that genuinely leads the screen.

Compound surfaces may deliberately pair parchment and dark sections, as in the nutrition dashboard. They share one outer border and radius so they read as a single component. Avoid nested shadows, decorative gradients, and metric-tinted cards.

## Typography

- Barlow Condensed is the display and numeric face. Use it for large headings, nutrition values, and compact numeric lockups.
- DM Sans is the body and control face.
- Small section labels may use uppercase with generous tracking. Keep sentence case for messages, field labels, and controls where fast reading matters.
- Nutrition values use tabular numerals and layouts must remain stable when values change.

## Light and dark mode

`useThemeColors` follows the system color scheme, and product components consume the same semantic roles in either appearance. The Version 4 identity remains warm in both: light surfaces are parchment-based rather than stark white, while dark surfaces use the brown-black canvas and warm ivory type. Components should not branch on appearance or restore the former plum, orange, yellow, blue, and green metric palette.

## Motion and haptics

Motion should communicate hierarchy or state change, honor Reduce Motion, and avoid decorative excess. Haptics should be reserved for meaningful confirmation or native-feeling control feedback.

## Styling policy

Use React Native styles and reusable semantic tokens. Tailwind/NativeWind is intentionally not part of the initial architecture.
