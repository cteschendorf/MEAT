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

## AI boundary

AI interprets ambiguous inputs and proposes structured data. Deterministic software validates, resolves trusted nutrition records, converts units, performs arithmetic, and persists confirmed results.

## Server boundary

Every server dependency must justify itself. Private food tracking, history, common-food search, and supported on-device intelligence should remain local where practical.

## EAS builds

No EAS build may be initiated without explicit approval for that specific build. CI must not contain an automatic EAS build step.
