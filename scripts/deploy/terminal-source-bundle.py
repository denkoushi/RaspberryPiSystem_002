#!/usr/bin/env python3
"""Validate, promote, consume, or clean one Pi3 staged Git bundle.

The helper never resolves a branch or contacts a Git remote.  Its production
paths are derived from the coordinator run ID, and every Git operation uses a
local bundle path with the network protocols disabled.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
MARKER_PREFIX = "TERMINAL_SOURCE_BUNDLE_RESULT:"
MAX_BUNDLE_BYTES = 64 * 1024 * 1024
FREE_SPACE_MARGIN_BYTES = 64 * 1024 * 1024
HASH_CHUNK_BYTES = 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 180


class SourceBundleError(RuntimeError):
    """Raised when staged source is not safe to use."""


def source_paths(root: Path, run_id: str) -> tuple[Path, Path]:
    if RUN_ID_RE.fullmatch(run_id) is None:
        raise SourceBundleError("run ID is malformed")
    prefix = f"raspi-pi3-source-{run_id}.bundle"
    return root / f"{prefix}.tmp", root / prefix


def _validate_binding(
    args: argparse.Namespace, *, require_repository: bool = True
) -> tuple[Path, Path, Path]:
    if HOST_RE.fullmatch(args.host) is None:
        raise SourceBundleError("host is malformed")
    if FULL_SHA_RE.fullmatch(args.previous_sha) is None:
        raise SourceBundleError("previous SHA is malformed")
    if FULL_SHA_RE.fullmatch(args.candidate_sha) is None:
        raise SourceBundleError("candidate SHA is malformed")
    if SHA256_RE.fullmatch(args.sha256) is None:
        raise SourceBundleError("bundle SHA-256 is malformed")
    if not 1 <= args.size <= MAX_BUNDLE_BYTES:
        raise SourceBundleError("bundle size exceeds its fixed safety bound")
    root = args.staging_root
    if not root.is_absolute() or ".." in root.parts:
        raise SourceBundleError("staging root must be absolute and normalized")
    try:
        metadata = root.lstat()
    except FileNotFoundError as error:
        raise SourceBundleError("staging root is missing") from error
    if not stat.S_ISDIR(metadata.st_mode) or Path(os.path.realpath(root)) != root:
        raise SourceBundleError("staging root must be a real directory")
    repository = (
        _repository_path(args.repository) if require_repository else args.repository
    )
    temporary, final = source_paths(root, args.run_id)
    return repository, temporary, final


def _git_environment() -> dict[str, str]:
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
    return environment


def _run_git(
    repository: Path,
    arguments: Sequence[str],
    *,
    capture_stderr: bool = False,
) -> bytes:
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
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "maintenance.auto=false",
                "-c",
                "protocol.allow=never",
                "-c",
                "protocol.file.allow=always",
                "-C",
                os.fspath(repository),
                *arguments,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE if capture_stderr else subprocess.DEVNULL,
            env=_git_environment(),
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SourceBundleError("local bundle Git command could not complete") from error
    if completed.returncode != 0:
        raise SourceBundleError("local bundle Git validation failed")
    if len(completed.stdout) > MAX_BUNDLE_BYTES:
        raise SourceBundleError("local bundle Git output exceeded its safety bound")
    if capture_stderr and len(completed.stderr) > MAX_BUNDLE_BYTES:
        raise SourceBundleError("local bundle Git error output exceeded its safety bound")
    return completed.stdout


def _repository_path(value: Path) -> Path:
    if not value.is_absolute() or ".." in value.parts:
        raise SourceBundleError("repository path must be absolute and normalized")
    try:
        repository_metadata = value.lstat()
        git_metadata = (value / ".git").lstat()
    except FileNotFoundError as error:
        raise SourceBundleError("repository layout is missing") from error
    if not stat.S_ISDIR(repository_metadata.st_mode) or not stat.S_ISDIR(
        git_metadata.st_mode
    ):
        raise SourceBundleError("repository layout is invalid")
    repository = Path(os.path.realpath(value))
    if repository != value:
        raise SourceBundleError("repository path must not contain symlinks")
    absolute_git = _run_git(repository, ["rev-parse", "--absolute-git-dir"])
    if Path(os.path.realpath(absolute_git.decode("utf-8").strip())) != repository / ".git":
        raise SourceBundleError("repository Git directory is unexpected")
    return repository


def _head(repository: Path) -> str:
    raw = _run_git(repository, ["rev-parse", "--verify", "HEAD^{commit}"])
    try:
        value = raw.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError as error:
        raise SourceBundleError("repository HEAD is malformed") from error
    if FULL_SHA_RE.fullmatch(value) is None:
        raise SourceBundleError("repository HEAD is malformed")
    return value


def _require_clean(repository: Path, expected_head: str) -> None:
    if _head(repository) != expected_head:
        raise SourceBundleError("repository HEAD does not match the sealed previous SHA")
    status = _run_git(
        repository, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]
    )
    if status:
        raise SourceBundleError("repository is not clean")
    flags = _run_git(repository, ["ls-files", "-v", "-z"])
    records = [record for record in flags.split(b"\0") if record]
    if any(not record.startswith(b"H ") for record in records):
        raise SourceBundleError("repository index has unsafe flags")
    if _run_git(repository, ["ls-files", "-u", "-z"]):
        raise SourceBundleError("repository index has unmerged entries")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(HASH_CHUNK_BYTES):
                digest.update(chunk)
    except OSError as error:
        raise SourceBundleError("bundle bytes could not be read") from error
    return digest.hexdigest()


def _require_bundle_file(path: Path, *, size: int, sha256: str) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise SourceBundleError("staged bundle is missing") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise SourceBundleError("staged bundle must be a regular file")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise SourceBundleError("staged bundle mode must be 0600")
    if metadata.st_uid != os.geteuid():
        raise SourceBundleError("staged bundle ownership is unexpected")
    if metadata.st_size != size or metadata.st_size > MAX_BUNDLE_BYTES:
        raise SourceBundleError("staged bundle size is unexpected")
    if _sha256(path) != sha256:
        raise SourceBundleError("staged bundle digest is unexpected")


def _require_bundle_contract(
    repository: Path,
    bundle: Path,
    *,
    previous_sha: str,
    candidate_sha: str,
    size: int,
    sha256: str,
) -> None:
    _require_clean(repository, previous_sha)
    _require_bundle_file(bundle, size=size, sha256=sha256)
    _run_git(repository, ["bundle", "verify", os.fspath(bundle)], capture_stderr=True)
    heads = _run_git(repository, ["bundle", "list-heads", os.fspath(bundle)])
    try:
        head_lines = heads.decode("ascii", errors="strict").splitlines()
    except UnicodeDecodeError as error:
        raise SourceBundleError("bundle head is malformed") from error
    if head_lines != [f"{candidate_sha} HEAD"]:
        raise SourceBundleError("bundle does not contain the exact candidate HEAD")


def _result(args: argparse.Namespace, state: str, **values: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "state": state,
        "runId": args.run_id,
        "host": args.host,
        "previousSha": args.previous_sha,
        "candidateSha": args.candidate_sha,
        "sha256": args.sha256,
        "size": args.size,
        **values,
    }


def preflight(args: argparse.Namespace) -> dict[str, Any]:
    repository, temporary, final = _validate_binding(args)
    _require_clean(repository, args.previous_sha)
    required_free = FREE_SPACE_MARGIN_BYTES + (args.size * 2)
    if shutil.disk_usage(args.staging_root).free < required_free:
        raise SourceBundleError("staging filesystem has insufficient free space")
    existing = [path for path in (temporary, final) if path.exists() or path.is_symlink()]
    if len(existing) > 1:
        raise SourceBundleError("staging has ambiguous temporary and final residue")
    if existing:
        _require_bundle_contract(
            repository,
            existing[0],
            previous_sha=args.previous_sha,
            candidate_sha=args.candidate_sha,
            size=args.size,
            sha256=args.sha256,
        )
    state = "empty"
    if existing == [temporary]:
        state = "temporary-ready"
    elif existing == [final]:
        state = "ready"
    return _result(
        args,
        state,
        temporaryPath=os.fspath(temporary),
        finalPath=os.fspath(final),
        requiredFreeBytes=required_free,
    )


def promote(args: argparse.Namespace) -> dict[str, Any]:
    repository, temporary, final = _validate_binding(args)
    if final.exists() and not temporary.exists():
        _require_bundle_contract(
            repository,
            final,
            previous_sha=args.previous_sha,
            candidate_sha=args.candidate_sha,
            size=args.size,
            sha256=args.sha256,
        )
        return _result(args, "ready", finalPath=os.fspath(final), alreadyReady=True)
    if final.exists() or final.is_symlink():
        raise SourceBundleError("final bundle path is occupied")
    _require_bundle_contract(
        repository,
        temporary,
        previous_sha=args.previous_sha,
        candidate_sha=args.candidate_sha,
        size=args.size,
        sha256=args.sha256,
    )
    os.replace(temporary, final)
    directory_fd = os.open(args.staging_root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    _require_bundle_contract(
        repository,
        final,
        previous_sha=args.previous_sha,
        candidate_sha=args.candidate_sha,
        size=args.size,
        sha256=args.sha256,
    )
    return _result(args, "ready", finalPath=os.fspath(final), alreadyReady=False)


def verify(args: argparse.Namespace) -> dict[str, Any]:
    repository, _temporary, final = _validate_binding(args)
    _require_bundle_contract(
        repository,
        final,
        previous_sha=args.previous_sha,
        candidate_sha=args.candidate_sha,
        size=args.size,
        sha256=args.sha256,
    )
    return _result(args, "ready", finalPath=os.fspath(final))


def consume(args: argparse.Namespace) -> dict[str, Any]:
    repository, _temporary, final = _validate_binding(args)
    _require_bundle_contract(
        repository,
        final,
        previous_sha=args.previous_sha,
        candidate_sha=args.candidate_sha,
        size=args.size,
        sha256=args.sha256,
    )
    _run_git(repository, ["fetch", "--no-tags", os.fspath(final), "HEAD"])
    fetched = _run_git(
        repository, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]
    ).decode("ascii", errors="strict").strip()
    if fetched != args.candidate_sha:
        raise SourceBundleError("imported bundle did not resolve the candidate SHA")
    _require_clean(repository, args.previous_sha)
    _run_git(repository, ["reset", "--hard", args.candidate_sha])
    _require_clean(repository, args.candidate_sha)
    final.unlink()
    return _result(args, "consumed", finalPath=os.fspath(final), residue=False)


def cleanup(args: argparse.Namespace) -> dict[str, Any]:
    _repository, temporary, final = _validate_binding(
        args, require_repository=False
    )
    removed = 0
    for path in (temporary, final):
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISDIR(metadata.st_mode):
            raise SourceBundleError("staging cleanup refuses a directory")
        path.unlink()
        removed += 1
    if any(path.exists() or path.is_symlink() for path in (temporary, final)):
        raise SourceBundleError("staging cleanup left residue")
    return _result(args, "clean", removed=removed, residue=False)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "promote", "verify", "consume", "cleanup"))
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--staging-root", type=Path, default=Path("/var/tmp"))
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--previous-sha", required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--size", type=int, required=True)
    parser.add_argument("--ansible-marker", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    actions = {
        "preflight": preflight,
        "promote": promote,
        "verify": verify,
        "consume": consume,
        "cleanup": cleanup,
    }
    try:
        result = actions[args.action](args)
    except (SourceBundleError, OSError, UnicodeError) as error:
        print(f"terminal source bundle failed: {error}", file=sys.stderr)
        return 1
    encoded = json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    if args.ansible_marker:
        marker = base64.urlsafe_b64encode(encoded.encode("utf-8")).decode("ascii")
        print(MARKER_PREFIX + marker)
    else:
        print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
