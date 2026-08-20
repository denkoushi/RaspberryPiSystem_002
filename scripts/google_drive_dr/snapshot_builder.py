"""Build a consistent, non-secret snapshot payload for Business Pi 5."""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .command_port import CommandError, CommandPort, CommandResult
from .source_policy import (
    DEFAULT_PROJECT_ROOT,
    DEFAULT_STAGING_ROOT,
    SourcePolicy,
    SourcePolicyError,
    SourceSelection,
    default_policy,
    path_usage,
    relative_label,
    resolve,
)


class SnapshotError(RuntimeError):
    """Raised when the local snapshot cannot be completed."""


@dataclass(frozen=True)
class SnapshotArtifact:
    """Paths and metadata produced before the restic upload begins."""

    staging_dir: Path
    database_dump: Path
    git_bundle: Path
    manifest: Path
    repository_sha: str
    worktree_dirty: bool
    source_selection: SourceSelection
    total_bytes: int

    @property
    def upload_paths(self) -> tuple[Path, ...]:
        """Return source roots plus the generated staging directory."""

        # ``project-root`` is required only as a liveness check.  Uploading it
        # would include arbitrary caches and make the recovery boundary drift.
        source_paths = tuple(
            source.path
            for source in self.source_selection.included
            if source.spec.category != "project-root"
        )
        return (*source_paths, self.staging_dir)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _result_stdout(result: CommandResult | object) -> bytes:
    value = getattr(result, "stdout", b"")
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        return value.encode()
    return b""


def atomic_write_bytes(destination: Path, content: bytes, *, mode: int = 0o600) -> None:
    """Write a file and atomically publish it in the same directory."""

    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".partial",
            delete=False,
        ) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, destination)
        temporary = None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


