KEYS = {
    **{f"KEY_{letter}": letter.lower() for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"},
    **{f"KEY_{digit}": digit for digit in "0123456789"},
    "KEY_SPACE": " ",
    "KEY_MINUS": "-",
    "KEY_DOT": ".",
    "KEY_KPDOT": ".",
}
TERMINATORS = {"KEY_ENTER", "KEY_KPENTER", "KEY_TAB"}


class HidLineDecoder:
    def __init__(self) -> None:
        self._buffer: list[str] = []

    def feed(self, key_code: str) -> str | None:
        if key_code in TERMINATORS:
            value = "".join(self._buffer)
            self._buffer.clear()
            return value or None
        character = KEYS.get(key_code)
        if character is not None:
            self._buffer.append(character)
        return None
