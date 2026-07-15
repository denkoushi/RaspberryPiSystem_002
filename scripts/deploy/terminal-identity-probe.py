#!/usr/bin/env python3
"""Prove that a terminal can authenticate without exposing its client key."""
from __future__ import annotations

import argparse
import json
import re
import shlex
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


CONFIG_PATH = Path("/etc/raspi-status-agent.conf")
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
MAX_RESPONSE_BYTES = 64 * 1024


class _RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> urllib.request.Request | None:
        del new_url
        raise urllib.error.HTTPError(
            request.full_url,
            code,
            "identity endpoint redirects are forbidden",
            headers,
            file_pointer,
        )


def _read_config(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, raw_value = line.partition("=")
        key = key.strip()
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            continue
        if key not in {
            "API_BASE_URL",
            "CLIENT_ID",
            "CLIENT_KEY",
            "REQUEST_TIMEOUT",
            "TLS_SKIP_VERIFY",
        }:
            continue
        parsed = shlex.split(raw_value, comments=True, posix=True)
        if len(parsed) != 1 or key in values:
            raise ValueError("status-agent configuration is malformed")
        values[key] = parsed[0]
    required = {"API_BASE_URL", "CLIENT_ID", "CLIENT_KEY"}
    if not required.issubset(values) or not all(values[key] for key in required):
        raise ValueError("status-agent configuration is incomplete")
    return values


def _positive_timeout(value: str) -> float:
    try:
        timeout = float(value)
    except ValueError as error:
        raise ValueError("status-agent timeout is malformed") from error
    if timeout <= 0 or timeout > 60:
        raise ValueError("status-agent timeout is outside the safe range")
    return timeout


def probe(expected_client_id: str, config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    if CLIENT_ID_RE.fullmatch(expected_client_id) is None:
        raise ValueError("expected client identity is malformed")
    config = _read_config(config_path)
    if config["CLIENT_ID"] != expected_client_id:
        raise RuntimeError("local client identity does not match inventory")

    request = urllib.request.Request(
        config["API_BASE_URL"].rstrip("/") + "/system/deploy-status/identity",
        headers={"x-client-key": config["CLIENT_KEY"], "accept": "application/json"},
        method="GET",
    )
    context = (
        ssl._create_unverified_context()
        if config.get("TLS_SKIP_VERIFY", "0") == "1"
        else ssl.create_default_context()
    )
    timeout = _positive_timeout(config.get("REQUEST_TIMEOUT", "10"))
    opener = urllib.request.build_opener(
        _RejectRedirect(), urllib.request.HTTPSHandler(context=context)
    )
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError("identity endpoint rejected the terminal")
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError("identity endpoint response is too large")
    decoded = json.loads(payload.decode("utf-8"))
    if not isinstance(decoded, dict):
        raise RuntimeError("identity endpoint response is malformed")
    if decoded.get("authenticated") is not True:
        raise RuntimeError("identity endpoint did not authenticate the terminal")
    if decoded.get("statusClientId") != expected_client_id:
        raise RuntimeError("identity endpoint returned a different terminal")
    return {"authenticated": True, "statusClientId": expected_client_id}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-client-id", required=True)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    args = parser.parse_args()
    try:
        result = probe(args.expected_client_id, args.config)
    except Exception:
        # Never print exception details: HTTP errors can include endpoint
        # context and config parsing failures must not disclose secret input.
        print("terminal identity verification failed", file=sys.stderr)
        return 1
    print("TERMINAL_IDENTITY_OK:" + result["statusClientId"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
