"""Local operator application for launch, status, approval and cancellation."""
from __future__ import annotations

import json
import os
import re
import secrets
import shlex
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
from .models import LaunchSpec
from .policy import server_identity
from .reconcile import reconcile_status


OPERATOR_CANARY_APPROVAL_CLIENT = "operator-canary-approval"
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
    return reconcile_status(state, cancel, unit)


def status(run_id: str, *, runtime: Any) -> int:
    systemd, control = build_backends(runtime)
    payload = observe(run_id, systemd=systemd, control=control)
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


def launch(args: Any, *, runtime: Any) -> int:
    _require_clean_worktree(runtime=runtime)
    remote_inventory = _remote_inventory(args.inventory, runtime=runtime)
    runtime.run(["git", "-C", str(runtime.PROJECT), "fetch", "origin", args.branch])
    sha = runtime.run(
        ["git", "-C", str(runtime.PROJECT), "rev-parse", f"origin/{args.branch}"],
        capture=True,
    ).strip()
    if not runtime.FULL_SHA_RE.fullmatch(sha):
        raise RuntimeError("origin branch did not resolve to an immutable SHA")
    require_checkout_sha(sha, runtime=runtime)
    inventory_data = runtime.inventory_json(
        str(runtime.ANSIBLE_DIRECTORY / remote_inventory)
    )
    identity = validate_remote_server_identity(inventory_data, runtime=runtime)

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
    ).validate()
    try:
        systemd, control = build_backends(runtime)
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
                {"runId": run_id, "unitName": spec.unit_name, "state": "accepted"},
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
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    outcome = payload.get("state")
    if outcome == "success":
        return 0
    if outcome == "cancelled":
        return 130
    return 1
