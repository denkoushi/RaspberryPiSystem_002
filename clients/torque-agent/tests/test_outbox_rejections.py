import asyncio
import json
import logging
import sqlite3
from pathlib import Path

import httpx
import pytest

from torque_agent.api_client import OutboxSender
from torque_agent.queue_store import QueueStore


def rejected_rows(path: Path) -> list[dict]:
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute("SELECT * FROM torque_outbox_rejected ORDER BY event_id")]


@pytest.mark.parametrize(
    ("target_kind", "error_code"),
    [
        ("training", "TRAINING_SESSION_STATE_CONFLICT"),
        ("training", "TRAINING_ATTEMPTS_COMPLETE"),
        ("assembly", "ASSEMBLY_WORK_UNIT_INVALIDATED"),
        ("assembly", "EVENT_SESSION_MISMATCH"),
    ],
)
def test_terminal_conflict_is_preserved_and_next_event_commits(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, target_kind: str, error_code: str
) -> None:
    path = tmp_path / "outbox.sqlite3"
    queue = QueueStore(path)
    envelope = {
        "sessionId": "closed-session",
        "capturedAt": "2026-10-05T00:00:00Z",
        "payload": {"targetKind": target_kind, "value": 10, "unit": "N-m"},
    }
    queue.enqueue("event-1", envelope)
    queue.enqueue("event-2", {"sessionId": "next-session", "payload": {"value": 11}})
    calls = []
    notifications = []
    response = httpx.Response(409, json={"errorCode": error_code, "message": "訓練は完了済み" + "x" * 1200})

    class Api:
        async def post(self, session_id, event_id, payload):
            calls.append((session_id, event_id, payload))
            return response if event_id == "event-1" else httpx.Response(200)

    class Notifier:
        async def committed(self, event):
            assert queue.count() == 0
            assert len(rejected_rows(path)) == 1
            notifications.append(event.source_event_key)

    sender = OutboxSender("http://server", "client", queue, notifier=Notifier())
    with caplog.at_level(logging.WARNING, logger="torque_agent.sender"):
        assert asyncio.run(sender._send_once(Api())) is True

    assert [call[1] for call in calls] == ["event-1", "event-2"]
    assert calls[0] == ("closed-session", "event-1", envelope["payload"])
    assert queue.count() == 0
    assert notifications == ["event-2"]
    row = rejected_rows(path)[0]
    assert row["event_id"] == "event-1"
    assert json.loads(row["payload"]) == envelope
    assert row["http_status"] == 409
    assert row["error_code"] == error_code
    assert row["response_body"] == response.text[:1000]
    assert row["created_at"]
    assert error_code in caplog.text
    assert "event-1 moved to rejected outbox" in caplog.text
    assert len(rejected_rows(QueueStore(path).path)) == 1


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (409, {"errorCode": "CONFIRMATION_STALE"}),
        (409, {"errorCode": "ASSEMBLY_SESSION_STATE_CONFLICT"}),
        (409, {"errorCode": "LEGACY_TRACEABILITY_MODE"}),
        (409, {"errorCode": "WRONG_CAPABILITY_GROUP"}),
        (409, {"code": "TRAINING_SESSION_STATE_CONFLICT"}),
        (409, {"errorCode": ["TRAINING_SESSION_STATE_CONFLICT"]}),
        (409, ["TRAINING_SESSION_STATE_CONFLICT"]),
        (409, {}),
        (400, {"errorCode": "TRAINING_SESSION_STATE_CONFLICT"}),
        (401, {"errorCode": "TRAINING_SESSION_STATE_CONFLICT"}),
        (403, {"errorCode": "TRAINING_SESSION_STATE_CONFLICT"}),
        (404, {"errorCode": "TRAINING_SESSION_STATE_CONFLICT"}),
        (500, {"errorCode": "TRAINING_SESSION_STATE_CONFLICT"}),
    ],
)
def test_other_rejections_remain_pending_and_stop_delivery(tmp_path: Path, status: int, body: object) -> None:
    queue = QueueStore(tmp_path / "outbox.sqlite3")
    queue.enqueue("event-1", {"sessionId": "session", "payload": {"targetKind": "training", "value": 10}})
    queue.enqueue("event-2", {"sessionId": "session", "payload": {"value": 11}})
    calls = []

    class Api:
        async def post(self, session_id, event_id, payload):
            calls.append(event_id)
            return httpx.Response(status, json=body)

    assert asyncio.run(OutboxSender("http://server", "client", queue)._send_once(Api())) is False
    assert calls == ["event-1"]
    assert queue.count() == 2
    assert rejected_rows(queue.path) == []
    with sqlite3.connect(queue.path) as connection:
        attempt_count, last_error = connection.execute(
            "SELECT attempt_count, last_error FROM torque_outbox WHERE event_id = 'event-1'"
        ).fetchone()
    assert attempt_count == 1
    assert last_error.startswith(f"HTTP {status}:")


