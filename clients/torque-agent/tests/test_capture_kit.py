from __future__ import annotations

import asyncio
import json
import stat
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from torque_agent.capture_cli import (
    EXIT_DEVICE_OR_OS,
    EXIT_INCOMPLETE,
    EXIT_SUCCESS,
    EXIT_USAGE_OR_SAFETY,
    main,
)
from torque_agent.capture_fixtures import replay_capture, sanitize_capture, validate_fixtures
from torque_agent.capture_models import (
    DEFAULT_FRAME_TERMINATORS,
    PRIVATE_EVENTS_FILE,
    PRIVATE_MANIFEST_FILE,
    CaptureConfiguration,
    CaptureDeviceError,
    CaptureIncompleteError,
    CaptureSafetyError,
    ObservedKeyEvent,
)
from torque_agent.capture_recorder import capture_events, validate_device_path
from torque_agent.linux_event_source import LinuxEvdevEventSource


FIXTURES = Path(__file__).parent / "fixtures" / "capture_contract"
CEM3_FIXTURES = Path(__file__).parent / "fixtures" / "cem3_btla"


class FakeEventSource:
    def __init__(self, events: list[ObservedKeyEvent], *, error: Exception | None = None) -> None:
        self._events = iter(events)
        self._error = error
        self.entered = False
        self.released = False

    async def __aenter__(self) -> FakeEventSource:
        self.entered = True
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.released = True

    def __aiter__(self) -> FakeEventSource:
        return self

    async def __anext__(self) -> ObservedKeyEvent:
        try:
            return next(self._events)
        except StopIteration:
            if self._error is not None:
                raise self._error
            raise StopAsyncIteration


class BlockingEventSource(FakeEventSource):
    async def __anext__(self) -> ObservedKeyEvent:
        await asyncio.Event().wait()
        raise StopAsyncIteration


def key_events(*frames: tuple[str, str]) -> list[ObservedKeyEvent]:
    events: list[ObservedKeyEvent] = []
    relative_ns = 0
    for text, terminator in frames:
        for character in text.upper():
            relative_ns += 1_000
            events.append(ObservedKeyEvent(relative_ns, 0, 1, "down", (f"KEY_{character}",)))
            events.append(ObservedKeyEvent(relative_ns + 1, 0, 0, "up", (f"KEY_{character}",)))
        relative_ns += 1_000
        events.append(ObservedKeyEvent(relative_ns, 0, 1, "down", (terminator,)))
    return events


def configuration(
    output: Path,
    *,
    expected_frames: int = 2,
    timeout: float = 1.0,
    frame_terminators: tuple[str, ...] = DEFAULT_FRAME_TERMINATORS,
) -> CaptureConfiguration:
    return CaptureConfiguration(
        device=Path("/dev/input/by-id/CEM3-BTLA-event-kbd"),
        output=output,
        scenario="normal",
        expected_frames=expected_frames,
        firmware="fixture-only",
        output_config="fixture-only",
        timeout_seconds=timeout,
        frame_terminators=frame_terminators,
    )


def test_capture_rejects_non_by_id_general_keyboard_and_repository_output(tmp_path: Path) -> None:
    with pytest.raises(CaptureSafetyError, match="/dev/input/by-id"):
        validate_device_path(Path("/dev/input/event0"))
    with pytest.raises(CaptureSafetyError, match="/dev/input/by-id"):
        validate_device_path(Path("/dev/input/by-id/../event0"))
    with pytest.raises(CaptureSafetyError, match="general-purpose keyboard"):
        validate_device_path(Path("/dev/input/by-id/General-Keyboard-event-kbd"))

    repository = tmp_path / "repository"
    (repository / ".git").mkdir(parents=True)
    source = FakeEventSource(key_events(("a", "KEY_TAB")))
    with pytest.raises(CaptureSafetyError, match="outside a Git repository"):
        asyncio.run(capture_events(source, configuration(repository / "private", expected_frames=1)))


