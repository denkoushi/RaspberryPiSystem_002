import subprocess
import tempfile
import unittest
from pathlib import Path


REVERT_SCRIPT = Path(__file__).resolve().parents[1] / "revert_firmware_overlays.py"


class RevertFirmwareOverlaysTests(unittest.TestCase):
    def test_refuses_dirty_clone_without_force(self):
        with tempfile.TemporaryDirectory() as tmp:
            clone = Path(tmp) / "clone"
            clone.mkdir()
            clone_s = str(clone)
            subprocess.run(["git", "init", "-q"], cwd=clone_s, check=True)
            subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=clone_s, check=True)
            subprocess.run(["git", "config", "user.name", "test"], cwd=clone_s, check=True)
            target = clone / "firmware/src/llm/ChatGPT/ChatGPT.cpp"
            target.parent.mkdir(parents=True)
            target.write_text("// original\n", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=clone_s, check=True)
            subprocess.run(["git", "commit", "-qm", "init"], cwd=clone_s, check=True)
            target.write_text("// local edit\n", encoding="utf-8")

            result = subprocess.run(
                ["python3", str(REVERT_SCRIPT), str(clone)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("Refusing to revert", result.stderr)

    def test_force_clean_allows_dirty_revert(self):
        with tempfile.TemporaryDirectory() as tmp:
            clone = Path(tmp) / "clone"
            clone.mkdir()
            clone_s = str(clone)
            subprocess.run(["git", "init", "-q"], cwd=clone_s, check=True)
            subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=clone_s, check=True)
            subprocess.run(["git", "config", "user.name", "test"], cwd=clone_s, check=True)
            target = clone / "firmware/src/llm/ChatGPT/ChatGPT.cpp"
            target.parent.mkdir(parents=True)
            target.write_text("// original\n", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=clone_s, check=True)
            subprocess.run(["git", "commit", "-qm", "init"], cwd=clone_s, check=True)
            target.write_text("// local edit\n", encoding="utf-8")

            result = subprocess.run(
                ["python3", str(REVERT_SCRIPT), "--force-clean", str(clone)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertEqual(target.read_text(encoding="utf-8"), "// original\n")


if __name__ == "__main__":
    unittest.main()
