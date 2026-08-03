#!/usr/bin/env python3
"""Require accountable, unexpired metadata for effective dependency exceptions."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path


def load_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def trivy_ids(path: Path) -> set[str]:
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def override_ids(path: Path) -> set[str]:
    package = load_json(path)
    pnpm = package.get("pnpm")
    overrides = pnpm.get("overrides") if isinstance(pnpm, dict) else None
    if not isinstance(overrides, dict):
        raise ValueError(f"{path}: pnpm.overrides must be an object")
    return set(overrides)


def validate_entries(
    entries: object,
    effective_ids: set[str],
    label: str,
    today: dt.date,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(entries, list):
        return [f"{label}: metadata must be an array"]
    metadata: dict[str, dict[str, object]] = {}
    for item in entries:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            errors.append(f"{label}: every metadata item needs a string id")
            continue
        item_id = item["id"]
        if item_id in metadata:
            errors.append(f"{label}: duplicate metadata id {item_id}")
            continue
        metadata[item_id] = item
        for field in ("owner", "reason", "expiresOn"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                errors.append(f"{label} {item_id}: {field} is required")
        try:
            expires_on = dt.date.fromisoformat(str(item.get("expiresOn", "")))
        except ValueError:
            errors.append(f"{label} {item_id}: expiresOn must be an ISO date")
        else:
            if expires_on < today:
                errors.append(f"{label} {item_id}: metadata expired on {expires_on.isoformat()}")
    missing = effective_ids - set(metadata)
    stale = set(metadata) - effective_ids
    for item_id in sorted(missing):
        errors.append(f"{label} {item_id}: metadata is missing")
    for item_id in sorted(stale):
        errors.append(f"{label} {item_id}: metadata has no effective exception")
    return errors


def validate(root: Path, today: dt.date) -> list[str]:
    ledger = load_json(root / "security/dependency-exceptions.json")
    if ledger.get("schemaVersion") != 1:
        return ["dependency exception ledger: unsupported schemaVersion"]
    return [
        *validate_entries(ledger.get("trivy"), trivy_ids(root / ".trivyignore"), "trivy", today),
        *validate_entries(
            ledger.get("pnpmOverrides"),
            override_ids(root / "package.json"),
            "pnpm override",
            today,
        ),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--today", type=dt.date.fromisoformat, default=dt.date.today())
    args = parser.parse_args()
    try:
        errors = validate(args.root.resolve(), args.today)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors = [str(error)]
    if errors:
        for error in errors:
            print(f"dependency-exception error: {error}")
        return 1
    print("Dependency exception metadata is complete and unexpired.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
