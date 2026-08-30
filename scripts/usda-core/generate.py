#!/usr/bin/env python3
"""Build MEAT's deterministic, offline USDA core-food SQLite asset.

Only pinned, official FoodData Central JSON downloads are accepted in full mode.
The checked-in fixtures exercise the importer but are never a fallback for a
failed or changed USDA download.
"""

import argparse
import contextlib
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from typing import Dict, Iterator, List, Mapping, Optional, Sequence, TextIO, Tuple
import urllib.parse
import urllib.request
import zipfile


SCHEMA_VERSION = 1
GENERATOR_VERSION = "1.0.0"
DATABASE_FILENAME = "meat-usda-core.sqlite"
MANIFEST_FILENAME = "manifest.json"
OFFICIAL_SOURCE = "USDA FoodData Central"
USER_AGENT = "MEAT USDA core builder/1.0 (https://meatnutrition.app)"
SQLITE_APPLICATION_ID = 0x4D454154  # ASCII "MEAT"


class BuildError(RuntimeError):
    """Raised when an input or generated asset fails validation."""


@dataclass(frozen=True)
class SourceSpec:
    dataset_id: str
    label: str
    release: str
    url: str
    filename: str
    sha256: str
    archive_member: str
    root_key: str
    data_type: str
    minimum_records: int


OFFICIAL_SOURCES: Tuple[SourceSpec, ...] = (
    SourceSpec(
        dataset_id="foundation",
        label="Foundation Foods",
        release="2026-04-30",
        url="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip",
        filename="FoodData_Central_foundation_food_json_2026-04-30.zip",
        sha256="186e988ec542e913f51ef62b86a47758e8cdd0d1dc3889e7b055581f3c09c77a",
        archive_member="FoodData_Central_foundation_food_json_2026-04-30.json",
        root_key="FoundationFoods",
        data_type="Foundation",
        minimum_records=300,
    ),
    SourceSpec(
        dataset_id="fndds-2021-2023",
        label="FNDDS 2021-2023",
        release="2024-10-31",
        url="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
        filename="FoodData_Central_survey_food_json_2024-10-31.zip",
        sha256="dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb",
        archive_member="surveyDownload.json",
        root_key="SurveyFoods",
        data_type="Survey (FNDDS)",
        minimum_records=5000,
    ),
    SourceSpec(
        dataset_id="sr-legacy",
        label="SR Legacy",
        release="2018-04",
        url="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
        filename="FoodData_Central_sr_legacy_food_json_2018-04.zip",
        sha256="0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef",
        archive_member="FoodData_Central_sr_legacy_food_json_2018-04.json",
        root_key="SRLegacyFoods",
        data_type="SR Legacy",
        minimum_records=7000,
    ),
)


@dataclass(frozen=True)
class NutrientRule:
    code: str
    accepted_ids: Tuple[int, ...]
    unit: str


# These are the five nutrients currently displayed and aggregated by MEAT.
# Foundation Foods can report more than one calorie calculation. Prefer the
# general FoodData Central Energy nutrient, then the two Atwater variants.
NUTRIENT_RULES: Tuple[NutrientRule, ...] = (
    NutrientRule("energy-kcal", (1008, 2047, 2048), "kcal"),
    NutrientRule("protein-g", (1003,), "g"),
    NutrientRule("carbohydrate-g", (1005,), "g"),
    NutrientRule("fat-g", (1004,), "g"),
    NutrientRule("fiber-g", (1079,), "g"),
)

