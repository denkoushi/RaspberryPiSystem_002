#!/usr/bin/env python3
"""Read-only helper: may --allow-agent-skip be given for these (Pi4, agent) pairs?

Checks steps 1-4 of the deployment guide automatically and lists candidates for
step 5. Steps 5 and 6 always stay with a human. The helper changes nothing.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, NamedTuple, Sequence

ROOT = Path(__file__).resolve().parents[2]
AGENTS = ("nfc-agent", "barcode-agent", "torque-agent")
FULL_SHA = re.compile(r"[0-9a-f]{40}")
SAFE_PROJECT = re.compile(r"[a-z0-9][a-z0-9_-]*")
CONFIG_PATHS = (
    "infrastructure/ansible/group_vars", "infrastructure/ansible/host_vars", "infrastructure/ansible/roles/client_server_cert_pin",
    "infrastructure/ansible/playbooks/group_vars", "infrastructure/ansible/playbooks/host_vars",
)

Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


class Pair(NamedTuple):
    host: str
    agent: str


class Verdict(NamedTuple):
    pair: Pair
    tag: str
    project: str
    reason: str
    candidates: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.reason


# Longer than the launcher's own bound on the agent image read (two guard calls of 300 s plus cleanup).
COMMAND_TIMEOUT_SECONDS = 900


def default_runner(command: Sequence[str]) -> "subprocess.CompletedProcess[str]":
    """Run a command; a command that does not return in time counts as failed (exit 124)."""
    try:
        return subprocess.run(
            list(command), cwd=ROOT, text=True, capture_output=True, check=False, timeout=COMMAND_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(list(command), 124, "", f"timed out after {COMMAND_TIMEOUT_SECONDS} s")


def split_nul(text: str) -> list[str]:
    """Paths of ``git diff --name-only -z`` (a path may contain spaces)."""
    return [item for item in text.split("\0") if item]


def parse_pairs(values: Sequence[str]) -> tuple[Pair, ...]:
    pairs: list[Pair] = []
    for value in values:
        host, separator, agent = value.partition(":")
        if not separator or not host or agent not in AGENTS or Pair(host, agent) in pairs:
            raise ValueError(f"pair must be HOST:AGENT with a unique agent of {', '.join(AGENTS)}: {value}")
        pairs.append(Pair(host, agent))
    return tuple(pairs)


def normalize_inventory(value: str) -> str:
    """The launcher's inventory_path rule: a regular .yml in infrastructure/ansible, as a repo-relative path."""
    candidate = Path(value)
    candidate = candidate if candidate.is_absolute() else ROOT / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except OSError:
        raise ValueError("inventory file does not exist") from None
    if (
        candidate.is_symlink() or not resolved.is_file() or resolved.suffix != ".yml"
        or not resolved.is_relative_to(ROOT / "infrastructure/ansible")
    ):
        raise ValueError("inventory must be a regular YAML file in infrastructure/ansible")
    return resolved.relative_to(ROOT).as_posix()


def check_checkout(sha: str, run: Runner) -> str:
    head = run(["git", "rev-parse", "HEAD"])
    if head.returncode != 0 or head.stdout.strip() != sha:
        return "HEAD of this checkout is not the release SHA"
    status = run(["git", "status", "--porcelain"])
    if status.returncode != 0:
        return "git status failed"
    if status.stdout.strip():
        names = ", ".join(line[3:] for line in status.stdout.splitlines())
        return f"working tree has changes: {names}"
    return ""


def read_images(inventory: str, hosts: Sequence[str], run: Runner) -> tuple[dict[str, dict], str]:
    """Return (reports by host, problem); a non-zero exit is a failure even when the JSON looks complete."""
    result = run([
        "scripts/update-all-clients.sh", "--agent-images", "--inventory", inventory,
        "--limit", ":".join(dict.fromkeys(hosts)),
    ])
    if result.returncode != 0:
        return {}, f"the agent image read exited with code {result.returncode}"
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        return {}, ""
    reports = payload.get("hosts") if isinstance(payload, dict) else None
    if not isinstance(reports, list):
        return {}, ""
    return {item["host"]: item for item in reports if isinstance(item, dict) and isinstance(item.get("host"), str)}, ""


def tag_of(report: dict | None, pair: Pair) -> tuple[str, str, str]:
    """Return (tag, project, reason); the reason is empty only for exactly one running container."""
    try:
        project = str(report["project"])  # type: ignore[index]
        expected = str(report["expectedImages"][pair.agent])  # type: ignore[index]
        containers = report["containers"][pair.agent]  # type: ignore[index]
    except (KeyError, TypeError, IndexError):
        return "", "", "the agent containers could not be read from the host"
    if not isinstance(containers, list):
        return "", project, "the agent containers could not be read from the host"
    if len(containers) != 1:
        return "", project, f"{len(containers)} containers found; exactly one is required"
    if not isinstance(containers[0], dict):
        return "", project, "the agent containers could not be read from the host"
    image, status = str(containers[0].get("image")), str(containers[0].get("status"))
    if status != "running":
        return "", project, f"the container is {status}, not running"
    prefix = expected + ":"
    tag = image[len(prefix):] if image.startswith(prefix) else ""
    if not FULL_SHA.fullmatch(tag):
        return "", project, "the running image tag is not a 40-hex SHA"
    if not SAFE_PROJECT.fullmatch(project):
        return tag, project, "the Compose project name has an unexpected format"
    return tag, project, ""


