#!/usr/bin/env python3
"""Validate a Hermes boundary policy YAML file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.boundary_policy import BoundaryPolicy, validate_policy_document  # noqa: E402
from lib.config_contract import workspace_mounts_from_policy  # noqa: E402


def load_policy(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix in {".json"}:
        data = json.loads(text)
    else:
        if yaml is None:
            raise RuntimeError("PyYAML is required for YAML policies (pip install pyyaml)")
        data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("policy root must be a mapping")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Hermes boundary policy file")
    parser.add_argument(
        "--policy",
        type=Path,
        default=Path(__file__).resolve().parent / "config" / "boundary-policy.tools.yaml",
        help="Path to policy YAML/JSON",
    )
    parser.add_argument(
        "--check-docker-volumes",
        action="store_true",
        help="Emit expected terminal.docker_volumes lines for D2 workspace bind",
    )
    args = parser.parse_args()

    try:
        data = load_policy(args.policy)
    except Exception as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)]}, ensure_ascii=False))
        return 1

    errors = validate_policy_document(data)
    payload: dict[str, object] = {
        "ok": not errors,
        "policy": str(args.policy),
        "errors": errors,
    }
    if args.check_docker_volumes:
        try:
            policy = BoundaryPolicy.from_mapping(data)
            payload["docker_volumes"] = list(workspace_mounts_from_policy(policy))
        except ValueError as exc:
            errors.append(str(exc))
            payload["ok"] = False
            payload["errors"] = errors
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
