# Canonical domain model

MEAT's domain layer is framework-independent. It must not import React Native, Expo, Supabase, Apple frameworks, or persistence implementation details.

## Core rules

- Stable branded identifiers are used for persisted entities.
- The domain schema has an explicit version and future changes require migrations.
- Missing nutrient data is `unknown`; it is never silently converted to zero.
- All trustworthy available micronutrients can be retained even when the MVP UI only emphasizes calories, protein, carbohydrates, fat, and fiber.
- Nutrition values can carry source/provenance and confidence metadata.
- Food, meal, recipe, goals, history, media, social visibility, and user preferences are separate domain concepts.
- Local persistence records and future sync DTOs may map to these concepts but must not become the domain model itself.

## Nutrient representation

Nutrients use extensible string codes and units so USDA and other sources can retain data not anticipated by the initial UI. The five MVP metrics have canonical codes:

- `energy-kcal`
- `protein-g`
- `carbohydrate-g`
- `fat-g`
- `fiber-g`

A `NutrientValue` has a state of `known`, `unknown`, or `estimated`. Values and provenance are optional only when the state permits it; deterministic validation in the nutrition engine will enforce stronger runtime invariants later.

## Schema evolution

`DOMAIN_SCHEMA_VERSION` begins at 1. Persistence work must use explicit migrations. User data must not be discarded merely because the schema changes.

## Portability

Platform integrations belong behind adapters. These contracts intentionally contain no Apple-only types so future Android, web, and cloud-premium implementations remain possible.
