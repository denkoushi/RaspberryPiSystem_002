from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .models import ParsedTorqueEvent


MEMORY_COUNTER = re.compile(r"[0-9]{3}")
TORQUE_VALUE = re.compile(r"-?[0-9]+\.[0-9]*")
SERIAL_NUMBER = re.compile(r"[0-9]{6}[A-Z]")
DEVICE_DATE = re.compile(r"([0-9]{2})/([0-9]{2})/([0-9]{2})")
DEVICE_TIME_JP_LINUX = re.compile(r"([0-9]{2})'([0-9]{2})'([0-9]{2})")
JUDGEMENT_CHARACTERS = frozenset("DNLOH ")
JST = timezone(timedelta(hours=9))


class Cem3BtlaHogpParser:
    """Parser for the observed FMT-Y/TAB/ENTER/kEY-JP Linux HID profile."""

    PROFILE = "cem3-btla-hogp-v1"
    FRAME_TERMINATORS = frozenset({"KEY_ENTER", "KEY_KPENTER"})
    FIELD_COUNT = 7
    OBSERVED_UNIT_FIELD = "nm   "

    def parse(self, raw_text: str) -> ParsedTorqueEvent:
        if "\r" in raw_text or "\n" in raw_text:
            raise ValueError("CEM3-BTLA payload must not contain a line terminator")
        fields = raw_text.split("\t")
        if len(fields) != self.FIELD_COUNT:
            raise ValueError(f"CEM3-BTLA payload requires exactly {self.FIELD_COUNT} TAB-delimited fields")

        memory_counter, torque_text, unit_field, judgement_field, serial_number, date_text, time_text = fields
        if MEMORY_COUNTER.fullmatch(memory_counter) is None:
            raise ValueError("CEM3-BTLA memory counter must be three digits with zero suppression disabled")
        if TORQUE_VALUE.fullmatch(torque_text) is None:
            raise ValueError("CEM3-BTLA torque value does not match the observed decimal format")
        if unit_field != self.OBSERVED_UNIT_FIELD:
            raise ValueError("CEM3-BTLA unit field is not the observed N-m output")
        if len(judgement_field) != 2 or any(character not in JUDGEMENT_CHARACTERS for character in judgement_field):
            raise ValueError("CEM3-BTLA judgement must be the documented two-character result")
        if SERIAL_NUMBER.fullmatch(serial_number) is None:
            raise ValueError("CEM3-BTLA serial number must match the documented seven-character format")

        recorded_at = self._parse_recorded_at(date_text, time_text)
        return ParsedTorqueEvent(
            serial_number=serial_number,
            value=float(torque_text),
            unit=unit_field.strip(),
            memory_counter=memory_counter,
            device_recorded_at=recorded_at.isoformat(),
            device_judgement=judgement_field.strip() or None,
            raw_text=raw_text,
        )

    @staticmethod
    def _parse_recorded_at(date_text: str, time_text: str) -> datetime:
        date_match = DEVICE_DATE.fullmatch(date_text)
        if date_match is None:
            raise ValueError("CEM3-BTLA date must use the observed YY/MM/DD format")
        time_match = DEVICE_TIME_JP_LINUX.fullmatch(time_text)
        if time_match is None:
            raise ValueError("CEM3-BTLA time must use the observed kEY-JP Linux HID format")
        year, month, day = (int(value) for value in date_match.groups())
        hour, minute, second = (int(value) for value in time_match.groups())
        try:
            return datetime(2000 + year, month, day, hour, minute, second, tzinfo=JST)
        except ValueError as error:
            raise ValueError("CEM3-BTLA device date or time is not a valid calendar value") from error
