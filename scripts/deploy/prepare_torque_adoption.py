#!/usr/bin/env python3
"""Prepare the torque-agent adoption PR and refresh PRs blocked by it.

Run by a human/agent on a Mac with `gh` and `git` logged in. Not run in CI.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

try:
    from .release_artifact_contract import TORQUE_ADOPTED_SOURCE_SHA
    from .torque_component_adoption import SOURCE_CLOSURE, AdoptionError
except ImportError:  # Direct script execution from scripts/deploy.
    from release_artifact_contract import TORQUE_ADOPTED_SOURCE_SHA
    from torque_component_adoption import SOURCE_CLOSURE, AdoptionError

SLUG = "denkoushi/RaspberryPiSystem_002"
GHCR_REPOSITORY = "denkoushi/raspisys-torque-agent"
CONTRACT = Path(__file__).resolve().with_name("release_artifact_contract.py")
CONTRACT_PATH = "scripts/deploy/release_artifact_contract.py"
JOB_NAME = "pi4-agent-images-publish (torque-agent)"
CHECK_NAME = "torque-release-compatibility"
BLOCK_RE = re.compile(r"(TORQUE_ADOPTION = TorqueAdoption\(\n)(.*?)(\n\))", re.DOTALL)
INDEX_ACCEPT = (
    "application/vnd.oci.image.index.v1+json,"
    "application/vnd.docker.distribution.manifest.list.v2+json"
)


class PrepareError(AdoptionError):
    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


# --- side effects -----------------------------------------------------------


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def git_fetch_main() -> None:
    run("git", "fetch", "origin", "main")


def git_last_commit(*paths: str) -> str:
    return run("git", "log", "-1", "--format=%H", "origin/main", "--", *paths).strip()


def git_contains(ancestor: str, head: str) -> bool:
    """Return True when head already has ancestor; a fetch failure skips that PR."""
    try:
        run("git", "fetch", "origin", head)
    except subprocess.CalledProcessError as exc:
        print(f"  skip {head[:8]}: fetch failed: {exc.stderr.strip()}", file=sys.stderr)
        return True
    return (
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, head], capture_output=True, check=False
        ).returncode
        == 0
    )


def gh_json(*args: str):
    return json.loads(run("gh", *args) or "null")


def gh_paginated_jobs(run_id: int) -> list[dict]:
    out = run("gh", "api", "--paginate", f"repos/{SLUG}/actions/runs/{run_id}/jobs")
    # --paginate concatenates one JSON document per page.
    jobs: list[dict] = []
    decoder = json.JSONDecoder()
    pos = 0
    while pos < len(out):
        if out[pos].isspace():
            pos += 1
            continue
        doc, pos = decoder.raw_decode(out, pos)
        jobs.extend(doc.get("jobs", []))
    return jobs


def fetch_ghcr_index(tag: str) -> tuple[str, list[dict]]:
    token_url = f"https://ghcr.io/token?scope=repository:{GHCR_REPOSITORY}:pull"
    token = json.load(urllib.request.urlopen(token_url))["token"]
    req = urllib.request.Request(
        f"https://ghcr.io/v2/{GHCR_REPOSITORY}/manifests/{tag}",
        headers={"Authorization": f"Bearer {token}", "Accept": INDEX_ACCEPT},
    )
    resp = urllib.request.urlopen(req)
    return resp.headers["Docker-Content-Digest"], json.load(resp)["manifests"]


# --- logic ------------------------------------------------------------------


def git_main_contract() -> str:
    return run("git", "show", f"origin/main:{CONTRACT_PATH}")


def git_adoption_commit(source_sha: str) -> str:
    """The main commit that set the current source_sha (not merely the last edit)."""
    return run(
        "git", "log", "-1", "--format=%H", f"-Ssource_sha=\"{source_sha}\"", "origin/main", "--", CONTRACT_PATH
    ).strip()


def adopted_sha(text: str) -> str:
    match = re.search(r'source_sha="([0-9a-f]{40})"', text)
    if not match:
        raise PrepareError("source_sha not found in release_artifact_contract.py")
    return match.group(1)


def pick_platform_digests(manifests: list[dict]) -> tuple[str, str]:
    arm64, armv7 = [], []
    for entry in manifests:
        platform = entry.get("platform") or {}
        if platform.get("os") != "linux":
            continue
        if platform.get("architecture") == "arm64":
            arm64.append(entry["digest"])
        elif platform.get("architecture") == "arm" and platform.get("variant") == "v7":
            armv7.append(entry["digest"])
    if len(arm64) != 1 or len(armv7) != 1:
        raise PrepareError(
            f"expected exactly one linux/arm64 and one linux/arm/v7 entry, got {len(arm64)} and {len(armv7)}"
        )
    return arm64[0], armv7[0]


def select_job(jobs: list[dict]) -> dict:
    for job in jobs:
        if job.get("name") == JOB_NAME:
            if job.get("status") != "completed":
                raise PrepareError(f"not published yet: job '{JOB_NAME}' is {job.get('status')}", 4)
            if job.get("conclusion") != "success":
                raise PrepareError(f"job '{JOB_NAME}' concluded {job.get('conclusion')}", 5)
            return job
    raise PrepareError(f"not published yet: job '{JOB_NAME}' not found", 4)


def rewrite_block(text: str, values: dict) -> str:
    matches = BLOCK_RE.findall(text)
    if len(matches) != 1:
        raise PrepareError(f"TORQUE_ADOPTION block found {len(matches)} times, expected 1")

    def sub_block(match: re.Match) -> str:
        body = match.group(2)
        for key, value in values.items():
            literal = str(value) if isinstance(value, int) else f'"{value}"'
            body, count = re.subn(rf"(?m)^(\s*{key}=).*?,$", lambda m, lit=literal: f"{m.group(1)}{lit},", body)
            if count != 1:
                raise PrepareError(f"field {key} not found exactly once in block")
        return match.group(1) + body + match.group(3)

    return BLOCK_RE.sub(sub_block, text, count=1)


def select_blocked_prs(prs: list[dict], contains) -> list[int]:
    selected = []
    for pr in prs:
        if pr.get("isCrossRepository"):
            continue
        failed = any(
            c.get("name") == CHECK_NAME and c.get("conclusion") == "FAILURE"
            for c in pr.get("statusCheckRollup") or []
        )
        if failed and not contains(pr["headRefOid"]):
            selected.append(pr["number"])
    return selected


def pending_sha() -> str:
    git_fetch_main()
    return git_last_commit(*SOURCE_CLOSURE)


def build_pr_body(v: dict) -> str:
    short = v["source_sha"][:8]
    pr = f"#{v['pr_number']}" if v.get("pr_number") else "ソース変更"
    return f"""## 概要
{pr}({short})で作り直した torque-agent イメージを採用します。

