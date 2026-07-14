#!/usr/bin/env python3
"""Emit the stable git name-status stream used by the CI classifier."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Sequence


class DiffBaseError(RuntimeError):
    """Raised when an event cannot be mapped to a stable git diff base."""


def git_output(repo: Path, *args: str) -> bytes:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=repo,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", "replace").strip()
        raise DiffBaseError(detail or f"git {' '.join(args)} failed") from error


def stable_diff_base(repo: Path, event_name: str, base_sha: str, head_sha: str) -> str:
    for label, sha in (("base", base_sha), ("head", head_sha)):
        if not sha:
            raise DiffBaseError(f"{label} SHA is empty")
        git_output(repo, "cat-file", "-e", f"{sha}^{{commit}}")

    if event_name == "pull_request":
        merge_base = git_output(repo, "merge-base", base_sha, head_sha).decode().strip()
        if not merge_base:
            raise DiffBaseError("pull request merge base is unavailable")
        return merge_base
    if event_name == "push":
        return base_sha
    raise DiffBaseError(f"event {event_name!r} has no stable diff policy")


def collect_changed_files(
    repo: Path,
    event_name: str,
    base_sha: str,
    head_sha: str,
) -> bytes:
    diff_base = stable_diff_base(repo, event_name, base_sha, head_sha)
    return git_output(repo, "diff", "--name-status", "-z", diff_base, head_sha)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        output = collect_changed_files(
            args.repo,
            args.event_name,
            args.base_sha,
            args.head_sha,
        )
    except DiffBaseError as error:
        print(f"could not collect changed files: {error}", file=sys.stderr)
        return 2
    sys.stdout.buffer.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
