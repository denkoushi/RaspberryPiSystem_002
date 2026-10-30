from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
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
        self.assertEqual(package["packageManager"], "pnpm@12.16.1")
        self.assertEqual(package["engines"]["pnpm"], "12.16.1")

    def run_wrapper(self, *arguments: str, version: str | None = None,
                    missing: bool = False, broken: bool = False,
                    relative_path: bool = False) -> subprocess.CompletedProcess[str]:
        expected = json.loads((ROOT / "package.json").read_text())["packageManager"].split("@")[1]
        before = {path: sha256(path) for path in LOCK_FILES}
        with tempfile.TemporaryDirectory() as directory:
            tools = Path(directory)
            # Isolate PATH so no real pnpm/Corepack or network is needed.
            for command in ("bash", "node", "python3", "mktemp", "chmod", "rm", "sh", "dirname", "env"):
                executable = sys.executable if command == "python3" else shutil.which(command)
                self.assertIsNotNone(executable, command)
                (tools / command).symlink_to(executable)
            if not missing:
                fake = tools / "pnpm"
                fake.write_text(
                    '#!/usr/bin/env bash\n'
                    'if [[ "$1" == --version ]]; then\n'
                    '  [[ "$FAKE_PNPM_BROKEN" == 1 ]] && exit 1\n'
                    '  echo "$FAKE_PNPM_VERSION"; exit 0\n'
                    'fi\n'
                    '[[ "$CI" == true ]] || exit 3\n'
                    'if [[ "$1" == exec ]]; then shift; exec "$@"; fi\n'
                    'printf "%s\\n" "$@"\n',
                    encoding="utf-8",
                )
                fake.chmod(0o755)
            environment = os.environ.copy()
            environment["PATH"] = f"{os.path.relpath(tools, ROOT)}:{os.defpath}" if relative_path else str(tools)
            environment["FAKE_PNPM_VERSION"] = version if version is not None else expected
            environment["FAKE_PNPM_BROKEN"] = "1" if broken else "0"
            result = subprocess.run(
                [str(WRAPPER), *arguments], cwd=ROOT, env=environment,
                capture_output=True, text=True, check=False,
            )
        self.assertEqual(before, {path: sha256(path) for path in LOCK_FILES})
        return result

    def test_path_pnpm_matching_declared_exact_version_is_used(self) -> None:
        result = self.run_wrapper("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "12.16.1")
        self.assertIn("pnpm=12.16.1", result.stderr)

    def test_missing_mismatched_and_broken_pnpm_fail_with_install_hint(self) -> None:
        for options in ({"missing": True}, {"version": "11.19.0"},
                        {"version": "12.16.1-extra"}, {"broken": True}):
            with self.subTest(options=options):
                result = self.run_wrapper("install", **options)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertIn("npm install -g pnpm@12.16.1", result.stderr)

    def test_child_package_script_uses_the_same_exact_pnpm(self) -> None:
        result = self.run_wrapper("exec", "sh", "-c", "pnpm --version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "12.16.1")

    def test_relative_path_pnpm_is_absolute_in_child_shim(self) -> None:
        result = self.run_wrapper(
            "exec", "/bin/sh", "-c", "cd / && pnpm --version", relative_path=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "12.16.1")

    def test_install_forces_frozen_lockfile_and_preserves_arguments(self) -> None:
        result = self.run_wrapper("install", "--filter", "package with spaces")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(),
                         ["install", "--filter", "package with spaces", "--frozen-lockfile"])
        result = self.run_wrapper("install", "--frozen-lockfile")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["install", "--frozen-lockfile"])
        result = self.run_wrapper("install", "--no-frozen-lockfile")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("may not disable the frozen lockfile contract", result.stderr)

    def test_docker_pnpm_install_reads_package_manager(self) -> None:
        for name, count in (("api", 2), ("web", 1), ("kiosk-sop-generator", 1)):
            with self.subTest(image=name):
                text = (ROOT / f"infrastructure/docker/Dockerfile.{name}").read_text()
                self.assertEqual(text.count(
                    "npm install -g \"$(node -p \"require('./package.json').packageManager\")\""
                ), count)
                self.assertNotIn("corepack", text.lower())
                self.assertNotIn("pnpm@12.16.1", text)

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
