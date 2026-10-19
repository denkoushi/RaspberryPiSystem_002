import asyncio
import json
from pathlib import Path
from typing import Any

import httpx

from torque_agent.binding import BindingStore
from torque_agent.config import AgentConfig
from torque_agent.connection_lease import ConnectionLeaseManager
from torque_agent.main import create_app
from torque_agent.queue_store import QueueStore


class FakeLeaseApi:
    def __init__(self, responses: list[Any]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, object] | None]] = []

    async def request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        self.calls.append((method, path, payload))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def _config(tmp_path: Path) -> AgentConfig:
    boot_id_path = tmp_path / "boot_id"
    boot_id_path.write_text("boot-test\n")
    return AgentConfig(
        api_base_url="http://127.0.0.1:3000",
        client_key="test-client",
        queue_path=tmp_path / "events.sqlite3",
        devices=(),
        browser_origins=("http://127.0.0.1:3000",),
        heartbeat_ttl_seconds=8,
        guard_directory=tmp_path / "guard",
        boot_id_path=boot_id_path,
    )


def _lease_body(
    *,
    state: str = "owned_by_self",
    profile_id: str = "profile",
    lease_id: str = "lease-1",
    generation: int = 1,
    session_id: str = "session",
    client_device_id: str = "client-device",
    connect_after: str = "2000-01-01T00:00:00.000Z",
) -> dict[str, Any]:
    return {
        "torqueWrenchProfileId": profile_id,
        "targetKind": "assembly",
        "state": state,
        "owner": {
            "clientDeviceName": "StoneBase",
            "clientDeviceLocation": "1F",
            "clientDeviceId": client_device_id,
            "sessionId": session_id,
            "ownerKind": "assembly",
        },
        "leaseId": lease_id,
        "generation": generation,
        "expiresAt": "2099-01-01T00:00:00.000Z",
        "connectAfter": connect_after,
    }


def _arm_guard(manager: ConnectionLeaseManager, tmp_path: Path) -> None:
    manager.status_path.parent.mkdir(parents=True, exist_ok=True)
    manager.status_path.write_text(
        json.dumps({"bootId": "boot-test", "powered": True, "controller": "hci-test"})
    )
    manager.mark_hid_exclusive(Path("/dev/input/by-id/wrench"), True)


def test_loopback_release_requires_exact_owner_and_token_and_is_idempotent(tmp_path: Path) -> None:
    fake_api = FakeLeaseApi(
        [
            (200, {"lease": _lease_body()}),
            (
                200,
                {
                    "lease": {
                        "torqueWrenchProfileId": "profile",
                        "state": "available",
                        "owner": None,
                        "expiresAt": None,
                        "connectAfter": None,
                    },
                    "result": "released",
                    "status": {
                        "torqueWrenchProfileId": "profile",
                        "state": "available",
                        "owner": None,
                        "expiresAt": None,
                        "connectAfter": None,
                    },
                },
            ),
        ]
    )
    config = _config(tmp_path)
    manager = ConnectionLeaseManager(config, BindingStore(8), api=fake_api)

    asyncio.run(
        manager.acquire(
            profile_id="profile",
            session_id="session",
            current_template_bolt_id="bolt",
            confirmation_id="confirmation",
            request_id="request-1",
        )
    )
    _arm_guard(manager, tmp_path)

    stale = asyncio.run(
        manager.release(
            "PAGE_LEFT",
            target_kind="assembly",
            session_id="old-session",
            profile_id="profile",
            lease_id="lease-old",
            generation=1,
        )
    )
    assert stale["result"] == "stale_noop"
    assert manager.active_event.is_set()
    assert manager.intent_path.exists()
    assert manager.snapshot()["selfOwnedToken"] == {
        "targetKind": "assembly",
        "sessionId": "session",
        "torqueWrenchProfileId": "profile",
        "leaseId": "lease-1",
        "generation": 1,
    }
    assert len(fake_api.calls) == 1

    released = asyncio.run(
        manager.release(
            "OPERATOR_RELEASE",
            target_kind="assembly",
            session_id="session",
            profile_id="profile",
            lease_id="lease-1",
            generation=1,
        )
    )
    assert released["result"] == "released"
    assert manager.snapshot()["leaseOwned"] is False
    assert manager.active_event.is_set() is False
    assert manager.intent_path.exists() is False
    assert manager._bindings.current() is None
    assert fake_api.calls[-1][2] == {
        "targetKind": "assembly",
        "sessionId": "session",
        "leaseId": "lease-1",
        "generation": 1,
        "reason": "OPERATOR_RELEASE",
    }

    absent = asyncio.run(
        manager.release(
            "PAGE_LEFT",
            target_kind="assembly",
            session_id="session",
            profile_id="profile",
            lease_id="lease-1",
            generation=1,
        )
    )
    assert absent["result"] == "already_absent"
    assert len(fake_api.calls) == 2


