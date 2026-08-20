from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WRAPPER = ROOT / "scripts/ci/pnpm-exact.sh"
LOCK_FILES = (ROOT / "pnpm-lock.yaml", ROOT / "pnpm-workspace.yaml")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ExactPnpmToolchainTests(unittest.TestCase):
    def test_package_manager_and_engine_declare_the_same_exact_version(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["packageManager"], "pnpm@9.15.9")
        self.assertEqual(package["engines"]["pnpm"], "9.15.9")

    def test_path_pnpm_is_ignored_and_declared_exact_version_is_used(self) -> None:
        before = {path: sha256(path) for path in LOCK_FILES}
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "pnpm"
            marker = Path(directory) / "unexpected-pnpm-invocation"
            fake.write_text(
                '#!/usr/bin/env bash\ntouch "$FAKE_PNPM_MARKER"\necho 11.19.0\n',
                encoding="utf-8",
            )
            fake.chmod(0o755)
            environment = os.environ.copy()
            environment["PATH"] = f"{directory}:{environment['PATH']}"
            environment["FAKE_PNPM_MARKER"] = str(marker)
            result = subprocess.run(
                [str(WRAPPER), "--version"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "9.15.9")
        self.assertIn("pnpm=9.15.9", result.stderr)
        self.assertFalse(marker.exists())
        self.assertEqual(before, {path: sha256(path) for path in LOCK_FILES})

    def test_child_package_script_uses_the_same_exact_pnpm(self) -> None:
        result = subprocess.run(
            [str(WRAPPER), "exec", "sh", "-c", "pnpm --version"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("9.15.9", result.stdout)
        self.assertNotIn("11.19.0", result.stdout + result.stderr)

    def test_canonical_deploy_children_do_not_call_bare_pnpm(self) -> None:
        canonical_root = ROOT / "scripts/ci/run-deploy-contracts-local.sh"
        paths = [
            ROOT / ".husky/pre-commit",
            canonical_root,
            *sorted((ROOT / "scripts/deploy/tests").glob("*.sh")),
        ]
        pnpm_entrypoints: set[Path] = set()
        for path in paths:
            text = path.read_text(encoding="utf-8")
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertNotRegex(text, r"(?m)^\s*pnpm\b")
                if "pnpm" in text:
                    pnpm_entrypoints.add(path.relative_to(ROOT))
                    self.assertIn("scripts/ci/pnpm-exact.sh", text)
        self.assertEqual(
            pnpm_entrypoints,
            {
                Path(".husky/pre-commit"),
                Path("scripts/ci/run-deploy-contracts-local.sh"),
                Path("scripts/deploy/tests/test-deploy-status-postgres.sh"),
                Path("scripts/deploy/tests/test-google-drive-dr-postgres-restic-integration.sh"),
                Path("scripts/deploy/tests/test-postgres-role-boundaries.sh"),
                Path("scripts/deploy/tests/test-web-static-routing.sh"),
            },
        )


if __name__ == "__main__":
    unittest.main()
