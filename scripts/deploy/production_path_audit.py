#!/usr/bin/env python3
"""Validate and execute the secret-free standard-release audit matrix."""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.deploy.rolling_release.route_contract import ROUTE_STAGES


DEFAULT_MATRIX = ROOT / "scripts/deploy/production-path-audit.json"
EXECUTION_LEVELS = {"static": 0, "behavioral": 1, "compose": 2, "container": 3}
REQUIRED_SCENARIO_FIELDS = {
    "id",
    "required",
    "routeStages",
    "pi5Phases",
    "initialState",
    "entrypoint",
    "executionLevel",
    "expectedTransition",
    "failureInvariant",
    "testOwner",
    "incidents",
}


class AuditError(ValueError):
    pass


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise AuditError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_matrix(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
    except (OSError, json.JSONDecodeError) as error:
        raise AuditError(f"audit matrix is unavailable or malformed: {path}") from error
    if not isinstance(value, dict):
        raise AuditError("audit matrix root must be an object")
    return value


def test_owner(path_text: str) -> tuple[Path, str, str]:
    if path_text.count("::") != 1:
        raise AuditError(f"invalid test owner: {path_text}")
    relative, method = path_text.split("::", 1)
    path = ROOT / relative
    if not path.is_file() or path.suffix != ".py" or not method.startswith("test_"):
        raise AuditError(f"test owner is unavailable: {path_text}")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    owners = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef)
        and any(
            isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
            and child.name == method
            for child in node.body
        )
    ]
    if len(owners) != 1:
        raise AuditError(f"test owner must resolve exactly once: {path_text}")
    module = ".".join(path.relative_to(ROOT).with_suffix("").parts)
    return path, owners[0], f"{module}.{owners[0]}.{method}"


def validate_matrix(matrix: dict[str, Any]) -> dict[str, Any]:
    if matrix.get("schemaVersion") != 1:
        raise AuditError("audit matrix schemaVersion must be 1")
    incidents = matrix.get("incidents")
    phases = matrix.get("requiredPi5Phases")
    scenarios = matrix.get("scenarios")
    if not isinstance(incidents, list) or not incidents or any(
        not isinstance(item, str) or not item for item in incidents
    ):
        raise AuditError("audit incident registry is malformed")
    if len(incidents) != len(set(incidents)):
        raise AuditError("audit incident IDs must be unique")
    if not isinstance(phases, list) or not phases or any(
        not isinstance(item, str) or not item for item in phases
    ):
        raise AuditError("required Pi5 phases are malformed")
    if len(phases) != len(set(phases)):
        raise AuditError("required Pi5 phase IDs must be unique")
    if not isinstance(scenarios, list) or not scenarios:
        raise AuditError("audit scenarios must not be empty")

    route_by_id = {stage.id: stage for stage in ROUTE_STAGES}
    covered_routes: dict[str, list[dict[str, Any]]] = {key: [] for key in route_by_id}
    covered_phases: set[str] = set()
    covered_incidents: set[str] = set()
    scenario_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for raw in scenarios:
        if not isinstance(raw, dict) or set(raw) != REQUIRED_SCENARIO_FIELDS:
            raise AuditError("audit scenario fields are incomplete or unknown")
        scenario_id = raw["id"]
        if not isinstance(scenario_id, str) or not scenario_id or scenario_id in scenario_ids:
            raise AuditError(f"audit scenario ID is invalid or duplicated: {scenario_id!r}")
        scenario_ids.add(scenario_id)
        if type(raw["required"]) is not bool:
            raise AuditError(f"scenario required flag is invalid: {scenario_id}")
        level = raw["executionLevel"]
        if level not in EXECUTION_LEVELS:
            raise AuditError(f"scenario execution level is invalid: {scenario_id}")
        for field in ("initialState", "entrypoint", "expectedTransition", "failureInvariant"):
            if not isinstance(raw[field], str) or not raw[field].strip():
                raise AuditError(f"scenario {field} is missing: {scenario_id}")
        route_ids = raw["routeStages"]
        phase_ids = raw["pi5Phases"]
        incident_ids = raw["incidents"]
        for field, values in (
            ("routeStages", route_ids),
            ("pi5Phases", phase_ids),
            ("incidents", incident_ids),
        ):
            if not isinstance(values, list) or len(values) != len(set(values)) or any(
                not isinstance(item, str) or not item for item in values
            ):
                raise AuditError(f"scenario {field} is malformed: {scenario_id}")
        unknown_routes = set(route_ids) - set(route_by_id)
        unknown_phases = set(phase_ids) - set(phases)
        unknown_incidents = set(incident_ids) - set(incidents)
        if unknown_routes or unknown_phases or unknown_incidents:
            raise AuditError(
                f"scenario references unknown IDs: {scenario_id}: "
                f"routes={sorted(unknown_routes)} phases={sorted(unknown_phases)} "
                f"incidents={sorted(unknown_incidents)}"
            )
        test_owner(raw["testOwner"])
        for route_id in route_ids:
            covered_routes[route_id].append(raw)
        covered_phases.update(phase_ids)
        covered_incidents.update(incident_ids)
        normalized.append(raw)

    uncovered_routes = sorted(key for key, owners in covered_routes.items() if not owners)
    uncovered_phases = sorted(set(phases) - covered_phases)
    uncovered_incidents = sorted(set(incidents) - covered_incidents)
    if uncovered_routes or uncovered_phases or uncovered_incidents:
        raise AuditError(
            "required audit coverage is incomplete: "
            f"routes={uncovered_routes} phases={uncovered_phases} incidents={uncovered_incidents}"
        )
    weak_routes = sorted(
        route_id
        for route_id, owners in covered_routes.items()
        if route_by_id[route_id].operation in {"mutation", "commit"}
        and not any(
            owner["required"]
            and EXECUTION_LEVELS[owner["executionLevel"]] >= EXECUTION_LEVELS["behavioral"]
            for owner in owners
        )
    )
    if weak_routes:
        raise AuditError(f"mutating route stages lack behavioral evidence: {weak_routes}")
    if not any(
        scenario["required"]
        and scenario["executionLevel"] == "container"
        and "pi5.blue-green-release" in scenario["routeStages"]
        for scenario in normalized
    ):
        raise AuditError("Pi5 Blue/Green lacks required disposable-container evidence")
    return {
        "scenarios": normalized,
        "routeStageCount": len(route_by_id),
        "pi5PhaseCount": len(phases),
        "incidentCount": len(incidents),
        "uncovered": [],
    }


