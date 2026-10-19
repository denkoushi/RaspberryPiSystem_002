#!/usr/bin/env python3
"""Surface Playwright tests that only passed after a CI retry.

Playwright retries failed tests in CI and reports a test that passes on retry
as ``flaky`` while the run still succeeds. Without this report such tests are
invisible in the job result. Each flaky test becomes a workflow warning and a
row in the step summary.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Sequence


@dataclass(frozen=True)
class FlakyTest:
    file: str
    line: int
    title: str


def _walk_specs(suite: dict[str, Any], parents: tuple[str, ...]) -> Iterator[FlakyTest]:
    title = suite.get("title") or ""
    # The root suite of each file is titled with the file path; skip it in names.
    path = parents if not title or title == suite.get("file") else (*parents, title)
    for spec in suite.get("specs", []):
        if any(test.get("status") == "flaky" for test in spec.get("tests", [])):
            yield FlakyTest(
                file=str(spec.get("file") or suite.get("file") or ""),
                line=int(spec.get("line") or 0),
                title=" > ".join((*path, str(spec.get("title") or ""))),
            )
    for child in suite.get("suites", []):
        yield from _walk_specs(child, path)


def flaky_tests(report: dict[str, Any]) -> list[FlakyTest]:
    found: list[FlakyTest] = []
    for suite in report.get("suites", []):
        found.extend(_walk_specs(suite, ()))
    return found


def summary_markdown(label: str, tests: Sequence[FlakyTest]) -> str:
    if not tests:
        return f"### {label}: no flaky tests\n"
    lines = [
        f"### {label}: {len(tests)} flaky test(s) passed only after retry",
        "",
        "| Test | Location |",
        "| --- | --- |",
    ]
    for test in tests:
        lines.append(f"| {test.title} | `{test.file}:{test.line}` |")
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--label", default="Playwright")
    parser.add_argument("--summary-file", type=Path)
    args = parser.parse_args(argv)

    if not args.report.exists():
        print(f"No Playwright JSON report at {args.report}; nothing to check.")
        return 0
    tests = flaky_tests(json.loads(args.report.read_text(encoding="utf-8")))
    for test in tests:
        # Paths in the report are relative to the Playwright testDir (e2e/).
        print(
            f"::warning file=e2e/{test.file},line={test.line},"
            f"title=Flaky Playwright test::{test.title} passed only after retry"
        )
    if args.summary_file:
        with args.summary_file.open("a", encoding="utf-8") as handle:
            handle.write(summary_markdown(args.label, tests))
    print(f"{args.label}: {len(tests)} flaky test(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
