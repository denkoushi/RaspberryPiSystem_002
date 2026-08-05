"""Closed, secret-free Ansible failure diagnostics for durable release status."""
from __future__ import annotations

import re
from typing import Any, Mapping


REGISTERED_GIT_OPERATIONS = frozenset(
    {
        "repository-git-dir",
        "repository-head",
        "repository-status",
        "repository-index-flags",
        "repository-unmerged-index",
        "bundle-verify",
        "bundle-list-heads",
        "bundle-fetch",
        "bundle-fetch-head",
        "repository-reset",
    }
)
MAX_DIAGNOSTIC_CHARS = 512
MAX_BINDING_CHARS = 256
_PREFIX = "local bundle Git operation failed (operation="
_PATTERN = re.compile(
    r"local bundle Git operation failed "
    r"\(operation=([a-z0-9-]+), rc=(unavailable|[0-9]{1,3}), stderr=(.*?)\)"
)
_SECRET_OR_URL = re.compile(
    r"(?i)(?:https?|ssh|git|file)://|\b(?:authorization|bearer|token|password|passwd)\b"
)


def valid_binding_text(value: Any, *, allow_empty: bool = False) -> bool:
    return (
        isinstance(value, str)
        and (allow_empty or bool(value))
        and len(value) <= MAX_BINDING_CHARS
        and "\x00" not in value
        and all(character.isprintable() for character in value)
    )


def _generic() -> dict[str, Any]:
    return {"kind": "generic", "code": "malformed-safe-diagnostic"}


def parse_failed_result(payload: Any) -> dict[str, Any] | None:
    """Extract only the helper's registered, already-sanitized diagnostic."""

    if not isinstance(payload, Mapping):
        return None
    candidates = {
        value
        for key in ("stderr", "msg")
        if isinstance((value := payload.get(key)), str) and _PREFIX in value
    }
    if not candidates:
        return None
    matches = {
        match.groups()
        for value in candidates
        for match in _PATTERN.finditer(value)
    }
    if len(matches) != 1:
        return _generic()
    operation, raw_rc, stderr = next(iter(matches))
    stderr = " ".join(stderr.split())
    if (
        operation not in REGISTERED_GIT_OPERATIONS
        or not stderr
        or len(stderr) > MAX_DIAGNOSTIC_CHARS
        or not all(character.isprintable() for character in stderr)
        or _SECRET_OR_URL.search(stderr) is not None
    ):
        return _generic()
    if raw_rc == "unavailable":
        rc: int | None = None
    else:
        rc = int(raw_rc)
        if not 1 <= rc <= 255:
            return _generic()
    return {
        "kind": "registered-operation",
        "operation": operation,
        "rc": rc,
        "stderr": stderr,
    }


def valid_diagnostic(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    if value.get("kind") == "generic":
        return set(value) == {"kind", "code"} and value.get("code") == (
            "malformed-safe-diagnostic"
        )
    if value.get("kind") != "registered-operation" or set(value) != {
        "kind",
        "operation",
        "rc",
        "stderr",
    }:
        return False
    rc = value.get("rc")
    stderr = value.get("stderr")
    return (
        value.get("operation") in REGISTERED_GIT_OPERATIONS
        and (rc is None or (type(rc) is int and 1 <= rc <= 255))
        and isinstance(stderr, str)
        and bool(stderr)
        and len(stderr) <= MAX_DIAGNOSTIC_CHARS
        and all(character.isprintable() for character in stderr)
        and _SECRET_OR_URL.search(stderr) is None
    )


def project_event(event: Mapping[str, Any], run_id: str) -> dict[str, Any]:
    diagnostic = event.get("diagnostic")
    if event.get("runId") != run_id or not valid_diagnostic(diagnostic):
        raise ValueError("diagnostic event binding is malformed")
    for field in ("scope", "host", "play", "task"):
        if not valid_binding_text(event.get(field), allow_empty=field == "play"):
            raise ValueError("diagnostic event binding is malformed")
    return {
        "runId": run_id,
        "scope": event["scope"],
        "host": event["host"],
        "play": event["play"],
        "task": event["task"],
        **dict(diagnostic),
    }


def valid_projected_diagnostic(value: Any, run_id: str) -> bool:
    if not isinstance(value, Mapping) or value.get("runId") != run_id:
        return False
    binding_fields = {"runId", "scope", "host", "play", "task"}
    diagnostic = {key: item for key, item in value.items() if key not in binding_fields}
    if set(value) != binding_fields | set(diagnostic):
        return False
    return all(
        valid_binding_text(value.get(field), allow_empty=field == "play")
        for field in ("scope", "host", "play", "task")
    ) and valid_diagnostic(diagnostic)
