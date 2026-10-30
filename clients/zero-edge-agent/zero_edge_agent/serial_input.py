"""USB CDC scanner input using only the standard library."""

import logging
import os
import select
import termios
import time
import tty
from datetime import datetime

from .keyboard import Scan

LOG = logging.getLogger(__name__)


class LineDecoder:
    MAX_LENGTH = 256

    def __init__(self):
        self.buffer = []
        self.overflow = False

    def feed(self, data):
        lines = []
        for byte in data:
            if byte in (9, 10, 13):
                line = "".join(self.buffer).strip()
                if line and not self.overflow:
                    lines.append(line)
                self.buffer.clear()
                self.overflow = False
            elif 0x20 <= byte <= 0x7E and not self.overflow:
                if len(self.buffer) == self.MAX_LENGTH:
                    # Discard the entire oversized scan rather than emit a truncated ID.
                    self.buffer.clear()
                    self.overflow = True
                else:
                    self.buffer.append(chr(byte))
        return lines


def _read(fd):
    try:
        data = os.read(fd, 4096)
    except BlockingIOError:
        return b""
    if not data:
        raise OSError("Serial input closed")
    return data


def _initialize(fd, stop, commands):
    sent = 0
    for command in commands:
        if stop.is_set():
            return
        if sent and stop.wait(0.3):
            return
        pending = command.encode("ascii")
        while pending and not stop.is_set():
            if not select.select([], [fd], [], 1)[1]:
                continue
            try:
                written = os.write(fd, pending)
            except BlockingIOError:
                continue
            if not written:
                raise OSError("Serial write closed")
            pending = pending[written:]
        if stop.is_set():
            return
        sent += 1
    LOG.info("Serial scanner initialization: %d commands sent", sent)
    deadline = time.monotonic() + 1
    while not stop.is_set():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if select.select([fd], [], [], min(1, remaining))[0]:
            _read(fd)  # Discard acknowledgements and any partial startup scan.


def iter_scans(path, stop, init_commands=()):
    while not stop.is_set():
        fd = None
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            tty.setraw(fd, termios.TCSANOW)
            LOG.info("Serial scanner connected: %s", path)
            _initialize(fd, stop, init_commands)
            decoder = LineDecoder()
            while not stop.is_set():
                if not select.select([fd], [], [], 1)[0]:
                    continue
                for line in decoder.feed(_read(fd)):
                    if stop.is_set():
                        break
                    monotonic_at = time.monotonic()
                    scanned_at = datetime.now().astimezone()
                    yield Scan(line, scanned_at, monotonic_at)
        except (OSError, termios.error):
            LOG.warning("Serial scanner unavailable or input lost; reconnecting")
        finally:
            if fd is not None:
                os.close(fd)
                LOG.info("Serial scanner closed: %s", path)
        stop.wait(2)