def test_loopback_status_exposes_self_token_but_never_other_owner_token(tmp_path: Path) -> None:
    held = {
        "state": "owned_by_other",
        "owner": {
            "clientDeviceName": "Assembly-01",
            "clientDeviceLocation": "2F",
            "clientDeviceId": "private-other-client",
            "sessionId": "private-other-session",
        },
        "leaseId": "private-other-lease",
        "generation": 77,
        "expiresAt": "2099-01-01T00:00:00.000Z",
        "connectAfter": "2099-01-01T00:00:00.000Z",
    }
    fake_api = FakeLeaseApi(
        [(409, {"errorCode": "TORQUE_WRENCH_LEASE_HELD", "details": {"lease": held}})]
    )
    config = _config(tmp_path)
    manager = ConnectionLeaseManager(config, BindingStore(8), api=fake_api)
    app = create_app(config, BindingStore(8), QueueStore(config.queue_path), manager)

    async def request_status() -> dict[str, Any]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://agent.test") as client:
            await client.post(
                "/lease/acquire",
                json={
                    "sessionId": "session",
                    "currentTemplateBoltId": "bolt",
                    "confirmationId": "confirmation",
                    "torqueWrenchProfileId": "profile",
                    "requestId": "request-1",
                },
            )
            response = await client.get("/health")
        return response.json()

    status = asyncio.run(request_status())
    assert status["state"] == "owned_by_other"
    assert status["owner"] == {
        "clientDeviceName": "Assembly-01",
        "clientDeviceLocation": "2F",
    }
    assert status["selfOwnedToken"] is None
    assert "leaseId" not in status
    assert "generation" not in status
    assert "private-other-client" not in json.dumps(status)
    assert "private-other-session" not in json.dumps(status)
    assert "private-other-lease" not in json.dumps(status)


def test_temporary_renew_loss_disarms_then_recovers_only_same_token(tmp_path: Path) -> None:
    fake_api = FakeLeaseApi(
        [
            (200, {"lease": _lease_body()}),
            httpx.ConnectError("Pi5 temporarily unavailable"),
            (200, {"lease": _lease_body()}),
        ]
    )
    config = _config(tmp_path)
    manager = ConnectionLeaseManager(config, BindingStore(8), api=fake_api)
    asyncio.run(
        manager.acquire(
            profile_id="profile",
            session_id="session",
            current_template_bolt_id="bolt",
            confirmation_id="confirmation",
            request_id="request-1",
        )
    )
    _arm_guard(manager, tmp_path)
    manager._reconcile_activation()
    assert manager.active_event.is_set()

    asyncio.run(manager._renew_once())
    recovering = manager.snapshot()
    assert recovering["state"] == "recovering"
    assert recovering["leaseOwned"] is True
    assert recovering["ready"] is False
    assert recovering["bound"] is True
    assert recovering["bluetoothPowered"] is True
    assert recovering["hidExclusive"] is False
    assert manager.active_event.is_set() is False
    assert manager.intent_path.exists() is False

    # Browser heartbeat refreshes the candidate binding but cannot arm it.
    heartbeat = asyncio.run(
        manager.heartbeat(
            session_id="session",
            current_template_bolt_id="bolt",
            confirmation_id="confirmation",
            profile_id="profile",
        )
    )
    assert heartbeat["state"] == "recovering"
    assert manager.active_event.is_set() is False

    asyncio.run(manager._renew_once())
    assert manager.snapshot()["state"] == "owned_by_self"
    assert manager.active_event.is_set()
    assert manager.intent_path.exists()
    assert [call[1] for call in fake_api.calls] == [
        "/api/torque-wrenches/profile/connection-lease/acquire",
        "/api/torque-wrenches/profile/connection-lease/renew",
        "/api/torque-wrenches/profile/connection-lease/renew",
    ]
    assert all("acquire" not in call[1] or call[0] == "POST" for call in fake_api.calls)
    assert fake_api.calls[-1][2] == {
        "sessionId": "session",
        "leaseId": "lease-1",
        "generation": 1,
    }


