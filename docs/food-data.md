# Food data strategy

MEAT uses a hybrid model: a substantial on-device USDA corpus, private personal foods, and independent network providers for the long tail. A food's identity always includes its source. Records with similar names, barcodes, or FDC IDs remain separate and are never silently merged.

## Offline USDA core

The app bundles `assets/usda/meat-usda-core.sqlite` as a query-only SQLite database. It contains only CC0 USDA FoodData Central releases:

- Foundation Foods, published April 30, 2026;
- FNDDS 2021–2023, published October 31, 2024;
- SR Legacy, published April 2018.

Branded Foods are intentionally excluded. The pinned asset contains 13,588 foods: 363 Foundation, 5,432 FNDDS, and 7,793 SR Legacy records. It also contains 67,067 nutrient values, 37,025 portions, and one FTS5 row per food. FTS5 provides deterministic offline description search; the core provider does not claim barcode capability.

The database is a generated artifact, not a hand-maintained source file. `assets/usda/manifest.json` records the official download URLs, input hashes, release metadata, schema version, record counts, database size, and output SHA-256. `npm run quality:usda` exercises the fixture generator tests and verifies the shipped database against that manifest. `npm run usda:rebuild` is the deliberate networked rebuild path; it must never silently replace a failed or empty download with fabricated data.

## Provider identity and storage

Each provider returns a stable source-scoped reference in the form `sourceId:encodeURIComponent(recordId)`, such as `usda-core:321358`, `usda-fdc:321358`, or `open-food-facts:3017620422003`. Source prefixes are part of identity even when two providers describe the same food.

Food data is divided across four stores:

1. Private foods and tracking data in `meat.db`.
2. The bundled query-only USDA database, `meat-usda-core.sqlite`.
3. USDA online responses in `usda-fdc-cache.db`.
4. Open Food Facts responses in `open-food-facts-cache.db`.

The two network caches retain expired entries so an adapter can return a clearly marked stale result when the network fails. Cached responses never turn into a cross-provider master database.

## Licensing boundary

USDA FoodData Central data is CC0. Open Food Facts data is ODbL/share-alike, so OFF-derived search and product responses remain in the dedicated OFF cache with source provenance. They are not copied into the USDA asset or merged with USDA records. Any future bulk import or redistribution requires a fresh licensing review.
