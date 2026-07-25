#!/usr/bin/env python3
"""Compare Fuel build artifacts without modifying either artifact tree."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, Iterable


SCHEMA_VERSION = 1
BINDING_SUFFIXES = {".rs", ".ts"}
MAX_JSON_CHANGES = 250
IDENTITY_NAME_RE = re.compile(
    r"(?:^|[-_.])(?:contract[-_]?id|predicate[-_]?root|"
    r"bytecode[-_]?root|root|id)(?:[-_.]|$)"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare Fuel ABI, bytecode, storage, ID/root, and binding artifacts."
    )
    parser.add_argument("old", help="Old artifact file or directory.")
    parser.add_argument("new", help="New artifact file or directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON.")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_identity_name(path: Path) -> bool:
    return bool(IDENTITY_NAME_RE.search(path.name.lower()))


def artifact_kind(path: Path) -> str:
    name = path.name.lower()
    if path.suffix == ".bin":
        return "bytecode"
    if path.suffix == ".json":
        if "abi" in name:
            return "abi"
        if "storage" in name or "slot" in name:
            return "storage"
        if "config" in name:
            return "configurables"
        if is_identity_name(path):
            return "identity"
        return "json"
    if path.suffix in BINDING_SUFFIXES or name.endswith(".d.ts"):
        return "binding"
    if is_identity_name(path):
        return "identity"
    return "other"


def collect(path: Path) -> tuple[Path, dict[str, Path]]:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"path does not exist: {resolved}")
    if resolved.is_file():
        return resolved.parent, {resolved.name: resolved}

    files = {
        item.relative_to(resolved).as_posix(): item
        for item in sorted(resolved.rglob("*"))
        if item.is_file()
        and (
            item.suffix in {".bin", ".json", ".rs", ".ts"}
            or item.name.endswith(".d.ts")
            or is_identity_name(item)
        )
    }
    return resolved, files


def json_value(path: Path) -> tuple[Any | None, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, str(exc)


def join_json_path(parent: str, part: str | int) -> str:
    if isinstance(part, int):
        return f"{parent}[{part}]" if parent else f"[{part}]"
    return f"{parent}.{part}" if parent else part


def json_changes(old: Any, new: Any, path: str = "") -> Iterable[dict[str, Any]]:
    if type(old) is not type(new):
        yield {
            "path": path or "$",
            "change": "type",
            "old": type(old).__name__,
            "new": type(new).__name__,
        }
        return
    if isinstance(old, dict):
        old_keys = set(old)
        new_keys = set(new)
        for key in sorted(old_keys - new_keys):
            yield {"path": join_json_path(path, key), "change": "removed"}
        for key in sorted(new_keys - old_keys):
            yield {"path": join_json_path(path, key), "change": "added"}
        for key in sorted(old_keys & new_keys):
            yield from json_changes(old[key], new[key], join_json_path(path, key))
        return
    if isinstance(old, list):
        common = min(len(old), len(new))
        for index in range(common):
            yield from json_changes(old[index], new[index], join_json_path(path, index))
        for index in range(common, len(old)):
            yield {"path": join_json_path(path, index), "change": "removed"}
        for index in range(common, len(new)):
            yield {"path": join_json_path(path, index), "change": "added"}
        return
    if old != new:
        yield {"path": path or "$", "change": "value", "old": old, "new": new}


def file_metadata(path: Path) -> dict[str, Any]:
    return {
        "kind": artifact_kind(path),
        "size": path.stat().st_size,
        "sha256": sha256(path),
    }


def compare(old_path: Path, new_path: Path) -> dict[str, Any]:
    old_root, old_files = collect(old_path)
    new_root, new_files = collect(new_path)
    old_names = set(old_files)
    new_names = set(new_files)
    changed: list[dict[str, Any]] = []

    for name in sorted(old_names & new_names):
        old_meta = file_metadata(old_files[name])
        new_meta = file_metadata(new_files[name])
        if old_meta["sha256"] == new_meta["sha256"]:
            continue
        item: dict[str, Any] = {
            "path": name,
            "kind": old_meta["kind"],
            "old": old_meta,
            "new": new_meta,
        }
        if old_files[name].suffix == ".json" and new_files[name].suffix == ".json":
            old_json, old_error = json_value(old_files[name])
            new_json, new_error = json_value(new_files[name])
            if old_error or new_error:
                item["json_error"] = {"old": old_error, "new": new_error}
            else:
                changes = list(json_changes(old_json, new_json))
                item["json_changes"] = changes[:MAX_JSON_CHANGES]
                item["json_changes_truncated"] = len(changes) > MAX_JSON_CHANGES
        changed.append(item)

    added = [
        {"path": name, **file_metadata(new_files[name])}
        for name in sorted(new_names - old_names)
    ]
    removed = [
        {"path": name, **file_metadata(old_files[name])}
        for name in sorted(old_names - new_names)
    ]
    unchanged = len(old_names & new_names) - len(changed)

    return {
        "schema_version": SCHEMA_VERSION,
        "old_root": str(old_root),
        "new_root": str(new_root),
        "summary": {
            "added": len(added),
            "removed": len(removed),
            "changed": len(changed),
            "unchanged": unchanged,
        },
        "added": added,
        "removed": removed,
        "changed": changed,
        "different": bool(added or removed or changed),
    }


def render_text(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "Fuel artifact diff",
        f"Old: {report['old_root']}",
        f"New: {report['new_root']}",
        (
            f"Summary: {summary['added']} added, {summary['removed']} removed, "
            f"{summary['changed']} changed, {summary['unchanged']} unchanged"
        ),
    ]
    if report["added"]:
        lines.append("\nAdded:")
        lines.extend(f"- {item['path']} ({item['kind']})" for item in report["added"])
    if report["removed"]:
        lines.append("\nRemoved:")
        lines.extend(f"- {item['path']} ({item['kind']})" for item in report["removed"])
    if report["changed"]:
        lines.append("\nChanged:")
        for item in report["changed"]:
            detail = (
                f"{item['old']['size']} -> {item['new']['size']} bytes"
                if item["kind"] == "bytecode"
                else item["kind"]
            )
            lines.append(f"- {item['path']}: {detail}")
            for change in item.get("json_changes", [])[:20]:
                lines.append(f"  - {change['change']}: {change['path']}")
            if len(item.get("json_changes", [])) > 20:
                lines.append("  - additional JSON changes omitted from text output")
    if not report["different"]:
        lines.append("No artifact differences.")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        report = compare(Path(args.old), Path(args.new))
    except (FileNotFoundError, OSError, ValueError) as exc:
        print(f"diff-fuel-artifacts: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render_text(report))
    return 1 if report["different"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
