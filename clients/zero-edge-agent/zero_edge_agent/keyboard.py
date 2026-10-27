"""Exclusive evdev reader with hotplug recovery and no import-time evdev dependency."""

import logging
import select
import time
from dataclasses import dataclass
from datetime import datetime

LOG = logging.getLogger(__name__)
KEYS = {"KEY_" + c: (c.lower(), c) for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}
KEYS.update({"KEY_" + c: (c, shifted) for c, shifted in zip("1234567890", "!@#$%^&*()")})
KEYS.update({"KEY_MINUS": ("-", "_"), "KEY_SEMICOLON": (";", ":"),
             "KEY_SPACE": (" ", " "), "KEY_SLASH": ("/", "?")})


@dataclass(frozen=True)
class Scan:
    line: str
    scanned_at: datetime
    monotonic_at: float


class LineDecoder:
    def __init__(self):
        self.buffer = []
        self.shift = set()

    def feed(self, key, value):
        if key in ("KEY_LEFTSHIFT", "KEY_RIGHTSHIFT"):
            if value == 0:
                self.shift.discard(key)
            else:
                self.shift.add(key)
            return None
        if value != 1:  # Ignore releases and autorepeat.
            return None
        if key in ("KEY_ENTER", "KEY_KPENTER"):
            line = "".join(self.buffer)
            self.buffer.clear()
            return line
        if key == "KEY_BACKSPACE":
            if self.buffer:
                self.buffer.pop()
        elif key in KEYS:
            self.buffer.append(KEYS[key][bool(self.shift)])
        return None


def open_device(evdev, configured_path):
    try:
        paths = [configured_path] if configured_path else sorted(evdev.list_devices())
    except OSError:  # /dev/input can be absent until the first USB device appears.
        return None
    for path in paths:
        device = None
        try:
            device = evdev.InputDevice(path)
            keys = device.capabilities().get(evdev.ecodes.EV_KEY, [])
            if not configured_path and not all(
                key in keys for key in (evdev.ecodes.KEY_ENTER, evdev.ecodes.KEY_1, evdev.ecodes.KEY_A)
            ):
                device.close()
                continue
            device.grab()
            return device
        except OSError:
            if device is not None:
                device.close()
    return None


def iter_scans(configured_path, stop):
    import evdev  # Debian python3-evdev, absent on non-Linux test runners.

    missing_logged = False
    while not stop.is_set():
        device = open_device(evdev, configured_path)
        if device is None:
            if not missing_logged:
                LOG.warning("Waiting for a keyboard/scanner")
                missing_logged = True
            stop.wait(2)
            continue
        missing_logged = False
        decoder = LineDecoder()
        LOG.info("Scanner connected: %s", device.path)
        try:
            while not stop.is_set():
                if not select.select([device], [], [], 0.5)[0]:
                    continue
                for event in device.read():
                    if stop.is_set():
                        break
                    if event.type == evdev.ecodes.EV_SYN and event.code == evdev.ecodes.SYN_DROPPED:
                        # Reopen to discard the incomplete barcode and held modifiers.
                        raise OSError("Input events lost")
                    if event.type != evdev.ecodes.EV_KEY:
                        continue
                    key = evdev.ecodes.KEY.get(event.code, "")
                    if isinstance(key, (list, tuple)):
                        key = key[0]
                    line = decoder.feed(key, event.value)
                    if line is not None:
                        monotonic_at = time.monotonic()
                        scanned_at = datetime.now().astimezone()
                        yield Scan(line, scanned_at, monotonic_at)
        except OSError:
            LOG.warning("Scanner disconnected or input lost; reconnecting")
        finally:
            device.close()  # Also releases EVIOCGRAB.
        stop.wait(1)
