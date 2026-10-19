#!/usr/bin/env python3
"""CLI orchestration for fail-closed Pi5 Docker release-image retention.

The policy and Docker I/O live in sibling modules.  This file owns only the
command-line contract and JSON summaries:

* ``read`` (the default) prints a dry-run summary and never removes anything;
* ``plan`` writes one sealed JSON plan; and
* ``apply`` requires that plan and prints the deletion summary.
"""

from __future__ import annotations

import argparse
import datetime as _datetime
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

if __package__:
    from .docker_image_retention_model import (
        MINIMUM_AGE_SECONDS,
        PLAN_SCHEMA_VERSION,
        SUMMARY_KIND,
        RetentionError,
        parse_created,
    )
    from .docker_image_retention_runtime import (
        DockerClient,
        apply_plan,
        load_plan,
        plan_from_runtime,
        write_plan,
    )
else:
    from docker_image_retention_model import (
        MINIMUM_AGE_SECONDS,
        PLAN_SCHEMA_VERSION,
        SUMMARY_KIND,
        RetentionError,
        parse_created,
    )
    from docker_image_retention_runtime import (
        DockerClient,
        apply_plan,
        load_plan,
        plan_from_runtime,
        write_plan,
    )


DEFAULT_STATE_PATH = Path("/var/lib/raspi-release/image-retention.json")
DEFAULT_PLAN_PATH = Path("/var/lib/raspi-release/image-retention-plan.json")


def _summary_for_plan(
    plan: Mapping[str, Any], *, mode: str, plan_path: Path | None = None
) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "kind": SUMMARY_KIND,
        "mode": mode,
        "status": "ok",
        "dryRun": mode in {"read", "plan"},
        "planSha256": plan["planSha256"],
        "candidateCount": plan["candidateCount"],
        "estimatedBytes": plan["estimatedBytes"],
        "candidateIds": plan["candidateIds"],
        "runningContainerImageIds": plan["runningContainerImageIds"],
        "excluded": plan["excluded"],
    }
    if plan_path is not None:
        summary["planPath"] = str(plan_path)
    return summary


def _blocked_summary(error: RetentionError, *, mode: str) -> dict[str, Any]:
    return {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "kind": SUMMARY_KIND,
        "mode": mode,
        "status": "blocked",
        "dryRun": mode != "apply",
        "reason": error.reason,
        "error": str(error),
        "deleted": [],
        "unresolved": [],
    }


def _parse_cli_time(value: str | None) -> _datetime.datetime | None:
    if value is None:
        return None
    return parse_created(value, label="--now")


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("read", "plan", "apply"), default="read")
    parser.add_argument(
        "--state-file",
        "--state-path",
        "--state",
        dest="state_path",
        type=Path,
        default=DEFAULT_STATE_PATH,
    )
    parser.add_argument(
        "--plan",
        "--plan-path",
        dest="plan_path",
        type=Path,
        default=DEFAULT_PLAN_PATH,
    )
    parser.add_argument(
        "--output",
        dest="output_path",
        type=Path,
        help="output path for the explicit plan command",
    )
    parser.add_argument(
        "--minimum-age-hours",
        dest="minimum_age_hours",
        type=int,
        default=MINIMUM_AGE_SECONDS // 3600,
    )
    parser.add_argument("--docker-path", dest="docker_path", default="docker")
    parser.add_argument("--now", help="RFC3339 observation time (test/diagnostic use)")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="legacy spelling for the explicit apply command",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    command = "apply" if args.apply else args.command
    state_path = args.state_path
    plan_path = args.plan_path
    try:
        if args.minimum_age_hours != MINIMUM_AGE_SECONDS // 3600:
            raise RetentionError(
                "minimum age policy must be exactly 24 hours", reason="invalid_policy"
            )
        now = _parse_cli_time(args.now)
        client = DockerClient(args.docker_path)
        if command == "read":
            plan = plan_from_runtime(client, state_path=state_path, now=now)
            summary = _summary_for_plan(plan, mode="read")
        elif command == "plan":
            plan = plan_from_runtime(client, state_path=state_path, now=now)
            output_path = args.output_path or plan_path
            write_plan(output_path, plan)
            summary = _summary_for_plan(plan, mode="plan", plan_path=output_path)
        else:
            plan = load_plan(plan_path)
            summary = apply_plan(client, plan, state_path=state_path, now=now)
            summary["planPath"] = str(plan_path)
        json.dump(summary, sys.stdout, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        sys.stdout.write("\n")
        return 1 if summary.get("status") not in {"ok"} else 0
    except RetentionError as error:
        json.dump(
            _blocked_summary(error, mode=command),
            sys.stdout,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
