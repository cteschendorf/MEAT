# MEAT USDA proxy

This Cloudflare Worker keeps the FoodData Central API key off devices and exposes a small, read-only, versioned API for MEAT.

## API

- `GET /v1/health`
- `GET /v1/usda/search?q=greek%20yogurt&limit=25`
- `GET /v1/usda/foods/:fdcId`

Search text is normalized but is neither echoed in API responses nor written to logs. Workers Logs and invocation URL logging are explicitly disabled in `wrangler.toml`; client-facing responses are also `private, no-store`. The Worker's internal Cache API still retains searches for 15 minutes and details for 24 hours using hashed cache keys. Responses retain the USDA FDC ID, data type, CC0 provenance, all returned nutrients, and available portions.

The API allows cross-origin read requests without credentials (`Access-Control-Allow-Origin: *`) so it works for Expo native clients and optional web development. Only `GET` and `OPTIONS` are accepted.

## Local checks

```sh
npm install
npm run check
npm run dev
```

The Worker expects a secret binding named `USDA_FDC_API_KEY`. Before a future deployment, set it from this directory with `npx wrangler secret put USDA_FDC_API_KEY`; never place the value in `wrangler.toml` or source control.

`wrangler.toml` configures the custom domain `api.meatnutrition.app` and a Cloudflare rate-limit binding of 30 requests per 60 seconds. Its `namespace_id` must remain a positive integer unique within the target Cloudflare account. The code also has an isolated in-memory fallback for local use and tests.

No deployment or secret provisioning is performed by this package.
