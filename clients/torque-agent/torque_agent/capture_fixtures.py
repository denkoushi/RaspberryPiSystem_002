from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .capture_models import (
    CAPTURE_SCHEMA_VERSION,
    DEFAULT_FRAME_TERMINATORS,
    PRIVATE_EVENTS_FILE,
    PRIVATE_MANIFEST_FILE,
    CaptureIncompleteError,
    CaptureSafetyError,
)
from .capture_recorder import require_private_path
from .hid_line_decoder import DecodedHidFrame, HidLineDecoder, TERMINATORS


OBSERVED_SCENARIOS = {
    "normal",
    "repeated_memory",
    "rapid_consecutive",
}
DERIVED_SCENARIOS = {
    "below_limit",
    "above_limit",
    "partial",
    "missing_field",
    "bad_number",
    "unsupported_unit",
}
ALLOWED_SCENARIOS = OBSERVED_SCENARIOS | DERIVED_SCENARIOS
OBSERVED_MINIMUM_RECORDS = {
    "normal": 3,
    "repeated_memory": 2,
    "rapid_consecutive": 5,
}
FIXTURE_KEYS = {
    "schemaVersion",
    "payloadText",
    "terminator",
    "scenario",
    "sequence",
    "provenance",
}
SERIAL_ALIAS = re.compile(r"\bSERIAL_[A-Z0-9_]+\b")
FORBIDDEN_PRIVATE_TEXT = (
    "/dev/input/",
    "/Users/",
    "/home/",
    "/var/lib/torque-agent/",
    "torque-capture-private",
)


@dataclass(frozen=True)
class ReplayResult:
    frames: tuple[DecodedHidFrame, ...]
    pending_key_count: int
    pending_unsupported_key_count: int

    @property
    def unsupported_key_count(self) -> int:
        return self.pending_unsupported_key_count + sum(
            len(frame.unsupported_key_codes) for frame in self.frames
        )


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CaptureSafetyError(f"invalid JSON file: {path.name}") from error
    if not isinstance(value, dict):
        raise CaptureSafetyError(f"JSON root must be an object: {path.name}")
    return value


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    try:
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("record is not an object")
                records.append(value)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise CaptureSafetyError(f"invalid JSONL at {path.name}") from error
    if not records:
        raise CaptureSafetyError(f"JSONL contains no records: {path.name}")
    return records


def resolve_private_capture(input_path: Path) -> tuple[Path, dict[str, Any] | None]:
    resolved = require_private_path(input_path, label="raw capture input")
    if resolved.is_dir():
        events_path = resolved / PRIVATE_EVENTS_FILE
        manifest_path = resolved / PRIVATE_MANIFEST_FILE
        if not events_path.is_file() or not manifest_path.is_file():
            raise CaptureSafetyError("capture directory is missing its private event or manifest file")
        return events_path, _load_json_object(manifest_path)
    if not resolved.is_file():
        raise CaptureSafetyError("capture input does not exist")
    manifest_path = resolved.parent / PRIVATE_MANIFEST_FILE
    return resolved, _load_json_object(manifest_path) if manifest_path.is_file() else None


