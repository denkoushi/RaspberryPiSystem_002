from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from .binding import BindingStore
from .hid_line_decoder import DecodedHidFrame
from .parser_registry import TorquePayloadParser
from .queue_store import QueueStore

LOGGER = logging.getLogger("torque_agent.ingestor")


class TorqueEventIngestor:
    def __init__(
        self,
        *,
        queue: QueueStore,
        bindings: BindingStore,
        parsers: dict[Path, TorquePayloadParser],
        parser_profiles: dict[Path, str],
        event_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._queue = queue
        self._bindings = bindings
        self._parsers = parsers
        self._parser_profiles = parser_profiles
        self._event_id_factory = event_id_factory or (lambda: str(uuid4()))

    async def on_decode_error(self, device_path: Path, frame: DecodedHidFrame) -> None:
        self._queue.record_local_error(
            self._event_id_factory(),
            reason="HID_DECODE_FAILED",
            device_path=str(device_path),
            parser_profile=self._parser_profiles[device_path],
            raw_text=json.dumps(
                {
                    "keyCodes": list(frame.key_codes),
                    "terminator": frame.terminator,
                    "unsupportedKeyCodes": list(frame.unsupported_key_codes),
                },
                ensure_ascii=False,
            ),
        )
        LOGGER.warning(
            "Retained HID frame with %d unsupported key(s) from %s",
            len(frame.unsupported_key_codes),
            device_path,
        )

    async def on_line(self, device_path: Path, raw_text: str) -> None:
        event_id = self._event_id_factory()
        parser_profile = self._parser_profiles[device_path]
        binding = self._bindings.current()
        if not binding:
            self._queue.record_local_error(
                event_id,
                reason="BINDING_MISSING_OR_EXPIRED",
                device_path=str(device_path),
                parser_profile=parser_profile,
                raw_text=raw_text,
            )
            LOGGER.warning("Retained HID input without a live browser binding: %s", device_path)
            return

        try:
            parsed = self._parsers[device_path].parse(raw_text)
        except (TypeError, ValueError) as error:
            self._queue.record_local_error(
                event_id,
                reason="PAYLOAD_PARSE_FAILED",
                device_path=str(device_path),
                parser_profile=parser_profile,
                raw_text=raw_text,
                error=str(error),
            )
            LOGGER.warning("Retained malformed HID input from %s: %s", device_path, error)
            return

        self._queue.enqueue(
            event_id,
            {
                "sessionId": binding.session_id,
                "payload": {
                    "expectedTemplateBoltId": binding.current_template_bolt_id,
                    "confirmationId": binding.confirmation_id,
                    "serialNumber": parsed.serial_number,
                    "value": parsed.value,
                    "unit": parsed.unit,
                    "deviceRecordedAt": parsed.device_recorded_at,
                    "deviceMemoryCounter": parsed.memory_counter,
                    "deviceJudgement": parsed.device_judgement,
                    "rawPayload": {
                        "rawText": parsed.raw_text,
                        "devicePath": str(device_path),
                        "parserProfile": parser_profile,
                    },
                },
            },
        )
