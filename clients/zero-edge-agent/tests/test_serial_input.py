import os
import termios
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from zero_edge_agent import main as agent_main, serial_input
from zero_edge_agent.config import Config
from zero_edge_agent.keyboard import Scan
from zero_edge_agent.serial_input import LineDecoder

CAPTURE = b'\x000\x000\x000\x003\x006\x006\x006\x006\x003\x003\x00\t'
MD_CAPTURE = b'\x00M\x00D\x000\x000\x004\x002\x009\x001\x004\x008\x001\x00\t'


@pytest.mark.parametrize("data, expected", [
    (CAPTURE, ["0003666633"]),
    (MD_CAPTURE, ["MD004291481"]),
    (b'\x90\x00' + CAPTURE, ["0003666633"]),
    (b' one\r\n\n two \rthree\n\t', ["one", "two", "three"]),
    (b'\x00\x01\x7f\xffA\x1bB\t', ["AB"]),
])
def test_decoder(data, expected):
    assert LineDecoder().feed(data) == expected


def test_decoder_split_scan():
    decoder = LineDecoder()
    assert decoder.feed(CAPTURE[:9]) == []
    assert decoder.feed(CAPTURE[9:]) == ["0003666633"]


def test_decoder_buffer_cap_and_recovery():
    decoder = LineDecoder()
    assert decoder.feed(b'A' * decoder.MAX_LENGTH) == []
    assert decoder.feed(b'\t') == ['A' * decoder.MAX_LENGTH]
    for _ in range(10):
        assert decoder.feed(b'A' * 1000) == []
        assert len(decoder.buffer) <= decoder.MAX_LENGTH
    assert decoder.feed(b'\t' + CAPTURE) == ["0003666633"]


def test_reader_initializes_raw_pty_discards_ack_and_yields(monkeypatch, caplog):
    master, slave = os.openpty()
    path = os.ttyname(slave)
    stop = threading.Event()
    waits = Mock(return_value=False)
    monkeypatch.setattr(stop, "wait", waits)
    clock = [0.0]
    monkeypatch.setattr(serial_input, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    real_select = serial_input.select.select
    reads = [0]

    def select_input(read, write, error, timeout):
        if write:
            return real_select(read, write, error, timeout)
        reads[0] += 1
        if reads[0] == 1:
            os.write(master, b'\x90\x00startup')
        elif reads[0] == 2:
            clock[0] += timeout
            return [], [], []
        else:
            os.write(master, CAPTURE)
        return real_select(read, write, error, timeout)

    monkeypatch.setattr(serial_input.select, "select", select_input)
    commands = ("C_CMD_R000", "C_CMD_2801", "S_CMD_04VL100")
    scans = serial_input.iter_scans(path, stop, commands)
    try:
        with caplog.at_level("INFO"):
            scan = next(scans)
            assert isinstance(scan, Scan)
            assert scan.line == "0003666633"
            assert scan.scanned_at.utcoffset() is not None
            assert scan.monotonic_at == 1.0
            assert real_select([master], [], [], 1)[0]
            assert os.read(master, 4096) == b''.join(c.encode("ascii") for c in commands)
            assert not termios.tcgetattr(slave)[3] & (termios.ICANON | termios.ECHO)
            assert waits.call_args_list == [((0.3,),), ((0.3,),)]
            stop.set()
            assert list(scans) == []
        assert "3 commands sent" in caplog.text
        assert "Serial scanner closed" in caplog.text
        assert all(command not in caplog.text for command in commands)
    finally:
        scans.close()
        os.close(master)
        os.close(slave)


@pytest.mark.parametrize("disconnect", [OSError("lost"), b''])
def test_reader_retries_open_and_read_errors_discards_partial_scan(monkeypatch, disconnect):
    opened = Mock(side_effect=[OSError("missing"), 10, 11])
    closed = Mock()
    monkeypatch.setattr(serial_input.os, "open", opened)
    monkeypatch.setattr(serial_input.os, "close", closed)
    monkeypatch.setattr(serial_input.tty, "setraw", Mock())
    monkeypatch.setattr(serial_input.select, "select", lambda *args: ([True], [], []))
    ticks = iter(range(0, 100, 2))  # Skip startup drain without wall-clock waits.
    monkeypatch.setattr(serial_input, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    monkeypatch.setattr(serial_input.os, "read", Mock(side_effect=[b'partial', disconnect, CAPTURE]))
    stop = threading.Event()
    waits = Mock(return_value=False)
    monkeypatch.setattr(stop, "wait", waits)
    scans = serial_input.iter_scans("/dev/ttyACM0", stop)
    assert next(scans).line == "0003666633"
    assert waits.call_args_list == [((2,),), ((2,),)]
    stop.set()
    assert list(scans) == []
    assert closed.call_args_list == [((10,),), ((11,),)]
    assert all(call.args == ("/dev/ttyACM0", os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
               for call in opened.call_args_list)


@pytest.mark.parametrize("mode", ["evdev", "serial"])
def test_main_selects_input_mode(monkeypatch, mode):
    config = Config("https://example.test", "secret", input_mode=mode,
                    hid_device="/dev/input/event1", serial_device="/dev/ttyACM1",
                    reader_init_commands=("C_CMD_R000",))
    monkeypatch.setattr(agent_main, "load_config", lambda: config)
    monkeypatch.setattr(agent_main.signal, "signal", Mock())
    monkeypatch.setattr(agent_main.threading, "Thread", Mock())
    queue = Mock()
    monkeypatch.setattr(agent_main, "ScanQueue", Mock(return_value=queue))
    processor = Mock()
    monkeypatch.setattr(agent_main, "ScanProcessor", Mock(return_value=processor))
    scan = Mock(spec=Scan)
    evdev_reader = Mock(return_value=iter([scan]))
    serial_reader = Mock(return_value=iter([scan]))
    monkeypatch.setattr(agent_main, "iter_scans", evdev_reader)
    monkeypatch.setattr(serial_input, "iter_scans", serial_reader)
    assert agent_main.main() == 0
    processor.process.assert_called_once_with(scan)
    queue.close.assert_called_once()
    if mode == "serial":
        serial_reader.assert_called_once_with(config.serial_device,
                                              serial_reader.call_args.args[1],
                                              config.reader_init_commands)
        evdev_reader.assert_not_called()
    else:
        evdev_reader.assert_called_once_with(config.hid_device, evdev_reader.call_args.args[1])
        serial_reader.assert_not_called()
