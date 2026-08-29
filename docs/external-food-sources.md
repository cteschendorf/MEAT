# External food-source policy

Resolution order: personal/local first, then free/open network providers, then OCR/manual creation, with AI estimate only as an explicit low-confidence fallback.

USDA FoodData Central is the preferred network source. Its data is CC0; API access uses a free data.gov key that must stay out of source control.

Open Food Facts is an optional user-driven barcode fallback. Its database is ODbL, so MEAT keeps OFF-derived cache entries in the provider-specific `external_food_cache`, not in the combined USDA corpus. The app must identify itself with a custom User-Agent, respect rate limits, provide required attribution, and revisit ODbL obligations before any bulk import or redistribution. Product images are outside this MVP integration.

External outages/rate limits are non-fatal. The resolver falls through and lets manual/OCR logging continue. Ordinary free-core logging must not depend on a paid per-query food API without an explicit future product decision.
