#!/usr/bin/env python3
"""Inspect a local Fuel/Sway project without modifying it or using the network."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib
from typing import Any


SCHEMA_VERSION = 1
SKIP_DIRS = {
    ".git",
    ".idea",
    ".next",
    ".turbo",
    ".vscode",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
    "target",
}
LOCK_NAMES = {
    "Cargo.lock",
    "Forc.lock",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}
ARTIFACT_SUFFIXES = {
    ".bin",
    ".json",
    ".ts",
    ".d.ts",
    ".rs",
}
PROGRAM_RE = re.compile(r"^\s*(contract|script|predicate|library)\s*;", re.MULTILINE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect Fuel/Sway pins, programs, SDKs, tools, and artifacts."
    )
    parser.add_argument(
        "--path",
        default=".",
        help="Project path to inspect (default: current directory).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit deterministic JSON instead of the human-readable report.",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=6,
        help="Maximum directory depth to inspect (default: 6).",
    )
    return parser.parse_args()


def load_toml(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle), None
    except (OSError, tomllib.TOMLDecodeError) as exc:
        return None, str(exc)


def load_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, str(exc)
    if not isinstance(value, dict):
        return None, "expected a JSON object"
    return value, None


def detect_root(start: Path) -> Path:
    start = start.expanduser().resolve()
    if start.is_file():
        start = start.parent
    if not start.exists():
        raise FileNotFoundError(f"path does not exist: {start}")

    candidates: list[Path] = []
    current = start
    while True:
        if any(
            (current / marker).exists()
            for marker in ("fuel-toolchain.toml", "Forc.toml", "Cargo.toml", "package.json")
        ):
            candidates.append(current)
        if (current / ".git").exists() or current.parent == current:
            break
        current = current.parent
    return candidates[-1] if candidates else start


def walk_files(root: Path, max_depth: int) -> list[Path]:
    files: list[Path] = []
    for current, dirs, names in os.walk(root):
        current_path = Path(current)
        depth = len(current_path.relative_to(root).parts)
        dirs[:] = sorted(
            directory
            for directory in dirs
            if directory not in SKIP_DIRS and depth < max_depth
        )
        for name in sorted(names):
            files.append(current_path / name)
    return files


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def first_program_kind(package_dir: Path, manifest: dict[str, Any]) -> tuple[str, str | None]:
    project = manifest.get("project", {})
    entry = project.get("entry") if isinstance(project, dict) else None
    candidates = []
    if isinstance(entry, str):
        candidates.extend((package_dir / entry, package_dir / "src" / entry))
    candidates.extend((package_dir / "src" / "main.sw", package_dir / "src" / "lib.sw"))

    seen: set[Path] = set()
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        try:
            source = candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        match = PROGRAM_RE.search(source)
        if match:
            return match.group(1), str(candidate)
    return "unknown", None


def inspect_forc_manifest(path: Path, root: Path) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    data, error = load_toml(path)
    result: dict[str, Any] = {"path": relative(path, root)}
    if error or data is None:
        result["error"] = error
        warnings.append(f"Unable to parse {result['path']}: {error}")
        return result, warnings

    project = data.get("project")
    workspace = data.get("workspace")
    if isinstance(project, dict):
        kind, entry_path = first_program_kind(path.parent, data)
        result.update(
            {
                "type": "package",
                "name": project.get("name"),
                "program_kind": kind,
                "entry_path": (
                    relative(Path(entry_path), root) if entry_path is not None else None
                ),
                "forc_version": project.get("forc-version"),
                "implicit_std": project.get("implicit-std", True),
                "experimental": project.get("experimental", {}),
                "dependencies": sorted((data.get("dependencies") or {}).keys()),
                "contract_dependencies": sorted(
                    (data.get("contract-dependencies") or {}).keys()
                ),
            }
        )
        if kind == "unknown":
            warnings.append(f"Could not determine program kind for {result['path']}")
    elif isinstance(workspace, dict):
        result.update(
            {
                "type": "workspace",
                "members": workspace.get("members", []),
            }
        )
    else:
        result["type"] = "unknown"
        warnings.append(f"{result['path']} has neither [project] nor [workspace]")
    return result, warnings


def command_info(command: str, args: list[str], timeout: int = 8) -> dict[str, Any]:
    executable = shutil.which(command)
    if executable is None:
        return {"available": False}
    try:
        proc = subprocess.run(
            [executable, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"available": True, "path": executable, "error": str(exc)}

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()
    result: dict[str, Any] = {
        "available": True,
        "path": executable,
        "exit_code": proc.returncode,
    }
    if stdout:
        result["output"] = stdout
    if stderr:
        result["stderr"] = stderr
    return result


def inspect_toolchain(path: Path, root: Path) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    data, error = load_toml(path)
    result: dict[str, Any] = {"path": relative(path, root)}
    if error or data is None:
        result["error"] = error
        warnings.append(f"Unable to parse {result['path']}: {error}")
        return result, warnings

    toolchain = data.get("toolchain", {})
    components = data.get("components", {})
    channel = toolchain.get("channel") if isinstance(toolchain, dict) else None
    result.update(
        {
            "channel": channel,
            "components": dict(sorted(components.items()))
            if isinstance(components, dict)
            else {},
        }
    )
    if channel == "latest":
        warnings.append(
            "Fuelup `latest` is a network alias, not the newest upstream Sway release"
        )
    if isinstance(channel, str) and channel.startswith("nightly"):
        warnings.append("Nightly toolchain selected; treat behavior as experimental")
    return result, warnings


def inspect_forc_lock(path: Path) -> dict[str, Any]:
    data, error = load_toml(path)
    if error or data is None:
        return {"error": error}
    packages: dict[str, dict[str, str]] = {}
    for package in data.get("package", []):
        if not isinstance(package, dict):
            continue
        name = package.get("name")
        if not isinstance(name, str):
            continue
        entry = {
            key: value
            for key, value in package.items()
            if key in ("version", "source") and isinstance(value, str)
        }
        packages[name] = entry
    return {"packages": len(packages), "dependencies": dict(sorted(packages.items()))}


def extract_semver(text: str) -> str | None:
    match = re.search(r"(\d+\.\d+\.\d+)", text)
    return match.group(1) if match else None


def component_pin_warnings(
    toolchain_files: list[dict[str, Any]], tools: dict[str, Any]
) -> list[str]:
    tool_keys = {"forc": "forc", "fuel-core": "fuel_core"}
    warnings: list[str] = []
    for toolchain in toolchain_files:
        components = toolchain.get("components", {})
        if not isinstance(components, dict):
            continue
        for component, pinned in sorted(components.items()):
            if not isinstance(pinned, str):
                continue
            info = tools.get(tool_keys.get(component, ""), {})
            if not info.get("available"):
                continue
            installed = extract_semver(info.get("output") or info.get("stderr") or "")
            if installed and extract_semver(pinned) and installed != extract_semver(pinned):
                warnings.append(
                    f"{toolchain['path']}: pins {component} {pinned} but installed "
                    f"{component} reports {installed}"
                )
    return warnings


def inspect_cargo_lock(path: Path) -> dict[str, str]:
    data, _ = load_toml(path)
    versions: dict[str, str] = {}
    if not data:
        return versions
    for package in data.get("package", []):
        if not isinstance(package, dict):
            continue
        name = package.get("name")
        version = package.get("version")
        if isinstance(name, str) and isinstance(version, str):
            if name == "fuels" or name.startswith("fuels-"):
                versions[name] = version
    return dict(sorted(versions.items()))


def inspect_package_json(path: Path) -> dict[str, str]:
    data, _ = load_json(path)
    versions: dict[str, str] = {}
    if not data:
        return versions
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        dependencies = data.get(section, {})
        if not isinstance(dependencies, dict):
            continue
        for name, version in dependencies.items():
            if name == "fuels" or name.startswith("@fuel-ts/"):
                versions[name] = str(version)
    return dict(sorted(versions.items()))


def is_artifact(path: Path) -> bool:
    if "out" in path.parts:
        return path.suffix in ARTIFACT_SUFFIXES or path.name.endswith(".d.ts")
    directory_markers = {part.lower() for part in path.parts[:-1]}
    return (
        bool(directory_markers & {"generated", "typegen", "typegend"})
        and (path.suffix in {".ts", ".rs"} or path.name.endswith(".d.ts"))
    )


def inspect(root: Path, max_depth: int) -> dict[str, Any]:
    files = walk_files(root, max_depth)
    warnings: list[str] = []

    forc_manifests = []
    for path in files:
        if path.name == "Forc.toml":
            manifest, manifest_warnings = inspect_forc_manifest(path, root)
            forc_manifests.append(manifest)
            warnings.extend(manifest_warnings)

    toolchain_files = []
    for path in files:
        if path.name == "fuel-toolchain.toml":
            toolchain, toolchain_warnings = inspect_toolchain(path, root)
            toolchain_files.append(toolchain)
            warnings.extend(toolchain_warnings)

    locks = sorted(relative(path, root) for path in files if path.name in LOCK_NAMES)
    if forc_manifests and not any(Path(lock).name == "Forc.lock" for lock in locks):
        warnings.append("Forc project found without a committed/discovered Forc.lock")
    if forc_manifests and not toolchain_files:
        warnings.append("Forc project found without fuel-toolchain.toml")

    forc_locks: dict[str, dict[str, Any]] = {}
    for path in files:
        if path.name == "Forc.lock":
            forc_locks[relative(path, root)] = inspect_forc_lock(path)

    rust_sdks: dict[str, dict[str, str]] = {}
    ts_sdks: dict[str, dict[str, str]] = {}
    for path in files:
        if path.name == "Cargo.lock":
            versions = inspect_cargo_lock(path)
            if versions:
                rust_sdks[relative(path, root)] = versions
        elif path.name == "package.json":
            versions = inspect_package_json(path)
            if versions:
                ts_sdks[relative(path, root)] = versions

    tools = {
        "fuelup": command_info("fuelup", ["--version"]),
        "fuelup_show": command_info("fuelup", ["show"]),
        "forc": command_info("forc", ["--version"]),
        "fuel_core": command_info("fuel-core", ["--version"]),
        "rustc": command_info("rustc", ["--version"]),
        "node": command_info("node", ["--version"]),
    }
    for required in ("fuelup", "forc"):
        if forc_manifests and not tools[required].get("available"):
            warnings.append(f"Required tool not found on PATH: {required}")
    warnings.extend(component_pin_warnings(toolchain_files, tools))

    artifacts = sorted(relative(path, root) for path in files if is_artifact(path))

    return {
        "schema_version": SCHEMA_VERSION,
        "root": str(root),
        "network_used": False,
        "toolchain_files": sorted(toolchain_files, key=lambda value: value["path"]),
        "forc_manifests": sorted(forc_manifests, key=lambda value: value["path"]),
        "forc_locks": dict(sorted(forc_locks.items())),
        "locks": locks,
        "sdk_versions": {
            "rust": dict(sorted(rust_sdks.items())),
            "typescript": dict(sorted(ts_sdks.items())),
        },
        "tools": tools,
        "artifacts": artifacts,
        "warnings": sorted(set(warnings)),
    }


def render_text(report: dict[str, Any]) -> str:
    lines = [
        f"Fuel preflight: {report['root']}",
        "Network used: no",
        "",
        "Toolchains:",
    ]
    if report["toolchain_files"]:
        for item in report["toolchain_files"]:
            lines.append(
                f"- {item['path']}: channel={item.get('channel')!r}, "
                f"components={len(item.get('components', {}))}"
            )
    else:
        lines.append("- none")

    lines.extend(("", "Sway packages:"))
    if report["forc_manifests"]:
        for item in report["forc_manifests"]:
            if item.get("type") == "package":
                lines.append(
                    f"- {item['path']}: {item.get('name') or '?'} "
                    f"({item.get('program_kind', 'unknown')})"
                )
            else:
                lines.append(f"- {item['path']}: {item.get('type', 'unknown')}")
    else:
        lines.append("- none")

    lines.extend(("", "Installed tools:"))
    for name, info in report["tools"].items():
        if not info.get("available"):
            lines.append(f"- {name}: unavailable")
        else:
            output = info.get("output") or info.get("stderr") or "available"
            first_line = output.splitlines()[0]
            lines.append(f"- {name}: {first_line}")

    if report.get("forc_locks"):
        lines.extend(("", "Forc locks:"))
        for path, item in report["forc_locks"].items():
            detail = (
                f"{item['packages']} packages"
                if "packages" in item
                else f"error: {item.get('error')}"
            )
            lines.append(f"- {path}: {detail}")

    lines.extend(
        (
            "",
            f"Locks: {len(report['locks'])}",
            f"Artifacts: {len(report['artifacts'])}",
            "",
            "Warnings:",
        )
    )
    lines.extend(f"- {warning}" for warning in report["warnings"])
    if not report["warnings"]:
        lines.append("- none")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        root = detect_root(Path(args.path))
        report = inspect(root, args.max_depth)
    except (FileNotFoundError, ValueError, OSError) as exc:
        print(f"fuel-preflight: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render_text(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
