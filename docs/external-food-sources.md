# External food-source policy

Network lookup is a long-tail fallback, not the primary logging path.

Resolution order:
1. personal history/recent foods (later ranking layer);
2. on-device USDA-derived corpus;
3. provider-specific free/open network source;
4. OCR/manual/community creation;
5. AI estimate only as an explicit low-confidence fallback.

## USDA FoodData Central

Preferred network provider. FoodData Central data is CC0. API use requires a free data.gov API key, which must never be committed to the repository. USDA requests can be normalized and cached without introducing share-alike database licensing.

## Open Food Facts

Optional provider primarily for user-driven barcode misses. The API is free/open but the database is ODbL and its contents use the Database Contents License. MEAT must:
- identify itself with a custom User-Agent;
- respect endpoint rate limits;
- attribute Open Food Facts where required;
- keep OFF-derived cached records in the provider-specific `external_food_cache` rather than combining them into the USDA-derived `food_corpus`;
- review ODbL/share-alike obligations before any bulk import, combined database, or redistribution strategy.

Product images are a separate licensing surface and are not part of this MVP integration.

## Reliability

External-provider errors, rate limits, and outages are non-fatal. Resolution falls through to the next provider or returns no network match so manual/OCR flows can continue. Successful barcode results are cached with provenance and freshness to reduce repeated calls.

## Cost rule

Ordinary free-core logging must not depend on a paid per-query food API unless product economics are explicitly revisited and approved.