- `scripts/deploy/release_artifact_contract.py` の `TORQUE_ADOPTION` を、{short} の main の CI run {v['origin_run_id']} / job {v['origin_job_id']}(`{JOB_NAME}`)が公開したイメージに差し替えます。
  - index `{v['index_digest']}`
  - linux/arm64 `{v['arm64_digest']}`
  - linux/arm/v7 `{v['armv7_digest']}`
- 値は `scripts/deploy/prepare_torque_adoption.py write` で GHCR から読みました。
- torque のソースと Dockerfile は変えていません。

## Deploy impact declaration

<!-- deploy-impact:start -->
| Item | Declaration |
| --- | --- |
| Risk | unknown |
| Target machines | pi4 |
| Changed surfaces | agent, deploy, ci, config, unknown |
| Required files/artifacts | torque-agent image index {v['index_digest']} published for {short}, and the release set of the merge SHA |
| Database | no: only the adopted image identity values change |
| Secrets/config delivery | no: no secret or config file changes |
| Success evidence | Torque Release Composition succeeds on this PR and on main (torque-component-adoption included); adoption and release contract tests pass |
| Rollback/cleanup | Revert this PR to return to the {v['previous_sha'][:8]} identity; no data or state to clean up |
| Production verification | After the fleet deploy that includes this PR, torque-agent container healthy on raspi4-kensaku-stonebase01 and raspi4-assembly-01 |
<!-- deploy-impact:end -->

