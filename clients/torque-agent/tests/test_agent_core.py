import asyncio
import json
from pathlib import Path

import httpx
import pytest

from torque_agent.binding import BindingStore
from torque_agent.api_client import OutboxSender
from torque_agent.cem3_btla_parser import Cem3BtlaHogpParser
from torque_agent.config import AgentConfig
from torque_agent.hid_line_decoder import DecodedHidFrame, HidLineDecoder
from torque_agent.ingestor import TorqueEventIngestor
from torque_agent.main import build_registry, create_app
from torque_agent.models import WorkBinding
from torque_agent.parser_registry import ParserRegistry, SyntheticDelimitedFixtureParser
from torque_agent.queue_store import QueueStore


CEM3_FIXTURES = Path(__file__).parent / "fixtures" / "cem3_btla" / "SERIAL_A"


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


def test_cem3_btla_parser_matches_observed_normal_and_rapid_fixtures() -> None:
    parser = Cem3BtlaHogpParser()
    records = [
        json.loads(line)
        for fixture_name in ("normal.jsonl", "rapid_consecutive.jsonl")
        for line in (CEM3_FIXTURES / fixture_name).read_text().splitlines()
    ]

    events = [parser.parse(record["payloadText"].replace("SERIAL_A", "123456A")) for record in records]

    assert [event.memory_counter for event in events] == ["025", "026", "027", "009", "010", "011", "013", "014"]
    assert [event.value for event in events] == [4.24, 4.24, 4.36, 4.16, 4.06, 4.1, 4.24, 4.06]
    assert all(event.unit == "nm" and event.device_judgement == "O" for event in events)
    assert events[0].serial_number == "123456A"
    assert events[0].device_recorded_at == "2026-07-18T09:54:12+09:00"


@pytest.mark.parametrize(
    ("fixture_name", "message"),
    [
        ("partial.jsonl", "exactly 7"),
        ("missing_field.jsonl", "exactly 7"),
        ("bad_number.jsonl", "torque value"),
        ("unsupported_unit.jsonl", "unit field"),
    ],
)
def test_cem3_btla_parser_rejects_fixture_derived_invalid_payloads(
    fixture_name: str,
    message: str,
) -> None:
    record = json.loads((CEM3_FIXTURES / fixture_name).read_text().splitlines()[0])
    payload = record["payloadText"].replace("SERIAL_A", "123456A")

    with pytest.raises(ValueError, match=message):
        Cem3BtlaHogpParser().parse(payload)


def test_cem3_btla_parser_rejects_unobserved_time_layout_and_invalid_calendar() -> None:
    parser = Cem3BtlaHogpParser()
    observed = "025\t04.24\tnm   \tO \t123456A\t26/07/18\t09'54'12"

    with pytest.raises(ValueError, match="kEY-JP Linux HID"):
        parser.parse(observed.replace("09'54'12", "09:54:12"))
    with pytest.raises(ValueError, match="valid calendar"):
        parser.parse(observed.replace("26/07/18", "26/02/30"))


def test_cem3_btla_parser_definition_keeps_tab_as_data_and_is_registered_for_production(tmp_path: Path) -> None:
    registry = ParserRegistry()
    registry.register(
        Cem3BtlaHogpParser.PROFILE,
        Cem3BtlaHogpParser,
        frame_terminators=Cem3BtlaHogpParser.FRAME_TERMINATORS,
    )

    assert isinstance(registry.create(Cem3BtlaHogpParser.PROFILE), Cem3BtlaHogpParser)
    assert registry.frame_terminators(Cem3BtlaHogpParser.PROFILE) == frozenset({"KEY_ENTER", "KEY_KPENTER"})

    production_registry = build_registry(
        AgentConfig(
            api_base_url="http://127.0.0.1:3000",
            client_key="test-client",
            queue_path=tmp_path / "events.sqlite3",
            devices=(),
        )
    )
    assert isinstance(production_registry.create(Cem3BtlaHogpParser.PROFILE), Cem3BtlaHogpParser)
    assert production_registry.frame_terminators(Cem3BtlaHogpParser.PROFILE) == frozenset(
        {"KEY_ENTER", "KEY_KPENTER"}
    )


def test_hid_decoder_handles_partial_and_continuous_lines() -> None:
    decoder = HidLineDecoder()
    assert decoder.feed("KEY_A") is None
    assert decoder.feed("KEY_1") is None
    assert decoder.feed("KEY_ENTER") == DecodedHidFrame("a1", "KEY_ENTER", ("KEY_A", "KEY_1"), ())
    assert decoder.feed("KEY_B") is None
    assert decoder.feed("KEY_TAB") == DecodedHidFrame("b", "KEY_TAB", ("KEY_B",), ())