def judge(pair: Pair, tag: str, project: str, sha: str, inventory: str, run: Runner) -> Verdict:
    def fail(reason: str, candidates: tuple[str, ...] = ()) -> Verdict:
        return Verdict(pair, tag, project, reason, candidates)

    if run(["git", "merge-base", "--is-ancestor", tag, sha]).returncode != 0:
        return fail(f"{tag} is not an ancestor of the release SHA, or is unknown here")
    classify = run([
        sys.executable, "scripts/ci/classify_event_changes.py", "--event-name", "push",
        "--base-sha", tag, "--head-sha", sha, "--repo", ".",
    ])
    try:
        classification = json.loads(classify.stdout)
        reasons = classification["failClosedReasons"]
        services = classification["pi4AgentServices"]
        composition = classification["torqueComposition"]
    except (ValueError, KeyError, TypeError):
        return fail("the change classification could not be read")
    if not isinstance(reasons, list) or not isinstance(services, list) or not isinstance(composition, bool):
        return fail("the change classification could not be read")
    if classify.returncode != 0 or reasons:
        return fail("the change classification fails closed: " + ", ".join(map(str, reasons)))
    if pair.agent in services:
        return fail(f"{pair.agent} is rebuilt by the changes between {tag} and the release SHA")
    if pair.agent == "torque-agent" and composition:
        return fail("the torque API side changed between the two versions")
    for ref in (tag, sha):
        if run(["git", "cat-file", "-e", f"{ref}:{inventory}"]).returncode != 0:
            return fail(f"the inventory {inventory} is not tracked by git at {ref[:12]}, so its changes cannot be compared")
    inventory_dir = Path(inventory).parent.as_posix()
    config_paths = tuple(dict.fromkeys((*CONFIG_PATHS, f"{inventory_dir}/group_vars", f"{inventory_dir}/host_vars")))
    diff = run(["git", "diff", "--name-only", "-z", tag, sha, "--", inventory, *config_paths])
    if diff.returncode != 0:
        return fail("the configuration diff could not be taken")
    if split_nul(diff.stdout):
        return fail("configuration changed between the two versions: " + ", ".join(split_nul(diff.stdout)))
    changed = run(["git", "diff", "--name-only", "-z", tag, sha])
    name = pair.agent.removesuffix("-agent")
    if changed.returncode != 0:
        return fail("差分が取れない (the list of changed files could not be taken)")
    candidates = tuple(path for path in split_nul(changed.stdout) if name in path.lower())
    return Verdict(pair, tag, project, "", candidates)


def main(argv: Sequence[str] | None = None, run: Runner = default_runner) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--inventory", required=True)
    parser.add_argument("pairs", nargs="+", metavar="HOST:AGENT")
    args = parser.parse_args(argv)
    if not FULL_SHA.fullmatch(args.sha):
        print("--sha must be a full 40-hex SHA", file=sys.stderr)
        return 2
    try:
        pairs = parse_pairs(args.pairs)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    try:
        args.inventory = normalize_inventory(args.inventory)
    except ValueError as error:
        print(f"not judged: {error}")
        return 2
    problem = check_checkout(args.sha, run)
    if problem:
        print(f"not judged: {problem}")
        return 2
    reports, read_problem = read_images(args.inventory, [pair.host for pair in pairs], run)
    verdicts = []
    for pair in pairs:
        tag, project, reason = tag_of(reports.get(pair.host), pair)
        reason = read_problem or reason
        verdicts.append(
            Verdict(pair, tag, project, reason, ()) if reason else judge(pair, tag, project, args.sha, args.inventory, run)
        )
    for verdict in verdicts:
        label = f"{verdict.pair.host}:{verdict.pair.agent}"
        if verdict.ok:
            print(f"{label}: steps 1-4 pass (version {verdict.tag}, project {verdict.project})")
            for path in verdict.candidates:
                print(f"  step 5 candidate: {path}")
        else:
            print(f"{label}: 付けてはいけない ({verdict.reason})")
    if not all(verdict.ok for verdict in verdicts):
        return 1
    print("steps 1-4 pass; steps 5 and 6 await a human")
    entries = ",".join(f"{v.pair.host}:{v.pair.agent}:{v.tag}:{v.project}" for v in verdicts)
    print(f"--allow-agent-skip-sha {args.sha} --allow-agent-skip {entries}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
