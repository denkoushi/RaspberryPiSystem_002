#!/usr/bin/env python3
"""Prove one inventory-required kiosk agent at final fleet observation."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


_AGENTS = {"nfc-agent": 7071, "barcode-agent": None}
_MAX_RESPONSE_BYTES = 64 * 1024
_CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{12,64}$")


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


def _container(repository: Path, compose_file: Path, agent: str) -> None:
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


def _endpoint(agent: str, port: int) -> None:
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), _NoRedirect(), urllib.request.HTTPHandler()
    )
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/agent/status",
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with opener.open(request, timeout=10) as response:
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


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", choices=sorted(_AGENTS), required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--compose-file", type=Path, required=True)
    parser.add_argument("--require-pcscd", action="store_true")
    parser.add_argument("--ansible-marker", action="store_true")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if not 1 <= args.port <= 65535:
            raise ProbeError("kiosk agent status port is malformed")
        fixed_port = _AGENTS[args.agent]
        if fixed_port is not None and args.port != fixed_port:
            raise ProbeError("kiosk agent status port violates the runtime contract")
        if not args.repository.is_absolute() or not args.compose_file.is_absolute():
            raise ProbeError("kiosk agent runtime paths must be absolute")
        if args.require_pcscd:
            if args.agent != "nfc-agent":
                raise ProbeError("pcscd is only valid for nfc-agent")
            _run(["systemctl", "is-enabled", "--quiet", "pcscd.service"])
            _run(["systemctl", "is-active", "--quiet", "pcscd.service"])
        _container(args.repository, args.compose_file, args.agent)
        _endpoint(args.agent, args.port)
        if args.ansible_marker:
            print(f"TERMINAL_AGENT_HEALTH_OK:{args.agent}:{args.port}")
        return 0
    except ProbeError as error:
        print(f"terminal agent health proof failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
