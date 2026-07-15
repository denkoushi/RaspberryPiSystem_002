#!/usr/bin/env python3
"""Classify a git name-status stream for staged CI execution.

The classifier is intentionally independent from git and GitHub Actions. It
accepts the NUL-delimited output of ``git diff --name-status -z`` on stdin and
prints JSON, a Markdown summary, or GitHub Actions outputs. Unknown inputs and
changes that can hide removed build dependencies select the full suite.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Iterable, Sequence


CATEGORIES = (
    "repo_policy",
    "workspace_quality",
    "api",
    "web",
    "db_infra",
    "deploy_contract",
    "client",
    "e2e",
    "docker_security",
)
FULL_SUITE = frozenset(CATEGORIES)

GLOBAL_PATHS = frozenset(
    {
        ".dockerignore",
        ".gitleaks.toml",
        ".trivyignore",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
        "turbo.json",
    }
)


@dataclass(frozen=True)
class Change:
    status: str
    path: str
    previous_path: str | None = None


@dataclass(frozen=True)
class ClassifiedChange:
    change: Change
    categories: frozenset[str]
    fail_closed_reason: str | None = None


def _has_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}/")


def categories_for_path(path: str) -> frozenset[str] | None:
    """Return categories for a known path, or ``None`` for an unknown path."""
    normalized = PurePosixPath(path).as_posix().removeprefix("./")

    if normalized.startswith(".github/workflows/") or normalized.startswith(
        ".github/actions/"
    ):
        return FULL_SUITE
    if _has_prefix(normalized, "scripts/ci"):
        return FULL_SUITE
    if normalized in GLOBAL_PATHS:
        return FULL_SUITE

    if _has_prefix(normalized, "docs") or (
        "/" not in normalized and normalized.lower().endswith(".md")
    ):
        return frozenset({"repo_policy"})

    if _has_prefix(normalized, "apps/api/prisma"):
        return frozenset({"repo_policy", "workspace_quality", "api", "db_infra"})
    if _has_prefix(normalized, "apps/api"):
        return frozenset({"repo_policy", "workspace_quality", "api"})
    if _has_prefix(normalized, "apps/web"):
        return frozenset({"repo_policy", "workspace_quality", "web"})
    if _has_prefix(normalized, "packages"):
        return frozenset({"repo_policy", "workspace_quality", "api", "web"})

    if _has_prefix(normalized, "clients") or _has_prefix(normalized, "scripts/client"):
        return frozenset({"repo_policy", "client"})
    if _has_prefix(normalized, "scripts/kiosk"):
        return frozenset({"repo_policy", "client"})

    if _has_prefix(normalized, "infrastructure/ansible"):
        return frozenset({"repo_policy", "db_infra", "deploy_contract"})
    if _has_prefix(normalized, "scripts/deploy") or normalized == "scripts/update-all-clients.sh":
        return frozenset({"repo_policy", "deploy_contract"})
    if _has_prefix(normalized, "scripts/server"):
        return frozenset({"repo_policy", "db_infra", "deploy_contract"})

    if _has_prefix(normalized, "infrastructure/docker"):
        return frozenset({"repo_policy", "db_infra", "docker_security"})
    if _has_prefix(normalized, "e2e") or normalized == "playwright.config.ts":
        return frozenset({"repo_policy", "e2e"})

    return None


def classify_change(change: Change) -> ClassifiedChange:
    status_kind = change.status[:1]
    if status_kind in {"D", "R", "C"}:
        return ClassifiedChange(
            change=change,
            categories=FULL_SUITE,
            fail_closed_reason=f"{status_kind.lower()} change requires the full suite",
        )
    if status_kind not in {"A", "M"}:
        return ClassifiedChange(
            change=change,
            categories=FULL_SUITE,
            fail_closed_reason=f"unsupported git status {change.status!r}",
        )

    categories = categories_for_path(change.path)
    if categories is None:
        return ClassifiedChange(
            change=change,
            categories=FULL_SUITE,
            fail_closed_reason=f"unknown path {change.path!r}",
        )
    if categories == FULL_SUITE:
        return ClassifiedChange(
            change=change,
            categories=categories,
            fail_closed_reason=f"global CI configuration path {change.path!r}",
        )
    return ClassifiedChange(change=change, categories=categories)


def classify_changes(
    changes: Iterable[Change], *, force_full_reason: str | None = None
) -> dict[str, object]:
    classified = [classify_change(change) for change in changes]
    selected: set[str] = set()
    reasons: list[str] = []
    for item in classified:
        selected.update(item.categories)
        if item.fail_closed_reason:
            reasons.append(item.fail_closed_reason)

    if force_full_reason:
        selected.update(FULL_SUITE)
        reasons.append(force_full_reason)

    return {
        "schemaVersion": 1,
        "mode": "enforced",
        "fileCount": len(classified),
        "fullSuite": selected == set(FULL_SUITE),
        "categories": {category: category in selected for category in CATEGORIES},
        "failClosedReasons": reasons,
        "changes": [
            {
                "status": item.change.status,
                "path": item.change.path,
                **(
                    {"previousPath": item.change.previous_path}
                    if item.change.previous_path
                    else {}
                ),
                "categories": sorted(item.categories),
                **(
                    {"failClosedReason": item.fail_closed_reason}
                    if item.fail_closed_reason
                    else {}
                ),
            }
            for item in classified
        ],
    }


def parse_name_status_z(data: bytes) -> list[Change]:
    fields = data.decode("utf-8", "surrogateescape").split("\0")
    if fields and fields[-1] == "":
        fields.pop()

    changes: list[Change] = []
    index = 0
    while index < len(fields):
        status = fields[index]
        index += 1
        if not status:
            raise ValueError("empty git status")
        if status[:1] in {"R", "C"}:
            if index + 1 >= len(fields):
                raise ValueError(f"missing paths for git status {status!r}")
            previous_path, path = fields[index], fields[index + 1]
            index += 2
            changes.append(Change(status=status, path=path, previous_path=previous_path))
        else:
            if index >= len(fields):
                raise ValueError(f"missing path for git status {status!r}")
            changes.append(Change(status=status, path=fields[index]))
            index += 1
    return changes


def render_markdown(result: dict[str, object]) -> str:
    categories = result["categories"]
    assert isinstance(categories, dict)
    reasons = result["failClosedReasons"]
    assert isinstance(reasons, list)

    lines = [
        "## Change classification (enforced)",
        "",
        "Selected categories control which pull-request jobs run. Full-suite events ignore path minimization.",
        "",
        f"Changed files: **{result['fileCount']}**  ",
        f"Full suite classification: **{'yes' if result['fullSuite'] else 'no'}**",
        "",
        "| Category | Selected |",
        "| --- | --- |",
    ]
    lines.extend(
        f"| `{category}` | {'yes' if categories[category] else 'no'} |"
        for category in CATEGORIES
    )
    if reasons:
        lines.extend(["", "Fail-closed reasons:"])
        lines.extend(f"- {reason}" for reason in reasons)
    return "\n".join(lines) + "\n"


def render_github_output(result: dict[str, object]) -> str:
    """Render stable lowercase booleans for ``GITHUB_OUTPUT``."""
    categories = result["categories"]
    assert isinstance(categories, dict)
    lines = [
        f"{category}={'true' if categories[category] else 'false'}"
        for category in CATEGORIES
    ]
    lines.append(f"full_suite={'true' if result['fullSuite'] else 'false'}")
    return "\n".join(lines) + "\n"


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--format",
        choices=("json", "markdown", "github-output"),
        default="json",
    )
    parser.add_argument(
        "--force-full-reason",
        help="Select every category when no stable diff base is available.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        changes = parse_name_status_z(sys.stdin.buffer.read())
    except ValueError as error:
        print(f"invalid git name-status input: {error}", file=sys.stderr)
        return 2
    result = classify_changes(changes, force_full_reason=args.force_full_reason)
    if args.format == "markdown":
        sys.stdout.write(render_markdown(result))
    elif args.format == "github-output":
        sys.stdout.write(render_github_output(result))
    else:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
