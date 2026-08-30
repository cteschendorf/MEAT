# Reproducible USDA core corpus

This pipeline creates MEAT's slim, offline USDA FoodData Central SQLite asset. It accepts only these pinned official JSON archives:

| Dataset | Release | Official archive | Pinned SHA256 |
| --- | --- | --- | --- |
| Foundation Foods | April 30, 2026 | `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip` | `186e988ec542e913f51ef62b86a47758e8cdd0d1dc3889e7b055581f3c09c77a` |
| FNDDS 2021–2023 | October 31, 2024 | `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip` | `dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb` |
| SR Legacy | April 2018 | `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip` | `0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef` |

The release list and download links come from USDA's [FoodData Central downloadable-data page](https://fdc.nal.usda.gov/download-datasets/). Branded Foods are intentionally excluded.

## Build the release asset

Run from the repository root:

```sh
python3 scripts/usda-core/generate.py
```

The generator downloads into the operating system's temporary directory, verifies every complete archive against its pinned SHA256, validates the ZIP member and JSON shape, and atomically writes only these tracked outputs:

- `assets/usda/meat-usda-core.sqlite`
- `assets/usda/manifest.json`

Use a separate reusable cache when desired:

```sh
python3 scripts/usda-core/generate.py --cache-dir /tmp/meat-usda-core-cache
python3 scripts/usda-core/generate.py --cache-dir /tmp/meat-usda-core-cache --offline
```

If an official file is unavailable, truncated, changed in place, or has an unexpected schema, generation fails. Fixture data are never substituted into the release asset.

## Contents

Schema version 1 contains:

- `source_releases`: release labels, official URLs, input SHA256 hashes, and source record counts;
- `foods`: USDA source, dataset, FDC ID, description, data type, publication date, and pinned release;
- `nutrient_values`: calories, protein, carbohydrate, fat, and fiber per 100 g, preserving the USDA nutrient ID/name/unit;
- `portions`: positive USDA gram weights and their amount, unit, modifier, description, and source ordering;
- `foods_fts`: deterministic FTS5 prefix search over food descriptions;
- `metadata`: schema/generator versions, license, fixture flag, and the explicit Branded exclusion.

Missing USDA nutrient values remain absent rather than being converted to zero. Official negative analytical macro values are also omitted as unusable nutrition quantities, never clamped, and their count is recorded in the manifest's `validation_events`. Portions retain a positive official gram weight when present, while nonpositive portion count/amount fields become unknown and are counted rather than fabricated. The official Foundation April 2026 array's explicit `null` placeholders are likewise counted and skipped; other primitive record shapes fail validation. For calories, nutrient ID 1008 is preferred, followed by Foundation Foods' Atwater IDs 2047 and 2048. The manifest records source and output hashes, byte size, and counts by dataset. It intentionally has no generation timestamp, allowing identical inputs and the same SQLite implementation to produce byte-identical outputs.

## Fixture and tests

The tiny fixture mode exercises all three dataset shapes without accessing the network and refuses to write into `assets/usda`:

```sh
python3 scripts/usda-core/generate.py --fixture --output-dir /tmp/meat-usda-core-fixture
python3 -m unittest discover -s scripts/usda-core -p 'test_*.py'
```

Fixture output is test-only. Never ship it.

## Updating a release

Update a pinned source only after USDA publishes it on the downloadable-data page. Review the schema and release notes, download from `fdc.nal.usda.gov`, independently calculate the complete archive SHA256, update the source specification and fixture coverage, and rerun the deterministic and full builds. A checksum mismatch must be investigated; do not simply accept a new hash.
