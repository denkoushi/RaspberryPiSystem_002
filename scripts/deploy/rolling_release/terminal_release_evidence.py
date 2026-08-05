"""Collect one terminal's final release evidence through one SSH transport.

This module is packaged as a zip application with the existing standalone
identity and kiosk-agent probes. It composes those unchanged proofs with Git
and systemd checks and emits one strict, non-secret marker.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
UNIT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.(?:service|timer|socket|path|target|mount)$"
)
AGENT_RE = re.compile(r"^(nfc-agent|barcode-agent|torque-agent):(auto|[0-9]{1,5}):(0|1)$")
MARKER_PREFIX = "TERMINAL_RELEASE_EVIDENCE_RESULT:"
REPOSITORY = Path("/opt/RaspberryPiSystem_002")
COMPOSE_FILE = REPOSITORY / "infrastructure/docker/docker-compose.client.yml"
SIGNAGE_ARTIFACT = Path("/usr/local/bin/raspi-signage-status-agent.pyz")


class EvidenceError(RuntimeError):
    pass


def _run(command: list[str], *, cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=True,
            text=True,
            capture_output=True,
            env={"PATH": os.environ.get("PATH", "")},
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise EvidenceError("terminal runtime command failed") from error
    return result.stdout


def _current_sha(repository: Path) -> str:
    # The evidence bundle runs under Ansible become because the remaining
    # systemd and Docker proofs require root.  Do not depend on root's ambient
    # Git configuration to trust the terminal-user-owned checkout: scope the
    # trust exception to this one fixed repository and this one read-only Git
    # invocation.  This mirrors the existing deployment checkout contract and
    # does not persist safe.directory configuration on the terminal.
    sha = _run(
        [
            "git",
            "-c",
            f"safe.directory={repository}",
            "-C",
            str(repository),
            "rev-parse",
            "HEAD",
        ]
    ).strip()
    if FULL_SHA_RE.fullmatch(sha) is None:
        raise EvidenceError("terminal HEAD is not immutable")
    return sha


def _signage_artifact_identity(path: Path) -> tuple[str, str, str]:
    try:
        metadata = path.stat(follow_symlinks=False)
        if not path.is_file() or path.is_symlink() or metadata.st_size > 1024 * 1024:
            raise EvidenceError("signage artifact is unsafe")
        payload = path.read_bytes()
        with zipfile.ZipFile(path) as archive:
            manifest = json.loads(archive.read("SIGNAGE-RELEASE.json").decode("utf-8"))
    except (OSError, UnicodeError, ValueError, KeyError, zipfile.BadZipFile) as error:
        raise EvidenceError("signage artifact identity is unavailable") from error
    source_sha = manifest.get("sourceSha") if isinstance(manifest, dict) else None
    digest = hashlib.sha256(payload).hexdigest()
    if (
        not isinstance(source_sha, str)
        or FULL_SHA_RE.fullmatch(source_sha) is None
        or manifest.get("profile") != "signage"
    ):
        raise EvidenceError("signage artifact identity is malformed")
    return source_sha, digest, f"git:{source_sha}@sha256:{digest}"


def _parse_agent_spec(value: str) -> tuple[str, int | None, bool]:
    match = AGENT_RE.fullmatch(value)
    if match is None:
        raise EvidenceError("terminal agent specification is malformed")
    agent, raw_port, raw_pcsc = match.groups()
    port = None if raw_port == "auto" else int(raw_port)
    if port is not None and not 1 <= port <= 65535:
        raise EvidenceError("terminal agent port is malformed")
    require_pcscd = raw_pcsc == "1"
    if require_pcscd != (agent == "nfc-agent"):
        raise EvidenceError("PC/SC proof must exactly match the NFC agent")
    return agent, port, require_pcscd


def collect(
    *,
    expected_client_id: str,
    services: list[str],
    check_status_agent_result: bool,
    agent_specs: list[str],
    maintenance_agents: list[str] | None = None,
    repository: Path = REPOSITORY,
    compose_file: Path = COMPOSE_FILE,
    signage_artifact: bool = False,
) -> dict[str, Any]:
    if (
        not services
        or len(services) != len(set(services))
        or any(UNIT_RE.fullmatch(unit) is None for unit in services)
    ):
        raise EvidenceError("terminal systemd proof request is malformed")
    parsed_agents = [_parse_agent_spec(value) for value in agent_specs]
    agent_names = [agent for agent, _port, _pcsc in parsed_agents]
    if len(agent_names) != len(set(agent_names)):
        raise EvidenceError("terminal agent proof request contains duplicates")
    maintained = list(maintenance_agents or [])
    if (
        len(maintained) != len(set(maintained))
        or any(agent not in agent_names for agent in maintained)
    ):
        raise EvidenceError("terminal maintenance agent proof request is malformed")

    if signage_artifact:
        current_sha, artifact_digest, artifact_identity = _signage_artifact_identity(
            SIGNAGE_ARTIFACT
        )
    else:
        current_sha = _current_sha(repository)
    for service in services:
        _run(["systemctl", "is-active", "--quiet", service])

    oneshot_services: list[str] = []
    if check_status_agent_result:
        result = _run(
            [
                "systemctl",
                "show",
                "--property=Result",
                "--value",
                "status-agent.service",
            ]
        ).strip()
        if result != "success":
            raise EvidenceError("status-agent oneshot result is not successful")
        oneshot_services.append("status-agent.service")

    identity_probe = importlib.import_module("terminal_identity_probe")
    identity = identity_probe.probe(expected_client_id)
    if identity != {"authenticated": True, "statusClientId": expected_client_id}:
        raise EvidenceError("terminal identity proof is malformed")

    agent_health = importlib.import_module("terminal_agent_health_probe")
    endpoints: list[dict[str, Any]] = []
    for agent, port, require_pcscd in parsed_agents:
        probe_args = argparse.Namespace(
            agent=agent,
            port=port,
            repository=repository,
            compose_file=compose_file,
            require_pcscd=require_pcscd,
            allow_device_disconnected=agent in maintained,
            ansible_marker=False,
        )
        agent_health._validate_arguments(probe_args)
        proven_port = agent_health._stable_probe(probe_args)
        if port is not None and proven_port != port:
            raise EvidenceError("terminal agent proof returned a different port")
        endpoints.append({"agent": agent, "port": proven_port})

    result = {
        "version": 1,
        "currentSha": current_sha,
        "activeSystemdUnits": services,
        "oneshotServices": oneshot_services,
        "identity": identity,
        "agentContainers": agent_names,
        "authenticatedAgentEndpoints": endpoints,
        "pcscdRequired": "nfc-agent" in agent_names,
    }
    if signage_artifact:
        result["artifactSha256"] = artifact_digest
        result["releaseArtifactIdentity"] = artifact_identity
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-client-id", required=True)
    parser.add_argument("--service", action="append", default=[])
    parser.add_argument("--check-status-agent-result", action="store_true")
    parser.add_argument("--agent-spec", action="append", default=[])
    parser.add_argument("--maintenance-agent", action="append", default=[])
    parser.add_argument("--repository", type=Path, default=REPOSITORY)
    parser.add_argument("--compose-file", type=Path, default=COMPOSE_FILE)
    parser.add_argument("--signage-artifact", action="store_true")
    parser.add_argument("--ansible-marker", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = collect(
            expected_client_id=args.expected_client_id,
            services=args.service,
            check_status_agent_result=args.check_status_agent_result,
            agent_specs=args.agent_spec,
            maintenance_agents=args.maintenance_agent,
            repository=args.repository,
            compose_file=args.compose_file,
            signage_artifact=args.signage_artifact,
        )
    except Exception:
        # Identity probe failures may carry endpoint or secret-adjacent context.
        # Never include exception text in output transported to the controller.
        print("terminal release evidence failed", file=sys.stderr)
        return 1
    encoded = json.dumps(
        result, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    if args.ansible_marker:
        print(MARKER_PREFIX + base64.urlsafe_b64encode(encoded).decode("ascii"))
    else:
        print(encoded.decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
