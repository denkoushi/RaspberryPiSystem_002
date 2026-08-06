"""Explicit Pi3 artifact transport/staging preflight outside Deploy authority."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

from . import application, policy, signage_artifact_stage
from .backends.ansible import read_only_inventory_json
from .backends.systemd import SystemdBackend
from .terminal_preflight_contract import build_target_contracts


MODE = "pi3-signage-artifact-preflight"
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
OCI_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


class Runtime:
    PROJECT = Path(__file__).resolve().parents[3]
    ANSIBLE_DIRECTORY = PROJECT / "infrastructure/ansible"
    os = os

    @staticmethod
    def run(
        command: list[str],
        *,
        cwd: Path | None = None,
        capture: bool = False,
        env: dict[str, str] | None = None,
    ) -> str:
        result = subprocess.run(
            command,
            cwd=cwd or Runtime.PROJECT,
            env=env,
            text=True,
            capture_output=capture,
            check=True,
        )
        return result.stdout if capture else ""


def _source_sha(value: str) -> str:
    if FULL_SHA_RE.fullmatch(value) is None:
        raise argparse.ArgumentTypeError("--source-sha must be a full lowercase Git SHA")
    return value


def _oci_digest(value: str) -> str:
    if OCI_DIGEST_RE.fullmatch(value) is None:
        raise argparse.ArgumentTypeError("--oci-digest must be an exact sha256 digest")
    return value


def _preflight_id(value: str) -> str:
    if signage_artifact_stage.RUN_ID_RE.fullmatch(value) is None:
        raise argparse.ArgumentTypeError(
            "--preflight-id must use YYYYMMDD-HHMMSS-sixhex"
        )
    return value


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="preflight-pi3-signage-artifact.sh",
        description=(
            "Verify one exact Pi3 Signage OCI artifact through disposable staging; "
            "this does not create or update Deploy authority."
        ),
    )
    parser.add_argument("--source-sha", required=True, type=_source_sha)
    parser.add_argument("--oci-digest", required=True, type=_oci_digest)
    parser.add_argument("--preflight-id", required=True, type=_preflight_id)
    parser.add_argument("--inventory", required=True)
    return parser.parse_args(argv)


def _empty_envelope(args: argparse.Namespace) -> dict[str, Any]:
    source_sha = getattr(args, "source_sha", None)
    oci_digest = getattr(args, "oci_digest", None)
    preflight_id = getattr(args, "preflight_id", None)
    reference = (
        f"{signage_artifact_stage.ARTIFACT_REPOSITORY}:{source_sha}"
        if isinstance(source_sha, str)
        else None
    )
    return {
        "schemaVersion": 1,
        "mode": MODE,
        "status": "incomplete",
        "preflightId": preflight_id if isinstance(preflight_id, str) else None,
        "targetHost": None,
        "inputAuthority": {
            "sourceSha": source_sha if isinstance(source_sha, str) else None,
            "artifactReference": reference,
            "ociDigest": oci_digest if isinstance(oci_digest, str) else None,
        },
        "deployAuthority": {
            "runCreated": False,
            "fleetStateMutated": False,
            "claimsMutated": False,
            "activeRunMutated": False,
            "ledgerMutated": False,
        },
        "stageReport": None,
        "failure": None,
    }


def _failure(
    report: dict[str, Any], *, code: str, stage: str, status: str
) -> tuple[int, dict[str, Any]]:
    report["status"] = status
    report["failure"] = {"code": code, "stage": stage}
    return (78 if status == "blocked" else 70), report


def _exact_main(args: argparse.Namespace, *, runtime: Any) -> None:
    if runtime.run(
        ["git", "-C", str(runtime.PROJECT), "status", "--porcelain"],
        capture=True,
    ).strip():
        raise RuntimeError("worktree-dirty")
    head = runtime.run(
        ["git", "-C", str(runtime.PROJECT), "rev-parse", "HEAD"],
        capture=True,
    ).strip()
    main = runtime.run(
        ["git", "-C", str(runtime.PROJECT), "rev-parse", "origin/main"],
        capture=True,
    ).strip()
    if head != args.source_sha or main != args.source_sha:
        raise RuntimeError("source-not-exact-main")


def _inventory_path(raw: str, *, runtime: Any) -> Path:
    candidate = Path(raw)
    absolute = candidate if candidate.is_absolute() else runtime.PROJECT / candidate
    try:
        resolved = absolute.resolve(strict=True)
        resolved.relative_to(Path(runtime.ANSIBLE_DIRECTORY).resolve(strict=True))
    except (FileNotFoundError, OSError, ValueError) as error:
        raise RuntimeError("inventory-invalid") from error
    if not resolved.is_file():
        raise RuntimeError("inventory-invalid")
    return resolved


def execute(
    args: argparse.Namespace, *, runtime: Any | None = None
) -> tuple[int, dict[str, Any]]:
    active_runtime = runtime or Runtime()
    report = _empty_envelope(args)
    try:
        if (
            FULL_SHA_RE.fullmatch(str(args.source_sha)) is None
            or OCI_DIGEST_RE.fullmatch(str(args.oci_digest)) is None
            or signage_artifact_stage.RUN_ID_RE.fullmatch(str(args.preflight_id)) is None
        ):
            return _failure(
                report,
                code="request-validation",
                stage="request",
                status="blocked",
            )
        _exact_main(args, runtime=active_runtime)
    except RuntimeError as error:
        code = str(error) if str(error) in {"worktree-dirty", "source-not-exact-main"} else "source-validation"
        return _failure(report, code=code, stage="source", status="blocked")
    except Exception:
        return _failure(
            report, code="source-validation", stage="source", status="incomplete"
        )

    try:
        inventory_path = _inventory_path(args.inventory, runtime=active_runtime)
        inventory = read_only_inventory_json(
            str(inventory_path), runtime=active_runtime
        )
        release_hosts = policy.release_hosts(inventory)
        signage_hosts = [host for host in release_hosts if host.get("role") == "signage"]
        if len(signage_hosts) != 1:
            raise RuntimeError("signage-target-count")
        target = build_target_contracts(inventory, signage_hosts)[0]
        selected_target = {
            key: target[key]
            for key in ("host", "profile", "address", "user", "port")
        }
        report["targetHost"] = selected_target["host"]
        application.validate_remote_server_identity(
            inventory, runtime=active_runtime
        )
        _remote_user, transport = application.build_server_transport(active_runtime)
        result = SystemdBackend(transport).preflight_pi3_signage_artifact(
            source_sha=args.source_sha,
            oci_digest=args.oci_digest,
            preflight_id=args.preflight_id,
            target=selected_target,
        )
    except RuntimeError as error:
        code = str(error) if str(error) == "signage-target-count" else "authority-validation"
        return _failure(report, code=code, stage="authority", status="blocked")
    except Exception:
        return _failure(
            report,
            code="preflight-execution",
            stage="transport",
            status="incomplete",
        )

    try:
        stage_report = signage_artifact_stage.parse_stage_report(
            result.stdout,
            run_id=args.preflight_id,
            host=report["targetHost"],
            retain=False,
        )
        expected_returncode = {
            "passed": 0,
            "blocked": 78,
            "incomplete": 70,
        }[stage_report["status"]]
        artifact = stage_report.get("artifact")
        if result.returncode != expected_returncode:
            raise RuntimeError("process-status-mismatch")
        if stage_report["status"] == "passed" and (
            not isinstance(artifact, dict)
            or artifact.get("sourceSha") != args.source_sha
            or artifact.get("ociDigest") != args.oci_digest
            or artifact.get("exactReference")
            != f"{signage_artifact_stage.ARTIFACT_REPOSITORY}@{args.oci_digest}"
        ):
            raise RuntimeError("artifact-identity-mismatch")
    except Exception:
        return _failure(
            report,
            code="stage-report-validation",
            stage="report",
            status="incomplete",
        )

    report["stageReport"] = stage_report
    report["status"] = stage_report["status"]
    if stage_report["status"] == "passed":
        return 0, report
    report["failure"] = dict(stage_report["failure"])
    return expected_returncode, report


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    code, report = execute(args)
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
