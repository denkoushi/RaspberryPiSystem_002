from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from google_drive_dr.source_policy import (
    SourcePolicyError,
    default_policy,
    is_excluded,
    path_usage,
    resolve,
    restic_excludes,
)


class SourcePolicyTests(unittest.TestCase):
    def test_work_instruction_originals_are_selected_without_derived_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config").mkdir()
            (root / "config/backup.json").write_text("{}\n")
            asset_root = root / "storage/work-instruction-assets"
            asset_root.mkdir(parents=True)
            (asset_root / "original.jpeg").write_bytes(b"original")
            policy = default_policy(root, root / "credentials")
            selection = resolve(policy)
            self.assertIn("work-instruction-assets", selection.categories)
            self.assertIn(asset_root, selection.paths)
            self.assertFalse(is_excluded(asset_root, policy=policy))

    def test_required_config_and_optional_volumes_are_separated(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config").mkdir()
            (root / "config/backup.json").write_text("{}\n")
            (root / "storage/photos").mkdir(parents=True)
            (root / "storage/photos/photo.jpg").write_bytes(b"photo")
            policy = default_policy(root, root / "dr-credentials")

            selection = resolve(policy)

            self.assertIn("runtime-config", selection.categories)
            self.assertIn("photos", selection.categories)
            self.assertIn("api-environment", {item.category for item in selection.missing_optional})
            self.assertNotIn("project-root", selection.paths)

    def test_missing_required_source_fails_but_optional_missing_is_a_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.mkdir(exist_ok=True)
            policy = default_policy(root, root / "credentials")
            with self.assertRaises(SourcePolicyError):
                resolve(policy)

            (root / "config").mkdir()
            (root / "config/backup.json").write_text("{}\n")
            selection = resolve(policy)
            self.assertGreater(len(selection.missing_optional), 1)

    def test_credential_and_derived_paths_are_excluded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            policy = default_policy(root, root / "credentials")
            for candidate in (
                root / "credentials/restic-password",
                root / "credentials/rclone.conf",
                root / "token.json",
                root / ".config/rclone",
                root / ".ssh/id_ed25519",
                root / "storage/thumbnails",
                root / "storage/pdf-pages",
                root / "storage/part-measurement-drawings-derivatives",
            ):
                self.assertTrue(is_excluded(candidate, policy=policy), candidate)

            excludes = "\n".join(restic_excludes(policy))
            self.assertIn("restic-password", excludes)
            self.assertIn("rclone.conf", excludes)
            self.assertIn("thumbnails", excludes)
            self.assertIn("pdf-pages", excludes)

    def test_path_usage_ignores_derived_and_secret_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "storage/photos").mkdir(parents=True)
            (root / "storage/photos/primary.bin").write_bytes(b"primary")
            (root / "storage/thumbnails").mkdir(parents=True)
            (root / "storage/thumbnails/derived.bin").write_bytes(b"derived")
            (root / "rclone.conf").write_bytes(b"secret")

            self.assertEqual(path_usage((root,)), len(b"primary"))


if __name__ == "__main__":
    unittest.main()
