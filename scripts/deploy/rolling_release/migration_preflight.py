#!/usr/bin/env python3
"""Standalone read-only production-ledger preflight executed before release submission.

The local operator sends this exact standard-library-only source to Pi5.  It
fetches the immutable candidate object without checking it out, holds the fleet
lock, and runs the already-installed production migration planner.  No release
unit, checkout, migration, image build, or service transition can start first.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


EX_OK = 0
EX_SOFTWARE = 70
EX_TEMPFAIL = 75
EX_CONFIG = 78
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
FORBIDDEN_REF_CHARACTERS = frozenset(" ~^:?*[\\")
ALLOWED_UNTRACKED = frozenset({"?? power-actions/"})
EXPECTED_KEYS = frozenset(
    {"version", "project", "runId", "branch", "sha", "expectedServerClientId"}
)


class MigrationPreflightConfigError(ValueError):
    """The local operator supplied a malformed remote preflight contract."""


def _valid_branch(branch: str) -> bool:
    if not branch or branch.startswith(("-", "/", ".")) or branch.endswith(("/", ".")):
        return False
    if branch == "@" or ".." in branch or "//" in branch or "@{" in branch:
        return False
    if any(component.endswith(".lock") or component.startswith(".") for component in branch.split("/")):
        return False
    if any(ord(character) < 32 or ord(character) == 127 for character in branch):
        return False
    return not any(character in FORBIDDEN_REF_CHARACTERS for character in branch)


def parse_spec(raw: str) -> dict[str, str | int]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise MigrationPreflightConfigError("migration preflight is not valid JSON") from error
    if not isinstance(payload, dict) or set(payload) != EXPECTED_KEYS:
        raise MigrationPreflightConfigError("migration preflight fields do not match version 1")
    if type(payload.get("version")) is not int or payload.get("version") != 1:
        raise MigrationPreflightConfigError("unsupported migration preflight version")

    for key, maximum in (
        ("project", 4096),
        ("runId", 80),
        ("branch", 255),
        ("sha", 40),
        ("expectedServerClientId", 128),
    ):
        value = payload.get(key)
        if not isinstance(value, str) or not value or len(value) > maximum or "\x00" in value:
            raise MigrationPreflightConfigError(f"{key} is malformed")

    project = str(payload["project"])
    if not os.path.isabs(project) or os.path.normpath(project) != project:
        raise MigrationPreflightConfigError("project must be a normalized absolute path")
    if RUN_ID_RE.fullmatch(str(payload["runId"])) is None:
        raise MigrationPreflightConfigError("runId is malformed")
    if not _valid_branch(str(payload["branch"])):
        raise MigrationPreflightConfigError("branch is not a valid Git ref")
    if FULL_SHA_RE.fullmatch(str(payload["sha"])) is None:
        raise MigrationPreflightConfigError("sha must be a full lowercase Git SHA")
    if re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", str(payload["expectedServerClientId"])
    ) is None:
        raise MigrationPreflightConfigError("expectedServerClientId is malformed")
    return payload


def _read_server_client_id(path: str = "/etc/raspi-status-agent.conf") -> str:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError("status-agent config is not a regular file")
        payload = os.read(descriptor, 65537)
    finally:
        os.close(descriptor)
    if len(payload) > 65536:
        raise OSError("status-agent config is too large")
    pattern = re.compile(
        r'''^[ \t]*CLIENT_ID[ \t]*=[ \t]*(?:"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"|'([A-Za-z0-9][A-Za-z0-9._:-]{0,127})'|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))[ \t]*(?:#.*)?$'''
    )
    values = [
        next(value for value in match.groups() if value is not None)
        for line in payload.decode("utf-8").splitlines()
        if (match := pattern.fullmatch(line)) is not None
    ]
    if len(values) != 1:
        raise OSError("status-agent CLIENT_ID is missing or duplicated")
    return values[0]


def _default_run(
    argv: Sequence[str], *, cwd: str, capture_output: bool = False
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(argv), cwd=cwd, text=True, capture_output=capture_output, check=False
    )


def execute(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
    server_client_id_reader: Callable[[], str] | None = None,
) -> int:
    project = str(spec["project"])
    lock_path = os.path.join(project, "logs", "deploy", "fleet-release-state.lock")
    planner = os.path.join(project, "scripts", "deploy", "pi5-migration-plan.sh")
    lock_descriptor: int | None = None
    temporary_directory: str | None = None
    try:
        os.makedirs(os.path.dirname(lock_path), mode=0o700, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            lock_descriptor = os.open(lock_path, flags, 0o600)
            if not stat.S_ISREG(os.fstat(lock_descriptor).st_mode):
                raise OSError("fleet lock is not a regular file")
            os.fchmod(lock_descriptor, 0o600)
            fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError) as error:
            print(f"[ERROR] migration preflight could not acquire the fleet lock: {error}", file=sys.stderr)
            return EX_TEMPFAIL

        try:
            client_id = (server_client_id_reader or _read_server_client_id)()
        except (OSError, UnicodeError) as error:
            print(f"[ERROR] migration preflight could not verify Pi5 identity: {error}", file=sys.stderr)
            return EX_CONFIG
        if client_id != spec["expectedServerClientId"]:
            print("[ERROR] migration preflight Pi5 identity mismatch", file=sys.stderr)
            return EX_CONFIG

        status = run_command(
            ["/usr/bin/git", "status", "--porcelain=v1", "--untracked-files=normal"],
            cwd=project,
            capture_output=True,
        )
        if getattr(status, "returncode", 1) != 0:
            print("[ERROR] migration preflight could not inspect the Pi5 checkout", file=sys.stderr)
            return EX_SOFTWARE
        dirty = [
            line
            for line in str(getattr(status, "stdout", "")).splitlines()
            if line and line not in ALLOWED_UNTRACKED
        ]
        if dirty:
            print("[ERROR] migration preflight refuses a dirty Pi5 checkout", file=sys.stderr)
            return EX_CONFIG

        fetch = run_command(
            ["/usr/bin/git", "fetch", "--no-tags", "origin", str(spec["branch"])],
            cwd=project,
            capture_output=True,
        )
        if getattr(fetch, "returncode", 1) != 0:
            print("[ERROR] migration preflight could not fetch the candidate", file=sys.stderr)
            return EX_SOFTWARE
        commit = run_command(
            ["/usr/bin/git", "cat-file", "-e", f'{spec["sha"]}^{{commit}}'],
            cwd=project,
            capture_output=True,
        )
        if getattr(commit, "returncode", 1) != 0:
            print("[ERROR] migration preflight candidate object is unavailable", file=sys.stderr)
            return EX_CONFIG

        temporary_directory = tempfile.mkdtemp(prefix="raspi-migration-preflight-")
        os.chmod(temporary_directory, 0o700)
        evidence = os.path.join(temporary_directory, "migration-plan.json")
        planned = run_command(
            [
                planner,
                "--ref",
                str(spec["sha"]),
                "--run-id",
                str(spec["runId"]),
                "--output",
                evidence,
            ],
            cwd=project,
            capture_output=True,
        )
        if getattr(planned, "returncode", 1) != 0:
            detail = str(getattr(planned, "stderr", "") or "").strip()
            print(
                "[ERROR] production-ledger migration preflight rejected the candidate"
                + (f": {detail}" if detail else ""),
                file=sys.stderr,
            )
            return EX_CONFIG
        if not os.path.isfile(evidence) or os.path.islink(evidence):
            print("[ERROR] migration preflight produced no sealed evidence", file=sys.stderr)
            return EX_SOFTWARE
        print(f'migration preflight passed for immutable candidate {spec["sha"]}')
        return EX_OK
    finally:
        if temporary_directory is not None:
            evidence = os.path.join(temporary_directory, "migration-plan.json")
            try:
                os.unlink(evidence)
            except FileNotFoundError:
                pass
            try:
                os.rmdir(temporary_directory)
            except FileNotFoundError:
                pass
        if lock_descriptor is not None:
            os.close(lock_descriptor)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print("[ERROR] migration preflight requires exactly one JSON specification", file=sys.stderr)
        return EX_CONFIG
    try:
        spec = parse_spec(arguments[0])
    except MigrationPreflightConfigError as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        return EX_CONFIG
    return execute(spec)


if __name__ == "__main__":
    raise SystemExit(main())