def replay_capture(input_path: Path, *, allow_repository_input: bool = False) -> ReplayResult:
    manifest: dict[str, Any] | None = None
    if allow_repository_input:
        events_path = input_path.expanduser().resolve(strict=True)
        if events_path.name != "synthetic-key-events.jsonl":
            raise CaptureSafetyError("repository replay is limited to synthetic-key-events.jsonl")
        contract_path = events_path.parent / "fixture-contract.json"
        if events_path.parent.name != "capture_contract" or not contract_path.is_file() or _load_json_object(
            contract_path
        ) != {
            "schemaVersion": CAPTURE_SCHEMA_VERSION,
            "kind": "synthetic-capture-contract",
        }:
            raise CaptureSafetyError("repository replay requires a synthetic fixture contract marker")
    else:
        events_path, manifest = resolve_private_capture(input_path)
    raw_terminators = manifest.get("frameTerminators") if manifest is not None else None
    if raw_terminators is None:
        frame_terminators = frozenset(DEFAULT_FRAME_TERMINATORS)
    elif (
        not isinstance(raw_terminators, list)
        or not raw_terminators
        or not all(isinstance(value, str) and value in TERMINATORS for value in raw_terminators)
    ):
        raise CaptureSafetyError("capture manifest has invalid frame terminators")
    else:
        frame_terminators = frozenset(raw_terminators)
    decoder = HidLineDecoder(terminators=frame_terminators)
    frames: list[DecodedHidFrame] = []
    for index, record in enumerate(_load_jsonl(events_path), start=1):
        if record.get("schemaVersion") != CAPTURE_SCHEMA_VERSION:
            raise CaptureSafetyError(f"unsupported capture schema at event {index}")
        if record.get("eventType") != "EV_KEY":
            raise CaptureSafetyError(f"non-EV_KEY record at event {index}")
        key_codes = record.get("keyCodes")
        key_state = record.get("keyState")
        if not isinstance(key_codes, list) or not key_codes or not all(isinstance(code, str) for code in key_codes):
            raise CaptureSafetyError(f"invalid key code list at event {index}")
        if key_state not in {"down", "up", "hold"}:
            raise CaptureSafetyError(f"invalid key state at event {index}")
        frame = decoder.feed(key_codes[0], key_state)
        if frame is not None and (frame.text or frame.unsupported_key_codes):
            frames.append(frame)
    return ReplayResult(
        frames=tuple(frames),
        pending_key_count=decoder.pending_key_count,
        pending_unsupported_key_count=decoder.pending_unsupported_key_count,
    )


def replay_summary(input_path: Path, *, allow_repository_input: bool = False) -> dict[str, Any]:
    replay = replay_capture(input_path, allow_repository_input=allow_repository_input)
    terminators: dict[str, int] = {}
    for frame in replay.frames:
        terminators[frame.terminator] = terminators.get(frame.terminator, 0) + 1
    return {
        "frames": len(replay.frames),
        "terminators": terminators,
        "unsupportedKeys": replay.unsupported_key_count,
        "pendingKeys": replay.pending_key_count,
    }


def _load_redactions(path: Path) -> list[tuple[str, str]]:
    resolved = require_private_path(path, label="redaction map")
    if not resolved.is_file():
        raise CaptureSafetyError("redaction map does not exist")
    if resolved.stat().st_mode & 0o077:
        raise CaptureSafetyError("redaction map must not be readable or writable by group/other users")
    value = _load_json_object(resolved)
    literals = value.get("literals")
    if not isinstance(literals, list) or not literals:
        raise CaptureSafetyError("redaction map must contain a non-empty literals array")
    replacements: list[tuple[str, str]] = []
    for index, item in enumerate(literals, start=1):
        if not isinstance(item, dict) or set(item) != {"source", "replacement"}:
            raise CaptureSafetyError(f"invalid redaction entry {index}")
        source = item.get("source")
        replacement = item.get("replacement")
        if not isinstance(source, str) or not source:
            raise CaptureSafetyError(f"redaction source {index} must be non-empty text")
        if not isinstance(replacement, str) or SERIAL_ALIAS.fullmatch(replacement) is None:
            raise CaptureSafetyError(f"redaction replacement {index} must use a SERIAL_* alias")
        replacements.append((source, replacement))
    if len({source for source, _ in replacements}) != len(replacements):
        raise CaptureSafetyError("redaction sources must be unique")
    if len({replacement for _, replacement in replacements}) != len(replacements):
        raise CaptureSafetyError("redaction aliases must be unique")
    return replacements