def test_hid_decoder_can_treat_tab_as_data_until_enter() -> None:
    decoder = HidLineDecoder(terminators=frozenset({"KEY_ENTER", "KEY_KPENTER"}))
    assert decoder.feed("KEY_0") is None
    assert decoder.feed("KEY_TAB") is None
    assert decoder.feed("KEY_A") is None
    assert decoder.feed("KEY_ENTER") == DecodedHidFrame(
        "0\ta",
        "KEY_ENTER",
        ("KEY_0", "KEY_TAB", "KEY_A"),
        (),
    )


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


@pytest.mark.parametrize(("mode", "expected"), [("system", True), (" insecure ", False)])
def test_config_parses_explicit_tls_verify_mode(monkeypatch: pytest.MonkeyPatch, mode: str, expected: bool) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "https://server.example.test")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv("TORQUE_HID_DEVICES_JSON", "[]")
    monkeypatch.setenv("TORQUE_TLS_VERIFY_MODE", mode)

    assert AgentConfig.from_env().tls_verify is expected


def test_config_rejects_unknown_tls_verify_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "https://server.example.test")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv("TORQUE_HID_DEVICES_JSON", "[]")
    monkeypatch.setenv("TORQUE_TLS_VERIFY_MODE", "disabled")

    with pytest.raises(ValueError, match="TORQUE_TLS_VERIFY_MODE"):
        AgentConfig.from_env()


def test_outbox_sender_uses_explicit_tls_verification_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    queue = QueueStore(tmp_path / "events.sqlite3")
    queue.enqueue("event-1", {"sessionId": "session-1", "payload": {"value": 4.2}})
    captured: dict[str, object] = {}

    class Response:
        status_code = 201
        text = "ok"

    class Client:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: object) -> Response:
            captured["url"] = url
            captured.update(kwargs)
            return Response()

    monkeypatch.setattr("torque_agent.api_client.httpx.AsyncClient", Client)

    delivered = asyncio.run(OutboxSender("https://server.example.test", "client", queue, tls_verify=False).send_once())

    assert delivered is True
    assert captured["verify"] is False
    assert queue.count() == 0


def test_loopback_api_health_and_disarm_contract(tmp_path: Path) -> None:
    config = AgentConfig(
        api_base_url="http://127.0.0.1:3000",
        client_key="test-client",
        queue_path=tmp_path / "events.sqlite3",
        devices=(),
        browser_origins=("http://127.0.0.1:3000",),
    )
    bindings = BindingStore(ttl_seconds=5)
    bindings.update(WorkBinding("session", "bolt", "confirmation", "profile"))
    app = create_app(config, bindings, QueueStore(config.queue_path))

    async def request_loopback_api() -> tuple[httpx.Response, httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://agent.test") as client:
            health_response = await client.get(
                "/health",
                headers={"origin": "http://127.0.0.1:3000"},
            )
            disarm_response = await client.post(
                "/heartbeat",
                json={
                    "sessionId": "session",
                    "currentTemplateBoltId": None,
                    "confirmationId": None,
                    "torqueWrenchProfileId": None,
                },
            )
        return health_response, disarm_response

    health, disarm = asyncio.run(request_loopback_api())

    assert health.status_code == 200
    assert health.json()["bound"] is True
    assert health.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert disarm.status_code == 200
    assert disarm.json() == {"ok": True, "bound": False}
    assert bindings.current() is None


@pytest.mark.parametrize(
    "path",
    [
        "/dev/input/event0",
        "/dev/input/by-id/../event0",
        "/dev/input/by-id/General-Keyboard-event-kbd",
    ],
)
def test_config_rejects_general_keyboard_event_path(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv(
        "TORQUE_HID_DEVICES_JSON",
        json.dumps([{"path": path, "parserProfile": "fixture"}]),
    )

    with pytest.raises(ValueError, match="Only explicit torque-wrench /dev/input/by-id"):
        AgentConfig.from_env()


def test_config_rejects_wildcard_browser_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TORQUE_API_BASE_URL", "http://127.0.0.1:3000")
    monkeypatch.setenv("TORQUE_CLIENT_KEY", "test-client")
    monkeypatch.setenv("TORQUE_BROWSER_ORIGINS_JSON", '["*"]')

    with pytest.raises(ValueError, match=r"must be an http\(s\) origin"):
        AgentConfig.from_env()
