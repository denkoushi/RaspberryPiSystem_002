"""Local operator application for launch, status, approval and cancellation."""
from __future__ import annotations

import json
import os
import re
import secrets
import shlex
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .backends.command import SshTransport, SubprocessRunner
from .backends.control import RemoteRunControl
from .backends.systemd import (
    DEFAULT_REMOTE_HOME,
    DEFAULT_REMOTE_PROJECT,
    DEFAULT_REMOTE_USER,
    SystemdBackend,
)
from .models import LaunchSpec, validate_lookup_run_id
from .planner import executor_selection
from .policy import server_identity
from . import readiness_policy
from .reconcile import reconcile_status
from .route_contract import ROUTE_STAGES
from .route_preflight import (
    BUILD_EXTERNAL_DEPENDENCY_IDS,
    EXTERNAL_TLS_ROUNDS,
)
from .terminal_preflight_contract import build_target_contracts


OPERATOR_CANARY_APPROVAL_CLIENT = "operator-canary-approval"
EX_SOFTWARE = 70
EX_CONFIG = 78
_REMOTE_CLIENT_ID_PROBE = r'''import os,re,stat,sys
p="/etc/raspi-status-agent.conf"
flags=os.O_RDONLY|getattr(os,"O_CLOEXEC",0)|getattr(os,"O_NOFOLLOW",0)
try:
 fd=os.open(p,flags)
 try:
  if not stat.S_ISREG(os.fstat(fd).st_mode): raise OSError("not regular")
  data=os.read(fd,65537)
 finally: os.close(fd)
 if len(data)>65536: raise OSError("too large")
 text=data.decode("utf-8")
 values=[]
 pattern=re.compile(r'^[ \t]*CLIENT_ID[ \t]*=[ \t]*(?:"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"|\'([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\'|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))[ \t]*(?:#.*)?$')
 for line in text.splitlines():
  match=pattern.fullmatch(line)
  if match: values.append(next(value for value in match.groups() if value is not None))
 if len(values)!=1: raise OSError("CLIENT_ID unavailable")
 print(values[0])
except Exception:
 sys.exit(78)
'''


def new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)


def _remote_user_and_host(raw_host: str) -> tuple[str, str]:
    if "@" in raw_host:
        user, host = raw_host.split("@", 1)
        if not user or not host:
            raise RuntimeError("RASPI_SERVER_HOST is malformed")
        return user, raw_host
    return DEFAULT_REMOTE_USER, f"{DEFAULT_REMOTE_USER}@{raw_host}"


def build_server_transport(
    runtime: Any,
    *,
    runner: Any | None = None,
) -> tuple[str, SshTransport]:
    """Build the one canonical Pi5 SSH transport used by every local action."""

    raw_host = runtime.os.environ.get("RASPI_SERVER_HOST")
    if not raw_host:
        raise RuntimeError("RASPI_SERVER_HOST is required")
    remote_user, ssh_host = _remote_user_and_host(raw_host)
    options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]
    configured = runtime.os.environ.get("RASPI_SERVER_SSH_OPTS")
    if configured:
        options.extend(shlex.split(configured))
    transport = SshTransport(
        ssh_host,
        runner if runner is not None else SubprocessRunner(),
        ssh_options=options,
    )
    return remote_user, transport


def build_backends(runtime: Any) -> tuple[SystemdBackend, RemoteRunControl]:
    remote_user, transport = build_server_transport(runtime)
    remote_home = (
        DEFAULT_REMOTE_HOME
        if remote_user == DEFAULT_REMOTE_USER
        else PurePosixPath("/home") / remote_user
    )
    return (
        SystemdBackend(
            transport,
            remote_project=DEFAULT_REMOTE_PROJECT,
            remote_user=remote_user,
            remote_home=remote_home,
        ),
        RemoteRunControl(transport, remote_project=DEFAULT_REMOTE_PROJECT),
    )


def observe(
    run_id: str,
    *,
    systemd: SystemdBackend,
    control: RemoteRunControl,
) -> dict[str, Any]:
    unit = systemd.show(run_id)
    state, cancel = control.snapshot(run_id)
    payload = reconcile_status(state, cancel, unit)
    payload.pop("actionRequired", None)
    action = canary_approval_action(
        payload,
        run_id=run_id,
        now_epoch=int(datetime.now(timezone.utc).timestamp()),
    )
    if action is not None:
        payload["actionRequired"] = action
    return payload


