#!/usr/bin/env python3
"""Wait for fixed external checks on one exact main commit."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Mapping, Sequence


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REPOSITORY_RE = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})/"
    r"[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,199})$"
)
CHECK_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_. -]{0,99}$")


class ReleaseCheckError(RuntimeError):
    pass


def evaluate_check_runs(
    payload: Mapping[str, Any],
    required: Sequence[str],
    expected_sha: str,
) -> tuple[str, dict[str, str]]:
    runs = payload.get("check_runs")
    if not isinstance(runs, list):
        raise ReleaseCheckError("GitHub check-run response is malformed")
    observed: dict[str, str] = {}
    for name in required:
        matches = [
            run
            for run in runs
            if isinstance(run, dict)
            and run.get("name") == name
            and run.get("head_sha") == expected_sha
        ]
        if not matches:
            observed[name] = "missing"
            continue
        run = matches[0]
        status = run.get("status")
        conclusion = run.get("conclusion")
        if status != "completed":
            observed[name] = str(status or "pending")
        elif conclusion == "success":
            observed[name] = "success"
        else:
            observed[name] = str(conclusion or "failure")
    if any(value not in {"success", "missing", "queued", "in_progress", "pending"} for value in observed.values()):
        return "failed", observed
    if all(value == "success" for value in observed.values()):
        return "success", observed
    return "pending", observed


def _fetch_json(url: str, token: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "raspi-release-check-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def wait_for_checks(
    *,
    repository: str,
    sha: str,
    required: Sequence[str],
    token: str,
    timeout_seconds: int,
    interval_seconds: int,
    fetcher: Callable[[str, str], dict[str, Any]] = _fetch_json,
) -> dict[str, str]:
    deadline = time.monotonic() + timeout_seconds
    url = (
        f"https://api.github.com/repos/{repository}/commits/{sha}/check-runs"
        "?per_page=100&filter=latest"
    )
    last: dict[str, str] = {}
    while True:
        try:
            state, last = evaluate_check_runs(fetcher(url, token), required, sha)
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
            if time.monotonic() >= deadline:
                raise ReleaseCheckError(
                    "GitHub checks were unavailable until the bounded deadline"
                ) from error
            state = "pending"
        if state == "success":
            return last
        if state == "failed":
            raise ReleaseCheckError(
                "required release check failed: "
                + ", ".join(f"{name}={value}" for name, value in last.items())
            )
        if time.monotonic() >= deadline:
            raise ReleaseCheckError(
                "required release checks did not finish before the deadline: "
                + ", ".join(f"{name}={value}" for name, value in last.items())
            )
        time.sleep(interval_seconds)


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--required", action="append", required=True)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--interval", type=int, default=10)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    token = os.environ.get("GITHUB_TOKEN", "")
    if (
        REPOSITORY_RE.fullmatch(args.repository) is None
        or FULL_SHA_RE.fullmatch(args.sha) is None
        or not token
        or not 30 <= args.timeout <= 3600
        or not 1 <= args.interval <= 60
        or len(args.required) != len(set(args.required))
        or any(CHECK_NAME_RE.fullmatch(name) is None for name in args.required)
    ):
        raise ReleaseCheckError("release-check gate arguments are malformed")
    observed = wait_for_checks(
        repository=args.repository,
        sha=args.sha,
        required=tuple(args.required),
        token=token,
        timeout_seconds=args.timeout,
        interval_seconds=args.interval,
    )
    print(json.dumps(observed, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReleaseCheckError as error:
        print(f"release check gate failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
