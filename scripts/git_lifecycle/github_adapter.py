"""Read-only GitHub CLI adapter for pull request observations."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

from .policy import PullRequestObservation


class GitHubAdapterError(RuntimeError):
    """The GitHub CLI could not provide a pull request observation."""


PR_JSON_FIELDS = (
    "number,state,mergedAt,baseRefName,headRefName,headRefOid,mergeCommit,"
    "headRepository,headRepositoryOwner,isCrossRepository"
)
Runner = Callable[..., subprocess.CompletedProcess[bytes]]


def _default_runner(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(*args, **kwargs)  # type: ignore[return-value]


class GitHubAdapter:
    """Fetch PR metadata through ``gh`` without performing GitHub mutations."""

    def __init__(
        self,
        repo_root: Path,
        *,
        runner: Runner | None = None,
        gh_binary: str = "gh",
    ) -> None:
        self.repo_root = Path(repo_root).expanduser().absolute()
        self.runner: Runner = runner or _default_runner
        self.gh_binary = gh_binary

    def _run(self, args: Sequence[str]) -> subprocess.CompletedProcess[bytes]:
        command = (self.gh_binary, *tuple(str(arg) for arg in args))
        try:
            result = self.runner(
                command,
                cwd=str(self.repo_root),
                capture_output=True,
                check=False,
            )
        except OSError as error:
            raise GitHubAdapterError(f"gh command could not start: {error}") from error
        if result.returncode:
            stderr = _decode(result.stderr).strip()
            detail = f": {stderr}" if stderr else ""
            raise GitHubAdapterError(
                f"gh command failed ({result.returncode}) {' '.join(command)}{detail}"
            )
        return result

    def view_pull_request(self, number: int) -> PullRequestObservation:
        """Read one PR with the exact fields used by finish."""

        if number <= 0:
            raise GitHubAdapterError("pull request number must be positive")
        result = self._run(["pr", "view", str(number), "--json", PR_JSON_FIELDS])
        return _parse_one(result.stdout, context=f"PR {number}")

    def list_pull_requests(self, *, limit: int | None = None) -> tuple[PullRequestObservation, ...]:
        """Read every PR state needed by a non-mutating audit.

        The REST endpoint is requested with ``gh api --paginate --slurp`` so
        repositories with more than 1,000 historical PRs do not silently lose
        old merged tasks.  ``limit`` remains as a defensive upper bound for
        embedding callers, but the default is intentionally unbounded.
        """

        if limit is not None and limit <= 0:
            raise GitHubAdapterError("pull request limit must be positive")
        result = self._run(
            [
                "api",
                "--paginate",
                "--slurp",
                "repos/{owner}/{repo}/pulls?state=all&per_page=100",
            ]
        )
        try:
            payload = json.loads(_decode(result.stdout))
        except json.JSONDecodeError as error:
            raise GitHubAdapterError("gh returned invalid pull request JSON") from error
        pages = _flatten_pages(payload)
        observations: list[PullRequestObservation] = []
        selected = pages if limit is None else pages[:limit]
        for item in selected:
            if not isinstance(item, Mapping):
                raise GitHubAdapterError("gh pull request list contained a non-object")
            try:
                observations.append(PullRequestObservation.from_mapping(item))
            except ValueError as error:
                raise GitHubAdapterError(f"invalid pull request object: {error}") from error
        return tuple(observations)

def choose_pull_request(
    pull_requests: Iterable[PullRequestObservation],
    branch: str,
    *,
    expected_sha: str | None = None,
) -> PullRequestObservation | None:
    """Choose the most relevant PR for a local branch deterministically."""

    candidates = [
        pr
        for pr in pull_requests
        if pr.head_branch == branch
    ]
    if not candidates:
        return None
    # An open PR is authoritative: an older merged PR must never make a reused
    # branch look cleanable.  Otherwise prefer the PR whose recorded head is
    # the asset currently being audited before falling back to the newest PR.
    open_candidates = [pr for pr in candidates if pr.open]
    if open_candidates:
        return max(open_candidates, key=lambda pr: pr.number)
    if expected_sha:
        matching = [pr for pr in candidates if pr.head_sha == expected_sha]
        if matching:
            return max(matching, key=lambda pr: pr.number)
    return max(candidates, key=lambda pr: pr.number)


def _parse_one(value: bytes | str, *, context: str) -> PullRequestObservation:
    try:
        payload = json.loads(_decode(value))
    except json.JSONDecodeError as error:
        raise GitHubAdapterError(f"gh returned invalid JSON for {context}") from error
    if not isinstance(payload, Mapping):
        raise GitHubAdapterError(f"gh returned a non-object for {context}")
    try:
        return PullRequestObservation.from_mapping(payload)
    except ValueError as error:
        raise GitHubAdapterError(f"invalid pull request object for {context}: {error}") from error


def _flatten_pages(value: object) -> list[object]:
    """Flatten both ``--slurp`` pages and a single-page test fixture."""

    if not isinstance(value, list):
        raise GitHubAdapterError("gh pull request list was not a JSON array")
    if not value:
        return []
    if all(isinstance(page, list) for page in value):
        flattened: list[object] = []
        for page in value:
            flattened.extend(page)  # type: ignore[arg-type]
        return flattened
    return value


def _decode(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="surrogateescape")
    return value


__all__ = [
    "GitHubAdapter",
    "GitHubAdapterError",
    "PR_JSON_FIELDS",
    "choose_pull_request",
]
