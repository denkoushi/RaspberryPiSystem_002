#!/usr/bin/env python3
"""Docker adapter and I/O runtime for the image-retention policy."""

from __future__ import annotations

import datetime as _datetime
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

if __package__:
    from .docker_image_retention_model import (
        PLAN_SCHEMA_VERSION,
        SUMMARY_KIND,
        ImageRecord,
        RetentionError,
        RetentionState,
        parse_image_inspect,
        parse_retention_state,
        sha256_json,
        strict_object,
        validate_container_id,
        validate_image_id,
        validate_reference,
    )
    from .docker_image_retention_policy import (
        DockerSnapshot,
        build_plan,
        ensure_current_ids_running,
        validate_plan,
    )
else:
    from docker_image_retention_model import (
        PLAN_SCHEMA_VERSION,
        SUMMARY_KIND,
        ImageRecord,
        RetentionError,
        RetentionState,
        parse_image_inspect,
        parse_retention_state,
        sha256_json,
        strict_object,
        validate_container_id,
        validate_image_id,
        validate_reference,
    )
    from docker_image_retention_policy import (
        DockerSnapshot,
        build_plan,
        ensure_current_ids_running,
        validate_plan,
    )


MAX_JSON_BYTES = 1024 * 1024
MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 60
SAFE_COMMAND_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"


class DockerCommandError(RetentionError):
    """A Docker read or image-removal command did not complete successfully."""

    def __init__(self, operation: str, *, returncode: int | None = None) -> None:
        suffix = f" (exit {returncode})" if returncode is not None else ""
        super().__init__(f"Docker {operation} failed{suffix}", reason="docker")
        self.operation = operation
        self.returncode = returncode


def _read_json_file(path: Path, *, label: str) -> dict[str, Any]:
    if "\x00" in os.fspath(path):
        raise RetentionError(f"{label} path is malformed", reason="invalid_path")
    try:
        if path.is_symlink() or not path.is_file():
            raise RetentionError(f"{label} is not a regular file", reason="invalid_path")
        if path.stat().st_size > MAX_JSON_BYTES:
            raise RetentionError(f"{label} exceeds its size limit", reason="invalid_json")
        raw = path.read_bytes()
    except RetentionError:
        raise
    except (OSError, UnicodeError) as error:
        raise RetentionError(f"{label} cannot be read", reason="io") from error
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError, RetentionError) as error:
        if isinstance(error, RetentionError):
            raise
        raise RetentionError(f"{label} is not valid JSON", reason="invalid_json") from error
    if not isinstance(value, dict):
        raise RetentionError(f"{label} must be a JSON object", reason="invalid_json")
    return value


def load_retention_state(path: Path) -> tuple[RetentionState, str]:
    document = _read_json_file(path, label="retention state")
    state = parse_retention_state(document)
    return state, sha256_json(state.as_document())