def _write_sanitized_jsonl(output: Path, records: list[dict[str, Any]]) -> None:
    resolved = output.expanduser().resolve(strict=False)
    if resolved.exists():
        raise CaptureSafetyError("sanitized fixture output must not already exist")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    temporary = resolved.with_suffix(f"{resolved.suffix}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            for record in records:
                stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, resolved)
    finally:
        if temporary.exists():
            temporary.unlink()


def sanitize_capture(input_path: Path, redactions_path: Path, output: Path) -> dict[str, Any]:
    events_path, manifest = resolve_private_capture(input_path)
    if manifest is None or manifest.get("status") != "complete":
        raise CaptureIncompleteError("only a complete capture can be sanitized")
    scenario = manifest.get("scenario")
    if scenario not in OBSERVED_SCENARIOS:
        raise CaptureSafetyError("raw capture has an unsupported observed scenario")

    replay = replay_capture(events_path)
    if not replay.frames:
        raise CaptureIncompleteError("capture contains no complete frames")
    if manifest.get("capturedFrames") != len(replay.frames) or manifest.get("expectedFrames") != len(replay.frames):
        raise CaptureIncompleteError("capture manifest and replayed frame counts do not match")
    if replay.pending_key_count:
        raise CaptureIncompleteError("capture ends with a partial frame")
    if replay.unsupported_key_count:
        raise CaptureIncompleteError("capture contains unsupported keys; inspect it before sanitizing")

    replacements = _load_redactions(redactions_path)
    occurrence_counts = [0] * len(replacements)
    sanitized_records: list[dict[str, Any]] = []
    for sequence, frame in enumerate(replay.frames, start=1):
        payload = frame.text
        for index, (source, replacement) in enumerate(replacements):
            count = payload.count(source)
            occurrence_counts[index] += count
            payload = payload.replace(source, replacement)
        sanitized_records.append(
            {
                "schemaVersion": CAPTURE_SCHEMA_VERSION,
                "payloadText": payload,
                "terminator": frame.terminator,
                "scenario": scenario,
                "sequence": sequence,
                "provenance": "observed",
            }
        )
    if any(count == 0 for count in occurrence_counts):
        raise CaptureSafetyError("at least one redaction source was not found; no fixture was written")
    joined = "\n".join(record["payloadText"] for record in sanitized_records)
    if any(source in joined for source, _ in replacements):
        raise CaptureSafetyError("a redaction source remains after replacement; no fixture was written")
    _write_sanitized_jsonl(output, sanitized_records)
    return {"frames": len(sanitized_records), "scenario": scenario, "aliases": len(replacements)}


def _validate_fixture_record(record: dict[str, Any], path: Path, expected_sequence: int) -> None:
    if set(record) != FIXTURE_KEYS:
        raise CaptureSafetyError(f"fixture schema keys are invalid: {path.name}")
    if (
        not isinstance(record["schemaVersion"], int)
        or isinstance(record["schemaVersion"], bool)
        or record["schemaVersion"] != CAPTURE_SCHEMA_VERSION
    ):
        raise CaptureSafetyError(f"fixture schema version is invalid: {path.name}")
    if not isinstance(record["payloadText"], str) or not record["payloadText"]:
        raise CaptureSafetyError(f"fixture payload must be non-empty text: {path.name}")
    if not isinstance(record["terminator"], str) or record["terminator"] not in TERMINATORS:
        raise CaptureSafetyError(f"fixture terminator is invalid: {path.name}")
    if not isinstance(record["scenario"], str) or record["scenario"] not in ALLOWED_SCENARIOS:
        raise CaptureSafetyError(f"fixture scenario is invalid: {path.name}")
    if (
        not isinstance(record["sequence"], int)
        or isinstance(record["sequence"], bool)
        or record["sequence"] != expected_sequence
    ):
        raise CaptureSafetyError(f"fixture sequence is not contiguous: {path.name}")
    if not isinstance(record["provenance"], str) or record["provenance"] not in {"observed", "derived"}:
        raise CaptureSafetyError(f"fixture provenance is invalid: {path.name}")
    serialized = json.dumps(record, ensure_ascii=False)
    if any(forbidden in serialized for forbidden in FORBIDDEN_PRIVATE_TEXT):
        raise CaptureSafetyError(f"fixture contains private capture metadata: {path.name}")


