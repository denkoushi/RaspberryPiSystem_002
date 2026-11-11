from __future__ import annotations

from collections import deque
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from barcode_agent.config import AgentConfig, normalize_origin
from barcode_agent.main import WebSocketManager, create_app
from barcode_agent.serial_reader import SerialReaderStatus


@pytest.fixture
def client():
    config = AgentConfig(
        rest_host="127.0.0.1", rest_port=7072, log_level="INFO",
        serial_device="/dev/unused", serial_baud=9600,
        allowed_origins=("https://kiosk.example", "http://kiosk.example:8080"),
    )
    reader = Mock()
    reader.get_status.return_value = SerialReaderStatus()
    manager = WebSocketManager()
    with TestClient(create_app(config, reader, manager, deque(), {"event": None})) as test_client:
        yield test_client, manager


@pytest.mark.parametrize("origin", [None, "https://kiosk.example", "HTTPS://KIOSK.EXAMPLE:443/", "http://kiosk.example:8080"])
def test_websocket_accepts_allowed_or_missing_origin(client, origin):
    test_client, manager = client
    headers = {} if origin is None else {"Origin": origin}
    with test_client.websocket_connect("/stream", headers=headers):
        assert len(manager.connections) == 1


@pytest.mark.parametrize("origin", ["https://other.example", "http://kiosk.example", "https://kiosk.example:444", "null", "", "https://kiosk.example/path"])
def test_websocket_rejects_other_origins_before_accept(client, origin, caplog):
    test_client, manager = client
    with pytest.raises(WebSocketDisconnect) as exc:
        with test_client.websocket_connect("/stream", headers={"Origin": origin}):
            pytest.fail("Unexpected WebSocket acceptance")
    assert exc.value.code == 1008
    assert not manager.connections
    assert [record.getMessage() for record in caplog.records] == [f"Rejected WebSocket origin: {origin}"]


@pytest.mark.parametrize("origin,allowed", [
    ("https://kiosk.example", True),
    ("HTTPS://KIOSK.EXAMPLE:443/", True),
    ("http://kiosk.example:8080", True),
    ("https://other.example", False),
    ("null", False),
])
def test_cors_get_and_preflight(client, origin, allowed):
    test_client, _ = client
    response = test_client.get("/api/agent/status", headers={"Origin": origin, "Cookie": "session=fixture"})
    assert response.status_code == 200
    preflight = test_client.options("/api/agent/status", headers={
        "Origin": origin, "Access-Control-Request-Method": "GET",
    })
    assert preflight.status_code == (200 if allowed else 400)
    for result in (response, preflight):
        assert result.headers.get("access-control-allow-origin") == (origin if allowed else None)
        assert "access-control-allow-credentials" not in result.headers
    assert preflight.headers["access-control-allow-methods"] == "GET"
    assert test_client.options("/api/agent/status", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST",
    }).status_code == 400


@pytest.mark.parametrize("value,expected", [
    ("HTTPS://KIOSK.EXAMPLE:443/", "https://kiosk.example"),
    ("http://KIOSK.EXAMPLE:80///", "http://kiosk.example"),
    ("https://KIOSK.EXAMPLE:8443/", "https://kiosk.example:8443"),
    ("http://[::1]:80/", "http://[::1]"),
])
def test_normalize_origin(value, expected):
    assert normalize_origin(value) == expected


@pytest.mark.parametrize("value", ["*", "null", "https://host/path", "https://user@host", "https://host:bad", "https://host?query", "https://host#fragment"])
def test_normalize_origin_rejects_invalid_values(value):
    with pytest.raises(ValueError):
        normalize_origin(value)


def test_config_loads_comma_separated_origins(monkeypatch, tmp_path):
    monkeypatch.setattr("barcode_agent.config.load_dotenv", lambda: None)
    monkeypatch.setenv("QUEUE_DB_PATH", str(tmp_path / "queue.db"))
    monkeypatch.setenv("ALLOWED_ORIGINS", " HTTPS://KIOSK.EXAMPLE:443/ , ,http://SECOND.EXAMPLE:8080/ ")
    assert AgentConfig.load().allowed_origins == ("https://kiosk.example", "http://second.example:8080")


def test_config_defaults_to_no_browser_origins(monkeypatch, tmp_path):
    monkeypatch.setattr("barcode_agent.config.load_dotenv", lambda: None)
    monkeypatch.setenv("QUEUE_DB_PATH", str(tmp_path / "queue.db"))
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert AgentConfig.load().allowed_origins == ()
