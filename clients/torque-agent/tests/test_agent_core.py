from pathlib import Path

import pytest

from torque_agent.binding import BindingStore
from torque_agent.config import AgentConfig
from torque_agent.hid_line_decoder import HidLineDecoder
from torque_agent.models import WorkBinding
from torque_agent.parser_registry import ParserRegistry, SyntheticDelimitedFixtureParser
from torque_agent.queue_store import QueueStore


def test_queue_survives_restart_and_keeps_event_identity(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite3"
    QueueStore(path).enqueue("event-1", {"sessionId": "s1", "payload": {"value": 30}})
    reopened = QueueStore(path)
    assert reopened.pending() == [("event-1", {"sessionId": "s1", "payload": {"value": 30}})]
    reopened.enqueue("event-1", {"different": True})
    assert reopened.count() == 1
    reopened.acknowledge("event-1")
    assert reopened.count() == 0


def test_synthetic_fixture_parser_is_explicit_and_complete() -> None:
    registry = ParserRegistry()
    registry.register(SyntheticDelimitedFixtureParser.PROFILE, SyntheticDelimitedFixtureParser)
    event = registry.create(SyntheticDelimitedFixtureParser.PROFILE).parse(
        "FIXTURE|serial=SN001|value=30.2|unit=N-m|memory=17|judgement=OK"
    )
    assert (event.serial_number, event.value, event.memory_counter) == ("SN001", 30.2, "17")
    with pytest.raises(ValueError, match="No verified parser"):
        registry.create("CEM3-BTLA-unverified")


def test_hid_decoder_handles_partial_and_continuous_lines() -> None:
    decoder = HidLineDecoder()
    assert decoder.feed("KEY_A") is None
    assert decoder.feed("KEY_1") is None
    assert decoder.feed("KEY_ENTER") == "a1"
    assert decoder.feed("KEY_B") is None
    assert decoder.feed("KEY_TAB") == "b"


def test_expired_binding_is_not_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 100.0
    monkeypatch.setattr("torque_agent.binding.time.monotonic", lambda: now)
    store = BindingStore(ttl_seconds=5)
    store.update(WorkBinding("session", "bolt", "confirmation", "profile"))
    assert store.current() is not None
    now = 106.0
    assert store.current() is None


def test_config_accepts_multiple_explicit_by_id_devices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv(
        "TORQUE_HID_DEVICES_JSON",
        '[{"path":"/dev/input/by-id/wrench-a","parserProfile":"fixture-a"},'
        '{"path":"/dev/input/by-id/wrench-b","parserProfile":"fixture-b"}]',
    )

    config = AgentConfig.from_env()

    assert [str(device.path) for device in config.devices] == [
        "/dev/input/by-id/wrench-a",
        "/dev/input/by-id/wrench-b",
    ]


def test_config_rejects_general_keyboard_event_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv(
        "TORQUE_HID_DEVICES_JSON",
        '[{"path":"/dev/input/event0","parserProfile":"fixture"}]',
    )

    with pytest.raises(ValueError, match="Only /dev/input/by-id"):
        AgentConfig.from_env()