def validate_fixtures(
    fixtures: Path,
    *,
    available_device_count: int = 1,
    redactions_path: Path | None = None,
) -> dict[str, Any]:
    root = fixtures.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise CaptureSafetyError("fixtures path must be a directory")
    if available_device_count < 1:
        raise CaptureSafetyError("available device count must be at least one")

    contract_path = root / "fixture-contract.json"
    synthetic = False
    if contract_path.is_file():
        contract = _load_json_object(contract_path)
        synthetic = contract == {"schemaVersion": CAPTURE_SCHEMA_VERSION, "kind": "synthetic-capture-contract"}
        if not synthetic:
            raise CaptureSafetyError("fixture contract marker is invalid")
        if root.name != "capture_contract":
            raise CaptureSafetyError("synthetic fixture contract is allowed only in capture_contract")
    elif (root / "synthetic-key-events.jsonl").exists():
        raise CaptureSafetyError("synthetic key events require a synthetic fixture contract marker")

    fixture_files = sorted(
        path for path in root.rglob("*.jsonl") if path.name != "synthetic-key-events.jsonl"
    )
    if not fixture_files:
        raise CaptureIncompleteError("fixture set contains no scenario files")

    scenarios: set[str] = set()
    scenario_record_counts: dict[str, int] = {}
    aliases: set[str] = set()
    total_records = 0
    for path in fixture_files:
        if path.stem not in ALLOWED_SCENARIOS:
            raise CaptureSafetyError(f"fixture filename is not a known scenario: {path.name}")
        records = _load_jsonl(path)
        for sequence, record in enumerate(records, start=1):
            _validate_fixture_record(record, path, sequence)
            if record["scenario"] != path.stem:
                raise CaptureSafetyError(f"fixture scenario does not match its filename: {path.name}")
            required_provenance = "derived" if synthetic or path.stem in DERIVED_SCENARIOS else "observed"
            if record["provenance"] != required_provenance:
                raise CaptureSafetyError(f"fixture provenance does not match its scenario: {path.name}")
            scenarios.add(record["scenario"])
            scenario_record_counts[record["scenario"]] = scenario_record_counts.get(record["scenario"], 0) + 1
            aliases.update(SERIAL_ALIAS.findall(record["payloadText"]))
            total_records += 1

    missing = OBSERVED_SCENARIOS - scenarios
    if missing:
        raise CaptureIncompleteError("fixture coverage is incomplete: " + ", ".join(sorted(missing)))
    insufficient = [] if synthetic else [
        f"{scenario} ({scenario_record_counts.get(scenario, 0)}/{minimum})"
        for scenario, minimum in OBSERVED_MINIMUM_RECORDS.items()
        if scenario_record_counts.get(scenario, 0) < minimum
    ]
    if insufficient:
        raise CaptureIncompleteError("fixture record coverage is incomplete: " + ", ".join(insufficient))
    if not synthetic:
        minimum_aliases = 2 if available_device_count > 1 else 1
        if len(aliases) < minimum_aliases:
            raise CaptureIncompleteError(
                f"fixture set requires at least {minimum_aliases} distinct anonymized serial alias(es)"
            )

    if redactions_path is not None:
        sources = [source for source, _ in _load_redactions(redactions_path)]
        fixture_text = "\n".join(path.read_text(encoding="utf-8") for path in fixture_files)
        if any(source in fixture_text for source in sources):
            raise CaptureSafetyError("fixture set still contains a redaction source")

    return {
        "fixtureKind": "synthetic" if synthetic else "observed",
        "files": len(fixture_files),
        "records": total_records,
        "scenarios": sorted(scenarios),
        "serialAliases": len(aliases),
    }