class DockerClient:
    """Small fixed-argv Docker adapter used by the planner and applier."""

    IMAGE_INSPECT_TEMPLATE = (
        '{"id":{{json .Id}},"created":{{json .Created}},"size":{{json .Size}},'
        '"repoTags":{{json .RepoTags}},"repoDigests":{{json .RepoDigests}},'
        '"labels":{{json .Config.Labels}}}'
    )

    def __init__(self, executable: str = "docker") -> None:
        if not executable or "\x00" in executable:
            raise RetentionError("Docker executable is malformed", reason="invalid_path")
        self.executable = executable

    def _run(self, arguments: Sequence[str], *, operation: str) -> str:
        if any(not isinstance(value, str) or "\x00" in value for value in arguments):
            raise RetentionError("Docker argv is malformed", reason="invalid_command")
        environment = {
            "PATH": SAFE_COMMAND_PATH,
            "LANG": "C",
            "LC_ALL": "C",
        }
        command = [self.executable, *arguments]
        try:
            with tempfile.TemporaryFile() as output:
                completed = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=subprocess.DEVNULL,
                    env=environment,
                    timeout=COMMAND_TIMEOUT_SECONDS,
                    check=False,
                )
                if output.tell() > MAX_COMMAND_OUTPUT_BYTES:
                    raise RetentionError(
                        "Docker command output exceeds its size limit", reason="docker"
                    )
                output.seek(0)
                raw = output.read()
        except RetentionError:
            raise
        except (OSError, subprocess.TimeoutExpired) as error:
            raise DockerCommandError(operation) from error
        if completed.returncode != 0:
            raise DockerCommandError(operation, returncode=completed.returncode)
        try:
            return raw.decode("utf-8", errors="strict").strip()
        except UnicodeDecodeError as error:
            raise RetentionError("Docker output is not UTF-8", reason="invalid_docker") from error

    def list_image_ids(self) -> tuple[str, ...]:
        raw = self._run(
            ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"],
            operation="image list",
        )
        identifiers = {line for line in raw.splitlines() if line}
        validated = {
            validate_image_id(identifier, label="Docker image list ID")
            for identifier in identifiers
        }
        return tuple(sorted(validated))

    def inspect_image(self, image_id: str) -> ImageRecord:
        image_id = validate_image_id(image_id)
        return self._inspect_image_target(image_id, require_same_id=True)

    def inspect_reference(self, reference: str) -> ImageRecord:
        reference = validate_reference(reference, label="Docker image reference")
        return self._inspect_image_target(reference, require_same_id=False)

    def _inspect_image_target(
        self, target: str, *, require_same_id: bool
    ) -> ImageRecord:
        raw = self._run(
            ["image", "inspect", "--format", self.IMAGE_INSPECT_TEMPLATE, target],
            operation="image inspect",
        )
        try:
            document = json.loads(raw, object_pairs_hook=strict_object)
        except (json.JSONDecodeError, UnicodeError, RetentionError) as error:
            if isinstance(error, RetentionError):
                raise
            raise RetentionError("Docker image inspect is not valid JSON", reason="invalid_docker") from error
        if not isinstance(document, dict):
            raise RetentionError("Docker image inspect is malformed", reason="invalid_docker")
        record = parse_image_inspect(document)
        if require_same_id and record.image_id != target:
            raise RetentionError("Docker image inspect returned a different image", reason="invalid_docker")
        return record

    def list_container_ids(self, *, all_containers: bool) -> tuple[str, ...]:
        arguments = ["ps"]
        if all_containers:
            arguments.append("--all")
        arguments.extend(("--quiet", "--no-trunc"))
        raw = self._run(arguments, operation="container list")
        identifiers = {line for line in raw.splitlines() if line}
        return tuple(sorted(validate_container_id(identifier) for identifier in identifiers))

    def inspect_container_image_id(self, container_id: str) -> str:
        container_id = validate_container_id(container_id)
        raw = self._run(
            ["inspect", "--type", "container", "--format", "{{json .Image}}", container_id],
            operation="container inspect",
        )
        try:
            image_id = json.loads(raw)
        except (json.JSONDecodeError, UnicodeError) as error:
            raise RetentionError("Docker container image ID is not valid JSON", reason="invalid_docker") from error
        return validate_image_id(image_id, label="Docker container image ID")

    def remove_image(self, image_id: str) -> None:
        image_id = validate_image_id(image_id)
        self._run(["image", "rm", image_id], operation="image removal")


def collect_snapshot(client: DockerClient) -> DockerSnapshot:
    image_ids = client.list_image_ids()
    images = tuple(
        sorted((client.inspect_image(image_id) for image_id in image_ids), key=lambda item: item.image_id)
    )
    all_container_image_ids = frozenset(
        client.inspect_container_image_id(container_id)
        for container_id in client.list_container_ids(all_containers=True)
    )
    running_container_image_ids = frozenset(
        client.inspect_container_image_id(container_id)
        for container_id in client.list_container_ids(all_containers=False)
    )
    if not running_container_image_ids.issubset(all_container_image_ids):
        raise RetentionError(
            "running container references are not present in all-container references",
            reason="invalid_docker",
        )
    return DockerSnapshot(
        images=images,
        container_image_ids=all_container_image_ids,
        running_container_image_ids=running_container_image_ids,
    )


def _validate_retention_references(client: DockerClient, state: RetentionState) -> None:
    for entry in state.entries:
        inspected = client.inspect_reference(entry.reference)
        if inspected.image_id != entry.image_id:
            raise RetentionError(
                f"{entry.service} {entry.reference} resolves to a different image ID",
                reason="state_mismatch",
            )


def plan_from_runtime(
    client: DockerClient,
    *,
    state_path: Path,
    now: _datetime.datetime | None = None,
) -> dict[str, Any]:
    state, state_sha256 = load_retention_state(state_path)
    snapshot = collect_snapshot(client)
    _validate_retention_references(client, state)
    return build_plan(
        snapshot,
        state,
        state_path=str(state_path.resolve()),
        state_sha256=state_sha256,
        now=now,
    )


def load_plan(path: Path) -> dict[str, Any]:
    document = _read_json_file(path, label="retention plan")
    return validate_plan(document)


