# MEAT

MEAT is an Apple-first, local-first nutrition tracker built with Expo, React Native, TypeScript, and Expo Router.

## Food-data model

Food sources remain independent from discovery through persistence:

- personal foods and private tracking live in the app's private SQLite database;
- the pinned USDA Foundation/FNDDS/SR Legacy core ships as a read-only SQLite asset;
- USDA online responses use their own provider cache and the Cloudflare proxy at `api.meatnutrition.app`;
- Open Food Facts responses use a separate provider cache to preserve their ODbL boundary.

Provider records have stable source-scoped IDs such as `usda-core:12345` and `open-food-facts:3017620422003`, and records are never silently merged. Search results are presented as one list grouped by food category (Your foods / Common / Branded) with the source shown on every row; the presentation is unified, the records are not. The one exception is collapsing a single FDC record seen through both the offline core and the online cache, which is the same record from the same authority.

## Local setup

Use Node.js 22 and Python 3:

```sh
npm ci
npm run proxy:install
npm run quality
npm run quality:ios-export
npm start
```

`npm run quality` runs the root typecheck/lint/runtime suite, Expo SDK checks, deterministic USDA asset verification, and the Cloudflare Worker check. The separate iOS export is a local Expo/Metro JavaScript export; it does not sign, upload, submit, or consume an EAS build.

See [local development](docs/local-development.md), [food data](docs/food-data.md), and [external sources](docs/external-food-sources.md) for details.

## Build approval rule

**Do not initiate an EAS build without explicit approval for that specific build.** Approval for one build does not authorize later builds.

Prefer Expo Go, local development, the local iOS export, static analysis, and automated tests whenever they can validate a change without a custom build.

## Project status

The current local candidate includes production T-bone branding, a protein-first Today dashboard, and one timestamped timeline event for each meal, snack, or sitting. Every discovery path feeds a shared multi-food composer. Events can carry an optional name, manual location, note, and up to five private on-device photos, then be edited, moved across days, or deleted with a ten-second Undo window. Journal uses the same time-first event model in 100-event pages.

Source-aware food discovery, barcode lookup, the pinned offline USDA core, independent provider caches, onboarding, favorites/recents, and saved meals/recipes remain intact. A food opens on the serving its own source names — the package serving for a scanned product — rather than a synthesized 100 g. Amounts may be entered against that serving ("2 x 1 medium breast") or in a measurement unit; the serving is retained so history shows the household measure rather than a flattened figure.

Mass units (g, kg, oz, lb) are offered for every food and convert exactly. Volume units (ml, L, fl oz, cup, tbsp, tsp) are offered only for a food whose own portions state a volume alongside a weight, because grams per millilitre varies by food and MEAT does not store a density. A fluid ounce of olive oil is 27.0 g and one of honey is 42.0 g; assuming either would be the volumetric equivalent of treating a missing nutrient as zero. The default unit for typed amounts is set under Goals & units.

Version remains `0.1.0`. Build number `2` shipped the branded timeline release. Build number `3` was the first input-revamp TestFlight candidate. Build number `4` adds the food detail sheet, goal-mode-aware targets, the iOS barcode fix, and keyboard handling; each subsequent build number requires its own approval.
