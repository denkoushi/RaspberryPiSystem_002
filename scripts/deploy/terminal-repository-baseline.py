#!/usr/bin/env python3
"""Prove a clean terminal checkout before sealing rollback state.

The only mutation this helper permits is a one-time compatibility repair for
the legacy Ansible task that deleted the complete tracked ``docs/`` tree after
each terminal deployment.  Every other dirty state is rejected unchanged.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MARKER_PREFIX = "TERMINAL_REPOSITORY_BASELINE_RESULT:"
MAX_GIT_OUTPUT = 8 * 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 30


class BaselineError(RuntimeError):
    """Raised when a terminal repository is not a safe release baseline."""


def _run_git(
    repository: Path,
    arguments: Sequence[str],
    *,
    allowed_exit_codes: tuple[int, ...] = (0,),
) -> tuple[int, bytes]:
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("GIT_")
    }
    environment.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_TERMINAL_PROMPT": "0",
            "LC_ALL": "C",
        }
    )
    try:
        completed = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={repository}",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.ignorestat=false",
                "-C",
                os.fspath(repository),
                *arguments,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BaselineError("repository Git command could not complete") from error
    if completed.returncode not in allowed_exit_codes:
        operation = arguments[0] if arguments else "operation"
        raise BaselineError(f"repository Git {operation} failed")
    if len(completed.stdout) > MAX_GIT_OUTPUT:
        raise BaselineError("repository Git output exceeded its safety limit")
    return completed.returncode, completed.stdout


def _repository_path(value: Path) -> Path:
    if not value.is_absolute() or ".." in value.parts:
        raise BaselineError("repository path must be absolute and normalized")
    try:
        repository_metadata = value.lstat()
        git_metadata = (value / ".git").lstat()
    except FileNotFoundError as error:
        raise BaselineError("repository layout is missing") from error
    if not stat.S_ISDIR(repository_metadata.st_mode):
        raise BaselineError("repository must be a real directory")
    if not stat.S_ISDIR(git_metadata.st_mode):
        raise BaselineError("repository .git must be a real directory")
    repository = Path(os.path.realpath(value))
    if repository != value:
        raise BaselineError("repository path must not contain symlink components")
    git_directory = Path(os.path.realpath(value / ".git"))
    if git_directory != repository / ".git":
        raise BaselineError("repository .git must not contain symlinks")
    _rc, top_level_raw = _run_git(repository, ["rev-parse", "--show-toplevel"])
    try:
        top_level = Path(top_level_raw.decode("utf-8", errors="strict").strip())
    except UnicodeDecodeError as error:
        raise BaselineError("repository top level is not UTF-8") from error
    if Path(os.path.realpath(top_level)) != repository:
        raise BaselineError("repository top level does not match its path")
    _rc, absolute_git_raw = _run_git(
        repository, ["rev-parse", "--absolute-git-dir"]
    )
    try:
        absolute_git = Path(
            absolute_git_raw.decode("utf-8", errors="strict").strip()
        )
    except UnicodeDecodeError as error:
        raise BaselineError("repository Git directory is not UTF-8") from error
    if Path(os.path.realpath(absolute_git)) != git_directory:
        raise BaselineError("repository Git directory does not match its .git directory")
    return repository


def _head(repository: Path) -> str:
    _rc, raw = _run_git(repository, ["rev-parse", "--verify", "HEAD^{commit}"])
    try:
        value = raw.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError as error:
        raise BaselineError("repository HEAD is malformed") from error
    if FULL_SHA_RE.fullmatch(value) is None:
        raise BaselineError("repository HEAD is malformed")
    return value


def _nul_paths(raw: bytes, label: str) -> list[bytes]:
    if not raw:
        return []
    if not raw.endswith(b"\0"):
        raise BaselineError(f"{label} output is not NUL terminated")
    values = raw[:-1].split(b"\0")
    if any(not value or b"\0" in value for value in values):
        raise BaselineError(f"{label} output contains an invalid path")
    return values


def _status_entries(repository: Path) -> list[tuple[bytes, bytes]]:
    _rc, raw = _run_git(
        repository,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    entries: list[tuple[bytes, bytes]] = []
    for record in _nul_paths(raw, "Git status"):
        if len(record) < 4 or record[2:3] != b" ":
            raise BaselineError("Git status entry is malformed")
        status = record[:2]
        # Rename/copy records consume a second path in porcelain v1 -z. They
        # are never compatible with the legacy docs-only deletion repair, so
        # reject before attempting to interpret another record as a status.
        if b"R" in status or b"C" in status:
            raise BaselineError("repository contains a rename or copy")
        entries.append((status, record[3:]))
    return entries


def _require_plain_index(repository: Path) -> None:
    _rc, raw = _run_git(repository, ["ls-files", "-v", "-z"])
    records = _nul_paths(raw, "Git index flags")
    if any(not record.startswith(b"H ") for record in records):
        raise BaselineError(
            "repository index contains assume-unchanged, skip-worktree, or non-stage-zero entries"
        )
    _rc, unmerged = _run_git(repository, ["ls-files", "-u", "-z"])
    if unmerged:
        raise BaselineError("repository index contains unmerged entries")


def _tracked_docs(repository: Path, head: str) -> list[bytes]:
    _rc, raw = _run_git(
        repository,
        ["ls-tree", "-r", "-z", "--name-only", head, "--", "docs"],
    )
    return _nul_paths(raw, "tracked docs")


def _require_exact_legacy_deletion(
    repository: Path, tracked_docs: list[bytes]
) -> None:
    entries = _status_entries(repository)
    deleted_docs = [path for status, path in entries if status == b" D"]
    if (
        not tracked_docs
        or len(deleted_docs) != len(entries)
        or len(set(deleted_docs)) != len(deleted_docs)
        or set(deleted_docs) != set(tracked_docs)
    ):
        raise BaselineError(
            "repository is dirty outside the complete legacy docs deletion"
        )


def prepare(repository_path: Path) -> dict[str, Any]:
    repository = _repository_path(repository_path)
    before_head = _head(repository)
    _require_plain_index(repository)
    entries = _status_entries(repository)
    if not entries:
        return {"head": before_head, "repairedLegacyDocs": False, "count": 0}

    tracked_docs = _tracked_docs(repository, before_head)
    _require_exact_legacy_deletion(repository, tracked_docs)

    # The exact status comparison above proves that the index is unchanged,
    # no untracked path exists, and every tracked docs path alone is absent.
    if _head(repository) != before_head:
        raise BaselineError("repository HEAD changed before legacy docs repair")
    _require_plain_index(repository)
    _require_exact_legacy_deletion(repository, tracked_docs)
    _run_git(
        repository,
        ["restore", f"--source={before_head}", "--worktree", "--", "docs"],
    )
    after_head = _head(repository)
    _require_plain_index(repository)
    if after_head != before_head or _status_entries(repository):
        raise BaselineError("legacy docs repair did not produce a clean unchanged HEAD")
    return {
        "head": after_head,
        "repairedLegacyDocs": True,
        "count": len(tracked_docs),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--ansible-marker", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = prepare(args.repository)
    except (BaselineError, OSError) as error:
        print(f"terminal repository baseline failed: {error}", file=sys.stderr)
        return 1
    encoded = json.dumps(result, ensure_ascii=True, sort_keys=True)
    if args.ansible_marker:
        marker = base64.urlsafe_b64encode(encoded.encode("utf-8")).decode("ascii")
        print(MARKER_PREFIX + marker)
    else:
        print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
