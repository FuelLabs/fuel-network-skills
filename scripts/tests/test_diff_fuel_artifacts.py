import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "diff_fuel_artifacts.py"
SPEC = importlib.util.spec_from_file_location("diff_fuel_artifacts", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DiffFuelArtifactsTests(unittest.TestCase):
    def test_reports_binary_and_structural_abi_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "old"
            new = root / "new"
            old.mkdir()
            new.mkdir()
            (old / "counter.bin").write_bytes(b"\x00\x01")
            (new / "counter.bin").write_bytes(b"\x00\x02\x03")
            (old / "counter-abi.json").write_text(
                json.dumps({"functions": [{"name": "get"}]}),
                encoding="utf-8",
            )
            (new / "counter-abi.json").write_text(
                json.dumps({"functions": [{"name": "get"}, {"name": "set"}]}),
                encoding="utf-8",
            )
            (old / "provider-notes.txt").write_text("ignored", encoding="utf-8")
            (new / "provider-notes.txt").write_text("changed", encoding="utf-8")
            (old / "counter-contract-id.txt").write_text("0x01", encoding="utf-8")
            (new / "counter-contract-id.txt").write_text("0x02", encoding="utf-8")

            report = MODULE.compare(old, new)

            self.assertTrue(report["different"])
            self.assertEqual(report["summary"]["changed"], 3)
            abi = next(item for item in report["changed"] if item["kind"] == "abi")
            self.assertEqual(
                abi["json_changes"],
                [{"path": "functions[1]", "change": "added"}],
            )
            self.assertFalse(
                any(item["path"] == "provider-notes.txt" for item in report["changed"])
            )

    def test_cli_exit_codes_distinguish_equal_changed_and_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "old"
            new = root / "new"
            old.mkdir()
            new.mkdir()
            (old / "artifact.bin").write_bytes(b"same")
            (new / "artifact.bin").write_bytes(b"same")

            equal = subprocess.run(
                [sys.executable, str(SCRIPT), str(old), str(new), "--json"],
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(equal.returncode, 0)
            self.assertFalse(json.loads(equal.stdout)["different"])

            (new / "artifact.bin").write_bytes(b"different")
            changed = subprocess.run(
                [sys.executable, str(SCRIPT), str(old), str(new), "--json"],
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(changed.returncode, 1)
            self.assertTrue(json.loads(changed.stdout)["different"])

            missing = subprocess.run(
                [sys.executable, str(SCRIPT), str(old), str(root / "missing")],
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(missing.returncode, 2)


if __name__ == "__main__":
    unittest.main()
