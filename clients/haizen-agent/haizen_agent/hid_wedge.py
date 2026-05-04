"""HID キーボードウェッジを evdev または標準入力から読む。"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from typing import Any

try:
    from evdev import InputDevice, categorize, ecodes  # type: ignore[import-untyped]
except Exception:  # pragma: no cover
    InputDevice = None  # type: ignore[misc, assignment]
    categorize = None  # type: ignore[misc, assignment]
    ecodes = None  # type: ignore[misc, assignment]


def _keycode_to_char(keycode: Any) -> str | None:
    code = None
    if isinstance(keycode, str):
        code = keycode
    elif isinstance(keycode, (list, tuple)) and keycode:
        code = keycode[-1]
    if not code:
        return None
    mapping = {
        "KEY_0": "0",
        "KEY_1": "1",
        "KEY_2": "2",
        "KEY_3": "3",
        "KEY_4": "4",
        "KEY_5": "5",
        "KEY_6": "6",
        "KEY_7": "7",
        "KEY_8": "8",
        "KEY_9": "9",
        "KEY_A": "A",
        "KEY_B": "B",
        "KEY_C": "C",
        "KEY_D": "D",
        "KEY_E": "E",
        "KEY_F": "F",
        "KEY_G": "G",
        "KEY_H": "H",
        "KEY_I": "I",
        "KEY_J": "J",
        "KEY_K": "K",
        "KEY_L": "L",
        "KEY_M": "M",
        "KEY_N": "N",
        "KEY_O": "O",
        "KEY_P": "P",
        "KEY_Q": "Q",
        "KEY_R": "R",
        "KEY_S": "S",
        "KEY_T": "T",
        "KEY_U": "U",
        "KEY_V": "V",
        "KEY_W": "W",
        "KEY_X": "X",
        "KEY_Y": "Y",
        "KEY_Z": "Z",
        "KEY_ENTER": "\n",
        "KEY_KPENTER": "\n",
        "KEY_SPACE": " ",
        "KEY_MINUS": "-",
        "KEY_SLASH": "/",
    }
    return mapping.get(str(code))


def iter_lines_stdin() -> Iterator[str]:
    for line in sys.stdin:
        yield line.rstrip("\r\n")


def iter_lines_evdev(device_path: str) -> Iterator[str]:
    if InputDevice is None or categorize is None or ecodes is None:
        raise RuntimeError(
            "python-evdev が利用できません。`sudo apt-get install -y python3-evdev` を実行するか、"
            "HAIZEN_HID_DEVICE を空にして標準入力モードで動かしてください。"
        )
    dev = InputDevice(device_path)
    buffer = ""
    try:
        for event in dev.read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key_event = categorize(event)
            if getattr(key_event, "keystate", None) != key_event.key_down:
                continue
            keycode = key_event.keycode
            char = _keycode_to_char(keycode)
            if char is None:
                continue
            if char == "\n":
                line = buffer.strip()
                buffer = ""
                if line:
                    yield line
            else:
                buffer += char
    finally:
        try:
            dev.close()
        except Exception:
            pass


def iter_scan_lines(device_path: str | None) -> Iterator[str]:
    if device_path:
        yield from iter_lines_evdev(device_path)
    else:
        yield from iter_lines_stdin()
