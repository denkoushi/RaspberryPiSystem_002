from __future__ import annotations

import importlib.util
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


HELPER = Path(__file__).resolve().parents[1] / "preserve-container-archive.py"
SPEC = importlib.util.spec_from_file_location("preserve_container_archive", HELPER)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def add_file(archive: tarfile.TarFile, name: str, payload: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(payload)
    archive.addfile(member, io.BytesIO(payload))


class PreserveContainerArchiveTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        # macOS exposes /var as a symlink. Resolve the trusted temporary root so
        # destination tests exercise the helper's no-symlink traversal itself.
        self.root = Path(self.temporary.name).resolve()
        self.destination = self.root / "destination"
        self.destination.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def archive(self, name: str, writer) -> Path:
        path = self.root / name
        with tarfile.open(path, "w") as archive:
            writer(archive)
        return path

    def test_copies_nested_regular_files_with_unusual_names(self) -> None:
        archive = self.archive(
            "normal.tar",
            lambda output: add_file(output, "./nested/image name\n.png", b"image"),
        )

        result = MODULE.preserve_archive(archive, self.destination)

        self.assertEqual(result.copied, ("nested/image name\n.png",))
        self.assertEqual(result.skipped, ())
        self.assertEqual(
            (self.destination / "nested" / "image name\n.png").read_bytes(),
            b"image",
        )

    def test_existing_regular_file_is_never_overwritten(self) -> None:
        existing = self.destination / "existing.png"
        existing.write_bytes(b"host-authoritative")
        archive = self.archive(
            "existing.tar",
            lambda output: add_file(output, "./existing.png", b"container-old"),
        )

        result = MODULE.preserve_archive(archive, self.destination)

        self.assertEqual(result.copied, ())
        self.assertEqual(result.skipped, ("existing.png",))
        self.assertEqual(existing.read_bytes(), b"host-authoritative")

    def test_missing_destination_tree_is_created_without_following_links(self) -> None:
        destination = self.root / "missing" / "nested"
        archive = self.archive(
            "missing-destination.tar",
            lambda output: add_file(output, "./image.png", b"image"),
        )

        result = MODULE.preserve_archive(archive, destination)

        self.assertEqual(result.copied, ("image.png",))
        self.assertEqual((destination / "image.png").read_bytes(), b"image")

    def test_missing_destination_below_symlink_is_rejected(self) -> None:
        outside = self.root / "outside-directory"
        outside.mkdir()
        linked_parent = self.root / "linked-parent"
        linked_parent.symlink_to(outside, target_is_directory=True)
        destination = linked_parent / "destination"
        archive = self.archive(
            "linked-destination.tar",
            lambda output: add_file(output, "./image.png", b"image"),
        )

        with self.assertRaises(OSError):
            MODULE.preserve_archive(archive, destination)

        self.assertFalse((outside / "destination").exists())

    def test_path_traversal_rejects_the_entire_archive_before_copy(self) -> None:
        def write_archive(output: tarfile.TarFile) -> None:
            add_file(output, "./would-have-been-safe.png", b"safe")
            add_file(output, "../escape.png", b"escape")

        archive = self.archive("traversal.tar", write_archive)

        with self.assertRaisesRegex(MODULE.ArchivePreservationError, "unsafe archive path"):
            MODULE.preserve_archive(archive, self.destination)

        self.assertEqual(list(self.destination.iterdir()), [])
        self.assertFalse((self.root / "escape.png").exists())

    def test_symlink_hardlink_and_special_file_are_rejected(self) -> None:
        cases = (
            ("symlink", tarfile.SYMTYPE, "/etc/passwd"),
            ("hardlink", tarfile.LNKTYPE, "other.png"),
            ("fifo", tarfile.FIFOTYPE, ""),
        )
        for label, member_type, link_name in cases:
            with self.subTest(label=label):
                def write_archive(output: tarfile.TarFile) -> None:
                    member = tarfile.TarInfo(f"./{label}")
                    member.type = member_type
                    member.linkname = link_name
                    output.addfile(member)

                archive = self.archive(f"{label}.tar", write_archive)
                with self.assertRaisesRegex(
                    MODULE.ArchivePreservationError,
                    "link or special file",
                ):
                    MODULE.preserve_archive(archive, self.destination)
                self.assertEqual(list(self.destination.iterdir()), [])

    def test_duplicate_normalized_path_is_rejected_before_copy(self) -> None:
        def write_archive(output: tarfile.TarFile) -> None:
            add_file(output, "image.png", b"first")
            add_file(output, "./image.png", b"second")

        archive = self.archive("duplicate.tar", write_archive)

        with self.assertRaisesRegex(MODULE.ArchivePreservationError, "duplicate archive path"):
            MODULE.preserve_archive(archive, self.destination)

        self.assertEqual(list(self.destination.iterdir()), [])

    def test_destination_symlink_collision_fails_closed(self) -> None:
        outside = self.root / "outside.png"
        outside.write_bytes(b"outside")
        (self.destination / "image.png").symlink_to(outside)
        archive = self.archive(
            "destination-symlink.tar",
            lambda output: add_file(output, "./image.png", b"container"),
        )

        with self.assertRaises(OSError):
            MODULE.preserve_archive(archive, self.destination)

        self.assertEqual(outside.read_bytes(), b"outside")

    def test_empty_archive_is_a_noop(self) -> None:
        archive = self.archive("empty.tar", lambda _output: None)

        result = MODULE.preserve_archive(archive, self.destination)

        self.assertEqual(result, MODULE.PreservationResult(copied=(), skipped=()))


if __name__ == "__main__":
    unittest.main()
