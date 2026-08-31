# MEAT architecture

## Direction

MEAT is Apple-first but not Apple-locked. React Native is the application/UI layer. Apple-specific capabilities should be implemented behind explicit adapters so domain logic remains portable.

## Layer boundaries

- `app/` — Expo Router route composition only.
- `src/ui/` — reusable presentation components and design-system primitives.
- `src/domain/` — framework-independent nutrition, goals, meals, food, and social domain models and rules.
- `src/data/` — repositories, persistence implementations, migrations, food indexes, and normalization.
- `src/services/` — application use cases and orchestration between domain and adapters.
- `src/ai/` — platform-neutral AI contracts, structured validation, and adapters.
- `src/platform/` — Apple/Android/native integrations and capability detection.
- `src/config/` — validated runtime configuration and feature capabilities.

Dependencies should point inward: platform/data/UI may depend on domain contracts; domain must not depend on React Native, Expo, Supabase, or Apple APIs.

## Data principles

- Canonical models precede screen-specific models.
- Rich nutrient storage is independent of what the MVP displays.
- Unknown nutrient values remain unknown rather than becoming zero.
- Local persistence and future server synchronization models are separate contracts.
- Schema changes use explicit migrations rather than destructive resets.
- Provider records keep stable source-scoped references and provenance.
- Similar records from different providers remain separate; MEAT never silently merges food databases.

## Food-provider boundary

`FoodProvider` adapters return `FoodCandidate` records containing a stable `FoodRef`, canonical `Food`, portions, and provenance. The stable ID format is `sourceId:encodeURIComponent(recordId)`, for example `usda-core:321358`, `usda-fdc:321358`, or `open-food-facts:3017620422003`. The source prefix is part of identity: equal names, barcodes, or FDC IDs do not authorize cross-provider merging.

The discovery service applies source preferences and returns independent result/error states in the order personal, USDA core, USDA online, and Open Food Facts. One provider's outage, throttle, or invalid response does not suppress results from another. Selected provider records are retained by their own provider and referenced by their stable ID before a meal is written.

## Storage boundary

Active data is split by purpose and license:

| Store | Role | Mutability |
| --- | --- | --- |
| `meat.db` | Private foods, meals, goals, recipes, saved meals, preferences, favorites, and known provider references | User-owned, writable |
| `meat-usda-core.sqlite` | Pinned CC0 USDA Foundation/FNDDS/SR Legacy search and nutrition data | Bundled, query-only |
| `usda-fdc-cache.db` | USDA online provider responses | Provider-scoped cache |
| `open-food-facts-cache.db` | Open Food Facts search/product responses | Provider-scoped ODbL cache |

The private store does not become a combined redistribution database. It holds personal records and stable references to provider records; provider payloads remain in the appropriate source asset/cache.

## Meal-event and media boundary

`Meal` is the only timeline entity. One confirmed composer draft becomes one atomic, timestamped event containing one or more foods. Separate confirmations are never grouped by time proximity. `Meal.title`, `caption`, `location`, and ordered `mediaIds` are optional context; only food items participate in deterministic nutrition totals.

The composer persists a selected provider record before referencing it, then writes all meal items in one private transaction. Edit mode keeps the same meal ID and creation time, so changing `occurredAt` moves an event between local days without duplicating it.

Photos are handled by a platform adapter under `src/platform/media/`. Selected images are re-encoded as JPEG at quality 0.85 with a 2048px maximum long edge, checked for EXIF, and staged in the cache until confirmation. Confirmation promotes files to the app document sandbox before attaching their media rows. Rollback, cancellation, orphan cleanup, private-data deletion, and the ten-second meal-deletion Undo window coordinate database and file ownership explicitly. Location is manual text only; there is no GPS, geocoding, location permission, upload, or inference in this candidate.

## Navigation boundary

The root stack owns hidden utility routes such as the composer, barcode scanner, event detail, and deletion Undo. Today, Journal, Friends, and Me live in nested tab stacks. Mutation routes prevent native/header removal while a write is active and unwind to an existing destination instead of creating duplicate tab or detail routes.

## AI boundary

AI interprets ambiguous inputs and proposes structured data. Deterministic software validates, resolves trusted nutrition records, converts units, performs arithmetic, and persists confirmed results.

## Server boundary

Every server dependency must justify itself. Private food tracking, history, common-food search, and supported on-device intelligence should remain local where practical.

USDA online access is the narrow exception. The app calls the read-only Cloudflare Worker at `https://api.meatnutrition.app`; only the Worker receives the secret `USDA_FDC_API_KEY`. The key must never be bundled in the app, placed in an `EXPO_PUBLIC_` value, or committed. The Worker's custom domain, rate limit, response validation, and cache policy are versioned under `services/usda-proxy/`.

## EAS builds

No EAS build may be initiated without explicit approval for that specific build. CI may typecheck, lint, test, verify deterministic assets, check Expo dependencies, test the Worker, and create a local Expo iOS JavaScript export. CI must not sign, upload, submit, or start an EAS build.
