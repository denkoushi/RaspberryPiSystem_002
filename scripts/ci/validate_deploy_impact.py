#!/usr/bin/env python3
"""Validate the PR Deploy impact declaration against enforced CI JSON."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from deploy_impact_contract import (  # noqa: E402
    ImpactContractError,
    assess,
    parse_table,
    render_summary,
)


def _load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read JSON input {path}: {error}") from error


def _validate_classification(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("classification JSON must be an object")
    if value.get("schemaVersion") != 6:
        raise ValueError("classification JSON must use schemaVersion 6")
    changes = value.get("changes")
    if not isinstance(changes, list):
        raise ValueError("classification JSON changes must be an array")
    for index, change in enumerate(changes):
        if not isinstance(change, dict):
            raise ValueError(f"classification changes[{index}] must be an object")
        if not isinstance(change.get("status"), str) or not isinstance(
            change.get("path"), str
        ):
            raise ValueError(f"classification changes[{index}] lacks status/path")
    return value


def _append_summary(path: Path, summary: str) -> None:
    try:
        with path.open("a", encoding="utf-8") as stream:
            stream.write(summary)
    except OSError as error:
        raise ValueError(f"cannot append summary {path}: {error}") from error


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-path", type=Path, required=True)
    parser.add_argument("--classification-json", type=Path, required=True)
    parser.add_argument("--markdown-file", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        event = _load_json(args.event_path)
        if not isinstance(event, dict):
            raise ValueError("GitHub event JSON must be an object")
        if event.get("pull_request") is None:
            print("[deploy-impact] non-pull-request event: declaration not evaluated")
            return 0
        pull_request = event["pull_request"]
        if not isinstance(pull_request, dict):
            raise ValueError("pull_request event payload must be an object")
        body = pull_request.get("body") or ""
        classification = _validate_classification(
            _load_json(args.classification_json)
        )
        declaration = parse_table(body)
        assessment = assess(declaration, classification)
        summary = render_summary(assessment)
        if args.markdown_file:
            _append_summary(args.markdown_file, summary)
        print(summary, end="")
        return 0
    except ImpactContractError as error:
        print(f"[deploy-impact] contract mismatch: {error}", file=sys.stderr)
        return 1
    except ValueError as error:
        print(f"[deploy-impact] invalid input: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
