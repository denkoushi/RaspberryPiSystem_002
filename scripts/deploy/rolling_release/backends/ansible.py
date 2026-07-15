"""Ansible command adapter used by the rolling-release coordinator.

This module executes already-decided host actions.  It deliberately does not
choose release scope, host order, or rollback policy.
"""
from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Protocol


class Runtime(Protocol):
    ANSIBLE_DIRECTORY: Any
    PROJECT: Any

    def run(self, command: list[str], **kwargs: Any) -> str: ...

    def state_command(self, *arguments: str) -> None: ...

    def utc_now(self) -> str: ...

    def playbook(
        self,
        inventory: str,
        host: str,
        revision: str,
        run_id: str,
        *,
        rollback: bool = False,
    ) -> None: ...


def inventory_json(path: str, *, runtime: Runtime) -> dict[str, Any]:
    return json.loads(
        runtime.run(
            ["ansible-inventory", "-i", path, "--list"],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    )


def selected_hosts(path: str, limit: str, *, runtime: Runtime) -> list[str] | None:
    if not limit:
        return None
    try:
        output = runtime.run(
            ["ansible", "-i", path, "server:clients", "--list-hosts", "--limit", limit],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    except subprocess.CalledProcessError as error:
        combined = "\n".join(
            value for value in (error.stdout, error.stderr) if isinstance(value, str)
        )
        if "hosts (0)" in combined:
            return []
        raise
    return [
        line.strip()
        for line in output.splitlines()
        if line.strip() and not line.lstrip().startswith("hosts")
    ]


def prestage_signage_maintenance(
    inventory: str,
    host: str,
    run_id: str,
    client_id: str,
    *,
    runtime: Runtime,
) -> None:
    source = runtime.ANSIBLE_DIRECTORY / "roles/signage/templates/signage-maintenance.svg.j2"
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "apt",
            "-a",
            "name=librsvg2-bin state=present update_cache=yes",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "copy",
            "-a",
            f"src={source} dest=/usr/local/share/signage-maintenance.svg mode=0644",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    command = (
        "set -e; mkdir -p /run/signage; "
        "rsvg-convert -f png -w 1920 -h 1080 /usr/local/share/signage-maintenance.svg "
        "-o /run/signage/current.tmp.jpg; "
        "if test -f /run/signage/current.jpg; then "
        "cat /run/signage/current.tmp.jpg > /run/signage/current.jpg; "
        "rm -f /run/signage/current.tmp.jpg; "
        "else mv /run/signage/current.tmp.jpg /run/signage/current.jpg; fi"
    )
    runtime.run(
        ["ansible", "-i", inventory, host, "-b", "-m", "shell", "-a", command],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    runtime.state_command("ack", "--run-id", run_id, "--client", client_id)


def remote_previous_sha(inventory: str, host: str, *, runtime: Runtime) -> str:
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "command",
            "-a",
            "git -C /opt/RaspberryPiSystem_002 rev-parse HEAD",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    for line in output.splitlines():
        candidate = line.strip()
        if len(candidate) == 40 and all(character in "0123456789abcdef" for character in candidate):
            return candidate
    raise RuntimeError(f"could not resolve previous SHA for {host}: {output}")


def playbook(
    inventory: str,
    host: str,
    revision: str,
    run_id: str,
    *,
    rollback: bool = False,
    runtime: Runtime,
) -> None:
    environment = os.environ.copy()
    environment.update(
        {"ANSIBLE_REPO_VERSION": revision, "RUN_ID": run_id, "RELEASE_ORCHESTRATED": "1"}
    )
    extra = "release_orchestrated=true release_rollback=" + ("true" if rollback else "false")
    runtime.run(
        [
            "ansible-playbook",
            "-i",
            inventory,
            str(runtime.ANSIBLE_DIRECTORY / "playbooks/deploy-staged.yml"),
            "--limit",
            host,
            "-e",
            extra,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        env=environment,
    )


def rollback_terminal(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> bool:
    try:
        runtime.playbook(
            inventory,
            target_spec["host"],
            target["previousSha"],
            run_id,
            rollback=True,
        )
        target["rollback"] = "success"
        runtime.state_command(
            "remove-client",
            "--run-id",
            run_id,
            "--client",
            target_spec["clientId"],
        )
        target["maintenanceClearedAt"] = runtime.utc_now()
        return True
    except Exception as rollback_error:
        target["rollback"] = f"failed: {rollback_error}"
        runtime.state_command("set-phase", "--run-id", run_id, "--phase", "failed")
        return False
