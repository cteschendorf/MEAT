# External food-source policy

Discovery considers enabled sources independently in this order: personal foods, the bundled USDA core, USDA online, and Open Food Facts. Results stay grouped by provider and retain stable source-scoped IDs. MEAT does not merge records or suppress one provider merely because another provider returned a similar food.

## USDA online

The app calls the read-only Cloudflare Worker at `https://api.meatnutrition.app`; it does not call FoodData Central with an embedded API key. The Worker exposes versioned health, search, and food-detail routes and holds the data.gov credential only in the Cloudflare secret `USDA_FDC_API_KEY`. Workers Logs and fetch invocation logging are explicitly disabled so raw `?q=` values are not retained, client responses are `private, no-store`, and only hashed internal cache keys are stored.

For local app testing, `EXPO_PUBLIC_USDA_PROXY_URL` may override the public proxy base URL. It is not a place for a secret. Worker development lives under `services/usda-proxy/`; `npm run quality:proxy` typechecks and tests it without deploying, creating a secret, or changing the custom domain.

USDA online responses are stored only in `usda-fdc-cache.db`. Cached responses retain freshness metadata and may be returned as stale fallback when the network is unavailable.

## Open Food Facts

Open Food Facts is an optional source with its own ODbL cache and attribution boundary. Current plain-text searches submit the query to the legacy `/cgi/search.pl` endpoint. Barcode lookup uses the v3 `/api/v3/product/{barcode}` endpoint. Requests identify the app, respect provider limits, and validate provider responses.

OFF-derived responses live only in `open-food-facts-cache.db`; they are not copied into the USDA corpus or merged with USDA records. Product images and bulk redistribution remain outside this integration.

## Failure behavior

Provider successes, misses, throttles, invalid responses, and network errors remain independent. One source's error must not discard another source's result. Expired cache entries can provide a clearly marked stale fallback.

For barcode discovery, an unknown result is final only after every enabled barcode-capable provider has returned a definite miss. An outage or indeterminate provider response is not equivalent to “product not found.” Manual food creation remains available and carries the scanned barcode forward.
