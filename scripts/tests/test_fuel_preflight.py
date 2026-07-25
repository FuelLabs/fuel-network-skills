import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "fuel_preflight.py"


class FuelPreflightTests(unittest.TestCase):
    def run_preflight(
        self, root: Path, env: dict[str, str] | None = None
    ) -> tuple[int, dict]:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--path", str(root), "--json"],
            capture_output=True,
            check=False,
            text=True,
            env=env,
        )
        self.assertEqual(proc.stderr, "")
        return proc.returncode, json.loads(proc.stdout)

    def test_detects_contract_toolchain_and_sdk_pins(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src").mkdir()
            (root / "src" / "main.sw").write_text(
                "contract;\n\nabi Counter { fn value() -> u64; }\n",
                encoding="utf-8",
            )
            (root / "Forc.toml").write_text(
                '[project]\nauthors = ["Codex"]\nentry = "main.sw"\n'
                'license = "Apache-2.0"\nname = "counter"\n',
                encoding="utf-8",
            )
            (root / "Forc.lock").write_text("", encoding="utf-8")
            (root / "fuel-toolchain.toml").write_text(
                '[toolchain]\nchannel = "latest"\n\n'
                '[components]\nforc = "0.70.2"\nfuel-core = "0.47.1"\n',
                encoding="utf-8",
            )
            (root / "package.json").write_text(
                '{"dependencies":{"fuels":"0.103.0"}}',
                encoding="utf-8",
            )
            (root / "package-lock.json").write_text("{}", encoding="utf-8")
            (root / "Cargo.lock").write_text(
                'version = 3\n\n[[package]]\nname = "fuels"\nversion = "0.77.0"\n',
                encoding="utf-8",
            )
            (root / "abi-typegen").mkdir()
            (root / "abi-typegen" / "config.ts").write_text(
                "export default {};",
                encoding="utf-8",
            )
            (root / "src" / "generated").mkdir()
            (root / "src" / "generated" / "Counter.ts").write_text(
                "export class Counter {}",
                encoding="utf-8",
            )

            code, report = self.run_preflight(root)

            self.assertEqual(code, 0)
            self.assertEqual(report["root"], str(root))
            self.assertEqual(report["toolchain_files"][0]["channel"], "latest")
            self.assertEqual(report["forc_manifests"][0]["program_kind"], "contract")
            self.assertEqual(
                report["sdk_versions"]["typescript"]["package.json"]["fuels"],
                "0.103.0",
            )
            self.assertEqual(
                report["sdk_versions"]["rust"]["Cargo.lock"]["fuels"],
                "0.77.0",
            )
            self.assertIn(
                "Fuelup `latest` is a network alias, not the newest upstream Sway release",
                report["warnings"],
            )
            self.assertEqual(report["artifacts"], ["src/generated/Counter.ts"])

    def test_parses_forc_lock_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Forc.toml").write_text(
                '[project]\nentry = "main.sw"\nname = "counter"\n'
                'license = "Apache-2.0"\nauthors = ["team"]\n',
                encoding="utf-8",
            )
            (root / "Forc.lock").write_text(
                '[[package]]\nname = "counter"\n'
                'source = "member"\ndependencies = ["std"]\n\n'
                '[[package]]\nname = "std"\n'
                'source = "path+from-root-ABCDEF"\n',
                encoding="utf-8",
            )

            code, report = self.run_preflight(root)

            self.assertEqual(code, 0)
            lock = report["forc_locks"]["Forc.lock"]
            self.assertEqual(lock["packages"], 2)
            self.assertEqual(
                lock["dependencies"]["std"]["source"], "path+from-root-ABCDEF"
            )

    def test_warns_on_component_pin_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bin_dir = root / "fakebin"
            bin_dir.mkdir()
            fake_forc = bin_dir / "forc"
            fake_forc.write_text("#!/bin/sh\necho 'forc 0.60.0'\n", encoding="utf-8")
            fake_forc.chmod(0o755)

            project = root / "project"
            (project / "src").mkdir(parents=True)
            (project / "src" / "main.sw").write_text("contract;\n", encoding="utf-8")
            (project / "Forc.toml").write_text(
                '[project]\nentry = "main.sw"\nname = "counter"\n'
                'license = "Apache-2.0"\nauthors = ["team"]\n',
                encoding="utf-8",
            )
            (project / "Forc.lock").write_text("", encoding="utf-8")
            (project / "fuel-toolchain.toml").write_text(
                '[toolchain]\nchannel = "testnet"\n\n'
                '[components]\nforc = "0.70.2"\n',
                encoding="utf-8",
            )

            env = dict(os.environ)
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
            code, report = self.run_preflight(project, env=env)

            self.assertEqual(code, 0)
            self.assertIn(
                "fuel-toolchain.toml: pins forc 0.70.2 but installed forc "
                "reports 0.60.0",
                report["warnings"],
            )

    def test_reports_invalid_manifest_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Forc.toml").write_text("[project\n", encoding="utf-8")

            code, report = self.run_preflight(root)

            self.assertEqual(code, 0)
            self.assertIn("error", report["forc_manifests"][0])
            self.assertTrue(report["warnings"])


if __name__ == "__main__":
    unittest.main()
