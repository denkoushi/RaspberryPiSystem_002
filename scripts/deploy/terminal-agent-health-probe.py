#!/usr/bin/env python3
"""Prove one inventory-required kiosk agent at final fleet observation."""
from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


_AGENTS = {"nfc-agent": 7071, "barcode-agent": 7072, "torque-agent": 7073}
_PORT_ENVIRONMENT = {
    "nfc-agent": "REST_PORT",
    "barcode-agent": "REST_PORT",
    "torque-agent": "TORQUE_LOCAL_PORT",
}
_MAX_RESPONSE_BYTES = 64 * 1024
_CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{12,64}$")
_STABILITY_REQUIRED_SUCCESSES = 2
_STABILITY_MAX_ATTEMPTS = 3
_STABILITY_INTERVAL_SECONDS = 1.0
_ENDPOINT_TIMEOUT_SECONDS = 3


class ProbeError(RuntimeError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


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
        raise ProbeError("required kiosk agent runtime is not active") from error
    return result.stdout


def _container(repository: Path, compose_file: Path, agent: str) -> str:
    output = _run(
        [
            "docker",
            "compose",
            "-f",
            str(compose_file),
            "ps",
            "--status",
            "running",
            "-q",
            agent,
        ],
        cwd=repository,
    )
    identifiers = [line.strip() for line in output.splitlines() if line.strip()]
    if len(identifiers) != 1 or _CONTAINER_ID_RE.fullmatch(identifiers[0]) is None:
        raise ProbeError("required kiosk agent container is not uniquely running")
    return identifiers[0]


def _container_port(identifier: str, agent: str) -> int:
    """Resolve the live port from the restored container, never from new inventory."""

    if _CONTAINER_ID_RE.fullmatch(identifier) is None or agent not in _PORT_ENVIRONMENT:
        raise ProbeError("required kiosk agent runtime identity is malformed")
    raw = _run(
        [
            "docker",
            "container",
            "inspect",
            "--format",
            "{{json .Config.Env}}",
            identifier,
        ]
    )
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ProbeError("kiosk agent runtime environment is malformed") from error
    if not isinstance(entries, list) or any(not isinstance(item, str) for item in entries):
        raise ProbeError("kiosk agent runtime environment is malformed")
    key = _PORT_ENVIRONMENT[agent]
    values = [item[len(key) + 1 :] for item in entries if item.startswith(f"{key}=")]
    if len(values) > 1:
        raise ProbeError("kiosk agent runtime port is ambiguous")
    raw_port = values[0] if values else str(_AGENTS[agent])
    if re.fullmatch(r"[0-9]{1,5}", raw_port) is None:
        raise ProbeError("kiosk agent runtime port is malformed")
    port = int(raw_port)
    if not 1 <= port <= 65535:
        raise ProbeError("kiosk agent runtime port is malformed")
    if agent in {"nfc-agent", "torque-agent"} and port != _AGENTS[agent]:
        raise ProbeError("kiosk agent runtime port violates the runtime contract")
    return port


def _endpoint(agent: str, port: int) -> None:
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), _NoRedirect(), urllib.request.HTTPHandler()
    )
    endpoint_path = "/health" if agent == "torque-agent" else "/api/agent/status"
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{endpoint_path}",
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with opener.open(request, timeout=_ENDPOINT_TIMEOUT_SECONDS) as response:
            if response.status != 200 or response.headers.get_content_type() != "application/json":
                raise ProbeError("kiosk agent status endpoint is unhealthy")
            body = response.read(_MAX_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ProbeError("kiosk agent status endpoint is unavailable") from error
    if len(body) > _MAX_RESPONSE_BYTES:
        raise ProbeError("kiosk agent status response is too large")
    try:
        value = json.loads(
            body.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda constant: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {constant}")
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ProbeError("kiosk agent status response is malformed") from error
    if agent == "torque-agent":
        if (
            not isinstance(value, dict)
            or value.get("ok") is not True
            or isinstance(value.get("queuedEvents"), bool)
            or not isinstance(value.get("queuedEvents"), int)
            or value["queuedEvents"] < 0
            or type(value.get("bound")) is not bool
        ):
            raise ProbeError("torque-agent health contract is malformed")
        return
    if (
        not isinstance(value, dict)
        or type(value.get("readerConnected")) is not bool
        or not isinstance(value.get("message"), str)
    ):
        raise ProbeError("kiosk agent status contract is malformed")
    if agent == "nfc-agent":
        queue_size = value.get("queueSize")
        if isinstance(queue_size, bool) or not isinstance(queue_size, int) or queue_size < 0:
            raise ProbeError("nfc-agent status contract is malformed")
    elif value.get("restPort") != port:
        raise ProbeError("barcode-agent status port does not match inventory")


def _pcsc_runtime(socket_path: str = "/run/pcscd/pcscd.comm") -> None:
    load_state = _run(
        ["systemctl", "show", "--property=LoadState", "--value", "pcscd.socket"]
    ).strip()
    if load_state != "loaded":
        raise ProbeError("PC/SC socket unit is not loaded")
    _run(["systemctl", "is-enabled", "--quiet", "pcscd.socket"])
    _run(["systemctl", "is-active", "--quiet", "pcscd.socket"])
    try:
        socket_state = os.stat(socket_path, follow_symlinks=False)
    except OSError as error:
        raise ProbeError("PC/SC communication socket is unavailable") from error
    if not stat.S_ISSOCK(socket_state.st_mode):
        raise ProbeError("PC/SC communication path is not a socket")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", choices=sorted(_AGENTS), required=True)
    parser.add_argument("--port", type=int)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--compose-file", type=Path, required=True)
    parser.add_argument("--require-pcscd", action="store_true")
    parser.add_argument("--ansible-marker", action="store_true")
    return parser


def _validate_arguments(args: argparse.Namespace) -> None:
    if args.port is not None:
        if not 1 <= args.port <= 65535:
            raise ProbeError("kiosk agent status port is malformed")
        if args.agent in {"nfc-agent", "torque-agent"} and args.port != _AGENTS[args.agent]:
            raise ProbeError("kiosk agent status port violates the runtime contract")
    if not args.repository.is_absolute() or not args.compose_file.is_absolute():
        raise ProbeError("kiosk agent runtime paths must be absolute")
    if args.require_pcscd and args.agent != "nfc-agent":
        raise ProbeError("pcscd is only valid for nfc-agent")


def _probe_once(args: argparse.Namespace) -> int:
    if args.require_pcscd:
        _pcsc_runtime()
    identifier = _container(args.repository, args.compose_file, args.agent)
    port = args.port if args.port is not None else _container_port(identifier, args.agent)
    _endpoint(args.agent, port)
    return port


def _stable_probe(
    args: argparse.Namespace,
    *,
    sleep: Any = time.sleep,
    required_successes: int = _STABILITY_REQUIRED_SUCCESSES,
    max_attempts: int = _STABILITY_MAX_ATTEMPTS,
    interval_seconds: float = _STABILITY_INTERVAL_SECONDS,
) -> int:
    """Require consecutive complete proofs instead of accepting one instant."""

    consecutive = 0
    last_port: int | None = None
    last_error: ProbeError | None = None
    for attempt in range(max_attempts):
        try:
            last_port = _probe_once(args)
        except ProbeError as error:
            consecutive = 0
            last_error = error
        else:
            consecutive += 1
            if consecutive >= required_successes:
                return last_port
        if attempt + 1 < max_attempts:
            sleep(interval_seconds)
    if last_error is not None:
        raise ProbeError(
            f"required kiosk agent runtime did not stabilize: {last_error}"
        ) from last_error
    raise ProbeError("required kiosk agent runtime did not remain stable")


def main() -> int:
    args = _parser().parse_args()
    try:
        _validate_arguments(args)
        port = _stable_probe(args)
        if args.ansible_marker:
            print(f"TERMINAL_AGENT_HEALTH_OK:{args.agent}:{port}")
        return 0
    except ProbeError as error:
        print(f"terminal agent health proof failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