class SnapshotBuilder:
    """Create DB dump, Git bundle, and manifest without stopping services."""

    def __init__(
        self,
        commands: CommandPort,
        *,
        project_root: Path = DEFAULT_PROJECT_ROOT,
        staging_root: Path = DEFAULT_STAGING_ROOT,
        policy: SourcePolicy | None = None,
        compose_file: Path | None = None,
        compose_command: Sequence[str] = ("docker", "compose"),
        database_service: str = "db",
        database_name: str = "borrow_return",
        database_user: str = "postgres",
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.commands = commands
        self.project_root = Path(project_root).absolute()
        self.staging_root = Path(staging_root).absolute()
        self.policy = policy or default_policy(self.project_root)
        self.compose_file = compose_file or (
            self.project_root / "infrastructure/docker/docker-compose.server.yml"
        )
        self.compose_command = tuple(compose_command)
        self.database_service = database_service
        self.database_name = database_name
        self.database_user = database_user
        self.clock = clock

    def prepare_staging_root(self) -> None:
        self.staging_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.staging_root, 0o700)

    def create_staging(self) -> Path:
        self.prepare_staging_root()
        stage = self.staging_root / (
            f"business-pi5-{self.clock().strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex}"
        )
        stage.mkdir(mode=0o700)
        atomic_write_bytes(stage / ".raspi-google-drive-dr-stage", b"business-pi5\n")
        return stage

    def cleanup_stale_staging(self, *, older_than_seconds: int = 48 * 60 * 60) -> int:
        """Remove only our own old stage directories under the staging root."""

        self.prepare_staging_root()
        now = self.clock().timestamp()
        removed = 0
        for candidate in tuple(self.staging_root.iterdir()):
            if not candidate.is_dir() or candidate.is_symlink():
                continue
            marker = candidate / ".raspi-google-drive-dr-stage"
            try:
                marker.stat()
                age = now - candidate.stat().st_mtime
                candidate.resolve().relative_to(self.staging_root.resolve())
            except (FileNotFoundError, OSError, ValueError):
                continue
            if age >= older_than_seconds:
                self._remove_owned_stage(candidate)
                removed += 1
        return removed

    def discard_staging(self, stage: Path) -> None:
        """Remove one stage only after ownership and containment checks."""

        self._remove_owned_stage(stage)

    def _remove_owned_stage(self, stage: Path) -> None:
        import shutil

        candidate = Path(stage)
        try:
            candidate.resolve().relative_to(self.staging_root.resolve())
            if not (candidate / ".raspi-google-drive-dr").exists() and not (
                candidate / ".raspi-google-drive-dr-stage"
            ).exists():
                return
        except (FileNotFoundError, OSError, ValueError):
            return
        shutil.rmtree(candidate)

    def build(self) -> SnapshotArtifact:
        """Build a new snapshot; callers decide whether to retain the stage."""

        try:
            selection = resolve(self.policy)
        except SourcePolicyError as error:
            raise SnapshotError("required recovery source is unavailable") from error

        stage = self.create_staging()
        try:
            database_dump = stage / "database" / f"{self.database_name}.dump"
            self._dump_postgres(database_dump)

            repository_sha = self._git_sha()
            worktree_dirty = self._git_dirty()
            git_bundle = stage / "git" / "repository.bundle"
            self._create_git_bundle(git_bundle)

            manifest = stage / "manifest.json"
            manifest_payload = self._manifest_payload(
                selection=selection,
                repository_sha=repository_sha,
                worktree_dirty=worktree_dirty,
                database_dump=database_dump,
                git_bundle=git_bundle,
            )
            atomic_write_bytes(
                manifest,
                (json.dumps(manifest_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(),
            )
            atomic_write_bytes(stage / "SNAPSHOT_COMPLETE", b"complete\n")
            upload_sources = tuple(
                source.path
                for source in selection.included
                if source.spec.category != "project-root"
            )
            total_bytes = path_usage((*upload_sources, stage))
            return SnapshotArtifact(
                staging_dir=stage,
                database_dump=database_dump,
                git_bundle=git_bundle,
                manifest=manifest,
                repository_sha=repository_sha,
                worktree_dirty=worktree_dirty,
                source_selection=selection,
                total_bytes=total_bytes,
            )
        except SnapshotError:
            self.discard_staging(stage)
            raise
        except (CommandError, OSError, ValueError) as error:
            self.discard_staging(stage)
            raise SnapshotError("snapshot construction failed") from error

    def _database_command(self) -> list[str]:
        return [
            *self.compose_command,
            "-f",
            str(self.compose_file),
            "exec",
            "-T",
            self.database_service,
            "pg_dump",
            "-U",
            self.database_user,
            "-d",
            self.database_name,
            "-Fc",
            "--no-owner",
            "--no-acl",
        ]

    def _dump_postgres(self, destination: Path) -> None:
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        partial = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.partial")
        try:
            with partial.open("wb") as output:
                os.chmod(partial, 0o600)
                self.commands.run(self._database_command(), stdout=output)
                output.flush()
                os.fsync(output.fileno())
            if partial.stat().st_size <= 0:
                raise SnapshotError("PostgreSQL dump was empty")
            os.replace(partial, destination)
        finally:
            try:
                partial.unlink()
            except FileNotFoundError:
                pass

    def _git_sha(self) -> str:
        result = self.commands.run(self._git_command("rev-parse", "HEAD"))
        value = _result_stdout(result).decode("utf-8", errors="replace").strip()
        if len(value) != 40 or any(character not in "0123456789abcdef" for character in value.lower()):
            raise SnapshotError("Git HEAD could not be identified")
        return value

    def _git_dirty(self) -> bool:
        result = self.commands.run(
            self._git_command(
                "status",
                "--porcelain",
                "--untracked-files=normal",
            )
        )
        return bool(_result_stdout(result).strip())

    def _git_command(self, *arguments: str) -> list[str]:
        """Build a Git command trusted only for the configured checkout."""

        return [
            "git",
            "-c",
            f"safe.directory={self.project_root}",
            "-C",
            str(self.project_root),
            *arguments,
        ]

    def _create_git_bundle(self, destination: Path) -> None:
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        partial = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.partial")
        try:
            self.commands.run(
                self._git_command(
                    "bundle",
                    "create",
                    str(partial),
                    "HEAD",
                )
            )
            if not partial.is_file() or partial.stat().st_size <= 0:
                raise SnapshotError("Git bundle was empty")
            # ``git bundle verify`` resolves refs from the current working
            # directory.  The service's WorkingDirectory is the deployment
            # directory, not necessarily this repository, so keep the
            # repository context explicit in argv.
            self.commands.run(
                self._git_command(
                    "bundle",
                    "verify",
                    str(partial),
                )
            )
            os.chmod(partial, 0o600)
            os.replace(partial, destination)
        finally:
            try:
                partial.unlink()
            except FileNotFoundError:
                pass

    def _manifest_payload(
        self,
        *,
        selection: SourceSelection,
        repository_sha: str,
        worktree_dirty: bool,
        database_dump: Path,
        git_bundle: Path,
    ) -> dict[str, object]:
        def stage_relative(path: Path) -> str:
            return path.relative_to(database_dump.parents[1]).as_posix()

        return {
            "schemaVersion": 1,
            "role": "business-pi5",
            "createdAt": self.clock().astimezone(timezone.utc).isoformat(),
            "repositorySha": repository_sha,
            "worktreeDirty": worktree_dirty,
            "warning": "git worktree contains uncommitted changes" if worktree_dirty else None,
            "database": {
                "format": "postgresql-custom",
                "dump": stage_relative(database_dump),
                "options": ["-Fc", "--no-owner", "--no-acl"],
                "bytes": database_dump.stat().st_size,
            },
            "git": {
                "bundle": stage_relative(git_bundle),
                "sha": repository_sha,
                "verified": True,
                "bytes": git_bundle.stat().st_size,
            },
            "sources": [
                {
                    "category": source.spec.category,
                    "path": relative_label(source.path, policy=self.policy),
                    "required": source.spec.required,
                }
                for source in selection.included
                if source.spec.category != "project-root"
            ],
            "missingOptionalCategories": [
                spec.category for spec in selection.missing_optional
            ],
            "excludedCategories": list(selection.excluded),
        }
