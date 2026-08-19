#!/usr/bin/env python3
"""Validate this single-skill repository using only the Python standard library."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from typing import Any


SKILL_NAME = "fuel-network-skills"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"\A---\n(?P<body>.*?)\n---(?:\n|\Z)", re.DOTALL)
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\((?P<target>[^)#]+\.md)(?:#[^)]+)?\)")
QUOTED_YAML_VALUE_RE = re.compile(
    r'^\s{2}(?P<key>[a-z_]+):\s+"(?P<value>.*)"\s*$'
)

PREDICATE_HEADING = "## Transaction-binding predicate"
PREDICATE_FIXTURE = Path("fixtures") / "transaction-binding-predicate"
PREDICATE_FIXTURE_FILES = (
    Path("predicate") / "Forc.toml",
    Path("predicate") / "Forc.lock",
    Path("predicate") / "src" / "main.sw",
    Path("encoding-test") / "Forc.toml",
    Path("encoding-test") / "Forc.lock",
    Path("encoding-test") / "src" / "main.sw",
)


class ValidationError(ValueError):
    """Raised when repository validation fails."""


def parse_frontmatter(skill_markdown: str) -> dict[str, str]:
    match = FRONTMATTER_RE.match(skill_markdown)
    if not match:
        raise ValidationError("SKILL.md must begin with --- delimited frontmatter")

    metadata: dict[str, str] = {}
    for line in match.group("body").splitlines():
        key, separator, value = line.partition(":")
        if not separator or not key or not value.strip():
            raise ValidationError(f"invalid frontmatter line: {line!r}")
        if key in metadata:
            raise ValidationError(f"duplicate frontmatter key: {key}")
        metadata[key] = value.strip()

    if set(metadata) != {"name", "description"}:
        raise ValidationError("frontmatter must contain only name and description")
    return metadata


def parse_interface(openai_yaml: str) -> dict[str, str]:
    lines = openai_yaml.splitlines()
    if not lines or lines[0] != "interface:":
        raise ValidationError("agents/openai.yaml must contain an interface mapping")

    interface: dict[str, str] = {}
    for line in lines[1:]:
        match = QUOTED_YAML_VALUE_RE.match(line)
        if not match:
            raise ValidationError(
                "agents/openai.yaml must use quoted, two-space-indented interface values"
            )
        interface[match.group("key")] = match.group("value")
    return interface


def require_string_list(value: Any, location: str, *, nonempty: bool = False) -> None:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValidationError(f"{location} must be a list of strings")
    if nonempty and not value:
        raise ValidationError(f"{location} must not be empty")


def validate_evals(path: Path) -> None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"invalid evals/evals.json: {error}") from error

    if document.get("skill_name") != SKILL_NAME:
        raise ValidationError(f"evals.skill_name must be {SKILL_NAME!r}")
    cases = document.get("evals")
    if not isinstance(cases, list) or not cases:
        raise ValidationError("evals.evals must be a non-empty list")

    seen_ids: set[int | str] = set()
    for index, case in enumerate(cases):
        location = f"evals[{index}]"
        if not isinstance(case, dict):
            raise ValidationError(f"{location} must be an object")
        case_id = case.get("id")
        if not isinstance(case_id, (int, str)) or isinstance(case_id, bool):
            raise ValidationError(f"{location}.id must be a string or integer")
        if case_id in seen_ids:
            raise ValidationError(f"duplicate eval id: {case_id!r}")
        seen_ids.add(case_id)

        for field in ("prompt", "expected_output"):
            if not isinstance(case.get(field), str) or not case[field].strip():
                raise ValidationError(f"{location}.{field} must be a non-empty string")
        require_string_list(case.get("files"), f"{location}.files")
        require_string_list(
            case.get("expectations"), f"{location}.expectations", nonempty=True
        )


def extract_sway_block(markdown: str, heading: str) -> str:
    lines = markdown.splitlines(keepends=True)
    section = next(
        (index for index, line in enumerate(lines) if line.startswith(heading)), None
    )
    if section is None:
        raise ValidationError(f"references/worked-examples.md has no {heading!r} section")

    for index in range(section + 1, len(lines)):
        if lines[index].startswith("## "):
            break
        if lines[index].rstrip("\n") != "```sway":
            continue
        for end in range(index + 1, len(lines)):
            if lines[end].rstrip("\n") == "```":
                return "".join(lines[index + 1 : end])
        raise ValidationError(f"the sway block under {heading!r} is never closed")

    raise ValidationError(f"the {heading!r} section has no sway block")


def validate_predicate_fixture(root: Path) -> None:
    fixture = root / PREDICATE_FIXTURE
    for relative in PREDICATE_FIXTURE_FILES:
        if not (fixture / relative).is_file():
            raise ValidationError(
                f"predicate fixture is missing {(PREDICATE_FIXTURE / relative).as_posix()}"
            )

    documented = extract_sway_block(
        (root / "references" / "worked-examples.md").read_text(encoding="utf-8"),
        PREDICATE_HEADING,
    )
    compiled = fixture / "predicate" / "src" / "main.sw"
    if documented.encode("utf-8") != compiled.read_bytes():
        raise ValidationError(
            f"the {PREDICATE_HEADING!r} block in references/worked-examples.md no "
            f"longer matches {(PREDICATE_FIXTURE / 'predicate' / 'src' / 'main.sw').as_posix()}"
        )


def validate_repository(root: Path) -> None:
    skill_path = root / "SKILL.md"
    skill_markdown = skill_path.read_text(encoding="utf-8")
    metadata = parse_frontmatter(skill_markdown)

    name = metadata["name"]
    if name != SKILL_NAME or not NAME_RE.fullmatch(name) or len(name) > 64:
        raise ValidationError(f"skill name must be {SKILL_NAME!r} in hyphen-case")
    description = metadata["description"]
    if len(description) > 1024 or "<" in description or ">" in description:
        raise ValidationError("skill description is invalid")

    for link in MARKDOWN_LINK_RE.finditer(skill_markdown):
        target = root / link.group("target")
        if not target.is_file():
            raise ValidationError(f"SKILL.md references missing file: {target}")

    interface = parse_interface(
        (root / "agents" / "openai.yaml").read_text(encoding="utf-8")
    )
    required_interface = {"display_name", "short_description", "default_prompt"}
    if set(interface) != required_interface:
        raise ValidationError(
            "agents/openai.yaml must contain display_name, short_description, "
            "and default_prompt"
        )
    if not 25 <= len(interface["short_description"]) <= 64:
        raise ValidationError("interface.short_description must be 25-64 characters")
    if f"${SKILL_NAME}" not in interface["default_prompt"]:
        raise ValidationError(
            f"interface.default_prompt must explicitly mention ${SKILL_NAME}"
        )

    validate_predicate_fixture(root)
    validate_evals(root / "evals" / "evals.json")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        validate_repository(root)
    except (OSError, ValidationError) as error:
        print(f"validation failed: {error}", file=sys.stderr)
        return 1
    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
