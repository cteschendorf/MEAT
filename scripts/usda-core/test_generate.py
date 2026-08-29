import hashlib
import importlib.util
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parent / "generate.py"
SPEC = importlib.util.spec_from_file_location("meat_usda_core_generate", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load USDA core generator")
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


class UsdaCoreGeneratorTests(unittest.TestCase):
    def test_fixture_build_is_byte_deterministic_and_searchable(self):
        with tempfile.TemporaryDirectory() as temporary:
            first = Path(temporary) / "first"
            second = Path(temporary) / "second"
            first_manifest = generator.build(first, fixture=True)
            second_manifest = generator.build(second, fixture=True)

            first_database = first / generator.DATABASE_FILENAME
            second_database = second / generator.DATABASE_FILENAME
            self.assertEqual(first_database.read_bytes(), second_database.read_bytes())
            self.assertEqual(
                (first / generator.MANIFEST_FILENAME).read_bytes(),
                (second / generator.MANIFEST_FILENAME).read_bytes(),
            )
            self.assertEqual(first_manifest, second_manifest)
            self.assertEqual(first_manifest["record_counts_by_dataset"], {
                "foundation": 1,
                "fndds-2021-2023": 1,
                "sr-legacy": 1,
            })
            self.assertEqual(first_manifest["record_counts"]["foods"], 3)
            self.assertEqual(
                first_manifest["sqlite"]["sha256"],
                hashlib.sha256(first_database.read_bytes()).hexdigest(),
            )

            connection = sqlite3.connect("file:%s?mode=ro" % first_database, uri=True)
            try:
                self.assertEqual(
                    connection.execute("PRAGMA application_id").fetchone()[0],
                    generator.SQLITE_APPLICATION_ID,
                )
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertEqual(
                    connection.execute(
                        "SELECT description FROM foods_fts WHERE foods_fts MATCH 'apple*'"
                    ).fetchone()[0],
                    "Fixture apple, raw",
                )
                self.assertEqual(
                    connection.execute("SELECT count(*) FROM foods WHERE data_type = 'Branded'").fetchone()[0],
                    0,
                )
                self.assertEqual(
                    connection.execute("SELECT min(gram_weight) FROM portions").fetchone()[0] > 0,
                    True,
                )
                self.assertEqual(
                    {
                        row[0]
                        for row in connection.execute("SELECT DISTINCT nutrient_code FROM nutrient_values")
                    },
                    {rule.code for rule in generator.NUTRIENT_RULES},
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT amount_per_100g FROM nutrient_values "
                        "WHERE fdc_id = 900000001 AND nutrient_code = 'energy-kcal'"
                    ).fetchone(),
                    (52.0,),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT amount, gram_weight, measure_unit, description FROM portions "
                        "WHERE fdc_id = 900000001"
                    ).fetchone(),
                    (1.0, 182.0, "large", "1 large apple"),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT amount_per_100g FROM nutrient_values "
                        "WHERE fdc_id = 900000003 AND nutrient_code = 'carbohydrate-g'"
                    ).fetchone(),
                    (0.0,),
                )
            finally:
                connection.close()

    def test_empty_source_is_rejected_and_rolled_back(self):
        source = generator.SourceSpec(
            dataset_id="fixture-empty",
            label="Empty",
            release="2000-01-01",
            url="fixture://empty",
            filename="empty.json",
            sha256="",
            archive_member="",
            root_key="Foods",
            data_type="Foundation",
            minimum_records=1,
        )
        connection = sqlite3.connect(":memory:")
        try:
            generator.initialize_database(connection, fixture=True)
            connection.commit()
            with self.assertRaisesRegex(generator.BuildError, "Refusing to produce an empty"):
                generator.import_source(
                    connection,
                    source,
                    io.StringIO('{"Foods":[]}'),
                    "0" * 64,
                    "fixture://empty",
                    1,
                )
            self.assertEqual(connection.execute("SELECT count(*) FROM foods").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT count(*) FROM source_releases").fetchone()[0], 0)
        finally:
            connection.close()

    def test_bad_shape_and_checksum_are_rejected(self):
        with self.assertRaisesRegex(generator.BuildError, "Unexpected JSON root key"):
            list(generator.StreamingJsonArray(io.StringIO('{"Wrong":[]}'), "Foods"))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "input.zip"
            path.write_bytes(b"changed")
            with self.assertRaisesRegex(generator.BuildError, "SHA256 mismatch"):
                generator.verify_checksum(path, "0" * 64)

    def test_release_set_is_pinned_to_official_non_branded_sources(self):
        self.assertEqual(
            [source.dataset_id for source in generator.OFFICIAL_SOURCES],
            ["foundation", "fndds-2021-2023", "sr-legacy"],
        )
        for source in generator.OFFICIAL_SOURCES:
            generator.validate_official_url(source.url)
            self.assertEqual(len(source.sha256), 64)
            self.assertNotIn("branded", source.dataset_id.casefold())


if __name__ == "__main__":
    unittest.main()