def test_capture_preserves_events_terminators_permissions_and_releases_grab(tmp_path: Path) -> None:
    source = FakeEventSource(key_events(("actualone", "KEY_TAB"), ("actualtwo", "KEY_ENTER")))
    output = tmp_path / "private-capture"
    assert asyncio.run(capture_events(source, configuration(output))) == 2
    assert source.entered and source.released

    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    assert stat.S_IMODE((output / PRIVATE_EVENTS_FILE).stat().st_mode) == 0o600
    assert stat.S_IMODE((output / PRIVATE_MANIFEST_FILE).stat().st_mode) == 0o600
    records = [json.loads(line) for line in (output / PRIVATE_EVENTS_FILE).read_text().splitlines()]
    assert {record["keyState"] for record in records} == {"down", "up"}
    assert [record["keyCodes"][0] for record in records if record["keyCodes"][0] in {"KEY_TAB", "KEY_ENTER"}] == [
        "KEY_TAB",
        "KEY_ENTER",
    ]
    assert json.loads((output / PRIVATE_MANIFEST_FILE).read_text())["status"] == "complete"


def test_capture_buffers_events_in_ram_and_syncs_once_at_finalization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fsync_calls: list[int] = []
    monkeypatch.setattr("torque_agent.capture_recorder.os.fsync", fsync_calls.append)
    source = FakeEventSource(key_events(("firstframe", "KEY_ENTER"), ("secondframe", "KEY_ENTER")))

    assert asyncio.run(capture_events(source, configuration(tmp_path / "batched-sync"))) == 2

    # Initial manifest, one final event batch, and final manifest. The
    # individual key down/up events must not trigger durable writes.
    assert len(fsync_calls) == 3


def test_capture_can_preserve_tab_delimited_fields_until_enter_terminates_transmission(tmp_path: Path) -> None:
    source = FakeEventSource(
        key_events(("001", "KEY_TAB"), ("actual", "KEY_TAB"), ("nm", "KEY_ENTER"))
    )
    output = tmp_path / "enter-terminated-capture"
    config = configuration(
        output,
        expected_frames=1,
        frame_terminators=("KEY_ENTER", "KEY_KPENTER"),
    )

    assert asyncio.run(capture_events(source, config)) == 1
    replay = replay_capture(output)
    assert len(replay.frames) == 1
    assert replay.frames[0].text == "001\tactual\tnm"
    assert replay.frames[0].terminator == "KEY_ENTER"
    manifest = json.loads((output / PRIVATE_MANIFEST_FILE).read_text())
    assert manifest["frameTerminators"] == ["KEY_ENTER", "KEY_KPENTER"]
    assert manifest["capturedFrames"] == 1


def test_replay_retains_unknown_only_frame_and_sanitizer_fails_closed(tmp_path: Path) -> None:
    source = FakeEventSource(
        [
            ObservedKeyEvent(0, 183, 1, "down", ("KEY_F13",)),
            ObservedKeyEvent(1, 28, 1, "down", ("KEY_ENTER",)),
        ]
    )
    output = tmp_path / "unknown-only-capture"
    assert asyncio.run(capture_events(source, configuration(output, expected_frames=1))) == 1

    replay = replay_capture(output)
    assert len(replay.frames) == 1
    assert replay.frames[0].text == ""
    assert replay.frames[0].unsupported_key_codes == ("KEY_F13",)
    assert replay.unsupported_key_count == 1

    redactions = tmp_path / "unknown-map.torque-redactions.json"
    redactions.write_text(json.dumps({"literals": [{"source": "actual", "replacement": "SERIAL_A"}]}))
    redactions.chmod(0o600)
    with pytest.raises(CaptureIncompleteError, match="unsupported keys"):
        sanitize_capture(output, redactions, tmp_path / "unknown.jsonl")


