import asyncio
import json
from pathlib import Path

import pytest

from torque_agent.binding import BindingStore
from torque_agent.config import AgentConfig
from torque_agent.hid_line_decoder import DecodedHidFrame, HidLineDecoder
from torque_agent.ingestor import TorqueEventIngestor
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


def test_unbound_and_malformed_hid_input_is_retained_in_local_sqlite_audit(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite3"
    queue = QueueStore(path)
    bindings = BindingStore(ttl_seconds=5)
    device_path = Path("/dev/input/by-id/test-wrench")
    parser = SyntheticDelimitedFixtureParser()
    event_ids = iter(["unbound-1", "malformed-1", "valid-1"])
    ingestor = TorqueEventIngestor(
        queue=queue,
        bindings=bindings,
        parsers={device_path: parser},
        parser_profiles={device_path: parser.PROFILE},
        event_id_factory=lambda: next(event_ids),
    )

    asyncio.run(ingestor.on_line(device_path, "FIXTURE|serial=SN001|value=30|unit=N-m|memory=1"))
    bindings.update(WorkBinding("session", "bolt", "confirmation", "profile"))
    asyncio.run(ingestor.on_line(device_path, "not-a-valid-fixture"))
    asyncio.run(ingestor.on_line(device_path, "FIXTURE|serial=SN001|value=30|unit=N-m|memory=2"))

    reopened = QueueStore(path)
    assert reopened.pending() == [
        (
            "valid-1",
            {
                "sessionId": "session",
                "payload": {
                    "expectedTemplateBoltId": "bolt",
                    "confirmationId": "confirmation",
                    "serialNumber": "SN001",
                    "value": 30.0,
                    "unit": "N-m",
                    "deviceRecordedAt": None,
                    "deviceMemoryCounter": "2",
                    "deviceJudgement": None,
                    "rawPayload": {
                        "rawText": "FIXTURE|serial=SN001|value=30|unit=N-m|memory=2",
                        "devicePath": str(device_path),
                        "parserProfile": parser.PROFILE,
                    },
                },
            },
        )
    ]
    assert reopened.local_error_count() == 2
    assert {row["reason"] for row in reopened.local_errors()} == {
        "BINDING_MISSING_OR_EXPIRED",
        "PAYLOAD_PARSE_FAILED",
    }


def test_unsupported_hid_frame_is_retained_without_forwarding_an_altered_payload(tmp_path: Path) -> None:
    queue = QueueStore(tmp_path / "events.sqlite3")
    device_path = Path("/dev/input/by-id/test-wrench")
    parser = SyntheticDelimitedFixtureParser()
    ingestor = TorqueEventIngestor(
        queue=queue,
        bindings=BindingStore(ttl_seconds=5),
        parsers={device_path: parser},
        parser_profiles={device_path: parser.PROFILE},
        event_id_factory=lambda: "decode-error-1",
    )
    frame = DecodedHidFrame(
        text="partial",
        terminator="KEY_TAB",
        key_codes=("KEY_P", "KEY_F13"),
        unsupported_key_codes=("KEY_F13",),
    )

    asyncio.run(ingestor.on_decode_error(device_path, frame))

    assert queue.count() == 0
    error = queue.local_errors()[0]
    assert error["reason"] == "HID_DECODE_FAILED"
    assert json.loads(error["raw_text"]) == {
        "keyCodes": ["KEY_P", "KEY_F13"],
        "terminator": "KEY_TAB",
        "unsupportedKeyCodes": ["KEY_F13"],
    }


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
    assert decoder.feed("KEY_ENTER") == DecodedHidFrame("a1", "KEY_ENTER", ("KEY_A", "KEY_1"), ())
    assert decoder.feed("KEY_B") is None
    assert decoder.feed("KEY_TAB") == DecodedHidFrame("b", "KEY_TAB", ("KEY_B",), ())


def test_hid_decoder_retains_unknown_keys_and_actual_terminator() -> None:
    decoder = HidLineDecoder()
    assert decoder.feed("KEY_A") is None
    assert decoder.feed("KEY_F13") is None
    assert decoder.feed("KEY_KPENTER") == DecodedHidFrame(
        "a",
        "KEY_KPENTER",
        ("KEY_A", "KEY_F13"),
        ("KEY_F13",),
    )


def test_hid_decoder_tracks_standard_shifted_keys_without_guessing_payload_format() -> None:
    decoder = HidLineDecoder()
    assert decoder.feed("KEY_LEFTSHIFT", "down") is None
    assert decoder.feed("KEY_A", "down") is None
    assert decoder.feed("KEY_A", "up") is None
    assert decoder.feed("KEY_LEFTSHIFT", "up") is None
    assert decoder.feed("KEY_SEMICOLON", "down") is None
    assert decoder.feed("KEY_TAB", "down") == DecodedHidFrame(
        "A;",
        "KEY_TAB",
        ("KEY_LEFTSHIFT", "KEY_A", "KEY_SEMICOLON"),
        (),
    )


def test_expired_binding_is_not_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 100.0
    monkeypatch.setattr("torque_agent.binding.time.monotonic", lambda: now)
    store = BindingStore(ttl_seconds=5)
    store.update(WorkBinding("session", "bolt", "confirmation", "profile"))
    assert store.current() is not None
    store.clear()
    assert store.current() is None
    store.update(WorkBinding("session", "bolt", "confirmation", "profile"))
    now = 106.0
    assert store.current() is None


def test_config_accepts_multiple_explicit_by_id_devices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv("TORQUE_BROWSER_ORIGINS_JSON", '["https://kiosk.example.test"]')
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
    assert config.browser_origins == ("http://127.0.0.1:3000", "https://kiosk.example.test")


def test_config_rejects_general_keyboard_event_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv(
        "TORQUE_HID_DEVICES_JSON",
        '[{"path":"/dev/input/event0","parserProfile":"fixture"}]',
    )

    with pytest.raises(ValueError, match="Only /dev/input/by-id"):
        AgentConfig.from_env()


def test_config_rejects_wildcard_browser_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv("TORQUE_BROWSER_ORIGINS_JSON", '["*"]')

    with pytest.raises(ValueError, match=r"must be an http\(s\) origin"):
        AgentConfig.from_env()
