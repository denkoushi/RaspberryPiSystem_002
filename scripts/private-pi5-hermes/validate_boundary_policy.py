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
from lib.discord_task_bridge import emission_json as task_bridge_emission_json  # noqa: E402
from lib.hermes_browser_adapter import hermes_browser_emission  # noqa: E402
from lib.hermes_security_adapter import hermes_security_emission  # noqa: E402
from lib.task_bridge_policy import (  # noqa: E402
    TaskBridgePolicy,
    validate_task_bridge_document,
)


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
    parser.add_argument(
        "--emit-hermes-security",
        action="store_true",
        help="Emit Hermes security.website_blocklist + expected_llm_base_url JSON (D3)",
    )
    parser.add_argument(
        "--emit-browser-env",
        action="store_true",
        help="Emit Hermes browser config + AGENT_BROWSER_ARGS JSON (D4)",
    )
    parser.add_argument(
        "--validate-task-bridge",
        action="store_true",
        help="Validate task-bridge.policy.yaml (D5) and emit contract JSON",
    )
    parser.add_argument(
        "--task-bridge-policy",
        type=Path,
        default=Path(__file__).resolve().parent / "config" / "task-bridge.policy.yaml",
        help="Path to task bridge policy YAML (D5)",
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
    if args.emit_hermes_security:
        try:
            policy = BoundaryPolicy.from_mapping(data)
            payload["hermes_security"] = hermes_security_emission(policy)
        except ValueError as exc:
            errors.append(str(exc))
            payload["ok"] = False
            payload["errors"] = errors
    if args.emit_browser_env:
        try:
            policy = BoundaryPolicy.from_mapping(data)
            payload["hermes_browser"] = hermes_browser_emission(policy)
        except ValueError as exc:
            errors.append(str(exc))
            payload["ok"] = False
            payload["errors"] = errors
    if args.validate_task_bridge:
        try:
            bridge_data = load_policy(args.task_bridge_policy)
            bridge_errors = validate_task_bridge_document(bridge_data)
            if bridge_errors:
                errors.extend(bridge_errors)
                payload["ok"] = False
                payload["errors"] = errors
            else:
                bridge_policy = TaskBridgePolicy.from_mapping(bridge_data)
                payload["task_bridge"] = task_bridge_emission_json(bridge_policy)
        except Exception as exc:
            errors.append(str(exc))
            payload["ok"] = False
            payload["errors"] = errors
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
