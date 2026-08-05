from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


DEPLOY_DIR = Path(__file__).resolve().parents[1]
SCRIPT = DEPLOY_DIR / "terminal-source-bundle.py"
SPEC = importlib.util.spec_from_file_location("terminal_source_bundle", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
source_bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source_bundle)
PROJECT = DEPLOY_DIR.parents[1]


def git(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", os.fspath(repository), *arguments],
        check=True,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        },
    )
    return result.stdout.strip()


class TerminalSourceBundleTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "source"
        self.terminal = self.root / "terminal"
        self.staging = self.root / "staging"
        self.source.mkdir()
        self.staging.mkdir()
        git(self.source, "init", "-q")
        git(self.source, "config", "user.name", "Test")
        git(self.source, "config", "user.email", "test@example.invalid")
        (self.source / "value.txt").write_text("common\n", encoding="utf-8")
        git(self.source, "add", "value.txt")
        git(self.source, "commit", "-qm", "common")
        self.common_sha = git(self.source, "rev-parse", "HEAD")
        (self.source / "value.txt").write_text("previous\n", encoding="utf-8")
        git(self.source, "commit", "-qam", "previous")
        self.previous_sha = git(self.source, "rev-parse", "HEAD")
        subprocess.run(
            ["git", "clone", "-q", os.fspath(self.source), os.fspath(self.terminal)],
            check=True,
        )
        (self.source / "value.txt").write_text("candidate\n", encoding="utf-8")
        git(self.source, "commit", "-qam", "candidate")
        self.candidate_sha = git(self.source, "rev-parse", "HEAD")
        self.bundle = self.root / "candidate.bundle"
        git(
            self.source,
            "bundle",
            "create",
            os.fspath(self.bundle),
            "HEAD",
            f"^{self.previous_sha}",
        )
        self.run_id = "source-test-001"
        self.temporary_path, self.final_path = source_bundle.source_paths(
            self.staging, self.run_id
        )
        shutil.copyfile(self.bundle, self.temporary_path)
        self.temporary_path.chmod(0o600)
        self.size = self.temporary_path.stat().st_size
        self.digest = source_bundle._sha256(self.temporary_path)

    def tearDown(self):
        self.temporary.cleanup()

    def args(self, **overrides):
        values = {
            "repository": self.terminal,
            "staging_root": self.staging,
            "run_id": self.run_id,
            "host": "raspberrypi3",
            "previous_sha": self.previous_sha,
            "candidate_sha": self.candidate_sha,
            "sha256": self.digest,
            "size": self.size,
            "ansible_marker": False,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_candidate_absent_checkout_imports_only_the_verified_local_bundle(self):
        with self.assertRaises(subprocess.CalledProcessError):
            git(self.terminal, "cat-file", "-e", f"{self.candidate_sha}^{{commit}}")
        git(
            self.terminal,
            "config",
            "remote.origin.url",
            "https://127.0.0.1:9/external-transport-forbidden.git",
        )

        self.assertEqual(source_bundle.preflight(self.args())["state"], "temporary-ready")
        self.assertEqual(source_bundle.promote(self.args())["state"], "ready")
        self.assertEqual(source_bundle.preflight(self.args())["state"], "ready")
        self.assertEqual(source_bundle.verify(self.args())["state"], "ready")
        self.assertEqual(source_bundle.consume(self.args())["state"], "consumed")

        self.assertEqual(git(self.terminal, "rev-parse", "HEAD"), self.candidate_sha)
        self.assertEqual(git(self.terminal, "status", "--porcelain=v1"), "")
        self.assertFalse(self.temporary_path.exists())
        self.assertFalse(self.final_path.exists())

    def test_divergent_candidate_preserves_exact_sha_reset_semantics(self):
        git(self.source, "checkout", "-q", "-b", "divergent", self.common_sha)
        (self.source / "value.txt").write_text("divergent\n", encoding="utf-8")
        git(self.source, "commit", "-qam", "divergent candidate")
        divergent_sha = git(self.source, "rev-parse", "HEAD")
        divergent_bundle = self.root / "divergent.bundle"
        git(
            self.source,
            "bundle",
            "create",
            os.fspath(divergent_bundle),
            "HEAD",
            f"^{self.previous_sha}",
        )
        shutil.copyfile(divergent_bundle, self.temporary_path)
        self.temporary_path.chmod(0o600)
        arguments = self.args(
            candidate_sha=divergent_sha,
            sha256=source_bundle._sha256(self.temporary_path),
            size=self.temporary_path.stat().st_size,
        )

        source_bundle.preflight(arguments)
        source_bundle.promote(arguments)
        source_bundle.consume(arguments)

        self.assertEqual(git(self.terminal, "rev-parse", "HEAD"), divergent_sha)
        self.assertEqual(git(self.terminal, "status", "--porcelain=v1"), "")

    def test_corruption_fails_before_repository_or_runtime_state_and_cleanup_repeats(self):
        service = self.root / "service.state"
        display = self.root / "display.jpg"
        service.write_bytes(b"active")
        display.write_bytes(b"display-ok")
        before = {
            "head": git(self.terminal, "rev-parse", "HEAD"),
            "status": git(self.terminal, "status", "--porcelain=v1"),
            "index": git(self.terminal, "ls-files", "-s"),
            "service": service.read_bytes(),
            "display": display.read_bytes(),
        }
        with self.temporary_path.open("ab") as stream:
            stream.write(b"corruption")

        with self.assertRaisesRegex(source_bundle.SourceBundleError, "size"):
            source_bundle.promote(self.args())
        self.assertEqual(source_bundle.cleanup(self.args())["removed"], 1)
        self.assertEqual(source_bundle.cleanup(self.args())["removed"], 0)
        self.assertEqual(git(self.terminal, "rev-parse", "HEAD"), before["head"])
        self.assertEqual(git(self.terminal, "status", "--porcelain=v1"), before["status"])
        self.assertEqual(git(self.terminal, "ls-files", "-s"), before["index"])
        self.assertEqual(service.read_bytes(), before["service"])
        self.assertEqual(display.read_bytes(), before["display"])
        self.assertFalse(self.temporary_path.exists())
        self.assertFalse(self.final_path.exists())

    def test_binding_file_and_capacity_mutations_fail_closed(self):
        mutations = {
            "digest": {"sha256": "0" * 64},
            "candidate": {"candidate_sha": "f" * 40},
            "previous": {"previous_sha": "e" * 40},
            "size": {"size": self.size + 1},
            "maximum": {"size": source_bundle.MAX_BUNDLE_BYTES + 1},
            "host": {"host": "bad host"},
            "run": {"run_id": "x"},
        }
        for name, values in mutations.items():
            with self.subTest(name=name):
                with self.assertRaises(source_bundle.SourceBundleError):
                    source_bundle.preflight(self.args(**values))

        self.temporary_path.unlink()
        self.temporary_path.symlink_to(self.bundle)
        with self.assertRaisesRegex(source_bundle.SourceBundleError, "regular file"):
            source_bundle.preflight(self.args())

    def test_cleanup_does_not_depend_on_repository_readability(self):
        git_directory = self.terminal / ".git"
        unavailable = self.terminal / ".git-unavailable"
        os.replace(git_directory, unavailable)
        try:
            self.assertEqual(source_bundle.cleanup(self.args())["removed"], 1)
            self.assertEqual(source_bundle.cleanup(self.args())["removed"], 0)
        finally:
            os.replace(unavailable, git_directory)

    def test_execution_contract_forbids_remote_protocol_and_pi3_fallback(self):
        helper = SCRIPT.read_text(encoding="utf-8")
        signage_preparation = (
            PROJECT
            / "infrastructure/ansible/roles/signage/tasks/release-preparation.yml"
        ).read_text(encoding="utf-8")
        common = (
            PROJECT / "infrastructure/ansible/roles/common/tasks/main.yml"
        ).read_text(encoding="utf-8")
        playbook = (
            PROJECT / "infrastructure/ansible/playbooks/deploy-signage-staged.yml"
        ).read_text(encoding="utf-8")
        require = signage_preparation.index(
            "Validate sealed signage release mutation profile"
        )
        clean_check = signage_preparation.index(
            "Verify signage repository is clean and capture current HEAD"
        )
        local_import = signage_preparation.index(
            "Import and reset Pi3 repository from the verified local bundle"
        )
        self.assertLess(require, clean_check)
        self.assertLess(clean_check, local_import)
        self.assertNotIn("git fetch", signage_preparation)
        self.assertNotIn("origin", signage_preparation)
        self.assertIn("git fetch --no-tags origin", common)
        self.assertNotIn("terminal_staged_source", common)
        self.assertIn("tasks_from: release-preparation", playbook)
        self.assertIn('"protocol.allow=never"', helper)
        self.assertIn('"protocol.file.allow=always"', helper)
        consume = helper[helper.index("def consume(") : helper.index("def cleanup(")]
        self.assertNotIn("origin", consume)
        self.assertNotIn("http", consume.lower())


if __name__ == "__main__":
    unittest.main()
