#!/usr/bin/env python3
"""Collect and classify GitHub event changes with fail-closed fallbacks."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from classify_changes import (
    classify_changes,
    parse_name_status_z,
    render_github_output,
    render_markdown,
)
from collect_changed_files import DiffBaseError, collect_changed_files


CHANGE_AWARE_EVENTS = frozenset({"pull_request", "push"})


def classify_event(
    repo: Path,
    event_name: str,
    base_sha: str,
    head_sha: str,
) -> dict[str, object]:
    if event_name not in CHANGE_AWARE_EVENTS:
        return classify_changes(
            [], force_full_reason=f"{event_name} always runs the full suite"
        )
    if not base_sha or set(base_sha) == {"0"}:
        return classify_changes(
            [], force_full_reason="event has no stable diff base"
        )
    try:
        changes = parse_name_status_z(
            collect_changed_files(repo, event_name, base_sha, head_sha)
        )
    except (DiffBaseError, ValueError) as error:
        return classify_changes(
            [], force_full_reason=f"stable diff base is unavailable: {error}"
        )
    return classify_changes(changes)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--base-sha", default="")
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument(
        "--format",
        choices=("json", "markdown", "github-output", "none"),
        default="json",
    )
    parser.add_argument("--github-output-file", type=Path)
    parser.add_argument("--markdown-file", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    result = classify_event(
        args.repo,
        args.event_name,
        args.base_sha,
        args.head_sha,
    )
    if args.github_output_file:
        with args.github_output_file.open("a", encoding="utf-8") as output:
            output.write(render_github_output(result))
    if args.markdown_file:
        with args.markdown_file.open("a", encoding="utf-8") as output:
            output.write(render_markdown(result))
    if args.format == "markdown":
        sys.stdout.write(render_markdown(result))
    elif args.format == "github-output":
        sys.stdout.write(render_github_output(result))
    elif args.format == "json":
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
