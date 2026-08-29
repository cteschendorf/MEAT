# MEAT design system

## Brand roles

- Soft Plum `#6D4357` is the primary MEAT brand color.
- Chili Red `#D91F26` and Bright Chili `#F12A2F` communicate action, energy, and progress.
- Warm Off-White `#FAF8F6` is the primary light background.
- Dark Background `#120D10` is the primary dark background.

UI code should consume semantic tokens (`background`, `surface`, `textPrimary`, `action`, etc.) rather than raw brand colors.

## Accessibility

- All interactive controls target at least 44 points.
- Text uses `allowFontScaling` and layouts must tolerate Dynamic Type.
- Meaning must not depend on color alone.
- Disabled state is exposed through accessibility state.
- Loading, empty, and error messaging should use live regions where appropriate.
- Native controls and platform behavior are preferred over custom reimplementations.

## Surfaces and controls

The initial primitives are `Surface`, `ActionButton`, and `ScreenState`. Product screens should compose these rather than inventing new card/button treatments for each feature.

## Light and dark mode

`useThemeColors` follows the system color scheme. Both palettes preserve the same semantic roles so product components do not branch on appearance.

## Motion and haptics

Motion should communicate hierarchy or state change, honor Reduce Motion, and avoid decorative excess. Haptics should be reserved for meaningful confirmation or native-feeling control feedback.

## Styling policy

Use React Native styles and reusable semantic tokens. Tailwind/NativeWind is intentionally not part of the initial architecture.
