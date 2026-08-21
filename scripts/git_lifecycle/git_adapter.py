"""Small, argv-only adapter around Git.

The adapter intentionally exposes only the observations and mutations needed
by the lifecycle commands.  Every subprocess is executed without a shell and
all destructive-looking operations are guarded by the caller's policy.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence


class GitAdapterError(RuntimeError):
    """A Git command failed or returned an unusable observation."""


@dataclass(frozen=True)
class CommandFailure:
    args: tuple[str, ...]
    returncode: int
    stderr: str


@dataclass(frozen=True)
class GitWorktree:
    path: Path
    branch: str | None
    head_sha: str | None
    detached: bool = False
    locked: bool = False
    prunable: bool = False


@dataclass(frozen=True)
class MainObservation:
    worktree: GitWorktree | None
    clean: bool | None
    local_sha: str | None
    origin_sha: str | None
    relation: str | None
    cleanup_safety: "CleanupSafety | None" = None


@dataclass(frozen=True)
class CleanupSafety:
    """Whether Git cleanup can safely remove the worktree directory.

    ``git status`` intentionally does not include ignored files, and a normal
    status can also hide index flags such as assume-unchanged or
    skip-worktree.  Those counts are retained as non-secret evidence only.
    """

    status_clean: bool
    ignored_count: int = 0
    special_index_count: int = 0

    @property
    def safe(self) -> bool:
        return (
            self.status_clean
            and self.special_index_count == 0
        )


Runner = Callable[..., subprocess.CompletedProcess[bytes]]


def _default_runner(*args: object, **kwargs: object) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(*args, **kwargs)  # type: ignore[return-value]


class GitAdapter:
    """Observe and mutate one repository using explicit Git argv calls."""

    def __init__(self, repo_root: Path, *, runner: Runner | None = None) -> None:
        self.repo_root = Path(repo_root).expanduser().absolute()
        self.runner: Runner = runner or _default_runner

    @classmethod
    def discover(cls, cwd: Path | None = None) -> "GitAdapter":
        """Discover the common repository root from any worktree."""

        start = Path(cwd or Path.cwd()).absolute()
        top = _run_discovery(["rev-parse", "--show-toplevel"], cwd=start)
        common = _run_discovery(
            ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=start
        )
        common_path = Path(common)
        if common_path.name == ".git":
            root = common_path.parent
        else:
            root = Path(top)
        return cls(root.resolve())

    def _run(
        self,
        args: Sequence[str],
        *,
        cwd: Path | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[bytes]:
        command = ("git", *tuple(str(arg) for arg in args))
        try:
            result = self.runner(
                command,
                cwd=str(cwd or self.repo_root),
                capture_output=True,
                check=False,
            )
        except OSError as error:
            raise GitAdapterError(f"git command could not start: {error}") from error
        if result.returncode and check:
            stderr = _decode(result.stderr).strip()
            detail = f": {stderr}" if stderr else ""
            raise GitAdapterError(
                f"git command failed ({result.returncode}) {' '.join(command)}{detail}"
            )
        return result

    def output(self, args: Sequence[str], *, cwd: Path | None = None) -> str:
        return _decode(self._run(args, cwd=cwd).stdout).strip()

    def fetch_origin(self) -> str:
        """Fetch and prune origin, then return the exact origin/main SHA."""

        self._run(["fetch", "--prune", "origin"])
        return self.resolve_commit("refs/remotes/origin/main")

    def resolve_commit(self, ref: str) -> str:
        """Resolve one explicit ref to a commit, rejecting missing refs."""

        if not ref or ref.startswith("-") or "\x00" in ref:
            raise GitAdapterError("invalid Git ref")
        value = self.output(["rev-parse", "--verify", f"{ref}^{{commit}}"])
        if not re.fullmatch(r"[0-9a-fA-F]{40}", value):
            raise GitAdapterError(f"ref did not resolve to a full commit: {ref}")
        return value.lower()

    def branch_sha(self, branch: str) -> str | None:
        self._check_branch(branch)
        result = self._run(
            ["rev-parse", "--verify", f"refs/heads/{branch}^{{commit}}"], check=False
        )
        if result.returncode:
            return None
        value = _decode(result.stdout).strip()
        return value.lower() if re.fullmatch(r"[0-9a-fA-F]{40}", value) else None

    def has_local_branch(self, branch: str) -> bool:
        return self.branch_sha(branch) is not None

    def local_branches(self) -> dict[str, str]:
        """Return local branch names and SHAs using NUL-delimited ref output."""

        result = self._run(
            [
                "for-each-ref",
                "--format=%(refname:short)%00%(objectname)%00",
                "refs/heads",
            ]
        )
        values = _split_nul(_decode_bytes(result.stdout))
        branches: dict[str, str] = {}
        for index in range(0, len(values) - 1, 2):
            branch, sha = values[index], values[index + 1]
            if branch and re.fullmatch(r"[0-9a-fA-F]{40}", sha):
                branches[branch] = sha.lower()
        return branches

    def remote_branches(self, remote: str = "origin") -> dict[str, str]:
        """Return remote-tracking branches without treating ``origin/HEAD`` as a task."""

        if not remote or "/" in remote or remote.startswith("-"):
            raise GitAdapterError("invalid remote name")
        result = self._run(
            [
                "for-each-ref",
                "--format=%(refname:short)%00%(objectname)%00",
                f"refs/remotes/{remote}",
            ]
        )
        values = _split_nul(_decode_bytes(result.stdout))
        branches: dict[str, str] = {}
        prefix = f"{remote}/"
        for index in range(0, len(values) - 1, 2):
            full_name, sha = values[index], values[index + 1]
            if not full_name.startswith(prefix) or full_name == f"{remote}/HEAD":
                continue
            if re.fullmatch(r"[0-9a-fA-F]{40}", sha):
                branches[full_name.removeprefix(prefix)] = sha.lower()
        return branches

    def remote_branch_exists(self, branch: str, remote: str = "origin") -> bool:
        self._check_branch(branch)
        return branch in self.remote_branches(remote)

    def list_worktrees(self) -> tuple[GitWorktree, ...]:
        """List worktrees with NUL-safe path parsing."""

        result = self._run(["worktree", "list", "--porcelain", "-z"])
        data = _decode_bytes(result.stdout)
        records = _parse_worktree_records(data)
        return tuple(records)

    def worktree_for_path(self, path: Path) -> GitWorktree | None:
        candidate = Path(path).expanduser().resolve(strict=False)
        for worktree in self.list_worktrees():
            if worktree.path.resolve(strict=False) == candidate:
                return worktree
        return None

    def worktree_for_branch(self, branch: str) -> GitWorktree | None:
        for worktree in self.list_worktrees():
            if worktree.branch == branch:
                return worktree
        return None

    def main_worktree(self) -> GitWorktree | None:
        worktrees = self.list_worktrees()
        for worktree in worktrees:
            if worktree.branch == "main":
                return worktree
        return next(
            (worktree for worktree in worktrees if worktree.path.resolve() == self.repo_root.resolve()),
            None,
        )

    def is_clean(self, path: Path) -> bool:
        """Return ordinary Git status cleanliness for compatibility callers."""

        return self.cleanup_safety(path).status_clean

    def cleanup_safety(self, path: Path) -> CleanupSafety:
        """Observe ordinary, ignored, and special-index material safely."""

        status = self._run(
            ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
            cwd=Path(path),
        )
        ignored = self._run(
            [
                "status",
                "--porcelain=v1",
                "--ignored=matching",
                "--untracked-files=normal",
                "-z",
            ],
            cwd=Path(path),
        )
        index = self._run(["ls-files", "-v", "-z"], cwd=Path(path))
        ignored_count = sum(
            1
            for entry in _split_nul_bytes(ignored.stdout)
            if entry.startswith(b"!!")
        )
        special_index_count = sum(
            1
            for entry in _split_nul_bytes(index.stdout)
            if entry and entry[:1] != b"H"
        )
        return CleanupSafety(
            status_clean=not bool(status.stdout),
            ignored_count=ignored_count,
            special_index_count=special_index_count,
        )

    def branch_relation(self, local_ref: str, remote_ref: str) -> str | None:
        """Compare refs as equal, behind, ahead, or diverged."""

        try:
            result = self._run(
                ["rev-list", "--left-right", "--count", f"{local_ref}...{remote_ref}"],
                check=False,
            )
        except GitAdapterError:
            return None
        if result.returncode:
            return None
        values = _decode(result.stdout).strip().split()
        if len(values) != 2 or not all(value.isdigit() for value in values):
            return None
        ahead, behind = (int(value) for value in values)
        if ahead == 0 and behind == 0:
            return "equal"
        if ahead == 0:
            return "behind"
        if behind == 0:
            return "ahead"
        return "diverged"

    def observe_main(self, *, origin_sha: str | None = None) -> MainObservation:
        worktree = self.main_worktree()
        if worktree is None:
            return MainObservation(None, None, None, origin_sha, None)
        try:
            cleanup_safety = self.cleanup_safety(worktree.path)
        except GitAdapterError:
            cleanup_safety = None
        clean = cleanup_safety.safe if cleanup_safety is not None else None
        local_sha = self.branch_sha("main")
        if origin_sha is None:
            try:
                origin_sha = self.resolve_commit("refs/remotes/origin/main")
            except GitAdapterError:
                origin_sha = None
        relation = (
            self.branch_relation("refs/heads/main", "refs/remotes/origin/main")
            if local_sha and origin_sha
            else None
        )
        return MainObservation(
            worktree,
            clean,
            local_sha,
            origin_sha,
            relation,
            cleanup_safety,
        )

    def add_worktree_from_origin_main(self, branch: str, path: Path) -> None:
        """Create a new branch/worktree directly at the fetched origin/main ref."""

        self._check_branch(branch)
        target = Path(path).absolute()
        target.parent.mkdir(parents=True, exist_ok=True)
        self._run(
            ["worktree", "add", "-b", branch, str(target), "refs/remotes/origin/main"]
        )

    def remove_worktree(self, worktree: GitWorktree) -> None:
        """Remove a clean, exact registered worktree without overriding safety checks."""

        self._run(["worktree", "remove", str(worktree.path)])

    def delete_local_branch_if_at(self, branch: str, expected_sha: str) -> None:
        """Compare-and-delete one local ref, preserving races and unrelated refs."""

        self._check_branch(branch)
        if branch == "main":
            raise GitAdapterError("main branch is protected")
        if not re.fullmatch(r"[0-9a-fA-F]{40}", expected_sha):
            raise GitAdapterError("expected branch SHA is invalid")
        self._run(
            ["update-ref", "-d", f"refs/heads/{branch}", expected_sha.lower()]
        )

    def fast_forward_main(self) -> None:
        main = self.main_worktree()
        if main is None or main.branch != "main":
            raise GitAdapterError("main worktree is not available")
        self._run(["merge", "--ff-only", "refs/remotes/origin/main"], cwd=main.path)

    def _check_branch(self, branch: str) -> None:
        if not branch or "\x00" in branch or branch.startswith("-"):
            raise GitAdapterError("invalid branch name")
        result = self._run(["check-ref-format", "--branch", branch], check=False)
        if result.returncode:
            raise GitAdapterError(f"invalid branch name: {branch}")


def worktree_path_for_branch(repo_root: Path, branch: str) -> Path:
    """Return the stable sibling worktree path used by ``start``."""

    if not branch:
        raise ValueError("branch is required")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "--", branch).strip("-")
    slug = slug or "task"
    return Path(repo_root).absolute().parent / f"{Path(repo_root).name}-worktrees" / slug


def _run_discovery(args: Sequence[str], *, cwd: Path) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            check=False,
            text=True,
        )
    except OSError as error:
        raise GitAdapterError(f"git command could not start: {error}") from error
    if result.returncode:
        detail = (result.stderr or "").strip()
        raise GitAdapterError(f"git discovery failed: {detail or 'not a repository'}")
    return (result.stdout or "").strip()


def _decode(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="surrogateescape")
    return value


def _decode_bytes(value: bytes | str | None) -> bytes:
    if value is None:
        return b""
    return value if isinstance(value, bytes) else value.encode("utf-8", errors="surrogateescape")


def _split_nul(value: bytes) -> list[str]:
    return [
        part.decode("utf-8", errors="surrogateescape").strip("\r\n")
        for part in value.split(b"\x00")
        if part.strip(b"\r\n")
    ]


def _split_nul_bytes(value: bytes | str | None) -> list[bytes]:
    if value is None:
        return []
    raw = value if isinstance(value, bytes) else value.encode("utf-8", errors="surrogateescape")
    return [entry for entry in raw.split(b"\x00") if entry]


def _parse_worktree_records(value: bytes | str) -> list[GitWorktree]:
    raw = value if isinstance(value, bytes) else value.encode("utf-8", errors="surrogateescape")
    records = raw.split(b"\x00\x00")
    result: list[GitWorktree] = []
    for record in records:
        fields = [field.decode("utf-8", errors="surrogateescape") for field in record.split(b"\x00") if field]
        if not fields:
            continue
        path: Path | None = None
        branch: str | None = None
        head_sha: str | None = None
        detached = False
        locked = False
        prunable = False
        for field in fields:
            if field.startswith("worktree "):
                path = Path(field.removeprefix("worktree ")).absolute()
            elif field.startswith("HEAD "):
                candidate = field.removeprefix("HEAD ")
                head_sha = candidate if re.fullmatch(r"[0-9a-fA-F]{40}", candidate) else None
            elif field.startswith("branch "):
                ref = field.removeprefix("branch ")
                branch = ref.removeprefix("refs/heads/")
            elif field == "detached":
                detached = True
            elif field == "locked" or field.startswith("locked "):
                locked = True
            elif field == "prunable" or field.startswith("prunable "):
                prunable = True
        if path is not None:
            result.append(
                GitWorktree(
                    path=path,
                    branch=branch,
                    head_sha=head_sha.lower() if head_sha else None,
                    detached=detached,
                    locked=locked,
                    prunable=prunable,
                )
            )
    return result


__all__ = [
    "CommandFailure",
    "CleanupSafety",
    "GitAdapter",
    "GitAdapterError",
    "GitWorktree",
    "MainObservation",
    "worktree_path_for_branch",
]
