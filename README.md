# MEAT

MEAT is an Apple-first, local-first nutrition tracker built with Expo, React Native, TypeScript, and Expo Router.

## Food-data model

Food sources remain independent from discovery through persistence:

- personal foods and private tracking live in the app's private SQLite database;
- the pinned USDA Foundation/FNDDS/SR Legacy core ships as a read-only SQLite asset;
- USDA online responses use their own provider cache and the Cloudflare proxy at `api.meatnutrition.app`;
- Open Food Facts responses use a separate provider cache to preserve their ODbL boundary.

Provider records have stable source-scoped IDs such as `usda-core:12345` and `open-food-facts:3017620422003`. Search results are grouped by source and are never silently merged.

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

The current dogfood implementation includes local nutrition tracking, source-aware food discovery, barcode lookup, the pinned offline USDA core, independent provider caches, onboarding, quick-log suggestions, and saved meals/recipes. Food quantities are entered in grams throughout this candidate; ounce-aware entry is intentionally deferred until it can be supported end to end.
