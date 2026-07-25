import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "resolve_fuel_versions.py"
SPEC = importlib.util.spec_from_file_location("resolve_fuel_versions", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ResolveFuelVersionsTests(unittest.TestCase):
    @staticmethod
    def fake_fetch(url: str, timeout: float) -> bytes:
        del timeout
        if "channel-fuel-mainnet.toml" in url:
            return (
                b'date = "2026-07-01"\n'
                b'[pkg.forc]\nversion = "0.70.2"\n'
                b'[pkg.fuel-core]\nversion = "0.47.1"\n'
            )
        if "channel-fuel-testnet.toml" in url:
            return (
                b'date = "2026-07-02"\n'
                b'[pkg.forc]\nversion = "0.71.2"\n'
                b'[pkg.fuel-core]\nversion = "0.48.0"\n'
            )
        if url.endswith("/src/constants.rs"):
            return (
                b"const CHANNEL_MAINNET_FILE_NAME: &str = \"mainnet\";\n"
                b"const CHANNEL_LATEST_FILE_NAME: &str = "
                b"CHANNEL_MAINNET_FILE_NAME;\n"
            )
        if url.endswith("/FuelLabs/forc/releases?per_page=100"):
            return (
                b'[{"tag_name":"forc-client-0.70.2","draft":false,'
                b'"prerelease":false,"published_at":"2026-06-01"},'
                b'{"tag_name":"forc-node-0.70.1","draft":false,'
                b'"prerelease":false},{"tag_name":"forc-crypto-0.70.0",'
                b'"draft":false,"prerelease":false},{"tag_name":'
                b'"forc-wallet-0.16.0","draft":false,"prerelease":false}]'
            )
        if "/releases/latest" in url:
            repository = url.split("/repos/", 1)[1].split("/releases/", 1)[0]
            tag = "v1.2.3"
            return (
                '{"tag_name":"%s","published_at":"2026-07-03",'
                '"html_url":"https://example.test/%s"}' % (tag, repository)
            ).encode()
        raise AssertionError(f"unexpected URL: {url}")

    @patch.object(MODULE, "fetch", side_effect=fake_fetch.__func__)
    def test_resolves_channels_alias_releases_and_plugins(self, _fetch) -> None:
        report, errors = MODULE.resolve(["mainnet", "testnet"], 1)

        self.assertEqual(errors, [])
        self.assertEqual(report["channels"]["mainnet"]["components"]["forc"], "0.70.2")
        self.assertEqual(report["latest_alias"]["target"], "mainnet")
        self.assertEqual(report["releases"]["sway"]["tag"], "v1.2.3")
        self.assertEqual(
            report["forc_plugins"]["forc-client"]["tag"],
            "forc-client-0.70.2",
        )

    @patch.object(
        MODULE,
        "fetch",
        side_effect=MODULE.ResolutionError("endpoint unavailable"),
    )
    def test_collects_visible_endpoint_errors(self, _fetch) -> None:
        report, errors = MODULE.resolve(["mainnet"], 1)

        self.assertGreater(len(errors), 1)
        self.assertEqual(report["channels"], {})
        self.assertEqual(report["errors"], errors)

    def test_version_key_ignores_non_semver_tags(self) -> None:
        self.assertEqual(MODULE.version_key("forc-node-0.70.1", "forc-node-"), (0, 70, 1))
        self.assertEqual(MODULE.version_key("forc-node-next", "forc-node-"), ())


if __name__ == "__main__":
    unittest.main()