def test_recovery_discards_fenced_token_without_acquiring_a_successor(tmp_path: Path) -> None:
    fake_api = FakeLeaseApi(
        [
            (200, {"lease": _lease_body()}),
            httpx.ConnectError("Pi5 temporarily unavailable"),
            (409, {"errorCode": "TORQUE_WRENCH_LEASE_FENCED"}),
        ]
    )
    config = _config(tmp_path)
    manager = ConnectionLeaseManager(config, BindingStore(8), api=fake_api)
    asyncio.run(
        manager.acquire(
            profile_id="profile",
            session_id="session",
            current_template_bolt_id="bolt",
            confirmation_id="confirmation",
            request_id="request-1",
        )
    )
    _arm_guard(manager, tmp_path)
    manager._reconcile_activation()
    asyncio.run(manager._renew_once())
    asyncio.run(manager._renew_once())

    status = manager.snapshot()
    assert status["state"] == "fenced"
    assert status["leaseOwned"] is False
    assert status["bound"] is False
    assert status["ready"] is False
    assert manager.active_event.is_set() is False
    assert manager.intent_path.exists() is False
    assert [call[1].rsplit("/", 1)[-1] for call in fake_api.calls] == ["acquire", "renew", "renew"]


def test_recovery_discards_same_token_response_for_another_session(tmp_path: Path) -> None:
    fake_api = FakeLeaseApi(
        [
            (200, {"lease": _lease_body()}),
            httpx.ConnectError("Pi5 temporarily unavailable"),
            (200, {"lease": _lease_body(session_id="other-session")}),
        ]
    )
    config = _config(tmp_path)
    manager = ConnectionLeaseManager(config, BindingStore(8), api=fake_api)
    asyncio.run(
        manager.acquire(
            profile_id="profile",
            session_id="session",
            current_template_bolt_id="bolt",
            confirmation_id="confirmation",
            request_id="request-1",
        )
    )
    _arm_guard(manager, tmp_path)
    manager._reconcile_activation()
    asyncio.run(manager._renew_once())
    asyncio.run(manager._renew_once())

    assert manager.snapshot()["state"] == "fenced"
    assert manager.snapshot()["leaseOwned"] is False
    assert manager.active_event.is_set() is False
    assert manager.intent_path.exists() is False


def test_recovery_preserves_takeover_connect_after_guard_delay(tmp_path: Path) -> None:
    now = 2_000_000_000.0
    connect_after = "2033-05-18T03:33:21.000Z"
    fake_api = FakeLeaseApi(
        [
            (200, {"lease": _lease_body(state="handoff_wait", connect_after=connect_after)}),
            httpx.ConnectError("Pi5 temporarily unavailable"),
            (
                200,
                {
                    "lease": _lease_body(
                        state="handoff_wait",
                        connect_after=connect_after,
                    )
                },
            ),
        ]
    )
    config = _config(tmp_path)
    manager = ConnectionLeaseManager(
        config,
        BindingStore(8),
        api=fake_api,
        wall_time=lambda: now,
    )
    asyncio.run(
        manager.acquire(
            profile_id="profile",
            session_id="session",
            current_template_bolt_id="bolt",
            confirmation_id="confirmation",
            request_id="takeover-1",
            takeover=True,
            reason="physical wrench present",
        )
    )
    assert manager.active_event.is_set() is False
    assert manager.intent_path.exists() is False

    asyncio.run(manager._renew_once())
    asyncio.run(manager._renew_once())
    assert manager.snapshot()["state"] == "handoff_wait"
    assert manager.active_event.is_set() is False
    assert manager.intent_path.exists() is False

    now += 2
    manager._reconcile_activation()
    assert manager.active_event.is_set()
    assert manager.intent_path.exists()