## Test plan

- Commands and environments:
  - `python3 -m pytest -q scripts/deploy/tests/test_release_artifact_contract.py scripts/deploy/tests/test_torque_component_adoption.py scripts/deploy/tests/test_prepare_torque_adoption.py`
- Not run / reason:
  - `torque-component-adoption` は main への push だけで動くため、マージ後の main の run で確かめる。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
"""


# --- subcommands ------------------------------------------------------------


def cmd_status(_args) -> int:
    pending = pending_sha()
    current = adopted_sha(git_main_contract())
    if pending == current:
        print(f"adopted: {current}")
        return 0
    print(f"not adopted: newer torque source {pending} (current {current})")
    return 3


def cmd_write(args) -> int:
    text = CONTRACT.read_text()
    current = TORQUE_ADOPTED_SOURCE_SHA
    sha = args.source_sha or pending_sha()
    if sha == current:
        print(f"already adopted: {sha}")
        return 0
    runs = gh_json(
        "run", "list", "--repo", SLUG, "--workflow", "ci.yml", "--commit", sha,
        "--event", "push", "--json", "databaseId,status,conclusion",
    )
    if not runs:
        raise PrepareError(f"not published yet: no push CI run for {sha}", 4)
    run_id = max(r["databaseId"] for r in runs)
    job = select_job(gh_paginated_jobs(run_id))
    index_digest, manifests = fetch_ghcr_index(sha)
    arm64, armv7 = pick_platform_digests(manifests)
    values = {
        "source_sha": sha, "index_digest": index_digest, "arm64_digest": arm64,
        "armv7_digest": armv7, "origin_run_id": run_id, "origin_job_id": job["id"],
    }
    CONTRACT.write_text(rewrite_block(text, values))
    found = gh_json("pr", "list", "--repo", SLUG, "--state", "merged", "--search", sha, "--json", "number")
    pr_number = found[0]["number"] if found else None
    if args.pr_body:
        body = build_pr_body({**values, "pr_number": pr_number, "previous_sha": current})
        Path(args.pr_body).write_text(body)
    for key, value in values.items():
        print(f"{key}: {value}")
    title_ref = f"#{pr_number} " if pr_number else ""
    print(f"suggested PR title: fix: {title_ref}で作り直した torque-agent イメージを採用する")
    return 0


def cmd_update_blocked_prs(args) -> int:
    git_fetch_main()
    adoption = git_adoption_commit(adopted_sha(git_main_contract()))
    prs = gh_json(
        "pr", "list", "--repo", SLUG, "--state", "open", "--limit", "200",
        "--json", "number,headRefOid,isCrossRepository,statusCheckRollup",
    )
    numbers = select_blocked_prs(prs, lambda head: git_contains(adoption, head))
    failed = False
    for number in numbers:
        print(f"PR #{number}" + (" (dry-run)" if args.dry_run else ""))
        if args.dry_run:
            continue
        try:
            run("gh", "pr", "update-branch", str(number), "--repo", SLUG)
        except subprocess.CalledProcessError as exc:
            failed = True
            print(f"  update failed: {exc.stderr.strip()}", file=sys.stderr)
    if not numbers:
        print("no blocked PRs")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status").set_defaults(func=cmd_status)
    write = sub.add_parser("write")
    write.add_argument("--source-sha")
    write.add_argument("--pr-body")
    write.set_defaults(func=cmd_write)
    blocked = sub.add_parser("update-blocked-prs")
    blocked.add_argument("--dry-run", action="store_true")
    blocked.set_defaults(func=cmd_update_blocked_prs)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except PrepareError as exc:
        print(str(exc), file=sys.stderr)
        return exc.code
    except subprocess.CalledProcessError as exc:
        print(f"command failed: {exc.cmd}\n{exc.stderr}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
