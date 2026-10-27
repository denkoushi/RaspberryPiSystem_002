from datetime import datetime
import sys
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from zero_edge_agent import keyboard
from zero_edge_agent.config import load_config
from zero_edge_agent.keyboard import LineDecoder


def test_config_defaults_and_env_path(tmp_path, monkeypatch):
    path = tmp_path / "agent.conf"
    path.write_text('# Comment\nAPI_BASE_URL="https://example.test/"\nX_CLIENT_KEY="secret"\n')
    monkeypatch.setenv("ZERO_EDGE_AGENT_CONFIG", str(path))
    config = load_config()
    assert config.api_base_url == "https://example.test"
    assert config.x_client_key == "secret"
    assert not config.tls_skip_verify
    assert config.hid_device == ""
    assert config.queue_path == "/var/lib/zero-edge-agent/queue.db"
    assert "secret" not in repr(config)


def test_config_overrides(tmp_path, monkeypatch):
    path = tmp_path / "agent.conf"
    path.write_text('API_BASE_URL="http://example.test:8080"\nX_CLIENT_KEY="secret"\n'
                    'TLS_SKIP_VERIFY="1"\nHID_DEVICE="/dev/input/by-id/scanner"\nQUEUE_PATH="/tmp/queue.db"\n')
    monkeypatch.setenv("ZERO_EDGE_AGENT_CONFIG", str(path))
    config = load_config()
    assert config.tls_skip_verify
    assert config.hid_device == "/dev/input/by-id/scanner"
    assert config.queue_path == "/tmp/queue.db"


@pytest.mark.parametrize("contents", [
    'X_CLIENT_KEY="secret"', 'API_BASE_URL="https://example.test"',
    'API_BASE_URL="https://example.test/api"\nX_CLIENT_KEY="secret"',
    'API_BASE_URL="https://user:secret@example.test"\nX_CLIENT_KEY="secret"',
    'API_BASE_URL="https://example.test"\nX_CLIENT_KEY="secret"\nTLS_SKIP_VERIFY="yes"',
    'API_BASE_URL="https://example.test"\nX_CLIENT_KEY="secret',
])
def test_invalid_config_never_echoes_key(tmp_path, monkeypatch, contents):
    path = tmp_path / "agent.conf"
    path.write_text(contents)
    monkeypatch.setenv("ZERO_EDGE_AGENT_CONFIG", str(path))
    with pytest.raises(ValueError) as error:
        load_config()
    assert "secret" not in str(error.value)


def test_decoder_shift_digits_letters_colon_and_enter():
    decoder = LineDecoder()
    for key, value in [("KEY_LEFTSHIFT", 1), ("KEY_D", 1), ("KEY_I", 1), ("KEY_S", 1),
                       ("KEY_T", 1), ("KEY_SEMICOLON", 1), ("KEY_LEFTSHIFT", 0),
                       ("KEY_SPACE", 1), ("KEY_5", 1)]:
        assert decoder.feed(key, value) is None
    assert decoder.feed("KEY_ENTER", 1) == "DIST: 5"
    assert decoder.feed("KEY_ENTER", 1) == ""
    for key in ("KEY_A", "KEY_MINUS", "KEY_0"):
        decoder.feed(key, 1)
        decoder.feed(key, 2)
        decoder.feed(key, 0)
    assert decoder.feed("KEY_KPENTER", 1) == "a-0"


def test_decoder_both_shifts_and_backspace():
    decoder = LineDecoder()
    decoder.feed("KEY_LEFTSHIFT", 1)
    decoder.feed("KEY_RIGHTSHIFT", 1)
    decoder.feed("KEY_LEFTSHIFT", 0)
    decoder.feed("KEY_A", 1)
    decoder.feed("KEY_RIGHTSHIFT", 0)
    decoder.feed("KEY_B", 1)
    decoder.feed("KEY_BACKSPACE", 1)
    assert decoder.feed("KEY_ENTER", 1) == "A"


def test_reader_waits_autoselects_and_reconnects(monkeypatch):
    # Start unplugged, ignore a mouse, lose a partial scan, then reconnect.
    ecodes = SimpleNamespace(EV_KEY=1, EV_SYN=0, SYN_DROPPED=3, KEY_ENTER=28, KEY_1=2, KEY_A=30,
                             KEY={30: "KEY_A", 28: "KEY_ENTER"})
    event = lambda code: SimpleNamespace(type=1, code=code, value=1)
    device_spec = ["path", "capabilities", "grab", "read", "close"]
    mouse = Mock(spec_set=device_spec)
    mouse.capabilities.return_value = {1: [272]}
    first = Mock(spec_set=device_spec, path="/dev/input/event1")
    first.capabilities.return_value = {1: [28, 2, 30]}
    first.read.side_effect = [[event(30)], OSError("unplugged")]
    second = Mock(spec_set=device_spec, path="/dev/input/event2")
    second.capabilities.return_value = {1: [28, 2, 30]}
    second.read.return_value = [event(30), event(28)]
    evdev = SimpleNamespace(ecodes=ecodes, list_devices=Mock(side_effect=[[], ["mouse", "scanner"], ["scanner2"]]),
                             InputDevice=Mock(side_effect=[mouse, first, second]))
    monkeypatch.setitem(sys.modules, "evdev", evdev)
    monkeypatch.setattr(keyboard.select, "select", lambda *args: ([True], [], []))
    monkeypatch.setattr(keyboard.time, "monotonic", lambda: 1005.0)
    now = datetime.fromisoformat("2026-10-27T14:03:05.123+09:00")
    fake_datetime = Mock(spec=["now"])
    fake_datetime.now.return_value = now
    monkeypatch.setattr(keyboard, "datetime", fake_datetime)
    stop = threading.Event()
    monkeypatch.setattr(stop, "wait", lambda _: stop.is_set())
    scans = keyboard.iter_scans("", stop)
    scan = next(scans)
    assert scan.line == "a"  # Partial scan from disconnected device was discarded.
    assert scan.scanned_at == now.astimezone()
    assert scan.scanned_at.utcoffset() is not None
    assert scan.monotonic_at == 1005.0
    stop.set()
    assert list(scans) == []
    first.grab.assert_called_once()
    first.close.assert_called_once()
    second.grab.assert_called_once()
    second.close.assert_called_once()
    mouse.grab.assert_not_called()


def test_configured_device_retries_same_path():
    evdev = SimpleNamespace(InputDevice=Mock(side_effect=OSError("not connected")))
    assert keyboard.open_device(evdev, "/dev/input/by-id/scanner") is None
    evdev.InputDevice.assert_called_once_with("/dev/input/by-id/scanner")


def test_reader_handles_missing_input_directory():
    evdev = SimpleNamespace(list_devices=Mock(side_effect=FileNotFoundError("/dev/input")))
    assert keyboard.open_device(evdev, "") is None