def test_capture_releases_source_and_retains_partial_output_on_device_error_and_timeout(tmp_path: Path) -> None:
    failed_source = FakeEventSource([], error=CaptureDeviceError("already grabbed"))
    with pytest.raises(CaptureDeviceError):
        asyncio.run(capture_events(failed_source, configuration(tmp_path / "failed", expected_frames=1)))
    assert failed_source.released
    assert json.loads((tmp_path / "failed" / PRIVATE_MANIFEST_FILE).read_text())["status"] == "device_error"

    blocked_source = BlockingEventSource([])
    with pytest.raises(CaptureIncompleteError, match="timed out"):
        asyncio.run(
            capture_events(blocked_source, configuration(tmp_path / "timeout", expected_frames=1, timeout=0.01))
        )
    assert blocked_source.released
    assert json.loads((tmp_path / "timeout" / PRIVATE_MANIFEST_FILE).read_text())["status"] == "timeout"


def test_linux_adapter_releases_exclusive_grab_on_success_and_setup_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[object] = []

    class FakeDevice:
        def __init__(self, path: str, *, fail_loop: bool = False) -> None:
            self.path = path
            self.fail_loop = fail_loop
            self.grabbed = False
            self.closed = False
            created.append(self)

        def grab(self) -> None:
            self.grabbed = True

        def ungrab(self) -> None:
            self.grabbed = False

        def close(self) -> None:
            self.closed = True

        def async_read_loop(self) -> object:
            if self.fail_loop:
                raise OSError("fixture setup failure")
            return object()

    module = SimpleNamespace(InputDevice=FakeDevice, categorize=lambda event: event, ecodes=SimpleNamespace(EV_KEY=1))
    monkeypatch.setitem(sys.modules, "evdev", module)

    async def open_and_close() -> None:
        async with LinuxEvdevEventSource(Path("/dev/input/by-id/CEM3-BTLA-event-kbd")):
            pass

    asyncio.run(open_and_close())
    first = created[-1]
    assert not first.grabbed and first.closed

    module.InputDevice = lambda path: FakeDevice(path, fail_loop=True)
    with pytest.raises(CaptureDeviceError, match="stop torque-agent"):
        asyncio.run(LinuxEvdevEventSource(Path("/dev/input/by-id/CEM3-BTLA-event-kbd")).__aenter__())
    failed = created[-1]
    assert not failed.grabbed and failed.closed


def test_linux_adapter_reopens_stable_by_id_path_after_device_disconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[object] = []

    class FakeLoop:
        def __init__(self, events: list[object]) -> None:
            self._events = iter(events)

        def __aiter__(self) -> FakeLoop:
            return self

        async def __anext__(self) -> object:
            event = next(self._events)
            if isinstance(event, Exception):
                raise event
            return event

    class FakeDevice:
        def __init__(self, path: str) -> None:
            self.path = path
            self.grabbed = False
            self.closed = False
            self._index = len(created)
            created.append(self)

        def grab(self) -> None:
            self.grabbed = True

        def ungrab(self) -> None:
            self.grabbed = False

        def close(self) -> None:
            self.closed = True

        def async_read_loop(self) -> FakeLoop:
            if self._index == 0:
                return FakeLoop([OSError(19, "device disconnected")])
            return FakeLoop([SimpleNamespace(type=1, code=30, value=1)])

    key_event = SimpleNamespace(
        keycode="KEY_A",
        keystate=1,
        key_down=1,
        key_up=0,
        key_hold=2,
    )
    module = SimpleNamespace(
        InputDevice=FakeDevice,
        categorize=lambda event: key_event,
        ecodes=SimpleNamespace(EV_SYN=0, EV_KEY=1, SYN_DROPPED=3),
    )
    monkeypatch.setitem(sys.modules, "evdev", module)

    async def receive_after_reconnect() -> ObservedKeyEvent:
        async with LinuxEvdevEventSource(Path("/dev/input/by-id/CEM3-BTLA-event-kbd")) as source:
            return await anext(source)

    observed = asyncio.run(receive_after_reconnect())

    assert observed.key_codes == ("KEY_A",)
    assert len(created) == 2
    assert all(device.closed and not device.grabbed for device in created)


