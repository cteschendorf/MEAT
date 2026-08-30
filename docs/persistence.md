# Local persistence

MEAT is local-first and uses Expo SQLite. Private tracking and provider data are separated by purpose and license.

## Active stores

| Store | Contents | Access model |
| --- | --- | --- |
| `meat.db` | Personal foods, timestamped meal events, optional meal context, private media metadata, goals, recipes, saved meals, preferences, favorites, and known provider references | Private and writable |
| `meat-usda-core.sqlite` | Pinned USDA Foundation/FNDDS/SR Legacy foods, nutrients, portions, and FTS index | Bundled and query-only |
| `usda-fdc-cache.db` | USDA online search/detail responses | Provider-scoped writable cache |
| `open-food-facts-cache.db` | Open Food Facts search/product responses | Provider-scoped writable ODbL cache |

The private database stores the user's own data and source-scoped references such as `usda-core:321358`; it is not a combined provider database. Provider payloads stay in their source asset or cache. Records from different providers are never merged merely because names, barcodes, or upstream IDs match.

## Database rules

- Private database initialization enables WAL mode and foreign keys.
- Schema changes are applied through ordered migrations recorded in `schema_migrations`.
- Migrations preserve user data; destructive reset is not a migration strategy.
- UI code depends on repository contracts rather than SQLite directly.
- Normal private tracking works without Supabase or network access.
- Multi-record writes that must remain consistent use SQLite transactions.
- User-controlled values are always bound through SQLite parameters.
- `execAsync` is reserved for static migration and maintenance SQL.

The bundled USDA core is opened query-only. Provider-cache entries record freshness and retain an expired payload so the discovery layer can use a clearly identified stale result during an outage. A provider cache does not write into `meat.db` except when a user action records a stable provider reference in private history or favorites.

Migration 11 adds the private `media_assets` table. Meal name, notes, manual location, and ordered media references remain optional fields in the existing JSON meal payload, so build-1 meals require no rewrite and continue to deserialize unchanged. Confirming a composed meal writes every food item and its context as one meal-row transaction; provider records are persisted in their own cache before that private write.

## Privacy, export, and secrets

Private export and deletion operate on the user's private store without rewriting provider assets or combining provider caches. Private deletion is coordinated across SQLite, durable photo files, staged photo drafts, in-memory composer sessions, and pending Undo snapshots so deleted data cannot be restored accidentally after a purge. Photos and manual location remain device-local in this milestone and are never sent to food providers or uploaded.

The FoodData Central API secret is never stored in SQLite. It exists only as the Cloudflare Worker secret `USDA_FDC_API_KEY`. The app may contain the public proxy base URL (or a public override), but never the upstream API key.