def docker_residue() -> dict[str, int | bool]:
    probe = subprocess.run(
        ["docker", "info", "--format", "{{.ServerVersion}}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        return {"available": False, "containers": 0, "networks": 0, "volumes": 0}
    label = "com.raspi-system.production-path-audit=true"
    commands = {
        "containers": ["docker", "ps", "-aq", "--filter", f"label={label}"],
        "networks": ["docker", "network", "ls", "-q", "--filter", f"label={label}"],
        "volumes": ["docker", "volume", "ls", "-q", "--filter", f"label={label}"],
    }
    result: dict[str, int | bool] = {"available": True}
    for name, command in commands.items():
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            raise AuditError(f"could not inspect Docker {name} residue")
        result[name] = len([line for line in completed.stdout.splitlines() if line.strip()])
    return result


def execute(matrix_path: Path, output: Path) -> int:
    started = time.monotonic()
    validated = validate_matrix(load_matrix(matrix_path))
    scenarios = validated["scenarios"]
    owner_results: dict[str, dict[str, Any]] = {}
    for scenario in scenarios:
        owner = scenario["testOwner"]
        if owner in owner_results:
            continue
        _, _, unittest_name = test_owner(owner)
        before = time.monotonic()
        completed = subprocess.run(
            [sys.executable, "-m", "unittest", unittest_name],
            cwd=ROOT,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        owner_results[owner] = {
            "status": "passed" if completed.returncode == 0 else "failed",
            "exitCode": completed.returncode,
            "durationSeconds": round(time.monotonic() - before, 3),
        }
    outcomes = [
        {
            "id": scenario["id"],
            "required": scenario["required"],
            "executionLevel": scenario["executionLevel"],
            "testOwner": scenario["testOwner"],
            **owner_results[scenario["testOwner"]],
        }
        for scenario in scenarios
    ]
    residue = docker_residue()
    failed = sum(item["required"] and item["status"] != "passed" for item in outcomes)
    leaked = sum(int(residue[name]) for name in ("containers", "networks", "volumes"))
    report = {
        "schemaVersion": 1,
        "sourceSha": subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True
        ).stdout.strip(),
        "summary": {
            "required": sum(item["required"] for item in outcomes),
            "passed": sum(item["required"] and item["status"] == "passed" for item in outcomes),
            "failed": failed,
            "uncovered": 0,
            "durationSeconds": round(time.monotonic() - started, 3),
            "resourceResidue": residue,
        },
        "scenarios": outcomes,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0 if failed == 0 and leaked == 0 and residue["available"] is True else 1


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate")
    run = subparsers.add_parser("run")
    run.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        if args.command == "validate":
            result = validate_matrix(load_matrix(args.matrix))
            print(
                "production path audit matrix valid: "
                f"routes={result['routeStageCount']} "
                f"pi5-phases={result['pi5PhaseCount']} incidents={result['incidentCount']}"
            )
            return 0
        return execute(args.matrix, args.output)
    except (AuditError, OSError, subprocess.SubprocessError) as error:
        print(f"production path audit failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
