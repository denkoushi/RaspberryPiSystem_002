import os
import fcntl
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


DEPLOY_DIRECTORY = Path(__file__).parents[1]
if str(DEPLOY_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIRECTORY))

from rolling_release.lock import InheritedReleaseLockError, validate_inherited_release_lock


class InheritedReleaseLockTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name)
        (self.project / ".git").mkdir()
        self.path = self.project / ".git/rolling-release.lock"

    def tearDown(self):
        self.temporary.cleanup()

    def _environment(self, descriptor: int, path: Path | None = None):
        return {
            "ROLLING_RELEASE_LOCK_FD": str(descriptor),
            "ROLLING_RELEASE_LOCK_PATH": str(path or self.path),
        }

    def test_matching_regular_descriptor_is_locked_and_made_non_inheritable(self):
        descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.set_inheritable(descriptor, True)
            with patch.dict(os.environ, self._environment(descriptor), clear=True):
                self.assertEqual(validate_inherited_release_lock(self.project), descriptor)
            self.assertFalse(os.get_inheritable(descriptor))
        finally:
            os.close(descriptor)

    def test_matching_but_unlocked_descriptor_is_rejected(self):
        descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            with patch.dict(os.environ, self._environment(descriptor), clear=True):
                with self.assertRaisesRegex(InheritedReleaseLockError, "not already locked"):
                    validate_inherited_release_lock(self.project)
        finally:
            os.close(descriptor)

    def test_missing_or_closed_descriptor_fails_before_state_use(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(InheritedReleaseLockError, "descriptor"):
                validate_inherited_release_lock(self.project)

        descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        os.close(descriptor)
        with patch.dict(os.environ, self._environment(descriptor), clear=True):
            with self.assertRaisesRegex(InheritedReleaseLockError, "unavailable"):
                validate_inherited_release_lock(self.project)

    def test_wrong_inode_and_forged_path_are_rejected(self):
        other = self.project / ".git/other.lock"
        descriptor = os.open(other, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            self.path.touch()
            with patch.dict(os.environ, self._environment(descriptor), clear=True):
                with self.assertRaisesRegex(InheritedReleaseLockError, "does not match"):
                    validate_inherited_release_lock(self.project)
            with patch.dict(os.environ, self._environment(descriptor, other), clear=True):
                with self.assertRaisesRegex(InheritedReleaseLockError, "path does not match"):
                    validate_inherited_release_lock(self.project)
        finally:
            os.close(descriptor)

    def test_symlink_lock_path_is_rejected(self):
        target = self.project / ".git/target.lock"
        descriptor = os.open(target, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            self.path.symlink_to(target.name)
            with patch.dict(os.environ, self._environment(descriptor), clear=True):
                with self.assertRaisesRegex(InheritedReleaseLockError, "regular files"):
                    validate_inherited_release_lock(self.project)
        finally:
            os.close(descriptor)


if __name__ == "__main__":
    unittest.main()
