#!/usr/bin/env python3
"""
DGX gateway upstream client for stackchan-bridge.

Responsibility: HTTP calls to DGX (`/v1/chat/completions`, optional `/start`, ready probe).
Does not depend on BaseHTTPRequestHandler; keep bridge_server.py as routing/IO only.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class DgxUpstreamConfig:
    base_url: str
    llm_shared_token: str
    runtime_control_token: str
    chat_path: str = "/v1/chat/completions"
    runtime_start_path: str = "/start"
    runtime_ready_path: str = "/v1/models"
    upstream_timeout_sec: float = 45.0
    ready_timeout_sec: float = 600.0
    ready_poll_sec: float = 1.0
    auto_start: bool = False


class DgxUpstreamClient:
    def __init__(self, config: DgxUpstreamConfig) -> None:
        self._c = config

    @property
    def auto_start(self) -> bool:
        return self._c.auto_start

    def _llm_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._c.llm_shared_token:
            headers["X-LLM-Token"] = self._c.llm_shared_token
        return headers

    def _runtime_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._c.runtime_control_token:
            headers["X-Runtime-Control-Token"] = self._c.runtime_control_token
        return headers

    def ensure_runtime_ready(self) -> tuple[bool, dict[str, Any]]:
        """POST /start then poll GET ready path until 200 or timeout."""
        details: dict[str, Any] = {}
        if not self._c.auto_start:
            return False, {"message": "runtime auto start disabled"}
        if not self._c.runtime_control_token:
            return False, {"message": "runtime control token missing"}

        start_req = Request(
            url=f"{self._c.base_url}{self._c.runtime_start_path}",
            method="POST",
            headers=self._runtime_headers(),
            data=b"{}",
        )
        start_result: dict[str, Any] = {"attempted": True}
        try:
            with urlopen(start_req, timeout=self._c.upstream_timeout_sec) as resp:
                start_result["status"] = resp.getcode()
                start_result["body"] = resp.read().decode("utf-8", errors="ignore")[:1000]
        except HTTPError as e:
            start_result["status"] = e.code
            start_result["body"] = e.read().decode("utf-8", errors="ignore")[:1000]
            return False, {"start": start_result}
        except URLError as e:
            start_result["message"] = str(e)
            return False, {"start": start_result}
        except TimeoutError:
            start_result["message"] = "runtime start timed out"
            return False, {"start": start_result}

        deadline = time.monotonic() + self._c.ready_timeout_sec
        last_probe: dict[str, Any] = {}
        probe_timeout = min(self._c.upstream_timeout_sec, 10.0)

        while time.monotonic() < deadline:
            ready_req = Request(
                url=f"{self._c.base_url}{self._c.runtime_ready_path}",
                method="GET",
                headers=self._llm_headers(),
            )
            try:
                with urlopen(ready_req, timeout=probe_timeout) as resp:
                    body = resp.read().decode("utf-8", errors="ignore")[:1000]
                    return True, {"start": start_result, "ready": {"status": resp.getcode(), "body": body}}
            except HTTPError as e:
                last_probe = {"status": e.code, "body": e.read().decode("utf-8", errors="ignore")[:1000]}
            except URLError as e:
                last_probe = {"message": str(e)}
            except TimeoutError:
                last_probe = {"message": "runtime ready probe timed out"}
            time.sleep(self._c.ready_poll_sec)

        return False, {
            "start": start_result,
            "ready": last_probe,
            "message": "runtime did not become ready in time",
        }

    def post_chat_completions(self, body: bytes) -> tuple[int, dict[str, Any]]:
        """POST chat completions; returns (http_status, parsed_json). Raises on non-JSON 2xx edge cases."""
        req = Request(
            url=f"{self._c.base_url}{self._c.chat_path}",
            method="POST",
            headers=self._llm_headers(),
            data=body,
        )
        with urlopen(req, timeout=self._c.upstream_timeout_sec) as resp:
            raw = resp.read()
            status = resp.getcode()
            parsed = json.loads(raw.decode("utf-8"))
            return status, parsed


def config_from_env() -> DgxUpstreamConfig:
    import os

    base = os.getenv("DGX_BASE_URL", "http://100.118.82.72:38081").rstrip("/")
    auto = os.getenv("DGX_RUNTIME_AUTO_START", "").lower() in {"1", "true", "yes", "on"}
    return DgxUpstreamConfig(
        base_url=base,
        llm_shared_token=os.getenv("DGX_LLM_SHARED_TOKEN", ""),
        runtime_control_token=os.getenv("DGX_RUNTIME_CONTROL_TOKEN", ""),
        chat_path="/v1/chat/completions",
        runtime_start_path=os.getenv("DGX_RUNTIME_START_PATH", "/start"),
        runtime_ready_path=os.getenv("DGX_RUNTIME_READY_PATH", "/v1/models"),
        upstream_timeout_sec=float(os.getenv("UPSTREAM_TIMEOUT_SEC", "45")),
        ready_timeout_sec=float(os.getenv("DGX_RUNTIME_READY_TIMEOUT_SEC", "600")),
        ready_poll_sec=float(os.getenv("DGX_RUNTIME_READY_POLL_SEC", "1")),
        auto_start=auto,
    )