def canary_approval_action(
    status: dict[str, Any],
    *,
    run_id: str,
    now_epoch: int,
) -> dict[str, Any] | None:
    """Derive the one safe operator action from a live canary hold."""

    validate_lookup_run_id(run_id)
    if (
        isinstance(now_epoch, bool)
        or not isinstance(now_epoch, int)
        or status.get("runId") != run_id
        or status.get("state") != "running"
        or status.get("phase") != "waiting-approval"
    ):
        return None
    hold = status.get("canaryHold")
    if not isinstance(hold, dict) or hold.get("state") != "waiting-verification":
        return None
    expires_at = hold.get("expiresAt")
    canary = hold.get("canary")
    opened_at = hold.get("openedAt") or hold.get("since")
    if (
        isinstance(expires_at, bool)
        or not isinstance(expires_at, int)
        or not isinstance(canary, str)
        or not canary
        or not isinstance(opened_at, str)
        or not opened_at
    ):
        return None
    remaining = expires_at - now_epoch
    if remaining <= 0:
        return None
    return {
        "type": "canary-approval",
        "runId": run_id,
        "canary": canary,
        "openedAt": opened_at,
        "expiresAt": expires_at,
        "remainingSeconds": remaining,
        "command": f"scripts/update-all-clients.sh --approve {run_id}",
    }


def status(run_id: str, *, runtime: Any) -> int:
    systemd, control = build_backends(runtime)
    payload = observe(run_id, systemd=systemd, control=control)
    attach_main_integration = getattr(runtime, "attach_main_integration", None)
    if not callable(attach_main_integration):
        raise RuntimeError("main-integration audit adapter is unavailable")
    payload = attach_main_integration(payload)
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return 1 if payload.get("state") == "not-found" else 0


def approve(run_id: str, *, runtime: Any) -> int:
    systemd, control = build_backends(runtime)
    before = observe(run_id, systemd=systemd, control=control)
    if before.get("state") not in {"running", "cancelling"}:
        raise RuntimeError(f"cannot approve a terminal release: {before.get('state')}")
    if before.get("state") == "cancelling" or before.get("phase") != "waiting-approval":
        raise RuntimeError("release is not actively waiting for canary approval")
    result = control.approve(run_id, OPERATOR_CANARY_APPROVAL_CLIENT)
    if result.get("approved") is not True:
        raise RuntimeError("remote canary approval did not confirm the transition")
    print(json.dumps({"runId": run_id, "approved": True}, ensure_ascii=False))
    return 0


