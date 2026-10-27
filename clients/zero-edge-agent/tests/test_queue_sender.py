import io
import json
import ssl
import urllib.error
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest

from zero_edge_agent.config import Config
from zero_edge_agent.queue import MAX_AGE_SECONDS, ScanQueue
from zero_edge_agent.sender import HttpClient, NoRedirect, Sender


@pytest.fixture
def queue(tmp_path):
    queue = ScanQueue(tmp_path / "queue.db")
    yield queue
    queue.close()


def test_queue_persists_orders_and_keeps_payload(tmp_path):
    path = tmp_path / "queue.db"
    queue = ScanQueue(path)
    at = datetime.fromisoformat("2026-10-27T14:03:00.123+09:00")
    later = queue.enqueue("later", 0, at + timedelta(seconds=1))
    first = queue.enqueue("first", 2, at)
    second = queue.enqueue("second", 3, at)
    assert uuid.UUID(first).version == 4
    assert len({later, first, second}) == 3
    assert queue.db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert queue.db.execute("PRAGMA synchronous").fetchone()[0] == 2
    queue.close()
    queue = ScanQueue(path)
    assert queue.oldest() == {"clientRecordId": first, "scannedAt": at.isoformat(timespec="milliseconds"),
                              "orderNumber": "first", "branchNo": 2}
    queue.delete(first)
    assert queue.oldest()["clientRecordId"] == second
    queue.delete(second)
    assert queue.oldest()["clientRecordId"] == later
    queue.close()


def test_queue_purges_only_older_than_seven_days(queue):
    now = datetime.now(timezone.utc)
    queue.enqueue("expired", 0, now - timedelta(seconds=MAX_AGE_SECONDS + 0.001))
    boundary = queue.enqueue("boundary", 0, now - timedelta(seconds=MAX_AGE_SECONDS))
    queue.enqueue("new", 0, now)
    assert queue.purge(now.timestamp()) == 1
    assert queue.oldest()["clientRecordId"] == boundary


def test_queue_requires_offset(queue):
    with pytest.raises(ValueError, match="timezone"):
        queue.enqueue("slip", 0, datetime(2026, 10, 27))


@pytest.mark.parametrize("status, deleted", [(200, True), (400, True), (422, True),
                                            (500, False), (503, False), (401, False),
                                            (403, False), (429, False), (302, False)])
def test_sender_status_handling(queue, status, deleted, caplog):
    record_id = queue.enqueue("001", 5, datetime.now().astimezone())
    post = Mock(return_value=status)
    sender = Sender(queue, post, lambda: True)
    delay = sender.step()
    assert (queue.oldest() is None) is deleted
    assert delay == (0 if deleted else 1)
    assert post.call_args.args[0]["clientRecordId"] == record_id
    if status in (401, 403):
        assert "AUTHENTICATION FAILED" in caplog.text
    if status in (400, 422):
        assert "removed scan" in caplog.text


@pytest.mark.parametrize("error", [urllib.error.URLError("SECRET"), TimeoutError("SECRET"), OSError("SECRET")])
def test_network_failures_keep_payload_without_logging_exception(queue, error, caplog):
    queue.enqueue("001", 0, datetime.now().astimezone())
    original = queue.oldest()
    sender = Sender(queue, Mock(side_effect=error), lambda: True)
    assert sender.step() == 1
    assert queue.oldest() == original
    assert "SECRET" not in caplog.text


def test_sender_backoff_order_reset_and_idempotency(queue):
    now = datetime.now().astimezone()
    first = queue.enqueue("first", 1, now)
    second = queue.enqueue("second", 0, now)
    post = Mock(return_value=500)
    sender = Sender(queue, post, lambda: True)
    assert [sender.step() for _ in range(11)] == [1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300]
    payloads = [call.args[0] for call in post.call_args_list]
    assert all(payload == payloads[0] for payload in payloads)
    assert payloads[0]["clientRecordId"] == first
    post.return_value = 200
    assert sender.step() == 0
    assert queue.oldest()["clientRecordId"] == second
    post.return_value = 503
    assert sender.step() == 1


def test_sender_never_sends_expired_records(queue):
    queue.enqueue("old", 0, datetime.now().astimezone() - timedelta(days=8))
    post = Mock()
    assert Sender(queue, post, lambda: True).step() == 1
    post.assert_not_called()
    assert queue.oldest() is None


def test_sender_waits_for_sync_before_purging_or_sending(queue):
    queue.enqueue("old", 0, datetime.now().astimezone() - timedelta(days=8))
    post = Mock()
    assert Sender(queue, post, lambda: False).step() == 1
    post.assert_not_called()
    assert queue.oldest() is not None


@pytest.mark.parametrize("skip_verify", [False, True])
def test_http_contract_and_tls(monkeypatch, skip_verify):
    contexts = []
    original_context = ssl.create_default_context
    def context():
        contexts.append(original_context())
        return contexts[-1]
    monkeypatch.setattr(ssl, "create_default_context", context)
    client = HttpClient(Config("https://example.test", "private-key", skip_verify))
    response = Mock(status=200)
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    client.opener = Mock()
    client.opener.open.return_value = response
    record = {"clientRecordId": str(uuid.uuid4()), "scannedAt": "2026-10-27T14:03:00.123+09:00",
              "orderNumber": "001-abc", "branchNo": 3}
    assert client.post(record) == 200
    request = client.opener.open.call_args.args[0]
    assert request.full_url == "https://example.test/api/mobile-placement/edge-scans"
    assert request.method == "POST"
    assert request.get_header("X-client-key") == "private-key"
    assert json.loads(request.data) == record
    assert client.opener.open.call_args.kwargs == {"timeout": 10}
    assert contexts[0].check_hostname is (not skip_verify)
    assert contexts[0].verify_mode == (ssl.CERT_NONE if skip_verify else ssl.CERT_REQUIRED)


def test_urllib_http_error_is_returned_and_closed():
    client = HttpClient(Config("https://example.test", "secret"))
    body = io.BytesIO(b'{"code":"EDGE_ORDER_NOT_FOUND"}')
    client.opener = Mock()
    client.opener.open.side_effect = urllib.error.HTTPError("https://example.test", 422, "invalid", {}, body)
    assert client.post({}) == 422
    assert body.closed
    assert NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.test") is None
