"""Pure policy for the Business Pi 5 disaster-recovery source set.

This module describes *what* is eligible for the encrypted DR snapshot.  It
does not invoke Docker, PostgreSQL, restic, rclone, or a shell.  Filesystem
inspection is kept behind the small ``resolve``/``path_usage`` functions so
the policy itself can be exercised with ordinary temporary directories.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PROJECT_ROOT = Path("/opt/RaspberryPiSystem_002")
DEFAULT_CREDENTIAL_ROOT = Path("/etc/raspi-google-drive-dr")
DEFAULT_STAGING_ROOT = Path("/var/backups/raspi-google-drive-dr-staging")

# The names are logical categories rather than a recursive user-file list.
# This keeps the manifest useful for recovery without putting personal file
# names into logs or metadata.
REQUIRED_RELATIVE_SOURCES = (
    ("runtime-config", Path("config/backup.json")),
)

OPTIONAL_RELATIVE_SOURCES = (
    ("api-environment", Path("apps/api/.env")),
    ("web-environment", Path("apps/web/.env")),
    ("docker-environment", Path("infrastructure/docker/.env")),
    ("nfc-agent-environment", Path("clients/nfc-agent/.env")),
    ("certificates", Path("certs")),
    ("backup-ssh-authority", Path("secrets/backup-ssh")),
)

OPTIONAL_ABSOLUTE_SOURCES = (
    ("database-runtime-config", Path("/etc/raspi-database")),
    ("ansible-backup-boundary", Path("/etc/raspi-backup-ansible")),
    ("release-config", Path("/etc/raspi-release")),
    ("status-agent-config", Path("/etc/raspi-status-agent.conf")),
)

# These are the primary persistent file namespaces mounted by the production
# Compose file.  Each namespace is an independent source so a missing optional
# volume does not prevent DB/Git/config recovery.
PRIMARY_STORAGE_RELATIVE_SOURCES = (
    ("photos", Path("storage/photos")),
    ("pdfs", Path("storage/pdfs")),
    ("part-measurement-drawings", Path("storage/part-measurement-drawings")),
    ("assembly-procedure-images", Path("storage/assembly-procedure-images")),
    ("assembly-procedure-assets", Path("storage/assembly-procedure-assets")),
    ("measuring-instrument-genres", Path("storage/measuring-instrument-genres")),
    ("pallet-machine-illustrations", Path("storage/pallet-machine-illustrations")),
    ("csv-dashboards", Path("storage/csv-dashboards")),
    ("integrity-catalog", Path("storage/.integrity")),
)

# Patterns are passed to restic in addition to the explicit roots above.  The
# absolute forms protect against a future source being broadened accidentally;
# the basename forms protect a credential if a caller supplies a broad root.
RESTIC_EXCLUDES = (
    "**/thumbnails/**",
    "**/pdf-pages/**",
    "**/signage-rendered/**",
    "**/part-measurement-drawings-derivatives/**",
    "**/.cache/**",
    "**/cache/**",
    "**/logs/**",
    "**/*.log",
    "**/build/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/*.pid",
    "**/*.sock",
    "**/*.part",
    "**/.git/**",
    "**/.ssh/**",
    "**/.config/rclone/**",
    "**/token.json",
    "**/credentials.json",
    "**/client_secret*.json",
    "**/*oauth*.json",
    "**/docker-image/**",
    "**/docker-images/**",
    "**/db-data/**",
    "**/postgres-data/**",
    "/etc/raspi-google-drive-dr/rclone.conf",
    "/etc/raspi-google-drive-dr/restic-password",
    "**/raspi-google-drive-dr/rclone.conf",
    "**/raspi-google-drive-dr/restic-password",
    "**/restic-password",
    "**/restic-password*",
    "**/rclone.conf",
)

# These path names are checked before a path enters the restic command.  A
# caller cannot accidentally turn a secret root into a source merely by
# changing the configured project root.
EXCLUDED_RELATIVE_NAMES = (
    Path(".ssh"),
    Path("storage/thumbnails"),
    Path("storage/pdf-pages"),
    Path("storage/signage-rendered"),
    Path("storage/part-measurement-drawings-derivatives"),
    Path("storage/cache"),
    Path("storage/logs"),
    Path("node_modules"),
    Path("build"),
    Path("dist"),
    Path(".config/rclone"),
)


class SourcePolicyError(ValueError):
    """Raised when a required recovery source cannot be selected safely."""


@dataclass(frozen=True)
class SourceSpec:
    """A single logical recovery source.

    ``path`` is deliberately not expanded into individual files.  The
    category is what appears in the non-secret manifest; the data itself is
    read by restic from the root.
    """

    category: str
    path: Path
    required: bool = False


@dataclass(frozen=True)
class ResolvedSource:
    spec: SourceSpec
    path: Path


@dataclass(frozen=True)
class SourceSelection:
    included: tuple[ResolvedSource, ...]
    missing_optional: tuple[SourceSpec, ...]
    excluded: tuple[str, ...]

    @property
    def paths(self) -> tuple[Path, ...]:
        return tuple(source.path for source in self.included)

    @property
    def categories(self) -> tuple[str, ...]:
        return tuple(source.spec.category for source in self.included)


@dataclass(frozen=True)
class SourcePolicy:
    project_root: Path = DEFAULT_PROJECT_ROOT
    credential_root: Path = DEFAULT_CREDENTIAL_ROOT
    required_sources: tuple[SourceSpec, ...] = ()
    optional_sources: tuple[SourceSpec, ...] = ()

    def specs(self) -> tuple[SourceSpec, ...]:
        """Return stable, de-duplicated specs in manifest order."""

        result: list[SourceSpec] = []
        seen: set[Path] = set()
        for spec in (*self.required_sources, *self.optional_sources):
            resolved = _normalise(spec.path)
            if resolved in seen:
                continue
            seen.add(resolved)
            result.append(SourceSpec(spec.category, resolved, spec.required))
        return tuple(result)


def default_policy(
    project_root: Path = DEFAULT_PROJECT_ROOT,
    credential_root: Path = DEFAULT_CREDENTIAL_ROOT,
) -> SourcePolicy:
    """Build the Business Pi 5 policy for the supplied host paths."""

    project_root = _normalise(project_root)
    credential_root = _normalise(credential_root)
    required = [
        SourceSpec(category, project_root / relative, required=True)
        for category, relative in REQUIRED_RELATIVE_SOURCES
    ]
    # The project root itself is required because Git, config and storage all
    # use it as their recovery boundary.  It is not sent to restic directly.
    required.insert(0, SourceSpec("project-root", project_root, required=True))
    optional = [
        SourceSpec(category, project_root / relative)
        for category, relative in (*OPTIONAL_RELATIVE_SOURCES, *PRIMARY_STORAGE_RELATIVE_SOURCES)
    ]
    optional.extend(SourceSpec(category, path) for category, path in OPTIONAL_ABSOLUTE_SOURCES)
    return SourcePolicy(
        project_root=project_root,
        credential_root=credential_root,
        required_sources=tuple(required),
        optional_sources=tuple(optional),
    )


def _normalise(path: Path) -> Path:
    """Normalise lexical path components without requiring the path to exist."""

    return Path(os.path.normpath(str(path))).absolute()


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def is_excluded(path: Path, *, policy: SourcePolicy) -> bool:
    """Return whether a source root is forbidden by the policy."""

    candidate = _normalise(path)
    credential_root = _normalise(policy.credential_root)
    if _is_under(candidate, credential_root):
        return True
    project_root = _normalise(policy.project_root)
    if _is_under(candidate, project_root):
        relative = candidate.relative_to(project_root)
        if any(relative == excluded or excluded in relative.parents for excluded in EXCLUDED_RELATIVE_NAMES):
            return True
    name = candidate.name
    return name in {
        "restic-password",
        "rclone.conf",
        "token.json",
        "credentials.json",
        "client_secret.json",
    } or any(
        part == ".ssh" for part in candidate.parts
    )


def resolve(policy: SourcePolicy, *, exists: Callable[[Path], bool] = Path.exists) -> SourceSelection:
    """Resolve required and optional roots while preserving normal operation.

    Missing optional volumes become warnings for the caller.  A required
    source or an explicitly excluded source is an actual policy error because
    continuing would produce a snapshot that cannot be used for recovery.
    """

    included: list[ResolvedSource] = []
    missing_optional: list[SourceSpec] = []
    for spec in policy.specs():
        if is_excluded(spec.path, policy=policy):
            if spec.required:
                raise SourcePolicyError(f"required source is excluded: {spec.category}")
            missing_optional.append(spec)
            continue
        if exists(spec.path):
            included.append(ResolvedSource(spec, _normalise(spec.path)))
        elif spec.required:
            raise SourcePolicyError(f"required source is missing: {spec.category}")
        else:
            missing_optional.append(spec)
    return SourceSelection(
        included=tuple(included),
        missing_optional=tuple(missing_optional),
        excluded=tuple(spec.category for spec in policy.specs() if is_excluded(spec.path, policy=policy)),
    )


def path_usage(
    paths: Iterable[Path],
    *,
    stat: Callable[[Path], os.stat_result] = os.stat,
    walk: Callable[[str], tuple[list[str], list[str]]] | None = None,
) -> int:
    """Return a best-effort byte estimate without following changing errors."""

    total = 0
    for raw in paths:
        path = Path(raw)
        if path.is_file():
            try:
                total += int(stat(path).st_size)
            except (FileNotFoundError, PermissionError):
                continue
            continue
        if not path.is_dir():
            continue
        for current, directories, files in os.walk(path):
            # Do not descend into known derived or secret subtrees even if a
            # caller passed a broad project root.
            directories[:] = [
                name
                for name in directories
                if not is_excluded(Path(current) / name, policy=SourcePolicy(project_root=path))
            ]
            for name in files:
                candidate = Path(current) / name
                if is_excluded(candidate, policy=SourcePolicy(project_root=path)):
                    continue
                try:
                    total += int(stat(candidate).st_size)
                except (FileNotFoundError, PermissionError):
                    continue
    return total


def restic_excludes(policy: SourcePolicy) -> tuple[str, ...]:
    """Return stable restic patterns, including the configured secret root."""

    credential = _normalise(policy.credential_root).as_posix().rstrip("/")
    dynamic = (
        f"{credential}/rclone.conf",
        f"{credential}/restic-password",
    )
    return tuple(dict.fromkeys((*RESTIC_EXCLUDES, *dynamic)))


def relative_label(path: Path, *, policy: SourcePolicy) -> str:
    """Return a non-secret logical path label for a manifest entry."""

    candidate = _normalise(path)
    try:
        return candidate.relative_to(_normalise(policy.project_root)).as_posix()
    except ValueError:
        return candidate.as_posix()
