from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import Mock

from fastapi.testclient import TestClient

from nfc_agent.config import AgentConfig
from nfc_agent.main import create_app
from nfc_agent.resend_worker import ResendWorker


class FakeQueue:
    def __init__(self, events):
        self.events = list(events)
        self.deleted: list[int] = []

    def count(self):
        return len(self.events)

    def list_events(self, limit=100):
        return self.events[:limit]

    def delete(self, event_ids):
        self.deleted.extend(event_ids)


class FakeManager:
    def __init__(self, results):
        self.connections = {object()}
        self.results = list(results)

    async def broadcast(self, _payload):
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def config() -> AgentConfig:
    return AgentConfig(
        rest_host="127.0.0.1",
        rest_port=7071,
        queue_db_path=Path("/tmp/test-nfc-queue.db"),
        log_level="INFO",
        agent_mode="mock",
        api_base_url=None,
        client_id=None,
        client_secret=None,
    )


def test_resend_keeps_queue_when_broadcast_has_no_receiver():
    queue = FakeQueue([(1, {"uid": "a"}), (2, {"uid": "b"})])
    worker = ResendWorker(queue, FakeManager([False]), config())

    asyncio.run(worker._resend_queued_events())

    assert queue.deleted == []


def test_resend_deletes_only_successful_prefix_before_failure():
    queue = FakeQueue([(1, {"uid": "a"}), (2, {"uid": "b"}), (3, {"uid": "c"})])
    worker = ResendWorker(queue, FakeManager([True, False]), config())

    asyncio.run(worker._resend_queued_events())

    assert queue.deleted == [1]


def test_resend_exception_preserves_failed_event_and_remaining_order():
    queue = FakeQueue([(1, {"uid": "a"}), (2, {"uid": "b"})])
    worker = ResendWorker(queue, FakeManager([RuntimeError("send failed")]), config())

    asyncio.run(worker._resend_queued_events())

    assert queue.deleted == []


def test_removed_control_routes_return_404():
    queue = FakeQueue([])
    reader = Mock()
    reader.get_status.return_value = Mock(
        connected=True,
        reader_name="mock",
        message="ready",
        last_error=None,
    )
    manager = FakeManager([])
    app = create_app(config(), queue, reader, manager, {"event": None})
    client = TestClient(app)

    for route in ("/api/agent/flush", "/api/agent/reboot", "/api/agent/poweroff"):
        assert client.post(route).status_code == 404


def test_default_bind_is_loopback(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("REST_HOST", raising=False)
    monkeypatch.delenv("WEBSOCKET_HOST", raising=False)
    monkeypatch.setenv("QUEUE_DB_PATH", str(tmp_path / "queue.db"))

    loaded = AgentConfig.load()

    assert loaded.rest_host == "127.0.0.1"
