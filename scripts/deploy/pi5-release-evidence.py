#!/usr/bin/env python3
"""Create and verify sealed, run-scoped Pi5 release evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import time
from typing import Any


SHA = re.compile(r"^[0-9a-f]{40}$")
RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
IMAGE_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
MIGRATION_TTL_MAX = 3600
RESOURCE_TTL_MAX = 300
RESOURCE_SAMPLE_COUNT = 3
RESOURCE_SAMPLE_INTERVAL = 20


class EvidenceError(ValueError):
    pass


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _seal(payload: dict[str, Any]) -> str:
    unsigned = dict(payload)
    unsigned.pop("seal", None)
    return "sha256:" + hashlib.sha256(_canonical(unsigned)).hexdigest()


def _validate_identity(run_id: str, desired_sha: str) -> None:
    if RUN_ID.fullmatch(run_id) is None:
        raise EvidenceError("run ID is malformed")
    if SHA.fullmatch(desired_sha) is None:
        raise EvidenceError("desired SHA must be a full lowercase Git SHA")


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    parent_link = path.parent.lstat()
    if stat.S_ISLNK(parent_link.st_mode):
        raise EvidenceError("evidence directory must not be a symbolic link")
    parent = path.parent.stat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid():
        raise EvidenceError("evidence directory must be owned by the deploy process")
    payload["seal"] = _seal(payload)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(_canonical(payload) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _read(path: Path) -> dict[str, Any]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        before = path.lstat()
        if stat.S_ISLNK(before.st_mode):
            raise EvidenceError("evidence must not be a symbolic link")
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
            metadata = os.fstat(stream.fileno())
            if (before.st_dev, before.st_ino) != (metadata.st_dev, metadata.st_ino):
                raise EvidenceError("evidence changed while it was being opened")
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise EvidenceError("evidence must be a regular, single-link file")
            if metadata.st_uid != os.geteuid():
                raise EvidenceError("evidence owner does not match the deploy process")
            if stat.S_IMODE(metadata.st_mode) & 0o077:
                raise EvidenceError("evidence permissions must not grant group or other access")
            payload = json.load(
                stream,
                object_pairs_hook=_pairs,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    EvidenceError(f"non-finite JSON number: {value}")
                ),
            )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise EvidenceError(f"could not read evidence: {error}") from error
    if not isinstance(payload, dict):
        raise EvidenceError("evidence root must be an object")
    if not isinstance(payload.get("seal"), str):
        raise EvidenceError("evidence seal is malformed")
    if payload.get("seal") != _seal(payload):
        raise EvidenceError("evidence seal does not match its contents")
    return payload


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise EvidenceError(f"{label} schema contains missing or unknown fields")


def _number(value: Any, label: str) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise EvidenceError(f"{label} must be a finite non-negative number")
    return float(value)


def _validate_common(
    payload: dict[str, Any], *, kind: str, run_id: str, desired_sha: str, now: int
) -> dict[str, Any]:
    _validate_identity(run_id, desired_sha)
    _exact_keys(
        payload,
        {
            "version",
            "kind",
            "runId",
            "desiredSha",
            "createdAtEpoch",
            "expiresAtEpoch",
            "data",
            "seal",
        },
        "evidence",
    )
    if type(payload.get("version")) is not int or payload.get("version") != 1 or payload.get("kind") != kind:
        raise EvidenceError(f"expected {kind} evidence schema version 1")
    if payload.get("runId") != run_id or payload.get("desiredSha") != desired_sha:
        raise EvidenceError("evidence belongs to a different run or desired SHA")
    created = payload.get("createdAtEpoch")
    expires = payload.get("expiresAtEpoch")
    if type(created) is not int or type(expires) is not int or expires <= created:
        raise EvidenceError("evidence timestamps are malformed")
    if created > now + 30:
        raise EvidenceError("evidence timestamp is in the future")
    if expires < now:
        raise EvidenceError("evidence has expired")
    maximum_lifetime = MIGRATION_TTL_MAX if kind == "migration-plan" else RESOURCE_TTL_MAX
    if expires - created > maximum_lifetime or now - created > maximum_lifetime:
        raise EvidenceError("evidence lifetime exceeds the policy boundary")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise EvidenceError("evidence data is malformed")
    return data


def _ledger_digest(path: Path) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise EvidenceError("migration ledger must be a regular, single-link file")
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def create_migration(args: argparse.Namespace) -> None:
    _validate_identity(args.run_id, args.sha)
    if SHA.fullmatch(args.base_sha) is None:
        raise EvidenceError("base SHA must be a full lowercase Git SHA")
    now = int(time.time())
    if type(args.ttl) is not int or not 0 < args.ttl <= MIGRATION_TTL_MAX:
        raise EvidenceError(f"migration evidence TTL must be 1..{MIGRATION_TTL_MAX}")
    _write(
        args.output,
        {
            "version": 1,
            "kind": "migration-plan",
            "runId": args.run_id,
            "desiredSha": args.sha,
            "createdAtEpoch": now,
            "expiresAtEpoch": now + args.ttl,
            "data": {
                "baseSha": args.base_sha,
                "ledgerSha256": _ledger_digest(args.ledger),
            },
        },
    )


def verify_migration(args: argparse.Namespace) -> None:
    payload = _read(args.path)
    data = _validate_common(
        payload,
        kind="migration-plan",
        run_id=args.run_id,
        desired_sha=args.sha,
        now=int(time.time()),
    )
    if args.ledger is not None and data.get("ledgerSha256") != _ledger_digest(args.ledger):
        raise EvidenceError("applied migration ledger changed after planning")
    if SHA.fullmatch(str(data.get("baseSha", ""))) is None:
        raise EvidenceError("migration plan base SHA is malformed")
    _exact_keys(data, {"baseSha", "ledgerSha256"}, "migration plan data")
    if re.fullmatch(r"sha256:[0-9a-f]{64}", str(data.get("ledgerSha256", ""))) is None:
        raise EvidenceError("migration ledger digest is malformed")
    print(json.dumps(data, sort_keys=True, separators=(",", ":")))


def _positive_number(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < 0:
        raise argparse.ArgumentTypeError("value must be finite and non-negative")
    return parsed


def create_resource(args: argparse.Namespace) -> None:
    _validate_identity(args.run_id, args.sha)
    for image in (args.api_image, args.web_image):
        matches = re.findall(r"(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])", image)
        if matches != [args.sha]:
            raise EvidenceError("candidate image name is not bound to the desired SHA")
    for image_id in (args.api_image_id, args.web_image_id):
        if IMAGE_ID.fullmatch(image_id) is None:
            raise EvidenceError("Docker image ID is malformed")
    if type(args.ttl) is not int or not 0 < args.ttl <= RESOURCE_TTL_MAX:
        raise EvidenceError(f"resource evidence TTL must be 1..{RESOURCE_TTL_MAX}")
    samples = json.loads(
        args.samples_json,
        object_pairs_hook=_pairs,
        parse_constant=lambda value: (_ for _ in ()).throw(
            EvidenceError(f"non-finite JSON number: {value}")
        ),
    )
    if not isinstance(samples, list) or len(samples) < RESOURCE_SAMPLE_COUNT:
        raise EvidenceError(f"resource evidence requires {RESOURCE_SAMPLE_COUNT} load samples")
    samples = samples[-RESOURCE_SAMPLE_COUNT:]
    previous_at: int | None = None
    for sample in samples:
        if (
            not isinstance(sample, dict)
            or set(sample) != {"atEpoch", "load"}
            or type(sample.get("atEpoch")) is not int
        ):
            raise EvidenceError("load sample is malformed")
        _number(sample.get("load"), "sample load")
        if previous_at is not None and not (
            RESOURCE_SAMPLE_INTERVAL - 2
            <= sample["atEpoch"] - previous_at
            <= RESOURCE_SAMPLE_INTERVAL + 10
        ):
            raise EvidenceError("load samples are not separated by the required interval")
        previous_at = sample["atEpoch"]
    for label in (
        "memory_mb",
        "disk_gb",
        "min_memory_mb",
        "min_disk_gb",
        "max_load",
    ):
        _number(getattr(args, label), label)
    if args.memory_mb < args.min_memory_mb or args.disk_gb < args.min_disk_gb:
        raise EvidenceError("resource values do not satisfy their thresholds")
    if any(float(sample["load"]) >= args.max_load for sample in samples):
        raise EvidenceError("load sample does not satisfy the maximum")
    now = int(time.time())
    if samples[-1]["atEpoch"] > now + 30 or samples[-1]["atEpoch"] < now - RESOURCE_TTL_MAX:
        raise EvidenceError("load samples are not fresh")
    _write(
        args.output,
        {
            "version": 1,
            "kind": "candidate-resource",
            "runId": args.run_id,
            "desiredSha": args.sha,
            "createdAtEpoch": now,
            "expiresAtEpoch": now + args.ttl,
            "data": {
                "images": {
                    "api": {"name": args.api_image, "id": args.api_image_id},
                    "web": {"name": args.web_image, "id": args.web_image_id},
                },
                "thresholds": {
                    "minMemoryMb": args.min_memory_mb,
                    "minDiskGb": args.min_disk_gb,
                    "maxLoad": args.max_load,
                },
                "values": {"memoryMb": args.memory_mb, "diskGb": args.disk_gb},
                "loadSamples": samples,
            },
        },
    )


def verify_resource(args: argparse.Namespace) -> None:
    if args.sample_interval != RESOURCE_SAMPLE_INTERVAL:
        raise EvidenceError("resource sample interval does not match fixed policy")
    for image_id in (args.api_image_id, args.web_image_id):
        if IMAGE_ID.fullmatch(image_id) is None:
            raise EvidenceError("Docker image ID is malformed")
    for image in (args.api_image, args.web_image):
        matches = re.findall(r"(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])", image)
        if matches != [args.sha]:
            raise EvidenceError("candidate image name is not bound to the desired SHA")
    data = _validate_common(
        _read(args.path),
        kind="candidate-resource",
        run_id=args.run_id,
        desired_sha=args.sha,
        now=int(time.time()),
    )
    images = data.get("images")
    expected = {
        "api": {"name": args.api_image, "id": args.api_image_id},
        "web": {"name": args.web_image, "id": args.web_image_id},
    }
    if images != expected:
        raise EvidenceError("resource evidence does not match the exact candidate images")
    thresholds = data.get("thresholds")
    values = data.get("values")
    samples = data.get("loadSamples")
    if not isinstance(thresholds, dict) or not isinstance(values, dict) or not isinstance(samples, list):
        raise EvidenceError("resource evidence data is incomplete")
    _exact_keys(data, {"images", "thresholds", "values", "loadSamples"}, "resource data")
    _exact_keys(images, {"api", "web"}, "resource images")
    for name in ("api", "web"):
        if not isinstance(images[name], dict):
            raise EvidenceError("resource image identity is malformed")
        _exact_keys(images[name], {"name", "id"}, "resource image identity")
    _exact_keys(thresholds, {"minMemoryMb", "minDiskGb", "maxLoad"}, "resource thresholds")
    _exact_keys(values, {"memoryMb", "diskGb"}, "resource values")
    expected_thresholds = {
        "minMemoryMb": args.min_memory_mb,
        "minDiskGb": args.min_disk_gb,
        "maxLoad": args.max_load,
    }
    if thresholds != expected_thresholds:
        raise EvidenceError("resource evidence thresholds do not match current policy")
    if (
        _number(values.get("memoryMb"), "memory value") < thresholds["minMemoryMb"]
        or _number(values.get("diskGb"), "disk value") < thresholds["minDiskGb"]
    ):
        raise EvidenceError("recorded memory or disk no longer proves the gate")
    maximum = thresholds.get("maxLoad")
    _number(maximum, "maximum load")
    if len(samples) != RESOURCE_SAMPLE_COUNT:
        raise EvidenceError("recorded load threshold or samples are missing")
    previous_at: int | None = None
    now = int(time.time())
    for sample in samples:
        if not isinstance(sample, dict) or set(sample) != {"atEpoch", "load"} or type(sample.get("atEpoch")) is not int:
            raise EvidenceError("recorded load sample is malformed")
        if _number(sample.get("load"), "sample load") >= maximum:
            raise EvidenceError("recorded load samples do not prove the gate")
        if previous_at is not None and not (
            args.sample_interval - 2
            <= sample["atEpoch"] - previous_at
            <= args.sample_interval + 10
        ):
            raise EvidenceError("recorded load sample interval is outside policy")
        previous_at = sample["atEpoch"]
    if samples[-1]["atEpoch"] > now + 30 or samples[-1]["atEpoch"] < now - RESOURCE_TTL_MAX:
        raise EvidenceError("recorded load samples are not fresh")
    print(json.dumps(data, sort_keys=True, separators=(",", ":")))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    sub = result.add_subparsers(dest="command", required=True)

    migration = sub.add_parser("create-migration")
    migration.add_argument("--output", type=Path, required=True)
    migration.add_argument("--run-id", required=True)
    migration.add_argument("--sha", required=True)
    migration.add_argument("--base-sha", required=True)
    migration.add_argument("--ledger", type=Path, required=True)
    migration.add_argument("--ttl", type=int, default=3600)
    migration.set_defaults(action=create_migration)

    migration_verify = sub.add_parser("verify-migration")
    migration_verify.add_argument("--path", type=Path, required=True)
    migration_verify.add_argument("--run-id", required=True)
    migration_verify.add_argument("--sha", required=True)
    migration_verify.add_argument("--ledger", type=Path)
    migration_verify.set_defaults(action=verify_migration)

    resource = sub.add_parser("create-resource")
    resource.add_argument("--output", type=Path, required=True)
    resource.add_argument("--run-id", required=True)
    resource.add_argument("--sha", required=True)
    resource.add_argument("--api-image", required=True)
    resource.add_argument("--web-image", required=True)
    resource.add_argument("--api-image-id", required=True)
    resource.add_argument("--web-image-id", required=True)
    resource.add_argument("--memory-mb", type=_positive_number, required=True)
    resource.add_argument("--disk-gb", type=_positive_number, required=True)
    resource.add_argument("--min-memory-mb", type=_positive_number, required=True)
    resource.add_argument("--min-disk-gb", type=_positive_number, required=True)
    resource.add_argument("--max-load", type=_positive_number, required=True)
    resource.add_argument("--samples-json", required=True)
    resource.add_argument("--ttl", type=int, default=300)
    resource.set_defaults(action=create_resource)

    resource_verify = sub.add_parser("verify-resource")
    resource_verify.add_argument("--path", type=Path, required=True)
    resource_verify.add_argument("--run-id", required=True)
    resource_verify.add_argument("--sha", required=True)
    resource_verify.add_argument("--api-image", required=True)
    resource_verify.add_argument("--web-image", required=True)
    resource_verify.add_argument("--api-image-id", required=True)
    resource_verify.add_argument("--web-image-id", required=True)
    resource_verify.add_argument("--min-memory-mb", type=_positive_number, required=True)
    resource_verify.add_argument("--min-disk-gb", type=_positive_number, required=True)
    resource_verify.add_argument("--max-load", type=_positive_number, required=True)
    resource_verify.add_argument("--sample-interval", type=int, default=RESOURCE_SAMPLE_INTERVAL)
    resource_verify.set_defaults(action=verify_resource)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        args.action(args)
    except (EvidenceError, OSError, json.JSONDecodeError, ValueError) as error:
        print(f"ERROR: {error}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
