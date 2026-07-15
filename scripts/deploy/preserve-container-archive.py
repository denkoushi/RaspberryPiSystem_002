#!/usr/bin/env python3
"""Safely merge a container archive into an existing host directory."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import sys
import tarfile
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


class ArchivePreservationError(RuntimeError):
    """The archive or destination cannot be merged without data-loss risk."""


@dataclass(frozen=True)
class PreservationResult:
    copied: tuple[str, ...]
    skipped: tuple[str, ...]


def _validated_files(archive: tarfile.TarFile) -> list[tuple[tuple[str, ...], tarfile.TarInfo]]:
    entries: list[tuple[tuple[str, ...], tarfile.TarInfo]] = []
    entry_types: dict[tuple[str, ...], str] = {}

    for member in archive.getmembers():
        raw_name = member.name
        if "\x00" in raw_name:
            raise ArchivePreservationError("archive contains a NUL path")
        archive_name = PurePosixPath(raw_name)
        if archive_name.is_absolute() or ".." in archive_name.parts:
            raise ArchivePreservationError(f"unsafe archive path: {raw_name!r}")
        parts = tuple(part for part in archive_name.parts if part not in ("", "."))
        if not parts:
            if member.isdir():
                continue
            raise ArchivePreservationError("archive has an invalid root entry")
        if member.isdir():
            kind = "directory"
        elif member.isreg():
            kind = "file"
        else:
            raise ArchivePreservationError(
                f"archive contains a link or special file: {raw_name!r}"
            )
        if parts in entry_types:
            raise ArchivePreservationError(f"duplicate archive path: {raw_name!r}")
        entry_types[parts] = kind
        entries.append((parts, member))

    for parts, _member in entries:
        for depth in range(1, len(parts)):
            if entry_types.get(parts[:depth]) == "file":
                raise ArchivePreservationError(
                    f"archive file is used as a directory: {parts[:depth]!r}"
                )

    return [(parts, member) for parts, member in entries if member.isreg()]


class _Destination:
    def __init__(self, path: Path) -> None:
        if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
            raise ArchivePreservationError("secure directory descriptors are unavailable")
        self._nofollow = os.O_NOFOLLOW
        self._directory_flags = os.O_RDONLY | os.O_DIRECTORY | self._nofollow
        self._root_fd = self._open_or_create_path(path)
        root_status = os.fstat(self._root_fd)
        self._owner = (root_status.st_uid, root_status.st_gid)

    def _open_or_create_path(self, path: Path) -> int:
        absolute_path = Path(os.path.abspath(path))
        if absolute_path == Path("/"):
            raise ArchivePreservationError("destination cannot be the filesystem root")
        current_fd = os.open("/", self._directory_flags)
        try:
            for name in absolute_path.parts[1:]:
                if name in ("", ".", ".."):
                    raise ArchivePreservationError("destination path is malformed")
                created = False
                try:
                    next_fd = os.open(name, self._directory_flags, dir_fd=current_fd)
                except FileNotFoundError:
                    parent_status = os.fstat(current_fd)
                    try:
                        os.mkdir(name, 0o755, dir_fd=current_fd)
                        created = True
                    except FileExistsError:
                        pass
                    next_fd = os.open(name, self._directory_flags, dir_fd=current_fd)
                    if created:
                        os.fchown(next_fd, parent_status.st_uid, parent_status.st_gid)
                        os.fchmod(next_fd, 0o755)
                        os.fsync(next_fd)
                        os.fsync(current_fd)
                os.close(current_fd)
                current_fd = next_fd
            return current_fd
        except BaseException:
            os.close(current_fd)
            raise

    def close(self) -> None:
        os.close(self._root_fd)

    def open_directory(self, parts: tuple[str, ...]) -> int:
        current_fd = os.dup(self._root_fd)
        try:
            for name in parts:
                created = False
                try:
                    next_fd = os.open(name, self._directory_flags, dir_fd=current_fd)
                except FileNotFoundError:
                    try:
                        os.mkdir(name, 0o755, dir_fd=current_fd)
                        created = True
                    except FileExistsError:
                        pass
                    next_fd = os.open(name, self._directory_flags, dir_fd=current_fd)
                    if created:
                        os.fchown(next_fd, *self._owner)
                        os.fchmod(next_fd, 0o755)
                        os.fsync(next_fd)
                        os.fsync(current_fd)
                os.close(current_fd)
                current_fd = next_fd
            return current_fd
        except BaseException:
            os.close(current_fd)
            raise

    def existing_regular_file(self, parent_fd: int, name: str) -> bool:
        flags = os.O_RDONLY | self._nofollow | getattr(os, "O_NONBLOCK", 0)
        try:
            existing_fd = os.open(name, flags, dir_fd=parent_fd)
        except FileNotFoundError:
            return False
        try:
            if not stat.S_ISREG(os.fstat(existing_fd).st_mode):
                raise ArchivePreservationError(
                    f"destination collision is not a regular file: {name!r}"
                )
        finally:
            os.close(existing_fd)
        return True

    @staticmethod
    def _remove_temporary(
        parent_fd: int,
        temporary_name: str,
        identity: tuple[int, int],
    ) -> None:
        try:
            status = os.stat(temporary_name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if (status.st_dev, status.st_ino) != identity:
            raise ArchivePreservationError("temporary destination file was replaced")
        os.unlink(temporary_name, dir_fd=parent_fd)

    def publish(
        self,
        archive: tarfile.TarFile,
        member: tarfile.TarInfo,
        parts: tuple[str, ...],
    ) -> bool:
        parent_fd = self.open_directory(parts[:-1])
        temporary_name = f".container-archive-{uuid.uuid4().hex}.tmp"
        temporary_fd: int | None = None
        temporary_identity: tuple[int, int] | None = None
        try:
            if self.existing_regular_file(parent_fd, parts[-1]):
                return False

            temporary_fd = os.open(
                temporary_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | self._nofollow,
                0o600,
                dir_fd=parent_fd,
            )
            temporary_status = os.fstat(temporary_fd)
            temporary_identity = (temporary_status.st_dev, temporary_status.st_ino)
            source = archive.extractfile(member)
            if source is None:
                raise ArchivePreservationError(f"could not read archived file: {member.name!r}")
            with source, os.fdopen(temporary_fd, "wb", closefd=True) as output:
                temporary_fd = None
                shutil.copyfileobj(source, output)
                output.flush()
                os.fchmod(output.fileno(), 0o644)
                os.fchown(output.fileno(), *self._owner)
                os.fsync(output.fileno())

            try:
                os.link(
                    temporary_name,
                    parts[-1],
                    src_dir_fd=parent_fd,
                    dst_dir_fd=parent_fd,
                    follow_symlinks=False,
                )
            except FileExistsError:
                if not self.existing_regular_file(parent_fd, parts[-1]):
                    raise
                return False
            finally:
                self._remove_temporary(parent_fd, temporary_name, temporary_identity)
                temporary_identity = None
            os.fsync(parent_fd)
            return True
        finally:
            if temporary_fd is not None:
                os.close(temporary_fd)
            if temporary_identity is not None:
                self._remove_temporary(parent_fd, temporary_name, temporary_identity)
            os.close(parent_fd)


def preserve_archive(archive_path: Path, destination: Path) -> PreservationResult:
    copied: list[str] = []
    skipped: list[str] = []
    with tarfile.open(archive_path, mode="r:*") as archive:
        files = _validated_files(archive)
        if not files:
            return PreservationResult(copied=(), skipped=())
        target = _Destination(destination)
        try:
            for parts, member in files:
                relative_path = str(PurePosixPath(*parts))
                if target.publish(archive, member, parts):
                    copied.append(relative_path)
                else:
                    skipped.append(relative_path)
        finally:
            target.close()
    return PreservationResult(copied=tuple(copied), skipped=tuple(skipped))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Safely merge regular files from a container tar archive without overwrites."
    )
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        result = preserve_archive(arguments.archive, arguments.destination)
    except (ArchivePreservationError, OSError, tarfile.TarError) as error:
        print(f"[ERROR] container archive preservation failed: {error}", file=sys.stderr)
        return 1
    if not result.copied and not result.skipped:
        print("[INFO] container archive has no regular files; skip")
        return 0
    for relative_path in result.skipped:
        print(f"[SKIP] host already has {relative_path!r}")
    for relative_path in result.copied:
        print(f"[OK] preserved {relative_path!r}")
    print(
        f"[INFO] container archive preservation complete: "
        f"copied={len(result.copied)} skipped={len(result.skipped)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
