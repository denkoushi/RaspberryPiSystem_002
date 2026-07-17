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
from torque_agent.capture_fixtures import sanitize_capture, validate_fixtures
from torque_agent.capture_models import (
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


def configuration(output: Path, *, expected_frames: int = 2, timeout: float = 1.0) -> CaptureConfiguration:
    return CaptureConfiguration(
        device=Path("/dev/input/by-id/CEM3-BTLA-event-kbd"),
        output=output,
        scenario="normal",
        expected_frames=expected_frames,
        firmware="fixture-only",
        output_config="fixture-only",
        timeout_seconds=timeout,
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
    for scenario in ("normal", "below_limit", "above_limit"):
        (complete / f"{scenario}.jsonl").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "payloadText": "SERIAL_A",
                    "terminator": "KEY_TAB",
                    "scenario": scenario,
                    "sequence": 1,
                    "provenance": "observed",
                }
            )
            + "\n"
        )
    for scenario in ("repeated_memory", "rapid_consecutive"):
        records = [
            {
                "schemaVersion": 1,
                "payloadText": "SERIAL_A",
                "terminator": "KEY_ENTER",
                "scenario": scenario,
                "sequence": sequence,
                "provenance": "observed",
            }
            for sequence in (1, 2)
        ]
        (complete / f"{scenario}.jsonl").write_text("".join(json.dumps(record) + "\n" for record in records))
    with pytest.raises(CaptureIncompleteError, match="2 distinct"):
        validate_fixtures(complete, available_device_count=2)

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
