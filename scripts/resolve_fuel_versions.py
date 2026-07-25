#!/usr/bin/env python3
"""Resolve current Fuel channel and release versions from primary endpoints."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import sys
import tomllib
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SCHEMA_VERSION = 1
USER_AGENT = "codex-fuel-network-skills/1"
MANIFEST_URL = (
    "https://raw.githubusercontent.com/FuelLabs/fuelup/gh-pages/"
    "channel-fuel-{channel}.toml"
)
FUELUP_CONSTANTS_URL = (
    "https://raw.githubusercontent.com/FuelLabs/fuelup/{ref}/src/constants.rs"
)
LATEST_RELEASE_REPOSITORIES = {
    "sway": "FuelLabs/sway",
    "fuelup": "FuelLabs/fuelup",
    "fuel-core": "FuelLabs/fuel-core",
    "fuels-rs": "FuelLabs/fuels-rs",
    "fuels-ts": "FuelLabs/fuels-ts",
    "sway-libs": "FuelLabs/sway-libs",
}
FORC_RELEASE_PREFIXES = {
    "forc-client": "forc-client-",
    "forc-node": "forc-node-",
    "forc-crypto": "forc-crypto-",
    "forc-wallet": "forc-wallet-",
}


class ResolutionError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resolve named Fuelup channels and current upstream releases."
    )
    parser.add_argument(
        "--channel",
        action="append",
        choices=("mainnet", "testnet"),
        help="Named channel to resolve; repeat as needed (default: both).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="Per-request timeout in seconds (default: 15).",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON.")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Return success when some primary endpoints fail.",
    )
    return parser.parse_args()


def fetch(url: str, timeout: float) -> bytes:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT}
    token = os.environ.get("GITHUB_TOKEN")
    if token and "api.github.com" in url:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read()
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise ResolutionError(f"{url}: {exc}") from exc


def parse_json_bytes(payload: bytes, url: str) -> Any:
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ResolutionError(f"{url}: invalid JSON: {exc}") from exc


def resolve_manifest(channel: str, timeout: float) -> dict[str, Any]:
    url = MANIFEST_URL.format(channel=channel)
    payload = fetch(url, timeout)
    try:
        manifest = tomllib.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        raise ResolutionError(f"{url}: invalid TOML: {exc}") from exc
    packages = manifest.get("pkg", {})
    components = {
        name: value.get("version")
        for name, value in packages.items()
        if isinstance(value, dict) and isinstance(value.get("version"), str)
    }
    return {
        "url": url,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "date": manifest.get("date"),
        "components": dict(sorted(components.items())),
    }


def resolve_latest_release(name: str, repository: str, timeout: float) -> dict[str, Any]:
    url = f"https://api.github.com/repos/{repository}/releases/latest"
    payload = parse_json_bytes(fetch(url, timeout), url)
    if not isinstance(payload, dict) or not payload.get("tag_name"):
        raise ResolutionError(f"{url}: missing tag_name")
    return {
        "repository": repository,
        "tag": payload["tag_name"],
        "published_at": payload.get("published_at"),
        "url": payload.get("html_url") or url,
    }


def version_key(tag: str, prefix: str) -> tuple[int, ...]:
    value = tag.removeprefix(prefix).lstrip("v")
    match = re.match(r"(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        return ()
    return tuple(int(part) for part in match.groups())


def resolve_forc_releases(timeout: float) -> dict[str, Any]:
    url = "https://api.github.com/repos/FuelLabs/forc/releases?per_page=100"
    payload = parse_json_bytes(fetch(url, timeout), url)
    if not isinstance(payload, list):
        raise ResolutionError(f"{url}: expected release list")
    resolved: dict[str, Any] = {}
    for name, prefix in FORC_RELEASE_PREFIXES.items():
        candidates = [
            item
            for item in payload
            if isinstance(item, dict)
            and isinstance(item.get("tag_name"), str)
            and item["tag_name"].startswith(prefix)
            and not item.get("draft")
            and not item.get("prerelease")
            and version_key(item["tag_name"], prefix)
        ]
        if not candidates:
            raise ResolutionError(f"{url}: no release found for prefix {prefix}")
        item = max(candidates, key=lambda value: version_key(value["tag_name"], prefix))
        resolved[name] = {
            "repository": "FuelLabs/forc",
            "tag": item["tag_name"],
            "published_at": item.get("published_at"),
            "url": item.get("html_url"),
        }
    return resolved


def resolve_latest_alias(timeout: float, ref: str = "master") -> dict[str, Any]:
    url = FUELUP_CONSTANTS_URL.format(ref=ref)
    payload = fetch(url, timeout)
    source = payload.decode("utf-8", errors="replace")
    match = re.search(
        r"CHANNEL_LATEST_FILE_NAME\s*:\s*&str\s*=\s*"
        r"CHANNEL_(MAINNET|TESTNET)_FILE_NAME",
        source,
    )
    return {
        "url": url,
        "ref": ref,
        "evidence": "default-branch" if ref == "master" else "release-tag",
        "target": match.group(1).lower() if match else "unknown",
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def resolve(channels: list[str], timeout: float) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    report: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "channels": {},
        "latest_alias": {},
        "releases": {},
        "forc_plugins": {},
    }

    for channel in channels:
        try:
            report["channels"][channel] = resolve_manifest(channel, timeout)
        except ResolutionError as exc:
            errors.append(str(exc))

    for name, repository in LATEST_RELEASE_REPOSITORIES.items():
        try:
            report["releases"][name] = resolve_latest_release(name, repository, timeout)
        except ResolutionError as exc:
            errors.append(str(exc))

    fuelup_tag = report["releases"].get("fuelup", {}).get("tag")
    try:
        report["latest_alias"] = resolve_latest_alias(timeout, fuelup_tag or "master")
    except ResolutionError as exc:
        if fuelup_tag:
            try:
                report["latest_alias"] = resolve_latest_alias(timeout, "master")
            except ResolutionError as fallback_exc:
                errors.append(str(exc))
                errors.append(str(fallback_exc))
        else:
            errors.append(str(exc))

    try:
        report["forc_plugins"] = resolve_forc_releases(timeout)
    except ResolutionError as exc:
        errors.append(str(exc))

    report["errors"] = errors
    report["warnings"] = [
        "Named network channels and newest upstream releases are separate baselines.",
        "Do not infer compatibility by making component version numbers equal.",
    ]
    if report["latest_alias"].get("evidence") == "default-branch":
        report["warnings"].append(
            "Latest-alias semantics were read from the fuelup default branch, "
            "not a released tag; treat as unreleased evidence."
        )
    return report, errors


def render_text(report: dict[str, Any]) -> str:
    lines = [f"Fuel version resolution ({report['fetched_at']})", ""]
    lines.append("Named channels:")
    for name, channel in sorted(report["channels"].items()):
        components = ", ".join(
            f"{component}={version}"
            for component, version in channel["components"].items()
        )
        lines.append(f"- {name} ({channel.get('date')}): {components}")
    if not report["channels"]:
        lines.append("- none resolved")

    alias = report.get("latest_alias", {})
    alias_evidence = alias.get("evidence")
    alias_line = f"Fuelup latest alias: {alias.get('target', 'unknown')}"
    if alias_evidence:
        alias_line += f" ({alias_evidence}: {alias.get('ref')})"
    lines.extend(("", alias_line, ""))
    lines.append("Latest upstream releases:")
    for name, release in sorted(report["releases"].items()):
        lines.append(f"- {name}: {release['tag']}")
    for name, release in sorted(report["forc_plugins"].items()):
        lines.append(f"- {name}: {release['tag']}")

    if report["errors"]:
        lines.extend(("", "Errors:"))
        lines.extend(f"- {error}" for error in report["errors"])
    lines.extend(("", "Warnings:"))
    lines.extend(f"- {warning}" for warning in report["warnings"])
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    channels = sorted(set(args.channel or ["mainnet", "testnet"]))
    report, errors = resolve(channels, args.timeout)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render_text(report))
    if errors and not args.allow_partial:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
