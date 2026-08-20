import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "validate_repository.py"
SPEC = importlib.util.spec_from_file_location("validate_repository", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

REPOSITORY = SCRIPT.resolve().parents[1]
WORKED_EXAMPLES = Path("references") / "worked-examples.md"
PREDICATE_SOURCE = MODULE.PREDICATE_FIXTURE / "predicate" / "src" / "main.sw"


class ValidatePredicateFixtureTests(unittest.TestCase):
    @staticmethod
    def stage(directory: str) -> Path:
        """Copies just the files the fixture check reads into a temp root."""
        root = Path(directory)
        for relative in (WORKED_EXAMPLES, *(
            MODULE.PREDICATE_FIXTURE / item for item in MODULE.PREDICATE_FIXTURE_FILES
        )):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPOSITORY / relative, destination)
        return root

    def test_accepts_a_fixture_matching_the_documented_block(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = self.stage(directory)
            MODULE.validate_predicate_fixture(root)

    def test_rejects_a_fixture_that_drifted_from_the_documented_block(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = self.stage(directory)
            source = root / PREDICATE_SOURCE
            source.write_bytes(source.read_bytes() + b"\n// drifted\n")

            with self.assertRaises(MODULE.ValidationError) as caught:
                MODULE.validate_predicate_fixture(root)
            self.assertIn("no longer matches", str(caught.exception))

    def test_rejects_a_missing_fixture_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = self.stage(directory)
            (root / MODULE.PREDICATE_FIXTURE / "encoding-test" / "Forc.lock").unlink()

            with self.assertRaises(MODULE.ValidationError) as caught:
                MODULE.validate_predicate_fixture(root)
            self.assertIn("encoding-test/Forc.lock", str(caught.exception))


class ExtractSwayBlockTests(unittest.TestCase):
    def test_returns_the_first_block_of_the_named_section(self) -> None:
        markdown = (
            "## Predicates\n\n```sway\nother();\n```\n\n"
            "## Transaction-binding predicate (signed order)\n\n"
            "Intro.\n\n```sway\npredicate;\n```\n\n"
            "## Next\n\n```sway\nlater();\n```\n"
        )
        self.assertEqual(
            MODULE.extract_sway_block(markdown, MODULE.PREDICATE_HEADING),
            "predicate;\n",
        )

    def test_rejects_a_missing_section_and_an_unclosed_block(self) -> None:
        with self.assertRaises(MODULE.ValidationError):
            MODULE.extract_sway_block("# Worked examples\n", MODULE.PREDICATE_HEADING)
        with self.assertRaises(MODULE.ValidationError):
            MODULE.extract_sway_block(
                f"{MODULE.PREDICATE_HEADING}\n\n```sway\npredicate;\n",
                MODULE.PREDICATE_HEADING,
            )


if __name__ == "__main__":
    unittest.main()
