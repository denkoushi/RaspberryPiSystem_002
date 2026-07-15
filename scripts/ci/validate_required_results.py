#!/usr/bin/env python3
"""Validate the fixed ``ci-required`` aggregate contract."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class JobResult:
    name: str
    selected: str
    result: str


def validation_errors(
    classification_result: str, jobs: Sequence[JobResult]
) -> list[str]:
    errors: list[str] = []
    if classification_result != "success":
        errors.append(f"change-classification={classification_result}")
    for job in jobs:
        if job.selected not in {"true", "false"}:
            errors.append(f"{job.name}: invalid selection {job.selected!r}")
            continue
        expected = "success" if job.selected == "true" else "skipped"
        if job.result != expected:
            errors.append(
                f"{job.name}: selected={job.selected} result={job.result}; expected {expected}"
            )
    return errors


def parse_job(value: str) -> JobResult:
    try:
        name, state = value.split("=", 1)
        selected, result = state.split(":", 1)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "job result must use NAME=SELECTED:RESULT"
        ) from error
    if not name:
        raise argparse.ArgumentTypeError("job name must not be empty")
    return JobResult(name=name, selected=selected, result=result)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classification-result", required=True)
    parser.add_argument("jobs", nargs="+", type=parse_job)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    for job in args.jobs:
        print(f"{job.name} selected={job.selected} result={job.result}")
    errors = validation_errors(args.classification_result, args.jobs)
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
