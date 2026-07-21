#!/usr/bin/env python3
"""Verify active deploying maintenance without exposing the client key."""
from __future__ import annotations

import argparse
import json
import math
import re
import shlex
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


CONFIG_PATH = Path("/etc/raspi-status-agent.conf")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
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
    ) -> None:
        del new_url
        raise urllib.error.HTTPError(
            request.full_url, code, "redirect forbidden", headers, file_pointer
        )


def _config(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, raw = line.partition("=")
        key = key.strip()
        if not separator or key not in {
            "API_BASE_URL",
            "CLIENT_ID",
            "CLIENT_KEY",
            "REQUEST_TIMEOUT",
            "TLS_SKIP_VERIFY",
        }:
            continue
        parsed = shlex.split(raw, comments=True, posix=True)
        if len(parsed) != 1 or key in values:
            raise ValueError("status configuration is malformed")
        values[key] = parsed[0]
    if not {"API_BASE_URL", "CLIENT_ID", "CLIENT_KEY"} <= set(values):
        raise ValueError("status configuration is incomplete")
    if any(ord(character) < 32 or ord(character) == 127 for character in values["CLIENT_KEY"]):
        raise ValueError("status configuration is malformed")
    return values


def _url(base: str) -> str:
    value = urllib.parse.urlsplit(base)
    if (
        value.scheme not in {"http", "https"}
        or not value.netloc
        or value.hostname is None
        or value.username is not None
        or value.password is not None
        or value.query
        or value.fragment
    ):
        raise ValueError("status URL is malformed")
    return base.rstrip("/") + "/system/deploy-status"


def _timeout(value: str) -> float:
    result = float(value)
    if not math.isfinite(result) or not 0 < result <= 60:
        raise ValueError("status timeout is malformed")
    return result


def probe(
    run_id: str,
    expected_client_id: str,
    *,
    config_path: Path = CONFIG_PATH,
) -> dict[str, Any]:
    if RUN_ID_RE.fullmatch(run_id) is None or CLIENT_ID_RE.fullmatch(expected_client_id) is None:
        raise ValueError("maintenance identity is malformed")
    config = _config(config_path)
    if config["CLIENT_ID"] != expected_client_id:
        raise RuntimeError("maintenance client identity does not match")
    request = urllib.request.Request(
        _url(config["API_BASE_URL"]),
        headers={"x-client-key": config["CLIENT_KEY"], "accept": "application/json"},
        method="GET",
    )
    skip_verify = config.get("TLS_SKIP_VERIFY", "0")
    if skip_verify not in {"0", "1"}:
        raise ValueError("status TLS policy is malformed")
    context = ssl._create_unverified_context() if skip_verify == "1" else ssl.create_default_context()
    opener = urllib.request.build_opener(
        _RejectRedirect(), urllib.request.HTTPSHandler(context=context)
    )
    with opener.open(
        request, timeout=_timeout(config.get("REQUEST_TIMEOUT", "10"))
    ) as response:
        if response.status != 200:
            raise RuntimeError("maintenance status was rejected")
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise RuntimeError("maintenance status is too large")
    value = json.loads(body.decode("utf-8"))
    if (
        not isinstance(value, dict)
        or value.get("isMaintenance") is not True
        or value.get("runId") != run_id
        or value.get("phase") != "deploying"
    ):
        raise RuntimeError("active deploying maintenance does not match")
    return {"runId": run_id, "clientId": expected_client_id, "maintenance": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--expected-client-id", required=True)
    args = parser.parse_args()
    try:
        probe(args.run_id, args.expected_client_id)
    except Exception:
        print("terminal maintenance verification failed", file=sys.stderr)
        return 1
    print("TERMINAL_MAINTENANCE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