@pytest.mark.parametrize(
    ("target_kind", "error_code"),
    [("assembly", "TRAINING_SESSION_STATE_CONFLICT"), ("training", "ASSEMBLY_WORK_UNIT_INVALIDATED")],
)
def test_terminal_codes_are_scoped_to_the_endpoint(tmp_path: Path, target_kind: str, error_code: str) -> None:
    queue = QueueStore(tmp_path / "outbox.sqlite3")
    queue.enqueue("event", {"sessionId": "session", "payload": {"targetKind": target_kind}})

    class Api:
        async def post(self, session_id, event_id, payload):
            return httpx.Response(409, json={"errorCode": error_code})

    assert asyncio.run(OutboxSender("http://server", "client", queue)._send_once(Api())) is False
    assert queue.count() == 1
    assert rejected_rows(queue.path) == []


@pytest.mark.parametrize("failure", ["non-json", "timeout", "network"])
def test_unidentified_or_transport_failure_keeps_queue(tmp_path: Path, failure: str) -> None:
    queue = QueueStore(tmp_path / "outbox.sqlite3")
    queue.enqueue("event", {"sessionId": "session", "payload": {"targetKind": "training"}})

    class Api:
        async def post(self, session_id, event_id, payload):
            if failure == "timeout":
                raise httpx.ReadTimeout("timeout")
            if failure == "network":
                raise httpx.ConnectError("offline")
            return httpx.Response(409, text="not JSON")

    assert asyncio.run(OutboxSender("http://server", "client", queue)._send_once(Api())) is False
    assert queue.count() == 1
    assert rejected_rows(queue.path) == []


def test_existing_database_gets_rejected_table_and_retention_limit(tmp_path: Path) -> None:
    path = tmp_path / "existing.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE torque_outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, "
            "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT)"
        )
        connection.execute(
            "INSERT INTO torque_outbox (event_id, payload) VALUES (?, ?)",
            ("event-0", json.dumps({"sessionId": "session", "payload": {"value": 10}})),
        )
    queue = QueueStore(path)
    queue.LOCAL_AUDIT_LIMIT = 2
    for index in range(3):
        event_id = f"event-{index}"
        queue.enqueue(event_id, {"sessionId": "session", "payload": {"value": 10}})
        queue.reject(event_id, 409, "TRAINING_ATTEMPTS_COMPLETE", "complete")

    assert queue.count() == 0
    assert [row["event_id"] for row in rejected_rows(path)] == ["event-1", "event-2"]
    assert [row["event_id"] for row in rejected_rows(QueueStore(path).path)] == ["event-1", "event-2"]


def test_failed_move_rolls_back_without_losing_event(tmp_path: Path) -> None:
    queue = QueueStore(tmp_path / "outbox.sqlite3")
    envelope = {"sessionId": "session", "payload": {"value": 10}}
    queue.enqueue("event", envelope)
    with sqlite3.connect(queue.path) as connection:
        connection.execute(
            "CREATE TRIGGER block_delete BEFORE DELETE ON torque_outbox "
            "BEGIN SELECT RAISE(ABORT, 'delete failed'); END"
        )

    with pytest.raises(sqlite3.IntegrityError, match="delete failed"):
        queue.reject("event", 409, "TRAINING_ATTEMPTS_COMPLETE", "complete")

    assert queue.pending() == [("event", envelope)]
    assert rejected_rows(queue.path) == []
