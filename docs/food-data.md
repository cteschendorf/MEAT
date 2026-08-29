# Food data strategy

MEAT uses a hybrid model: a substantial on-device USDA corpus plus free/open network sources for the long tail.

USDA FoodData Central is the canonical local source because its data is CC0. Build-time ingestion should use current Foundation Foods and FNDDS, SR Legacy to fill useful gaps, and a selected high-value subset of Branded Foods rather than shipping the multi-gigabyte full branded set. Every normalized record keeps FDC provenance and all trustworthy available nutrients.

SQLite FTS5 supplies offline prefix search over name/brand with indexed GTIN lookup. Ranking combines text relevance and a build-time popularity score; personal recency/frequency is layered above this later.

The corpus is a generated build artifact with a version manifest, source release dates, record count, size/checksum and reproducible selection policy. The final app-size budget should be selected empirically by testing search quality against core versus broader corpus tiers.

Open Food Facts records must not be merged into this USDA-derived corpus because OFF uses ODbL/share-alike. OFF belongs behind a segregated external-provider/cache boundary.
