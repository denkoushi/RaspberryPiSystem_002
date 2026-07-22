from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .binding import BindingStore
from .config import AgentConfig
from .models import WorkBinding

LOGGER = logging.getLogger("torque_agent.lease")


def _parse_timestamp(value: object) -> float:
    if not isinstance(value, str):
        return 0.0
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _atomic_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class LeaseApiClient:
    def __init__(self, api_base_url: str, client_key: str, *, tls_verify: bool = True) -> None:
        self._api_base_url = api_base_url
        self._client_key = client_key
        self._tls_verify = tls_verify

    async def request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10, verify=self._tls_verify) as client:
            response = await client.request(
                method,
                f"{self._api_base_url}{path}",
                headers={"x-client-key": self._client_key},
                json=payload,
            )
        try:
            body = response.json()
        except ValueError:
            body = {"message": response.text}
        return response.status_code, body if isinstance(body, dict) else {"message": "invalid API response"}


@dataclass(frozen=True)
class LocalLease:
    profile_id: str
    session_id: str
    confirmation_id: str
    lease_id: str
    generation: int
    state: str
    expires_at: float
    connect_after: float


class ConnectionLeaseManager:
    """Fail-closed owner of browser binding, HID activation, and guard intent."""

    def __init__(
        self,
        config: AgentConfig,
        bindings: BindingStore,
        *,
        api: LeaseApiClient | None = None,
        monotonic: Any = time.monotonic,
        wall_time: Any = time.time,
    ) -> None:
        self._config = config
        self._bindings = bindings
        self._api = api or LeaseApiClient(config.api_base_url, config.client_key, tls_verify=config.tls_verify)
        self._monotonic = monotonic
        self._wall_time = wall_time
        self._lease: LocalLease | None = None
        self._public_lease: dict[str, Any] = {"state": "available", "owner": None}
        self._last_error: str | None = None
        self._blocked = False
        self._lock = asyncio.Lock()
        self._hid_paths: set[str] = set()
        self.active_event = asyncio.Event()
        self._boot_id = config.boot_id_path.read_text(encoding="utf-8").strip()
        if not self._boot_id:
            raise ValueError("kernel boot ID is unavailable")

    @property
    def intent_path(self) -> Path:
        return self._config.guard_directory / "intent.json"

    @property
    def status_path(self) -> Path:
        return self._config.guard_directory / "status.json"

    def _guard_status(self) -> dict[str, Any]:
        try:
            status = json.loads(self.status_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return {"powered": False, "controller": None, "reason": "GUARD_STATUS_UNAVAILABLE"}
        if not isinstance(status, dict) or status.get("bootId") != self._boot_id:
            return {"powered": False, "controller": None, "reason": "GUARD_STATUS_STALE"}
        return status

    def snapshot(self) -> dict[str, object]:
        binding = self._bindings.current()
        guard = self._guard_status()
        powered = guard.get("powered") is True
        hid_exclusive = bool(self._hid_paths)
        active = self.active_event.is_set()
        ready = bool(
            self._lease
            and binding
            and active
            and powered
            and hid_exclusive
            and binding.connection_lease_id == self._lease.lease_id
            and binding.connection_lease_generation == self._lease.generation
        )
        state = self._public_lease.get("state", "available")
        if self._last_error and self._lease is None:
            state = "communication_lost"
        if self._blocked and self._lease is None:
            state = "fenced"
        return {
            "ok": True,
            "ready": ready,
            "state": state,
            "owner": self._public_lease.get("owner"),
            "expiresAt": self._public_lease.get("expiresAt"),
            "connectAfter": self._public_lease.get("connectAfter"),
            "bound": binding is not None,
            "leaseOwned": self._lease is not None,
            "bluetoothPowered": powered,
            "bluetoothController": guard.get("controller"),
            "hidExclusive": hid_exclusive,
            "lastError": self._last_error,
        }

    def mark_hid_exclusive(self, path: Path, grabbed: bool) -> None:
        if grabbed:
            self._hid_paths.add(str(path))
        else:
            self._hid_paths.discard(str(path))

    def _write_guard_intent(self, lease: LocalLease) -> None:
        _atomic_json(
            self.intent_path,
            {
                "version": 1,
                "bootId": self._boot_id,
                "leaseId": lease.lease_id,
                "generation": lease.generation,
                "validUntilMonotonic": self._monotonic() + self._config.guard_intent_ttl_seconds,
            },
        )

    def _disarm(self) -> None:
        self.active_event.clear()
        self.intent_path.unlink(missing_ok=True)

    def _clear_local(self, reason: str | None, *, fenced: bool = False) -> LocalLease | None:
        previous = self._lease
        self._lease = None
        self._bindings.clear()
        self._disarm()
        self._last_error = reason
        self._blocked = fenced
        return previous

    def _binding_matches_lease(self, binding: WorkBinding | None, lease: LocalLease) -> bool:
        return bool(
            binding
            and binding.session_id == lease.session_id
            and binding.torque_wrench_profile_id == lease.profile_id
            and binding.connection_lease_id == lease.lease_id
            and binding.connection_lease_generation == lease.generation
        )

    def _reconcile_activation(self) -> None:
        lease = self._lease
        if not lease or not self._binding_matches_lease(self._bindings.current(), lease):
            self._disarm()
            return
        if self._wall_time() < lease.connect_after:
            self._disarm()
            return
        self._write_guard_intent(lease)
        self.active_event.set()
        self._public_lease = {**self._public_lease, "state": "owned_by_self"}

    @staticmethod
    def _lease_from_response(
        profile_id: str,
        session_id: str,
        confirmation_id: str,
        lease: dict[str, Any],
    ) -> LocalLease:
        lease_id = lease.get("leaseId")
        generation = lease.get("generation")
        if not isinstance(lease_id, str) or not isinstance(generation, int) or generation <= 0:
            raise ValueError("lease response omitted the owner token")
        return LocalLease(
            profile_id=profile_id,
            session_id=session_id,
            confirmation_id=confirmation_id,
            lease_id=lease_id,
            generation=generation,
            state=str(lease.get("state", "owned_by_self")),
            expires_at=_parse_timestamp(lease.get("expiresAt")),
            connect_after=_parse_timestamp(lease.get("connectAfter")),
        )

    async def acquire(
        self,
        *,
        profile_id: str,
        session_id: str,
        current_template_bolt_id: str,
        confirmation_id: str,
        request_id: str,
        takeover: bool = False,
        reason: str | None = None,
    ) -> dict[str, object]:
        async with self._lock:
            self._clear_local(None)
            endpoint = "takeover" if takeover else "acquire"
            payload: dict[str, object] = {
                "sessionId": session_id,
                "confirmationId": confirmation_id,
                "requestId": request_id,
            }
            if takeover:
                payload.update({"physicalWrenchPresent": True, "reason": reason or "physical wrench present"})
            try:
                status, body = await self._api.request(
                    "POST",
                    f"/api/torque-wrenches/{profile_id}/connection-lease/{endpoint}",
                    payload,
                )
            except (httpx.TimeoutException, httpx.NetworkError) as error:
                self._last_error = f"LEASE_API_UNAVAILABLE: {error}"
                return self.snapshot()
            if status < 200 or status >= 300:
                details = body.get("details")
                if isinstance(details, dict) and isinstance(details.get("lease"), dict):
                    self._public_lease = details["lease"]
                self._last_error = str(body.get("errorCode") or f"HTTP_{status}")
                self._blocked = self._last_error in {
                    "TORQUE_WRENCH_LEASE_FENCED",
                    "TORQUE_WRENCH_LEASE_EXPIRED",
                }
                return self.snapshot()
            lease_body = body.get("lease")
            if not isinstance(lease_body, dict):
                self._last_error = "INVALID_LEASE_RESPONSE"
                return self.snapshot()
            try:
                lease = self._lease_from_response(profile_id, session_id, confirmation_id, lease_body)
            except ValueError as error:
                self._last_error = str(error)
                return self.snapshot()
            self._lease = lease
            self._public_lease = lease_body
            self._last_error = None
            self._blocked = False
            self._bindings.update(
                WorkBinding(
                    session_id=session_id,
                    current_template_bolt_id=current_template_bolt_id,
                    confirmation_id=confirmation_id,
                    torque_wrench_profile_id=profile_id,
                    connection_lease_id=lease.lease_id,
                    connection_lease_generation=lease.generation,
                )
            )
            self._reconcile_activation()
            return self.snapshot()

    async def heartbeat(
        self,
        *,
        session_id: str,
        current_template_bolt_id: str | None,
        confirmation_id: str | None,
        profile_id: str | None,
    ) -> dict[str, object]:
        async with self._lock:
            lease = self._lease
            if not current_template_bolt_id or not confirmation_id or not profile_id:
                released = self._clear_local("BROWSER_DISARMED")
                if released:
                    await self._release_remote(released, "BROWSER_DISARMED")
                return self.snapshot()
            if not lease or lease.session_id != session_id or lease.profile_id != profile_id:
                return self.snapshot()
            self._bindings.update(
                WorkBinding(
                    session_id=session_id,
                    current_template_bolt_id=current_template_bolt_id,
                    confirmation_id=confirmation_id,
                    torque_wrench_profile_id=profile_id,
                    connection_lease_id=lease.lease_id,
                    connection_lease_generation=lease.generation,
                )
            )
            self._reconcile_activation()
            return self.snapshot()

    async def _release_remote(self, lease: LocalLease, reason: str) -> None:
        try:
            status, body = await self._api.request(
                "POST",
                f"/api/torque-wrenches/{lease.profile_id}/connection-lease/release",
                {
                    "sessionId": lease.session_id,
                    "leaseId": lease.lease_id,
                    "generation": lease.generation,
                    "reason": reason,
                },
            )
            if 200 <= status < 300 and isinstance(body.get("lease"), dict):
                self._public_lease = body["lease"]
                self._last_error = None
            else:
                self._last_error = str(body.get("errorCode") or f"HTTP_{status}")
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            self._last_error = f"LEASE_RELEASE_UNCONFIRMED: {error}"

    async def release(self, reason: str = "CLIENT_RELEASE") -> dict[str, object]:
        async with self._lock:
            lease = self._clear_local(None)
            if not lease:
                self._public_lease = {"state": "available", "owner": None}
                return self.snapshot()
            await self._release_remote(lease, reason)
            return self.snapshot()

    async def _renew_once(self) -> None:
        async with self._lock:
            lease = self._lease
            if not lease:
                return
            if not self._binding_matches_lease(self._bindings.current(), lease):
                released = self._clear_local("BROWSER_HEARTBEAT_EXPIRED")
                if released:
                    await self._release_remote(released, "BROWSER_HEARTBEAT_EXPIRED")
                return
            try:
                status, body = await self._api.request(
                    "POST",
                    f"/api/torque-wrenches/{lease.profile_id}/connection-lease/renew",
                    {
                        "sessionId": lease.session_id,
                        "leaseId": lease.lease_id,
                        "generation": lease.generation,
                    },
                )
            except (httpx.TimeoutException, httpx.NetworkError) as error:
                self._clear_local(f"LEASE_RENEW_FAILED: {error}")
                return
            lease_body = body.get("lease")
            if status < 200 or status >= 300 or not isinstance(lease_body, dict):
                error_code = str(body.get("errorCode") or f"HTTP_{status}")
                self._clear_local(
                    error_code,
                    fenced=error_code in {"TORQUE_WRENCH_LEASE_FENCED", "TORQUE_WRENCH_LEASE_EXPIRED"},
                )
                return
            self._lease = self._lease_from_response(
                lease.profile_id,
                lease.session_id,
                lease.confirmation_id,
                lease_body,
            )
            self._public_lease = lease_body
            self._last_error = None
            self._reconcile_activation()

    async def run(self) -> None:
        renew_due = self._monotonic()
        while True:
            await asyncio.sleep(0.1)
            if self._lease and self._bindings.current() is None:
                async with self._lock:
                    if self._lease and self._bindings.current() is None:
                        released = self._clear_local("BROWSER_HEARTBEAT_EXPIRED")
                        if released:
                            await self._release_remote(released, "BROWSER_HEARTBEAT_EXPIRED")
            if self._lease:
                self._reconcile_activation()
            now = self._monotonic()
            if now >= renew_due:
                renew_due = now + self._config.lease_renew_interval_seconds
                await self._renew_once()