def write_plan(path: Path, plan: Mapping[str, Any]) -> None:
    """Create one plan atomically and refuse to replace a populated plan.

    The monthly shell coordinator reserves its output name with ``mktemp``.
    An empty, regular reservation is therefore accepted and replaced only
    after the complete plan has been fsynced.  A populated or symlinked path is
    never replaced.
    """

    validate_plan(plan)
    if "\x00" in os.fspath(path) or path.is_symlink():
        raise RetentionError("retention plan path is malformed", reason="invalid_path")
    parent = path.parent
    precreated_empty = False
    try:
        if not parent.is_dir() or parent.is_symlink():
            raise RetentionError("retention plan directory is unavailable", reason="invalid_path")
        if path.exists():
            if not path.is_file() or path.stat().st_size != 0:
                raise RetentionError("retention plan already exists", reason="plan_exists")
            precreated_empty = True
            descriptor = -1
        else:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(path, flags, 0o600)
    except RetentionError:
        raise
    except FileExistsError as error:
        # A concurrent creator wins; never replace its plan.
        raise RetentionError("retention plan already exists", reason="plan_exists") from error
    except OSError as error:
        raise RetentionError("retention plan cannot be created", reason="io") from error
    temporary_path: Path | None = None
    try:
        encoded = (
            json.dumps(plan, ensure_ascii=True, indent=2, sort_keys=True, allow_nan=False) + "\n"
        ).encode("utf-8")
        if precreated_empty:
            descriptor, temporary_name = tempfile.mkstemp(
                dir=parent, prefix=f".{path.name}.", text=False
            )
            temporary_path = Path(temporary_name)
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        if temporary_path is not None:
            os.replace(temporary_path, path)
            temporary_path = None
    except (OSError, TypeError, ValueError) as error:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except OSError:
                pass
        elif not precreated_empty:
            try:
                path.unlink()
            except OSError:
                pass
        raise RetentionError("retention plan cannot be written", reason="io") from error


def apply_plan(
    client: DockerClient,
    plan: Mapping[str, Any],
    *,
    state_path: Path,
    now: _datetime.datetime | None = None,
) -> dict[str, Any]:
    """Apply exactly one sealed candidate set after complete state revalidation."""

    validated_plan = validate_plan(plan)
    resolved_state_path = str(state_path.resolve())
    if validated_plan["statePath"] != resolved_state_path:
        raise RetentionError("retention plan state path does not match", reason="plan_mismatch")
    current_plan = plan_from_runtime(client, state_path=state_path, now=now)
    if current_plan["snapshotSha256"] != validated_plan["snapshotSha256"]:
        raise RetentionError(
            "Docker or retention state changed since plan creation", reason="snapshot_changed"
        )
    if current_plan["candidateIds"] != validated_plan["candidateIds"]:
        raise RetentionError("candidate set changed since plan creation", reason="snapshot_changed")

    deleted: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    records_by_id = {candidate["id"]: candidate for candidate in validated_plan["candidates"]}
    for image_id in validated_plan["candidateIds"]:
        try:
            client.remove_image(image_id)
        except RetentionError as error:
            # A concurrent container/tag/reference can safely refuse one image;
            # continue with the other prevalidated full IDs and report nonzero.
            unresolved.append({"id": image_id, "error": str(error), "reason": error.reason})
            continue
        deleted.append(
            {
                "id": image_id,
                "sizeBytes": records_by_id[image_id]["sizeBytes"],
                "repositories": records_by_id[image_id]["repositories"],
            }
        )

    result: dict[str, Any] = {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "kind": SUMMARY_KIND,
        "mode": "apply",
        "status": "ok" if not unresolved else "partial_failure",
        "dryRun": False,
        "planSha256": validated_plan["planSha256"],
        "candidateCount": validated_plan["candidateCount"],
        "estimatedBytes": validated_plan["estimatedBytes"],
        "candidateIds": validated_plan["candidateIds"],
        "runningContainerImageIds": validated_plan["runningContainerImageIds"],
        "deleted": deleted,
        "unresolved": unresolved,
        "deletedCount": len(deleted),
        "unresolvedCount": len(unresolved),
    }

    # A successful rm must actually remove the ID.  Also verify every retained
    # ID still exists.  This postcondition reads Docker only and cannot delete
    # anything; failure makes the result nonzero while preserving the partial
    # result in the JSON summary.
    try:
        state, _ = load_retention_state(state_path)
        after = collect_snapshot(client)
        still_present = sorted(
            image_id for image_id in (item["id"] for item in deleted) if image_id in after.image_ids
        )
        if still_present:
            unresolved.extend(
                {
                    "id": image_id,
                    "error": "image remains after successful removal",
                    "reason": "postcondition",
                }
                for image_id in still_present
            )
        missing_retained = sorted(state.retained_image_ids - after.image_ids)
        if missing_retained:
            unresolved.append(
                {
                    "id": ",".join(missing_retained),
                    "error": "retained image disappeared during apply",
                    "reason": "postcondition",
                }
            )
        try:
            ensure_current_ids_running(state, after)
        except RetentionError as error:
            unresolved.append({"id": None, "error": str(error), "reason": error.reason})
    except RetentionError as error:
        unresolved.append({"id": None, "error": str(error), "reason": error.reason})
    result["status"] = "ok" if not unresolved else "partial_failure"
    result["unresolved"] = unresolved
    result["unresolvedCount"] = len(unresolved)
    return result
