# Local persistence

MEAT private tracking is local-first and uses Expo SQLite.

## Rules

- Database initialization enables WAL mode and foreign keys.
- Schema changes are applied through ordered migrations recorded in `schema_migrations`.
- Migrations must preserve user data; destructive reset is not a migration strategy.
- UI code depends on repository contracts rather than SQLite directly.
- Normal private food tracking must function without Supabase or network access.
- Multi-record writes that must remain consistent use SQLite transactions.
- Export and deletion hooks are part of the persistence contract from the beginning.

## Current schema

The initial private tracking schema stores canonical JSON payloads for foods, meals, recipes, and goals, with indexed meal timestamps. Later food-corpus/search work may introduce normalized/index tables optimized for lookup without requiring the private canonical records to mirror a future server schema.

## Security

All user-controlled values must be bound through SQLite parameters. `execAsync` is reserved for static migration/maintenance SQL and must not interpolate user data.