def test_linux_adapter_rejects_kernel_input_buffer_overrun(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[object] = []

    class FakeLoop:
        def __init__(self) -> None:
            self._returned = False

        def __aiter__(self) -> FakeLoop:
            return self

        async def __anext__(self) -> object:
            if self._returned:
                raise StopAsyncIteration
            self._returned = True
            return SimpleNamespace(type=0, code=3, value=0)

    class FakeDevice:
        def __init__(self, _path: str) -> None:
            self.grabbed = False
            self.closed = False
            created.append(self)

        def grab(self) -> None:
            self.grabbed = True

        def ungrab(self) -> None:
            self.grabbed = False

        def close(self) -> None:
            self.closed = True

        def async_read_loop(self) -> FakeLoop:
            return FakeLoop()

    module = SimpleNamespace(
        InputDevice=FakeDevice,
        categorize=lambda event: event,
        ecodes=SimpleNamespace(EV_SYN=0, EV_KEY=1, SYN_DROPPED=3),
    )
    monkeypatch.setitem(sys.modules, "evdev", module)

    async def receive_overrun() -> None:
        async with LinuxEvdevEventSource(Path("/dev/input/by-id/CEM3-BTLA-event-kbd")) as source:
            with pytest.raises(CaptureDeviceError, match="buffer overrun"):
                await anext(source)

    asyncio.run(receive_overrun())

    assert len(created) == 1
    assert created[0].closed and not created[0].grabbed


def test_replay_on_repository_fixture_is_explicit_and_never_prints_payload(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["replay", "--input", str(FIXTURES / "synthetic-key-events.jsonl"), "--synthetic"]) == EXIT_SUCCESS
    captured = capsys.readouterr()
    summary = json.loads(captured.out)
    assert summary == {
        "frames": 2,
        "pendingKeys": 1,
        "terminators": {"KEY_ENTER": 1, "KEY_TAB": 1},
        "unsupportedKeys": 1,
    }
    assert "ab" not in captured.out
    assert captured.err == ""

    assert main(["replay", "--input", str(FIXTURES / "synthetic-key-events.jsonl")]) == EXIT_USAGE_OR_SAFETY


def test_cli_exit_codes_are_fixed() -> None:
    assert (EXIT_SUCCESS, EXIT_USAGE_OR_SAFETY, EXIT_INCOMPLETE, EXIT_DEVICE_OR_OS) == (0, 2, 3, 4)


def test_sanitize_requires_every_literal_and_emits_only_anonymized_fixture_fields(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    source = FakeEventSource(key_events(("actualone", "KEY_TAB"), ("actualtwo", "KEY_ENTER")))
    asyncio.run(capture_events(source, configuration(raw)))
    redactions = tmp_path / "map.torque-redactions.json"
    redactions.write_text(
        json.dumps(
            {
                "literals": [
                    {"source": "actualone", "replacement": "SERIAL_A"},
                    {"source": "actualtwo", "replacement": "SERIAL_B"},
                ]
            }
        )
    )
    redactions.chmod(0o600)
    output = tmp_path / "sanitized" / "normal.jsonl"
    assert sanitize_capture(raw, redactions, output) == {"frames": 2, "scenario": "normal", "aliases": 2}
    records = [json.loads(line) for line in output.read_text().splitlines()]
    assert [record["payloadText"] for record in records] == ["SERIAL_A", "SERIAL_B"]
    assert all(
        set(record)
        == {"schemaVersion", "payloadText", "terminator", "scenario", "sequence", "provenance"}
        for record in records
    )
    assert "actual" not in output.read_text()

    missing_map = tmp_path / "missing.torque-redactions.json"
    missing_map.write_text(json.dumps({"literals": [{"source": "not-present", "replacement": "SERIAL_C"}]}))
    missing_map.chmod(0o600)
    with pytest.raises(CaptureSafetyError, match="not found"):
        sanitize_capture(raw, missing_map, tmp_path / "missing.jsonl")

    noise_then_value_raw = tmp_path / "noise-then-value-raw"
    assert asyncio.run(
        capture_events(
            FakeEventSource(key_events(("", "KEY_ENTER"), ("actualone", "KEY_ENTER"))),
            configuration(noise_then_value_raw, expected_frames=1),
        )
    ) == 1
    single_redactions = tmp_path / "single-map.torque-redactions.json"
    single_redactions.write_text(
        json.dumps({"literals": [{"source": "actualone", "replacement": "SERIAL_A"}]})
    )
    single_redactions.chmod(0o600)
    noise_output = tmp_path / "noise-filtered.jsonl"
    assert sanitize_capture(noise_then_value_raw, single_redactions, noise_output) == {
        "frames": 1,
        "scenario": "normal",
        "aliases": 1,
    }
    assert json.loads(noise_output.read_text())["payloadText"] == "SERIAL_A"


def test_validate_accepts_synthetic_contract_and_detects_coverage_or_device_shortfall(tmp_path: Path) -> None:
    result = validate_fixtures(FIXTURES)
    assert result["fixtureKind"] == "synthetic"
    assert set(result["scenarios"]) == {
        "normal",
        "below_limit",
        "above_limit",
        "repeated_memory",
        "rapid_consecutive",
    }
    observed = validate_fixtures(CEM3_FIXTURES)
    assert observed["fixtureKind"] == "observed"
    assert set(observed["scenarios"]) >= {"normal", "rapid_consecutive"}
    assert "repeated_memory" not in observed["scenarios"]

    incomplete = tmp_path / "incomplete"
    incomplete.mkdir()
    (incomplete / "normal.jsonl").write_text(
        '{"schemaVersion":1,"payloadText":"SERIAL_A","terminator":"KEY_TAB",'
        '"scenario":"normal","sequence":1,"provenance":"observed"}\n'
    )
    with pytest.raises(CaptureIncompleteError, match="coverage"):
        validate_fixtures(incomplete)
    assert main(["validate", "--fixtures", str(incomplete)]) == EXIT_INCOMPLETE

    complete = tmp_path / "complete"
    complete.mkdir()
    (complete / "normal.jsonl").write_text(
        "".join(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "payloadText": "SERIAL_A",
                    "terminator": "KEY_TAB",
                    "scenario": "normal",
                    "sequence": sequence,
                    "provenance": "observed",
                }
            )
            + "\n"
            for sequence in (1, 2, 3)
        )
    )
    for scenario, sequences in (("rapid_consecutive", (1, 2, 3, 4, 5)),):
        records = [
            {
                "schemaVersion": 1,
                "payloadText": "SERIAL_A",
                "terminator": "KEY_ENTER",
                "scenario": scenario,
                "sequence": sequence,
                "provenance": "observed",
            }
            for sequence in sequences
        ]
        (complete / f"{scenario}.jsonl").write_text("".join(json.dumps(record) + "\n" for record in records))
    with pytest.raises(CaptureIncompleteError, match="2 distinct"):
        validate_fixtures(complete, available_device_count=2)

    optional_repeat = complete / "repeated_memory.jsonl"
    optional_repeat.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "payloadText": "SERIAL_A",
                "terminator": "KEY_ENTER",
                "scenario": "repeated_memory",
                "sequence": 1,
                "provenance": "observed",
            }
        )
        + "\n"
    )
    with pytest.raises(CaptureIncompleteError, match=r"repeated_memory \(1/2\)"):
        validate_fixtures(complete)

    copied_contract = tmp_path / "cem3_btla"
    copied_contract.mkdir()
    (copied_contract / "fixture-contract.json").write_text((FIXTURES / "fixture-contract.json").read_text())
    with pytest.raises(CaptureSafetyError, match="only in capture_contract"):
        validate_fixtures(copied_contract)


def test_validate_rejects_absolute_path_metadata(tmp_path: Path) -> None:
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    (fixtures / "normal.jsonl").write_text(
        '{"schemaVersion":1,"payloadText":"/Users/private/capture","terminator":"KEY_TAB",'
        '"scenario":"normal","sequence":1,"provenance":"observed"}\n'
    )
    with pytest.raises(CaptureSafetyError, match="private capture metadata"):
        validate_fixtures(fixtures)
