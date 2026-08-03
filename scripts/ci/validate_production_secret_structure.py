#!/usr/bin/env python3
"""Reject new credential-shaped plaintext without ever printing its value."""

from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


SECRET_NAME = re.compile(
    r"(?:password|passwd|secret|token|api_?key|client_?key|private_?key|refresh_?key|pin)",
    re.IGNORECASE,
)
YAML_SCALAR = re.compile(r"^\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*):\s*(?P<value>.*?)\s*$")
SHELL_ASSIGNMENT = re.compile(
    r"^\s*(?:export\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>.*?)\s*$"
)
QUOTED_ASSIGNMENT = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?::|=)\s*(['\"])(?P<value>.*?)\2"
)
QUOTED_FALLBACK = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=.*?(?:\?\?|\|\|)\s*(['\"])(?P<value>.*?)\2"
)


@dataclass(frozen=True, order=True)
class Finding:
    path: str
    identifier: str
    syntax: str


def is_external_or_empty(value: str) -> bool:
    normalized = value.strip().rstrip(",")
    return (
        not normalized
        or normalized in {"null", "None", "~", "''", '\"\"'}
        or normalized.lower() in {"true", "false", "yes", "no"}
        or normalized.isdigit()
        or normalized in {">", ">-", "|", "|-"}
        or "{{" in normalized
        or "lookup(" in normalized
        or "process.env" in normalized
        or "import.meta.env" in normalized
        or normalized.startswith("!vault")
        or normalized.startswith("$(")
        or normalized.startswith("`")
        or normalized.startswith("${") and normalized.endswith("}") and ":-" not in normalized
        or normalized.startswith("${") and normalized.endswith(":-}")
    )


def is_secret_identifier(identifier: str) -> bool:
    normalized = identifier.lower()
    if normalized.endswith(("_file", "_path", "_authentication", "_max_tokens", "_max_tokens_cap")):
        return False
    return SECRET_NAME.search(identifier) is not None


def candidate_paths(root: Path) -> list[Path]:
    paths: set[Path] = set()
    ansible = root / "infrastructure/ansible"
    if ansible.exists():
        paths.update(path for path in ansible.rglob("*") if path.is_file() and path.suffix in {".yml", ".yaml", ".j2"})
    docker = root / "infrastructure/docker"
    if docker.exists():
        paths.update(
            path
            for path in docker.rglob("*")
            if path.is_file()
            and (path.suffix in {".yml", ".yaml", ".j2", ".env"} or path.name.startswith("Dockerfile"))
        )
    for relative in (
        "apps/api/prisma/seed.ts",
        "apps/web/src/config/productionBuildConfig.ts",
        "apps/web/src/lib/client-key/config.ts",
        "scripts/register-clients.sh",
    ):
        path = root / relative
        if path.exists():
            paths.add(path)
    if (root / ".git").exists():
        tracked = {
            root / item.decode("utf-8")
            for item in subprocess.run(
                ["git", "ls-files", "-z"],
                cwd=root,
                check=True,
                stdout=subprocess.PIPE,
            ).stdout.split(b"\0")
            if item
        }
        paths.intersection_update(tracked)
    return sorted(paths)


def scan_file(root: Path, path: Path) -> list[Finding]:
    relative = path.relative_to(root).as_posix()
    findings: list[Finding] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.lstrip()
        if not stripped or stripped.startswith(("#", "//")):
            continue
        for syntax, pattern in (
            ("yaml-scalar", YAML_SCALAR),
            ("shell-assignment", SHELL_ASSIGNMENT),
            ("quoted-assignment", QUOTED_ASSIGNMENT),
            ("quoted-fallback", QUOTED_FALLBACK),
        ):
            match = pattern.search(line)
            if not match:
                continue
            identifier = match.group("name")
            value = match.group("value")
            if is_secret_identifier(identifier) and not is_external_or_empty(value):
                findings.append(Finding(relative, identifier, syntax))
            break
    return findings


def scan(root: Path) -> collections.Counter[Finding]:
    findings: collections.Counter[Finding] = collections.Counter()
    for path in candidate_paths(root):
        findings.update(scan_file(root, path))
    return findings


def load_allowance(path: Path) -> dict[Finding, int]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schemaVersion") != 1 or not isinstance(document.get("allowedPlaintext"), list):
        raise ValueError(f"{path}: unsupported production secret baseline schema")
    allowance: dict[Finding, int] = {}
    for item in document["allowedPlaintext"]:
        if not isinstance(item, dict):
            raise ValueError(f"{path}: allowance entries must be objects")
        finding = Finding(str(item.get("path", "")), str(item.get("identifier", "")), str(item.get("syntax", "")))
        count = item.get("count")
        reason = item.get("reason")
        if not all((finding.path, finding.identifier, finding.syntax)) or not isinstance(count, int) or count < 1:
            raise ValueError(f"{path}: allowance entry is incomplete")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"{path}: allowance reason is required")
        if finding in allowance:
            raise ValueError(f"{path}: duplicate allowance for {finding.path}:{finding.identifier}:{finding.syntax}")
        allowance[finding] = count
    return allowance


def validate(root: Path, baseline: Path) -> list[str]:
    allowance = load_allowance(baseline)
    errors: list[str] = []
    for finding, count in sorted(scan(root).items()):
        allowed = allowance.get(finding, 0)
        if count > allowed:
            errors.append(
                f"{finding.path}: {finding.identifier} ({finding.syntax}) has {count - allowed} new plaintext occurrence(s)"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--list-findings", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.list_findings:
        for finding, count in sorted(scan(root).items()):
            print(f"{finding.path}|{finding.identifier}|{finding.syntax}|{count}")
        return 0
    baseline = args.baseline or root / "security/production-secret-baseline.json"
    try:
        errors = validate(root, baseline)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors = [str(error)]
    if errors:
        for error in errors:
            print(f"production-secret structure error: {error}")
        return 1
    print("Production secret structure matches the redacted baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