NUTRIENT_BY_ID: Dict[int, Tuple[NutrientRule, int]] = {
    nutrient_id: (rule, priority)
    for rule in NUTRIENT_RULES
    for priority, nutrient_id in enumerate(rule.accepted_ids)
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_official_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "fdc.nal.usda.gov":
        raise BuildError("Official USDA inputs must use HTTPS on fdc.nal.usda.gov: %s" % url)


def verify_checksum(path: Path, expected: str) -> str:
    actual = sha256_file(path)
    if actual != expected:
        raise BuildError(
            "SHA256 mismatch for %s: expected %s, got %s. "
            "Do not use this input; remove the cached file only after checking the pinned USDA release."
            % (path, expected, actual)
        )
    return actual


def download_source(spec: SourceSpec, cache_dir: Path, offline: bool) -> Path:
    validate_official_url(spec.url)
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / spec.filename
    if target.exists():
        verify_checksum(target, spec.sha256)
        return target
    if offline:
        raise BuildError("Pinned USDA input is not cached and --offline was set: %s" % target)

    request = urllib.request.Request(spec.url, headers={"User-Agent": USER_AGENT})
    partial = cache_dir / (spec.filename + ".partial-%d" % os.getpid())
    try:
        with contextlib.closing(urllib.request.urlopen(request, timeout=120)) as response:
            if response.geturl() and urllib.parse.urlparse(response.geturl()).hostname != "fdc.nal.usda.gov":
                raise BuildError("USDA download redirected off the official host: %s" % response.geturl())
            with partial.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        if partial.stat().st_size == 0:
            raise BuildError("USDA returned an empty download for %s" % spec.url)
        verify_checksum(partial, spec.sha256)
        os.replace(str(partial), str(target))
    finally:
        if partial.exists():
            partial.unlink()
    return target


class StreamingJsonArray:
    """Incrementally decode a single top-level JSON array without extra packages."""

    CHUNK_SIZE = 1024 * 1024
    MAX_ITEM_CHARS = 32 * 1024 * 1024

    def __init__(self, stream: TextIO, root_key: str) -> None:
        self.stream = stream
        self.root_key = root_key
        self.buffer = ""
        self.position = 0
        self.eof = False
        self.decoder = json.JSONDecoder()

    def _compact(self) -> None:
        if self.position > self.CHUNK_SIZE:
            self.buffer = self.buffer[self.position :]
            self.position = 0

    def _read_more(self) -> bool:
        if self.eof:
            return False
        self._compact()
        chunk = self.stream.read(self.CHUNK_SIZE)
        if chunk == "":
            self.eof = True
            return False
        self.buffer += chunk
        return True

    def _skip_whitespace(self) -> None:
        while True:
            while self.position < len(self.buffer) and self.buffer[self.position].isspace():
                self.position += 1
            if self.position < len(self.buffer) or not self._read_more():
                return

    def _peek(self) -> Optional[str]:
        self._skip_whitespace()
        if self.position >= len(self.buffer) and not self._read_more():
            return None
        self._skip_whitespace()
        return self.buffer[self.position] if self.position < len(self.buffer) else None

    def _expect(self, expected: str) -> None:
        actual = self._peek()
        if actual != expected:
            raise BuildError("Malformed JSON: expected %r, got %r" % (expected, actual))
        self.position += 1

    def _decode(self):
        self._skip_whitespace()
        start = self.position
        while True:
            try:
                value, end = self.decoder.raw_decode(self.buffer, self.position)
                self.position = end
                return value
            except json.JSONDecodeError as error:
                if len(self.buffer) - start > self.MAX_ITEM_CHARS:
                    raise BuildError("JSON item exceeds the %d-character safety limit" % self.MAX_ITEM_CHARS)
                if not self._read_more():
                    raise BuildError("Malformed or truncated JSON near character %d: %s" % (start, error))

    def __iter__(self) -> Iterator[Optional[Mapping[str, object]]]:
        self._expect("{")
        key = self._decode()
        if key != self.root_key:
            raise BuildError("Unexpected JSON root key: expected %r, got %r" % (self.root_key, key))
        self._expect(":")
        self._expect("[")

        first = True
        while True:
            marker = self._peek()
            if marker == "]":
                self.position += 1
                break
            if not first:
                self._expect(",")
                if self._peek() == "]":
                    raise BuildError("Malformed JSON: trailing comma in source array")
            value = self._decode()
            if value is not None and not isinstance(value, dict):
                raise BuildError("Every source-array item must be a JSON object or an explicit null placeholder")
            yield value
            first = False

        self._expect("}")
        if self._peek() is not None:
            raise BuildError("Unexpected content after the top-level JSON object")


@contextlib.contextmanager
def open_zip_json(path: Path, spec: SourceSpec) -> Iterator[TextIO]:
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as error:
        raise BuildError("Invalid ZIP archive %s: %s" % (path, error))
    with archive:
        corrupt_member = archive.testzip()
        if corrupt_member:
            raise BuildError("ZIP integrity check failed for member %s in %s" % (corrupt_member, path))
        names = archive.namelist()
        if names != [spec.archive_member]:
            raise BuildError(
                "Unexpected archive members for %s: expected [%r], got %r"
                % (spec.dataset_id, spec.archive_member, names)
            )
        with archive.open(spec.archive_member, "r") as binary:
            with io.TextIOWrapper(binary, encoding="utf-8") as text:
                yield text


@contextlib.contextmanager
def open_fixture_json(path: Path) -> Iterator[TextIO]:
    with path.open("r", encoding="utf-8") as handle:
        yield handle


def require_text(record: Mapping[str, object], key: str, dataset_id: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise BuildError("%s record has invalid %s" % (dataset_id, key))
    return value.strip()


def require_positive_integer(record: Mapping[str, object], key: str, dataset_id: str) -> int:
    value = record.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise BuildError("%s record has invalid %s: %r" % (dataset_id, key, value))
    return value


def optional_text(value: object, field: str, dataset_id: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise BuildError("%s record has non-text %s: %r" % (dataset_id, field, value))
    stripped = value.strip()
    return stripped or None


def finite_number(value: object, field: str, dataset_id: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BuildError("%s record has non-numeric %s: %r" % (dataset_id, field, value))
    number = float(value)
    if not math.isfinite(number):
        raise BuildError("%s record has non-finite %s: %r" % (dataset_id, field, value))
    return number


def select_nutrients(
    record: Mapping[str, object], dataset_id: str
) -> Tuple[List[Tuple[str, int, str, str, float]], int]:
    raw_nutrients = record.get("foodNutrients")
    if not isinstance(raw_nutrients, list):
        raise BuildError("%s record foodNutrients must be an array" % dataset_id)
    selected: Dict[str, Tuple[int, int, str, str, float]] = {}
    negative_values_skipped = 0
    for entry in raw_nutrients:
        if not isinstance(entry, dict):
            raise BuildError("%s foodNutrients item must be an object" % dataset_id)
        nutrient = entry.get("nutrient")
        if not isinstance(nutrient, dict):
            raise BuildError("%s nutrient metadata must be an object" % dataset_id)
        nutrient_id = nutrient.get("id")
        if isinstance(nutrient_id, bool) or not isinstance(nutrient_id, int):
            raise BuildError("%s nutrient has invalid id: %r" % (dataset_id, nutrient_id))
        matched = NUTRIENT_BY_ID.get(nutrient_id)
        if matched is None or entry.get("amount") is None:
            continue
        rule, priority = matched
        amount = finite_number(entry.get("amount"), "nutrient amount", dataset_id)
        if amount < 0:
            # A small number of official analytical records contain negative
            # macro values. They are not usable nutrition quantities. Preserve
            # that fact as a counted validation event; never clamp it to zero.
            negative_values_skipped += 1
            continue
        unit = require_text(nutrient, "unitName", dataset_id)
        if unit.casefold() != rule.unit.casefold():
            raise BuildError(
                "%s nutrient %d expected unit %s, got %s" % (dataset_id, nutrient_id, rule.unit, unit)
            )
        name = require_text(nutrient, "name", dataset_id)
        candidate = (priority, nutrient_id, name, unit, amount)
        previous = selected.get(rule.code)
        if previous is None or candidate[0] < previous[0]:
            selected[rule.code] = candidate
        elif candidate[0] == previous[0] and candidate[4] != previous[4]:
            raise BuildError("%s has conflicting values for nutrient %d" % (dataset_id, nutrient_id))
    return (
        [
            (rule.code, selected[rule.code][1], selected[rule.code][2], selected[rule.code][3], selected[rule.code][4])
            for rule in NUTRIENT_RULES
            if rule.code in selected
        ],
        negative_values_skipped,
    )


def select_portions(
    record: Mapping[str, object], dataset_id: str
) -> Tuple[
    List[Tuple[Optional[int], Optional[int], Optional[float], float, Optional[str], Optional[str], Optional[str]]],
    int,
]:
    raw_portions = record.get("foodPortions", [])
    if raw_portions is None:
        raw_portions = []
    if not isinstance(raw_portions, list):
        raise BuildError("%s record foodPortions must be an array" % dataset_id)
    portions = []
    nonpositive_amounts_omitted = 0
    for entry in raw_portions:
        if not isinstance(entry, dict):
            raise BuildError("%s foodPortions item must be an object" % dataset_id)
        if entry.get("gramWeight") is None:
            continue
        gram_weight = finite_number(entry.get("gramWeight"), "portion gramWeight", dataset_id)
        if gram_weight < 0:
            raise BuildError("%s portion has a negative gramWeight" % dataset_id)
        if gram_weight == 0:
            continue
        source_portion_id = entry.get("id")
        if source_portion_id is not None and (
            isinstance(source_portion_id, bool) or not isinstance(source_portion_id, int)
        ):
            raise BuildError("%s portion has invalid id: %r" % (dataset_id, source_portion_id))
        sequence_number = entry.get("sequenceNumber")
        if sequence_number is not None and (
            isinstance(sequence_number, bool) or not isinstance(sequence_number, int)
        ):
            raise BuildError("%s portion has invalid sequenceNumber: %r" % (dataset_id, sequence_number))
        amount = None
        if entry.get("amount") is not None:
            amount = finite_number(entry.get("amount"), "portion amount", dataset_id)
            if amount <= 0:
                # Retain the official positive gram weight and description,
                # but treat a nonpositive count/amount as unknown rather than
                # inventing a quantity.
                amount = None
                nonpositive_amounts_omitted += 1
        measure_unit = entry.get("measureUnit")
        unit = None
        if measure_unit is not None:
            if not isinstance(measure_unit, dict):
                raise BuildError("%s portion measureUnit must be an object" % dataset_id)
            unit = optional_text(measure_unit.get("abbreviation"), "measureUnit.abbreviation", dataset_id)
            if unit is None:
                unit = optional_text(measure_unit.get("name"), "measureUnit.name", dataset_id)
        modifier = optional_text(entry.get("modifier"), "portion modifier", dataset_id)
        description = optional_text(entry.get("portionDescription"), "portionDescription", dataset_id)
        portions.append((source_portion_id, sequence_number, amount, gram_weight, unit, modifier, description))
    portions.sort(
        key=lambda item: (
            item[1] if item[1] is not None else 2**31,
            item[0] if item[0] is not None else 2**31,
            item[6] or "",
            item[3],
        )
    )
    return portions, nonpositive_amounts_omitted


SCHEMA_SQL = """
PRAGMA page_size = 4096;
PRAGMA auto_vacuum = NONE;
PRAGMA journal_mode = DELETE;
PRAGMA synchronous = OFF;
PRAGMA foreign_keys = ON;
PRAGMA encoding = 'UTF-8';

CREATE TABLE metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE source_releases (
  dataset_id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  release TEXT NOT NULL,
  official_url TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count > 0)
) WITHOUT ROWID;

CREATE TABLE foods (
  fdc_id INTEGER PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL,
  publication_date TEXT,
  release TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES source_releases(dataset_id)
);

CREATE TABLE nutrient_values (
  fdc_id INTEGER NOT NULL,
  nutrient_code TEXT NOT NULL,
  nutrient_id INTEGER NOT NULL,
  nutrient_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  amount_per_100g REAL NOT NULL CHECK (amount_per_100g >= 0),
  PRIMARY KEY (fdc_id, nutrient_code),
  FOREIGN KEY (fdc_id) REFERENCES foods(fdc_id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE portions (
  fdc_id INTEGER NOT NULL,
  portion_index INTEGER NOT NULL CHECK (portion_index > 0),
  source_portion_id INTEGER,
  sequence_number INTEGER,
  amount REAL,
  gram_weight REAL NOT NULL CHECK (gram_weight > 0),
  measure_unit TEXT,
  modifier TEXT,
  description TEXT,
  PRIMARY KEY (fdc_id, portion_index),
  FOREIGN KEY (fdc_id) REFERENCES foods(fdc_id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX foods_dataset_idx ON foods(dataset_id, fdc_id);
CREATE INDEX nutrient_values_code_idx ON nutrient_values(nutrient_code, fdc_id);
CREATE INDEX portions_fdc_id_idx ON portions(fdc_id, portion_index);

CREATE VIRTUAL TABLE foods_fts USING fts5(
  description,
  content='foods',
  content_rowid='fdc_id',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);
"""


def initialize_database(connection: sqlite3.Connection, fixture: bool) -> None:
    connection.executescript(SCHEMA_SQL)
    connection.execute("PRAGMA application_id = %d" % SQLITE_APPLICATION_ID)
    connection.execute("PRAGMA user_version = %d" % SCHEMA_VERSION)
    metadata = (
        ("schema_version", str(SCHEMA_VERSION)),
        ("generator_version", GENERATOR_VERSION),
        ("fixture", "true" if fixture else "false"),
        ("license", "CC0 1.0 Universal"),
        ("excluded_datasets", "Branded"),
    )
    connection.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata)


def import_source(
    connection: sqlite3.Connection,
    spec: SourceSpec,
    json_stream: TextIO,
    input_hash: str,
    source_url: str,
    minimum_records: int,
) -> Mapping[str, int]:
    food_count = 0
    nutrient_count = 0
    portion_count = 0
    negative_nutrient_values_skipped = 0
    null_records_skipped = 0
    nonpositive_portion_amounts_omitted = 0
    connection.execute("BEGIN")
    try:
        # Insert first so the foods foreign key is valid; the final count is
        # updated only after the entire source has been validated.
        connection.execute(
            """INSERT INTO source_releases
               (dataset_id, source, label, release, official_url, input_sha256, record_count)
               VALUES (?, ?, ?, ?, ?, ?, 1)""",
            (spec.dataset_id, OFFICIAL_SOURCE, spec.label, spec.release, source_url, input_hash),
        )
        for record in StreamingJsonArray(json_stream, spec.root_key):
            # The official Foundation April 2026 JSON contains explicit null
            # placeholders at the end of its array. Count and ignore those
            # known non-record values; other primitive shapes remain fatal.
            if record is None:
                null_records_skipped += 1
                continue
            fdc_id = require_positive_integer(record, "fdcId", spec.dataset_id)
            description = require_text(record, "description", spec.dataset_id)
            data_type = require_text(record, "dataType", spec.dataset_id)
            if data_type != spec.data_type:
                raise BuildError(
                    "%s record %d has dataType %r; expected %r"
                    % (spec.dataset_id, fdc_id, data_type, spec.data_type)
                )
            publication_date = optional_text(record.get("publicationDate"), "publicationDate", spec.dataset_id)
            nutrients, record_negative_values_skipped = select_nutrients(record, spec.dataset_id)
            portions, record_nonpositive_portion_amounts = select_portions(record, spec.dataset_id)
            try:
                connection.execute(
                    """INSERT INTO foods
                       (fdc_id, source, dataset_id, description, data_type, publication_date, release)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (fdc_id, OFFICIAL_SOURCE, spec.dataset_id, description, data_type, publication_date, spec.release),
                )
            except sqlite3.IntegrityError as error:
                raise BuildError("Duplicate or invalid fdc_id %d: %s" % (fdc_id, error))
            connection.executemany(
                """INSERT INTO nutrient_values
                   (fdc_id, nutrient_code, nutrient_id, nutrient_name, unit, amount_per_100g)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [(fdc_id,) + nutrient for nutrient in nutrients],
            )
            connection.executemany(
                """INSERT INTO portions
                   (fdc_id, portion_index, source_portion_id, sequence_number, amount, gram_weight,
                    measure_unit, modifier, description)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (fdc_id, index) + portion
                    for index, portion in enumerate(portions, start=1)
                ],
            )
            food_count += 1
            nutrient_count += len(nutrients)
            portion_count += len(portions)
            negative_nutrient_values_skipped += record_negative_values_skipped
            nonpositive_portion_amounts_omitted += record_nonpositive_portion_amounts
        if food_count < minimum_records:
            raise BuildError(
                "%s produced %d records; expected at least %d. Refusing to produce an empty or truncated corpus."
                % (spec.dataset_id, food_count, minimum_records)
            )
        connection.execute(
            "UPDATE source_releases SET record_count = ? WHERE dataset_id = ?",
            (food_count, spec.dataset_id),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return {
        "foods": food_count,
        "nutrient_values": nutrient_count,
        "portions": portion_count,
        "negative_nutrient_values_skipped": negative_nutrient_values_skipped,
        "null_records_skipped": null_records_skipped,
        "nonpositive_portion_amounts_omitted": nonpositive_portion_amounts_omitted,
    }


def validate_database(
    connection: sqlite3.Connection, expected_foods: int, rebuild_fts: bool = True
) -> Mapping[str, int]:
    if rebuild_fts:
        connection.execute("INSERT INTO foods_fts(foods_fts) VALUES ('rebuild')")
    integrity = connection.execute("PRAGMA integrity_check").fetchone()
    if integrity != ("ok",):
        raise BuildError("SQLite integrity_check failed: %r" % (integrity,))
    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    if foreign_keys:
        raise BuildError("SQLite foreign_key_check failed: %r" % (foreign_keys[:5],))
    counts = {
        "foods": connection.execute("SELECT count(*) FROM foods").fetchone()[0],
        "nutrient_values": connection.execute("SELECT count(*) FROM nutrient_values").fetchone()[0],
        "portions": connection.execute("SELECT count(*) FROM portions").fetchone()[0],
        "fts_rows": connection.execute("SELECT count(*) FROM foods_fts").fetchone()[0],
    }
    if counts["foods"] != expected_foods or counts["fts_rows"] != expected_foods:
        raise BuildError("Generated row-count validation failed: %r" % counts)
    if connection.execute("SELECT count(*) FROM foods WHERE data_type = 'Branded'").fetchone()[0] != 0:
        raise BuildError("Branded records are forbidden in the USDA core corpus")
    if counts["nutrient_values"] == 0:
        raise BuildError("Generated corpus contains no MEAT nutrient values")
    return counts


def write_manifest(
    path: Path,
    fixture: bool,
    source_manifests: Sequence[Mapping[str, object]],
    counts: Mapping[str, int],
    database_path: Path,
) -> Mapping[str, object]:
    database_hash = sha256_file(database_path)
    counts_by_dataset = {
        source["dataset_id"]: source["record_count"] for source in source_manifests
    }
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generator_version": GENERATOR_VERSION,
        "fixture": fixture,
        "source": OFFICIAL_SOURCE,
        "license": "CC0 1.0 Universal",
        "excluded_datasets": ["Branded"],
        "nutrient_codes": [rule.code for rule in NUTRIENT_RULES],
        "record_counts_by_dataset": counts_by_dataset,
        "record_counts": dict(counts),
        "validation_events": {
            "negative_nutrient_values_skipped": sum(
                int(source["negative_nutrient_values_skipped"]) for source in source_manifests
            ),
            "null_records_skipped": sum(int(source["null_records_skipped"]) for source in source_manifests),
            "nonpositive_portion_amounts_omitted": sum(
                int(source["nonpositive_portion_amounts_omitted"]) for source in source_manifests
            ),
        },
        "sources": list(source_manifests),
        "sqlite": {
            "filename": DATABASE_FILENAME,
            "bytes": database_path.stat().st_size,
            "sha256": database_hash,
        },
    }
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def build(
    output_dir: Path,
    cache_dir: Optional[Path] = None,
    fixture: bool = False,
    offline: bool = False,
) -> Mapping[str, object]:
    script_dir = Path(__file__).resolve().parent
    output_dir = output_dir.resolve()
    if fixture and output_dir == (script_dir.parents[1] / "assets" / "usda").resolve():
        raise BuildError("Fixture mode may not write to the tracked assets/usda directory")

    if fixture:
        specs = tuple(
            SourceSpec(
                dataset_id=spec.dataset_id,
                label=spec.label,
                release=spec.release,
                url="fixture://%s" % spec.dataset_id,
                filename="%s.json" % spec.dataset_id,
                sha256="",
                archive_member="",
                root_key=spec.root_key,
                data_type=spec.data_type,
                minimum_records=1,
            )
            for spec in OFFICIAL_SOURCES
        )
        inputs = [script_dir / "fixtures" / spec.filename for spec in specs]
    else:
        specs = OFFICIAL_SOURCES
        resolved_cache = (cache_dir or (Path(tempfile.gettempdir()) / "meat-usda-core-cache-v1")).resolve()
        inputs = [download_source(spec, resolved_cache, offline) for spec in specs]

    output_dir.mkdir(parents=True, exist_ok=True)
    build_root = Path(tempfile.mkdtemp(prefix="meat-usda-core-build-"))
    temporary_database = build_root / DATABASE_FILENAME
    temporary_manifest = build_root / MANIFEST_FILENAME
    source_manifests: List[Mapping[str, object]] = []
    expected_foods = 0
    try:
        connection = sqlite3.connect(str(temporary_database))
        try:
            initialize_database(connection, fixture)
            connection.commit()
            for spec, input_path in zip(specs, inputs):
                input_hash = sha256_file(input_path)
                if not fixture:
                    verify_checksum(input_path, spec.sha256)
                opener = open_fixture_json if fixture else (lambda path, current=spec: open_zip_json(path, current))
                with opener(input_path) as stream:
                    imported = import_source(
                        connection,
                        spec,
                        stream,
                        input_hash,
                        spec.url,
                        spec.minimum_records,
                    )
                expected_foods += imported["foods"]
                source_manifests.append(
                    {
                        "dataset_id": spec.dataset_id,
                        "label": spec.label,
                        "release": spec.release,
                        "official_url": spec.url,
                        "input_sha256": input_hash,
                        "record_count": imported["foods"],
                        "nutrient_value_count": imported["nutrient_values"],
                        "portion_count": imported["portions"],
                        "negative_nutrient_values_skipped": imported[
                            "negative_nutrient_values_skipped"
                        ],
                        "null_records_skipped": imported["null_records_skipped"],
                        "nonpositive_portion_amounts_omitted": imported[
                            "nonpositive_portion_amounts_omitted"
                        ],
                    }
                )
            counts = validate_database(connection, expected_foods)
            connection.commit()
            connection.execute("VACUUM")
            connection.commit()
        finally:
            connection.close()

        # Validate the finalized bytes, not just the pre-VACUUM connection.
        final_check = sqlite3.connect("file:%s?mode=ro" % temporary_database, uri=True)
        try:
            counts = validate_database(final_check, expected_foods, rebuild_fts=False)
        finally:
            final_check.close()
        manifest = write_manifest(temporary_manifest, fixture, source_manifests, counts, temporary_database)
        os.replace(str(temporary_database), str(output_dir / DATABASE_FILENAME))
        os.replace(str(temporary_manifest), str(output_dir / MANIFEST_FILENAME))
        return manifest
    except Exception:
        raise
    finally:
        shutil.rmtree(str(build_root), ignore_errors=True)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory (full mode defaults to assets/usda; fixture mode defaults to a temp directory)",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Download cache outside assets (default: the operating-system temp directory)",
    )
    parser.add_argument("--offline", action="store_true", help="Use validated cached downloads; never access the network")
    parser.add_argument("--fixture", action="store_true", help="Build the tiny checked-in test fixture, never the release asset")
    args = parser.parse_args(argv)
    if args.output_dir is None:
        args.output_dir = (
            Path(tempfile.gettempdir()) / "meat-usda-core-fixture"
            if args.fixture
            else repository_root / "assets" / "usda"
        )
    return args


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        manifest = build(args.output_dir, cache_dir=args.cache_dir, fixture=args.fixture, offline=args.offline)
    except (BuildError, OSError, sqlite3.Error, urllib.error.URLError) as error:
        print("USDA core build failed: %s" % error, file=os.sys.stderr)
        return 1
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
