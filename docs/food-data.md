# Food data strategy

MEAT uses a hybrid food-data model: a substantial on-device corpus for common foods and free/open network sources for the long tail.

## Canonical local corpus: USDA FoodData Central

USDA FoodData Central data is CC0 and is therefore suitable for normalization into MEAT's own on-device database. Build-time ingestion should use the current Foundation Foods, FNDDS, SR Legacy, and a deliberately selected subset of Branded Foods.

Selection priorities:
1. Foundation/FNDDS common foods with strong nutrient completeness.
2. SR Legacy foods when they fill useful gaps.
3. Branded products selected by popularity/high-value categories and barcode utility rather than shipping the multi-gigabyte full branded database.

Every normalized food retains its FDC ID and USDA provenance. All trustworthy available nutrients are retained even when the UI only displays the five MVP metrics.

## Search corpus

The app stores compact canonical JSON plus searchable name/brand/GTIN fields. SQLite FTS5 provides offline prefix search. Ranking combines text relevance with a build-time popularity score. Personal recency/frequency will be layered ahead of corpus ranking in THI-268.

## Distribution and updates

The generated corpus is a build artifact, not hand-maintained application source. The pipeline should produce:
- a versioned SQLite seed database or import bundle;
- manifest containing source release dates, record counts, compressed/uncompressed size, and checksum;
- a reproducible selection policy;
- future delta/update support without changing private user records.

App-size budgets must be measured before final corpus size is frozen. The pipeline should allow tiered builds (core/common versus broader branded coverage) so search quality can be tested against binary size.

## External sources

Do not merge Open Food Facts records into the USDA-derived corpus. Open Food Facts is ODbL/share-alike and should remain behind a provider-specific external-source/cache boundary. This avoids unintentionally imposing share-alike obligations on MEAT's combined food database.
