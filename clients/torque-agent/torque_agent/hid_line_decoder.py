from __future__ import annotations

from dataclasses import dataclass


UNSHIFTED_KEYS = {
    **{f"KEY_{letter}": letter.lower() for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"},
    **{f"KEY_{digit}": digit for digit in "0123456789"},
    "KEY_SPACE": " ",
    "KEY_MINUS": "-",
    "KEY_EQUAL": "=",
    "KEY_LEFTBRACE": "[",
    "KEY_RIGHTBRACE": "]",
    "KEY_BACKSLASH": "\\",
    "KEY_SEMICOLON": ";",
    "KEY_APOSTROPHE": "'",
    "KEY_GRAVE": "`",
    "KEY_COMMA": ",",
    "KEY_DOT": ".",
    "KEY_SLASH": "/",
    "KEY_KP0": "0",
    "KEY_KP1": "1",
    "KEY_KP2": "2",
    "KEY_KP3": "3",
    "KEY_KP4": "4",
    "KEY_KP5": "5",
    "KEY_KP6": "6",
    "KEY_KP7": "7",
    "KEY_KP8": "8",
    "KEY_KP9": "9",
    "KEY_KPDOT": ".",
    "KEY_KPMINUS": "-",
    "KEY_KPPLUS": "+",
    "KEY_KPASTERISK": "*",
    "KEY_KPSLASH": "/",
    "KEY_TAB": "\t",
}
SHIFTED_KEYS = {
    **{f"KEY_{letter}": letter for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"},
    "KEY_1": "!",
    "KEY_2": "@",
    "KEY_3": "#",
    "KEY_4": "$",
    "KEY_5": "%",
    "KEY_6": "^",
    "KEY_7": "&",
    "KEY_8": "*",
    "KEY_9": "(",
    "KEY_0": ")",
    "KEY_MINUS": "_",
    "KEY_EQUAL": "+",
    "KEY_LEFTBRACE": "{",
    "KEY_RIGHTBRACE": "}",
    "KEY_BACKSLASH": "|",
    "KEY_SEMICOLON": ":",
    "KEY_APOSTROPHE": '"',
    "KEY_GRAVE": "~",
    "KEY_COMMA": "<",
    "KEY_DOT": ">",
    "KEY_SLASH": "?",
}
TERMINATORS = {"KEY_ENTER", "KEY_KPENTER", "KEY_TAB"}
SHIFT_KEYS = {"KEY_LEFTSHIFT", "KEY_RIGHTSHIFT"}


@dataclass(frozen=True)
class DecodedHidFrame:
    text: str
    terminator: str
    key_codes: tuple[str, ...]
    unsupported_key_codes: tuple[str, ...]


class HidLineDecoder:
    def __init__(self, *, terminators: frozenset[str] | None = None) -> None:
        self._buffer: list[str] = []
        self._key_codes: list[str] = []
        self._unsupported_key_codes: list[str] = []
        self._pressed_shift_keys: set[str] = set()
        self._terminators = terminators if terminators is not None else frozenset(TERMINATORS)

    @property
    def pending_key_count(self) -> int:
        return len(self._key_codes)

    @property
    def pending_unsupported_key_count(self) -> int:
        return len(self._unsupported_key_codes)

    def feed(self, key_code: str, key_state: str = "down") -> DecodedHidFrame | None:
        if key_state not in {"down", "up", "hold"}:
            raise ValueError(f"Unsupported HID key state: {key_state}")
        if key_code in SHIFT_KEYS:
            if key_state == "down":
                self._pressed_shift_keys.add(key_code)
                self._key_codes.append(key_code)
            elif key_state == "up":
                self._pressed_shift_keys.discard(key_code)
            return None
        if key_state != "down":
            return None

        if key_code in self._terminators:
            frame = DecodedHidFrame(
                text="".join(self._buffer),
                terminator=key_code,
                key_codes=tuple(self._key_codes),
                unsupported_key_codes=tuple(self._unsupported_key_codes),
            )
            self._buffer.clear()
            self._key_codes.clear()
            self._unsupported_key_codes.clear()
            self._pressed_shift_keys.clear()
            return frame

        self._key_codes.append(key_code)
        character = (
            SHIFTED_KEYS.get(key_code, UNSHIFTED_KEYS.get(key_code))
            if self._pressed_shift_keys
            else UNSHIFTED_KEYS.get(key_code)
        )
        if character is not None:
            self._buffer.append(character)
        else:
            self._unsupported_key_codes.append(key_code)
        return None