def cancel(run_id: str, reason: str, *, runtime: Any) -> int:
    systemd, control = build_backends(runtime)
    before = observe(run_id, systemd=systemd, control=control)
    if before.get("state") not in {"running", "cancelling"}:
        raise RuntimeError(f"cannot cancel a terminal release: {before.get('state')}")
    request = control.request_cancel(run_id, reason)
    signal_result = systemd.signal_cancel(run_id)
    if signal_result.returncode != 0:
        after = observe(run_id, systemd=systemd, control=control)
        if after.get("state") not in {"cancelled", "failed", "interrupted"}:
            raise RuntimeError(
                (signal_result.stderr or signal_result.stdout or "cancellation signal failed").strip()
            )
    print(
        json.dumps(
            {
                "runId": run_id,
                "cancelRequested": True,
                "created": bool(request.get("created")),
                "reason": (request.get("record") or {}).get("reason"),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


def _remote_inventory(local_inventory: str, *, runtime: Any) -> str:
    path = Path(local_inventory)
    absolute = path if path.is_absolute() else runtime.PROJECT / path
    try:
        resolved = absolute.resolve(strict=True)
        relative = resolved.relative_to(runtime.ANSIBLE_DIRECTORY.resolve(strict=True))
    except (FileNotFoundError, ValueError) as error:
        raise RuntimeError("inventory must exist below infrastructure/ansible") from error
    if not resolved.is_file():
        raise RuntimeError("inventory is not a regular file")
    return relative.as_posix()


def _require_clean_worktree(*, runtime: Any) -> None:
    dirty = (
        runtime.subprocess.run(["git", "-C", str(runtime.PROJECT), "diff", "--quiet"]).returncode
        != 0
        or runtime.subprocess.run(
            ["git", "-C", str(runtime.PROJECT), "diff", "--cached", "--quiet"]
        ).returncode
        != 0
        or bool(
            runtime.run(
                ["git", "-C", str(runtime.PROJECT), "ls-files", "--others", "--exclude-standard"],
                capture=True,
            ).strip()
        )
    )
    if dirty:
        raise RuntimeError("local repository has uncommitted or untracked changes; refusing deployment")


def require_checkout_sha(sha: str, *, runtime: Any) -> None:
    """Bind an approved target tree to the operator's exact local checkout."""

    _require_clean_worktree(runtime=runtime)
    head = runtime.run(
        ["git", "-C", str(runtime.PROJECT), "rev-parse", "HEAD"], capture=True
    ).strip()
    if not runtime.FULL_SHA_RE.fullmatch(head) or head != sha:
        raise RuntimeError(
            "local HEAD does not match the resolved target SHA; update the checkout and rerun --print-plan"
        )


def validate_candidate_migrations(sha: str, *, runtime: Any) -> None:
    """Validate committed candidate SQL before any remote release is submitted."""

    validator = runtime.PROJECT / "scripts/deploy/validate-candidate-migrations.sh"
    runtime.run(
        [str(validator), "origin/main", sha],
    )


def read_remote_server_client_id(*, runtime: Any) -> str:
    """Read only the public CLIENT_ID field; never return the config or key."""

    _remote_user, transport = build_server_transport(runtime)
    result = transport.run(["/usr/bin/python3", "-c", _REMOTE_CLIENT_ID_PROBE])
    value = result.stdout.strip()
    if (
        result.returncode != 0
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value)
    ):
        raise RuntimeError("remote Pi5 CLIENT_ID could not be verified")
    return value


def validate_remote_server_identity(
    inventory_data: dict[str, Any], *, runtime: Any
) -> dict[str, str]:
    identity = server_identity(inventory_data)
    if read_remote_server_client_id(runtime=runtime) != identity["clientId"]:
        raise RuntimeError(
            "RASPI_SERVER_HOST does not match the selected inventory server identity"
        )
    return identity


def _bounded_probe_details(result: Any) -> list[str]:
    details: list[str] = []
    for raw in f"{result.stdout or ''}\n{result.stderr or ''}".splitlines():
        line = "".join(character for character in raw.strip() if character.isprintable())
        if not line or len(details) >= 100:
            continue
        details.append(line[:512])
    return details


def _probe_record(name: str, result: Any, *, structured: bool = False) -> dict[str, Any]:
    returncode = result.returncode if type(result.returncode) is int else EX_SOFTWARE
    status = "passed" if returncode == 0 else ("blocked" if returncode == EX_CONFIG else "incomplete")
    record: dict[str, Any] = {
        "probe": name,
        "status": status,
        "exitCode": returncode,
        "issues": [],
    }
    if structured:
        try:
            payload = json.loads((result.stdout or "").strip())
        except (TypeError, json.JSONDecodeError):
            payload = None
        if (
            not isinstance(payload, dict)
            or payload.get("probe") != name
            or payload.get("version") != 2
        ):
            record.update(
                {
                    "status": "incomplete",
                    "exitCode": EX_SOFTWARE,
                    "issues": [f"{name}.invalid-report"],
                }
            )
            return record
        issues = payload.get("issues")
        proofs = payload.get("proofs")
        warnings = payload.get("warnings")
        metrics = payload.get("metrics")
        issue_records: list[dict[str, str | None]] = []
        if isinstance(issues, list):
            for value in issues[:100]:
                if isinstance(value, str):
                    issue_records.append(
                        {"code": value[:256], "host": None, "capability": None}
                    )
                elif isinstance(value, dict):
                    code = value.get("code")
                    host = value.get("host")
                    capability = value.get("capability")
                    if (
                        isinstance(code, str)
                        and code
                        and (host is None or isinstance(host, str))
                        and (capability is None or isinstance(capability, str))
                    ):
                        issue_records.append(
                            {
                                "code": code[:256],
                                "host": host[:256] if isinstance(host, str) else None,
                                "capability": (
                                    capability[:256]
                                    if isinstance(capability, str)
                                    else None
                                ),
                            }
                        )
                        continue
                    issue_records.append(
                        {
                            "code": f"{name}.invalid-issue-record",
                            "host": None,
                            "capability": None,
                        }
                    )
                else:
                    issue_records.append(
                        {
                            "code": f"{name}.invalid-issue-record",
                            "host": None,
                            "capability": None,
                        }
                    )
        else:
            issue_records.append(
                {
                    "code": f"{name}.invalid-issues",
                    "host": None,
                    "capability": None,
                }
            )
        record["issueRecords"] = issue_records
        record["issues"] = [str(value["code"]) for value in issue_records]
        record["proofs"] = (
            [value[:256] for value in proofs if isinstance(value, str)][:100]
            if isinstance(proofs, list)
            else []
        )
        record["warnings"] = (
            [value[:256] for value in warnings if isinstance(value, str)][:100]
            if isinstance(warnings, list)
            else []
        )
        record["metrics"] = (
            {
                key: value
                for key, value in metrics.items()
                if key in {"diskFreeMb", "memoryAvailableMb"}
                and type(value) in {int, float}
            }
            if isinstance(metrics, dict)
            else {}
        )
        if isinstance(payload.get("capability"), str):
            record["capability"] = payload["capability"]
        if isinstance(payload.get("host"), str):
            record["host"] = payload["host"]
        if isinstance(payload.get("targets"), list):
            record["targets"] = payload["targets"][:100]
        if name == "terminal":
            targets = payload.get("targets")
            valid_targets = isinstance(targets, list) and len(targets) <= 100
            seen_hosts: set[str] = set()
            target_issue_codes: set[str] = set()
            if valid_targets:
                for target in targets:
                    if not isinstance(target, dict) or set(target) != {
                        "host",
                        "profile",
                        "status",
                        "issues",
                    }:
                        valid_targets = False
                        break
                    host = target.get("host")
                    profile = target.get("profile")
                    target_status = target.get("status")
                    target_issues = target.get("issues")
                    if (
                        not isinstance(host, str)
                        or not host
                        or host in seen_hosts
                        or not isinstance(profile, str)
                        or not profile
                        or target_status not in {"passed", "blocked"}
                        or not isinstance(target_issues, list)
                        or any(
                            not isinstance(issue, str) or not issue
                            for issue in target_issues
                        )
                        or (target_status == "passed" and target_issues)
                        or (target_status == "blocked" and not target_issues)
                    ):
                        valid_targets = False
                        break
                    seen_hosts.add(host)
                    target_issue_codes.update(target_issues)
            top_issue_codes = {
                str(value.get("code"))
                for value in issue_records
                if isinstance(value, dict)
            }
            if (
                not valid_targets
                or not target_issue_codes <= top_issue_codes
                or (
                    payload.get("status") == "passed"
                    and any(
                        target.get("status") != "passed"
                        for target in targets
                        if isinstance(target, dict)
                    )
                )
            ):
                record.update(
                    {
                        "status": "incomplete",
                        "exitCode": EX_SOFTWARE,
                        "issues": ["terminal.invalid-target-report"],
                        "issueRecords": [
                            {
                                "code": "terminal.invalid-target-report",
                                "host": None,
                                "capability": None,
                            }
                        ],
                    }
                )
        external_dependencies = payload.get("externalDependencies")
        if name == "route" and not isinstance(external_dependencies, dict):
            record.update(
                {
                    "status": "incomplete",
                    "exitCode": EX_SOFTWARE,
                    "issues": [f"{name}.invalid-external-dependencies"],
                    "issueRecords": [
                        {
                            "code": f"{name}.invalid-external-dependencies",
                            "host": None,
                            "capability": None,
                        }
                    ],
                }
            )
        elif name == "route":
            required = external_dependencies.get("required")
            rounds = external_dependencies.get("rounds")
            successes = external_dependencies.get("successes")
            if (
                isinstance(required, list)
                and required == sorted(required)
                and len(required) == len(set(required))
                and all(
                    isinstance(value, str)
                    and value in BUILD_EXTERNAL_DEPENDENCY_IDS
                    for value in required
                )
                and type(rounds) is int
                and rounds == EXTERNAL_TLS_ROUNDS
                and isinstance(successes, dict)
                and set(successes) == set(required)
                and all(
                    key in BUILD_EXTERNAL_DEPENDENCY_IDS
                    and type(value) is int
                    and 0 <= value <= rounds
                    for key, value in successes.items()
                )
            ):
                record["externalDependencies"] = {
                    "required": required,
                    "rounds": rounds,
                    "successes": successes,
                }
            else:
                record.update(
                    {
                        "status": "incomplete",
                        "exitCode": EX_SOFTWARE,
                        "issues": [f"{name}.invalid-external-dependencies"],
                        "issueRecords": [
                            {
                                "code": f"{name}.invalid-external-dependencies",
                                "host": None,
                                "capability": None,
                            }
                        ],
                    }
                )
        if payload.get("status") != status:
            record.update(
                {
                    "status": "incomplete",
                    "exitCode": EX_SOFTWARE,
                    "issues": [f"{name}.status-mismatch"],
                }
            )
        return record
    if returncode != 0:
        record["issues"] = [f"{name}.{status}"]
        record["details"] = _bounded_probe_details(result)
    return record


def _preflight_report(
    spec: LaunchSpec,
    *,
    registry: readiness_policy.ReadinessRegistry,
    selection: readiness_policy.ReadinessSelection,
    migration_result: Any | None,
    route_result: Any | None,
    terminal_result: Any | None,
    selected_hosts: list[str],
    terminal_count: int,
    planning_snapshot: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    requested = {probe.capability for probe in selection.probes}
    records: dict[str, dict[str, Any]] = {}
    for name, result in (
        ("migration", migration_result),
        ("route", route_result),
        ("terminal", terminal_result),
    ):
        if result is not None:
            records[name] = _probe_record(name, result, structured=True)

    def evidence_for(
        capability: str,
        record_name: str,
    ) -> readiness_policy.ProbeEvidence:
        record = records.get(record_name)
        if record is None:
            return readiness_policy.ProbeEvidence(
                capability=capability,
                status="incomplete",
                issues=(f"{capability}.missing-probe-result",),
            )
        declared = record.get("capability")
        if record_name != "route" and declared != capability:
            return readiness_policy.ProbeEvidence(
                capability=capability,
                status="incomplete",
                issues=(f"{record_name}.capability-mismatch",),
            )
        if record_name == "terminal":
            expected_hosts = next(
                request.hosts
                for request in selection.probes
                if request.capability == capability
            )
            reported_hosts = tuple(
                target.get("host")
                for target in record.get("targets", [])
                if isinstance(target, dict)
                and isinstance(target.get("host"), str)
            )
            if (
                len(reported_hosts) != len(set(reported_hosts))
                or set(reported_hosts) != set(expected_hosts)
            ):
                return readiness_policy.ProbeEvidence(
                    capability=capability,
                    status="incomplete",
                    issues=("terminal.scope-mismatch",),
                )
        hosts = tuple(
            value.get("host")
            for value in record.get("issueRecords", [])
            if isinstance(value, dict) and isinstance(value.get("host"), str)
        )
        return readiness_policy.ProbeEvidence(
            capability=capability,
            status=str(record["status"]),
            issues=tuple(str(value) for value in record.get("issues", [])),
            warnings=tuple(str(value) for value in record.get("warnings", [])),
            hosts=tuple(dict.fromkeys(hosts)),
        )

    evidence: list[readiness_policy.ProbeEvidence] = []
    if "local.source-and-scope" in requested:
        evidence.append(
            readiness_policy.ProbeEvidence(
                capability="local.source-and-scope", status="passed"
            )
        )
    if "migration.production-ledger" in requested:
        evidence.append(
            evidence_for("migration.production-ledger", "migration")
        )
    route_record = records.get("route")
    route_status = (
        str(route_record["status"]) if route_record is not None else "incomplete"
    )
    route_issues = (
        tuple(str(value) for value in route_record.get("issues", []))
        if route_record is not None
        else ("route.missing-probe-result",)
    )
    route_warnings = (
        tuple(str(value) for value in route_record.get("warnings", []))
        if route_record is not None
        else ()
    )
    if "route.pi5-authority-and-resources" in requested:
        base_issues = tuple(
            value
            for value in route_issues
            if not value.startswith("pi5.external-tls:")
        )
        evidence.append(
            readiness_policy.ProbeEvidence(
                capability="route.pi5-authority-and-resources",
                status=(
                    "incomplete"
                    if route_status == "incomplete"
                    else ("blocked" if base_issues else "passed")
                ),
                issues=base_issues,
                warnings=tuple(
                    value
                    for value in route_warnings
                    if value != "pi5.interrupted-run-recovery-required"
                ),
                hosts=("pi5",),
            )
        )
    if "route.external-server-build" in requested:
        external_issues = tuple(
            value
            for value in route_issues
            if value.startswith("pi5.external-tls:")
        )
        external_contract = (
            route_record.get("externalDependencies")
            if route_record is not None
            else None
        )
        external_contract_matches = (
            isinstance(external_contract, dict)
            and external_contract.get("required")
            == list(BUILD_EXTERNAL_DEPENDENCY_IDS)
        )
        if not external_contract_matches:
            external_issues = (
                *external_issues,
                "pi5.external-tls:contract-mismatch",
            )
        evidence.append(
            readiness_policy.ProbeEvidence(
                capability="route.external-server-build",
                status=(
                    "incomplete"
                    if route_status == "incomplete" or not external_contract_matches
                    else ("blocked" if external_issues else "passed")
                ),
                issues=external_issues,
                hosts=("pi5",),
            )
        )
    if "route.interrupted-run-recovery" in requested:
        interrupted = tuple(
            value
            for value in route_warnings
            if value == "pi5.interrupted-run-recovery-required"
        )
        evidence.append(
            readiness_policy.ProbeEvidence(
                capability="route.interrupted-run-recovery",
                status="incomplete" if route_status == "incomplete" else "passed",
                warnings=interrupted,
                hosts=("pi5",),
            )
        )
    if "terminal.selected-prerequisites" in requested:
        evidence.append(
            evidence_for("terminal.selected-prerequisites", "terminal")
        )
    if "architecture.activation-executor" in requested:
        enabled = planning_snapshot.get("activationExecutionEnabled") is True
        evidence.append(
            readiness_policy.ProbeEvidence(
                capability="architecture.activation-executor",
                status="passed" if enabled else "blocked",
                issues=(
                    ()
                    if enabled
                    else ("activation-architecture.execution-disabled",)
                ),
            )
        )
    if "architecture.verification-executor" in requested:
        enabled = (
            planning_snapshot.get("verificationOnlyExecutionEnabled") is True
        )
        evidence.append(
            readiness_policy.ProbeEvidence(
                capability="architecture.verification-executor",
                status="passed" if enabled else "blocked",
                issues=(
                    ()
                    if enabled
                    else ("verification-architecture.execution-disabled",)
                ),
            )
        )
    decision = readiness_policy.evaluate_readiness(
        registry, selection, tuple(evidence)
    )
    outcome = decision.exit_code
    status = decision.status
    admission = (
        readiness_policy.make_admission(selection, decision).as_payload()
        if outcome == 0
        else None
    )
    target_planning = {
        "status": "provisional-read-only-snapshot",
        "typedTargetPlanningEnabled": planning_snapshot.get(
            "typedTargetPlanningEnabled"
        ),
        "activationExecutionEnabled": planning_snapshot.get(
            "activationExecutionEnabled"
        ),
        "verificationOnlyExecutionEnabled": planning_snapshot.get(
            "verificationOnlyExecutionEnabled"
        ),
        "mutationTargets": planning_snapshot["mutationTargets"],
        "activationTargets": planning_snapshot["activationTargets"],
        "verificationTargets": planning_snapshot["verificationTargets"],
        "terminalWork": planning_snapshot["terminalWork"],
        "selectedClaimRequirements": None,
    }
    return outcome, {
        "version": 2,
        "preflightId": spec.run_id,
        "sha": spec.sha,
        "inventory": spec.inventory,
        "limit": spec.limit,
        "status": status,
        "selectedHosts": selected_hosts,
        "targetPlanning": target_planning,
        **executor_selection(preflight_passed=outcome == 0),
        "terminalCount": terminal_count,
        "releaseSubmitted": False,
        "routeCoverage": [stage.id for stage in ROUTE_STAGES],
        "readinessPlan": readiness_policy.readiness_plan_payload(selection),
        "readinessReview": readiness_policy.readiness_review_payload(
            registry, decision
        ),
        "readinessAdmission": admission,
        "probes": list(records.values()),
    }


def _launch(args: Any, *, runtime: Any) -> int:
    _require_clean_worktree(runtime=runtime)
    remote_inventory = _remote_inventory(args.inventory, runtime=runtime)
    runtime.run(["git", "-C", str(runtime.PROJECT), "fetch", "origin", args.branch])
    runtime.run(["git", "-C", str(runtime.PROJECT), "fetch", "origin", "main"])
    sha = runtime.run(
        ["git", "-C", str(runtime.PROJECT), "rev-parse", f"origin/{args.branch}"],
        capture=True,
    ).strip()
    if not runtime.FULL_SHA_RE.fullmatch(sha):
        raise RuntimeError("origin branch did not resolve to an immutable SHA")
    require_checkout_sha(sha, runtime=runtime)
    validate_candidate_migrations(sha, runtime=runtime)
    inventory_data = runtime.read_only_inventory_json(
        str(runtime.ANSIBLE_DIRECTORY / remote_inventory)
    )
    # Validate the complete target-tree topology before the identity probe
    # opens SSH or a transient systemd unit can reach remote checkout/state.
    all_release_hosts = runtime.release_hosts(inventory_data)
    selected_release_hosts = all_release_hosts
    if args.limit:
        selected = runtime.read_only_selected_hosts(
            str(runtime.ANSIBLE_DIRECTORY / remote_inventory), args.limit
        )
        if not selected:
            raise RuntimeError(f"--limit selected no hosts: {args.limit}")
        selected_release_hosts = runtime.release_hosts(inventory_data, selected)
    identity = validate_remote_server_identity(inventory_data, runtime=runtime)

    build_print_plan = getattr(runtime, "build_print_plan", None)
    if not callable(build_print_plan):
        raise RuntimeError("read-only target planning is unavailable")
    planning_snapshot = build_print_plan(
        args.branch,
        args.inventory,
        args.limit,
        full_fleet=args.full_fleet,
        reverify_selected=args.reverify_selected,
    )
    if planning_snapshot.get("sha") != sha:
        raise RuntimeError("preflight planning SHA changed during launch")
    main_integration = planning_snapshot.get("mainIntegration")
    if not isinstance(main_integration, dict):
        raise RuntimeError("preflight planning did not produce main-integration evidence")
    readiness_registry = readiness_policy.load_registry()
    readiness_selection = readiness_policy.select_readiness(
        readiness_registry,
        readiness_policy.facts_from_plan(planning_snapshot),
    )
    terminal_request = next(
        (
            request
            for request in readiness_selection.probes
            if request.capability == "terminal.selected-prerequisites"
        ),
        None,
    )
    terminal_work = {
        work.get("host"): work
        for work in planning_snapshot["terminalWork"]
        if isinstance(work, dict) and isinstance(work.get("host"), str)
    }
    terminal_target_roles = [
        {"host": host, "role": str(terminal_work[host]["role"])}
        for host in (terminal_request.hosts if terminal_request else ())
        if host in terminal_work
    ]
    if terminal_request is not None and len(terminal_target_roles) != len(
        terminal_request.hosts
    ):
        raise RuntimeError(
            "readiness terminal scope is inconsistent with target planning"
        )
    terminal_preflight_targets = build_target_contracts(
        inventory_data, terminal_target_roles
    )

    run_id = new_run_id()
    spec = LaunchSpec(
        run_id=run_id,
        branch=args.branch,
        sha=sha,
        inventory=remote_inventory,
        expected_server_client_id=identity["clientId"],
        limit=args.limit or "",
        canary_hold_timeout=args.canary_hold_timeout,
        emergency_override=args.emergency_override,
        reason=args.reason,
        skip_canary_hold=args.skip_canary_hold,
        full_fleet=args.full_fleet,
        reverify_selected=args.reverify_selected,
    ).validate()
    systemd, control = build_backends(runtime)
    requested_capabilities = {
        request.capability for request in readiness_selection.probes
    }
    migration_preflight = (
        systemd.preflight_migrations(spec)
        if "migration.production-ledger" in requested_capabilities
        else None
    )
    route_capabilities = {
        "route.pi5-authority-and-resources",
        "route.external-server-build",
        "route.interrupted-run-recovery",
    }
    required_external_dependencies = (
        BUILD_EXTERNAL_DEPENDENCY_IDS
        if "route.external-server-build" in requested_capabilities
        else ()
    )
    route_preflight = (
        systemd.preflight_route(spec, required_external_dependencies)
        if requested_capabilities & route_capabilities
        else None
    )
    terminal_preflight_result = (
        systemd.preflight_terminals(spec, terminal_preflight_targets)
        if terminal_request is not None
        else None
    )
    preflight_code, preflight_report = _preflight_report(
        spec,
        registry=readiness_registry,
        selection=readiness_selection,
        migration_result=migration_preflight,
        route_result=route_preflight,
        terminal_result=terminal_preflight_result,
        selected_hosts=[str(target["host"]) for target in selected_release_hosts],
        terminal_count=len(terminal_preflight_targets),
        planning_snapshot=planning_snapshot,
    )
    if getattr(args, "preflight_only", False):
        print(json.dumps(preflight_report, ensure_ascii=False, sort_keys=True))
        return preflight_code
    if preflight_code != 0:
        raise RuntimeError(
            f"release {run_id} was not submitted because aggregate preflight "
            f"{preflight_report['status']}: "
            + json.dumps(preflight_report["probes"], ensure_ascii=True, sort_keys=True)
        )
    admission_payload = preflight_report.get("readinessAdmission")
    if not isinstance(admission_payload, dict):
        raise RuntimeError("passing preflight did not produce a readiness admission")
    spec = replace(spec, readiness_admission=admission_payload).validate()
    try:
        result = systemd.start(spec, wait=not args.detach)
    except Exception as error:
        raise RuntimeError(
            f"release {run_id} submission is uncertain; inspect it with --status {run_id}: {error}"
        ) from error
    if args.detach:
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "systemd rejected release unit").strip()
            raise RuntimeError(
                f"release {run_id} submission is uncertain; inspect it with --status {run_id}: {detail}"
            )
        print(
            json.dumps(
                {
                    "runId": run_id,
                    "unitName": spec.unit_name,
                    "state": "accepted",
                    "mainIntegration": main_integration,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 0

    # --wait propagates the unit result, but the durable record and unit must
    # still be reconciled.  A zero process exit alone never manufactures
    # release success.
    try:
        payload = observe(run_id, systemd=systemd, control=control)
    except Exception as error:
        raise RuntimeError(
            f"release {run_id} was submitted but status reconciliation failed; "
            f"retry --status {run_id}: {error}"
        ) from error
    payload["mainIntegration"] = main_integration
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    outcome = payload.get("state")
    if outcome == "success":
        return 0
    if outcome == "cancelled":
        return 130
    return 1


def _local_incomplete_preflight_report(args: Any) -> dict[str, Any]:
    registry = readiness_policy.load_registry()
    return {
        "version": 2,
        "preflightId": None,
        "sha": None,
        "inventory": getattr(args, "inventory", None),
        "limit": getattr(args, "limit", None) or "",
        "status": "incomplete",
        "selectedHosts": [],
        "targetPlanning": {
            "status": "unavailable",
            "typedTargetPlanningEnabled": None,
            "activationExecutionEnabled": None,
            "verificationOnlyExecutionEnabled": None,
            "mutationTargets": None,
            "activationTargets": None,
            "verificationTargets": None,
            "terminalWork": None,
            "selectedClaimRequirements": None,
        },
        **executor_selection(preflight_passed=False),
        "terminalCount": 0,
        "releaseSubmitted": False,
        "routeCoverage": [stage.id for stage in ROUTE_STAGES],
        "readinessPlan": None,
        "readinessReview": readiness_policy.unavailable_readiness_review(
            registry, "local.source-and-scope.incomplete"
        ),
        "readinessAdmission": None,
        "probes": [
            {
                "probe": "local",
                "status": "incomplete",
                "exitCode": EX_SOFTWARE,
                "issues": ["local.source-and-scope.incomplete"],
            }
        ],
    }


def launch(args: Any, *, runtime: Any) -> int:
    """Run launch, preserving one secret-free JSON result for diagnostic mode."""

    if not getattr(args, "preflight_only", False):
        return _launch(args, runtime=runtime)
    try:
        return _launch(args, runtime=runtime)
    except Exception:
        print(
            json.dumps(
                _local_incomplete_preflight_report(args),
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return EX_SOFTWARE
