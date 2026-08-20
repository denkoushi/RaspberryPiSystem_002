"""Validate an isolated restic restore without touching a live application.

This boundary owns the restored tree's format and path checks.  It deliberately
does not know how a snapshot was uploaded or how a live database is switched
over; the runner only supplies the restored target and an injected command
port.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .command_port import CommandError, CommandPort
from .source_policy import DEFAULT_CREDENTIAL_ROOT, DEFAULT_STAGING_ROOT


class RestoreValidationError(RuntimeError):
    """Raised when the restored snapshot cannot be trusted for recovery."""


@dataclass(frozen=True)
class RestoreValidationResult:
    """Non-secret evidence produced by a successful isolated validation."""

    manifest_path: Path
    repository_sha: str
    database_dump: Path
    git_bundle: Path
    source_paths: tuple[Path, ...]


def _is_same_or_descendant(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


class RestoreValidator:
    """Validate manifest, all recorded sources, Git, and PostgreSQL dump."""

    def __init__(
        self,
        commands: CommandPort,
        *,
        project_root: Path,
        compose_file: Path,
        staging_root: Path = DEFAULT_STAGING_ROOT,
        credential_root: Path = DEFAULT_CREDENTIAL_ROOT,
        database_service: str = "db",
        pg_restore_binary: str = "pg_restore",
        compose_command: tuple[str, ...] = ("docker", "compose"),
    ) -> None:
        self.commands = commands
        self.project_root = Path(project_root).absolute()
        self.compose_file = Path(compose_file).absolute()
        self.staging_root = Path(staging_root).absolute()
        self.credential_root = Path(credential_root).absolute()
        self.database_service = database_service
        self.pg_restore_binary = pg_restore_binary
        self.compose_command = compose_command

    def preflight_target(self, target: Path) -> None:
        """Reject restore targets that resolve inside protected live roots.

        The target may not exist yet, so this deliberately uses
        ``strict=False``.  Resolving the candidate and each configured root
        catches a symlinked parent that would otherwise make an apparently
        isolated path write into live application or backup state.
        """

        try:
            resolved_target = Path(target).resolve(strict=False)
            protected_roots = (
                self.project_root,
                self.credential_root,
                self.staging_root,
            )
            resolved_roots = tuple(root.resolve(strict=False) for root in protected_roots)
        except (OSError, RuntimeError) as error:
            raise RestoreValidationError("restore target cannot be resolved safely") from error
        if any(_is_same_or_descendant(resolved_target, root) for root in resolved_roots):
            raise RestoreValidationError("restore target is inside a protected live root")

    def validate(self, target: Path) -> RestoreValidationResult:
        """Validate a newly restored target and return only safe metadata."""

        target = Path(target)
        if not target.is_dir():
            raise RestoreValidationError("restore target is not a directory")
        manifest_path = self._find_manifest(target)
        payload = self._load_manifest(manifest_path)
        repository_sha = self._validate_identity(payload)
        database_dump, git_bundle = self._validate_artifacts(manifest_path, payload)
        self._verify_git_bundle(git_bundle)
        self._validate_dump_format(database_dump)
        source_paths = self._validate_all_sources(target, payload)
        self._reject_excluded_material(target)
        return RestoreValidationResult(
            manifest_path=manifest_path,
            repository_sha=repository_sha,
            database_dump=database_dump,
            git_bundle=git_bundle,
            source_paths=source_paths,
        )

    def _find_manifest(self, target: Path) -> Path:
        restored_staging_root = target / str(self.staging_root).lstrip("/")
        if not restored_staging_root.is_dir():
            raise RestoreValidationError("restored DR staging root is missing")
        owned_stages: list[Path] = []
        try:
            candidates = tuple(restored_staging_root.iterdir())
        except OSError as error:
            raise RestoreValidationError("restored DR staging root cannot be inspected") from error
        for candidate in candidates:
            if not candidate.is_dir() or candidate.is_symlink():
                continue
            if not candidate.name.startswith("business-pi5-"):
                continue
            marker = candidate / ".raspi-google-drive-dr-stage"
            if not marker.is_file() or marker.is_symlink():
                continue
            owned_stages.append(candidate)
        if len(owned_stages) != 1:
            raise RestoreValidationError("exactly one owned DR stage is required")
        manifests = [candidate for candidate in owned_stages[0].rglob("manifest.json") if candidate.is_file()]
        if len(manifests) != 1:
            raise RestoreValidationError("exactly one DR manifest is required in owned stage")
        return manifests[0]

    @staticmethod
    def _load_manifest(manifest_path: Path) -> dict[str, Any]:
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise RestoreValidationError("DR manifest cannot be read") from error
        if not isinstance(payload, dict):
            raise RestoreValidationError("DR manifest must be an object")
        return payload

    @staticmethod
    def _validate_identity(payload: dict[str, Any]) -> str:
        if payload.get("schemaVersion") != 1 or payload.get("role") != "business-pi5":
            raise RestoreValidationError("DR manifest identity is invalid")
        repository_sha = str(payload.get("repositorySha", ""))
        if len(repository_sha) != 40 or any(
            character not in "0123456789abcdef" for character in repository_sha.lower()
        ):
            raise RestoreValidationError("DR manifest Git SHA is invalid")
        return repository_sha

    def _validate_artifacts(
        self,
        manifest_path: Path,
        payload: dict[str, Any],
    ) -> tuple[Path, Path]:
        database = payload.get("database")
        git = payload.get("git")
        if not isinstance(database, dict) or not isinstance(git, dict):
            raise RestoreValidationError("DR manifest artifact records are invalid")
        database_dump = self._safe_manifest_child(manifest_path.parent, database.get("dump"))
        git_bundle = self._safe_manifest_child(manifest_path.parent, git.get("bundle"))
        if (
            not database_dump.is_file()
            or not git_bundle.is_file()
            or database_dump.stat().st_size <= 0
            or git_bundle.stat().st_size <= 0
        ):
            raise RestoreValidationError("required DB dump or Git bundle is missing")
        return database_dump, git_bundle

    @staticmethod
    def _safe_manifest_child(parent: Path, raw_relative: object) -> Path:
        if not isinstance(raw_relative, str) or not raw_relative:
            raise RestoreValidationError("manifest artifact path is invalid")
        relative = Path(raw_relative)
        if relative.is_absolute():
            raise RestoreValidationError("manifest artifact path must be relative")
        candidate = (parent / relative).resolve()
        try:
            candidate.relative_to(parent.resolve())
        except ValueError as error:
            raise RestoreValidationError("manifest artifact path escapes staging") from error
        return candidate

    def _verify_git_bundle(self, git_bundle: Path) -> None:
        try:
            # A systemd invocation runs from the deployment directory, which
            # is not the source repository.  Bundle verification needs that
            # repository context even though the bundle itself is elsewhere.
            self.commands.run(
                [
                    "git",
                    "-c",
                    f"safe.directory={self.project_root}",
                    "-C",
                    str(self.project_root),
                    "bundle",
                    "verify",
                    str(git_bundle),
                ]
            )
        except (CommandError, OSError) as error:
            raise RestoreValidationError("Git bundle verification failed") from error

    def _validate_dump_format(self, database_dump: Path) -> None:
        # Custom-format PostgreSQL dumps begin with PGDMP.  Peek only at the
        # header; a production dump may be many gigabytes.
        try:
            with database_dump.open("rb") as stream:
                if stream.read(5) != b"PGDMP":
                    raise RestoreValidationError("PostgreSQL dump is not custom format")
        except OSError as error:
            raise RestoreValidationError("PostgreSQL dump cannot be read") from error
        try:
            self.commands.run([self.pg_restore_binary, "--list", str(database_dump)])
            return
        except (CommandError, FileNotFoundError, OSError):
            pass
        try:
            self.commands.run(
                [
                    *self.compose_command,
                    "-f",
                    str(self.compose_file),
                    "exec",
                    "-T",
                    self.database_service,
                    self.pg_restore_binary,
                    "--list",
                ],
                input_file=database_dump,
            )
        except (CommandError, OSError) as error:
            raise RestoreValidationError("PostgreSQL dump validation failed") from error

    def _validate_all_sources(
        self,
        target: Path,
        payload: dict[str, Any],
    ) -> tuple[Path, ...]:
        sources = payload.get("sources")
        if not isinstance(sources, list):
            raise RestoreValidationError("DR manifest sources are invalid")
        restored_project_root = target / str(self.project_root).lstrip("/")
        paths: list[Path] = []
        for source in sources:
            if (
                not isinstance(source, dict)
                or not isinstance(source.get("path"), str)
                or not source["path"]
            ):
                raise RestoreValidationError("DR manifest source record is invalid")
            raw_path = Path(source["path"])
            if raw_path.is_absolute():
                candidate = (target / str(raw_path).lstrip("/")).resolve()
                boundary = target.resolve()
            else:
                candidate = (restored_project_root / raw_path).resolve()
                boundary = restored_project_root.resolve()
            try:
                candidate.relative_to(boundary)
            except ValueError as error:
                raise RestoreValidationError("restored source path escapes its boundary") from error
            if not candidate.exists():
                # The required flag is intentionally not consulted.  The
                # manifest records what this snapshot selected, so every
                # recorded source must survive restore validation.
                raise RestoreValidationError("recorded recovery source is missing")
            paths.append(candidate)
        return tuple(paths)

    @staticmethod
    def _reject_excluded_material(target: Path) -> None:
        excluded_names = {
            "restic-password",
            "rclone.conf",
            "token.json",
            "credentials.json",
            "client_secret.json",
        }
        try:
            candidates = target.rglob("*")
            for candidate in candidates:
                if candidate.is_symlink():
                    try:
                        candidate.resolve().relative_to(target.resolve())
                    except ValueError as error:
                        raise RestoreValidationError("restored symlink escapes target") from error
                if candidate.name in excluded_names or ".ssh" in candidate.parts:
                    raise RestoreValidationError("credential or SSH home data appeared in restore")
                if ".config" in candidate.parts and "rclone" in candidate.parts:
                    raise RestoreValidationError("rclone OAuth data appeared in restore")
        except OSError as error:
            raise RestoreValidationError("restored tree cannot be inspected") from error
