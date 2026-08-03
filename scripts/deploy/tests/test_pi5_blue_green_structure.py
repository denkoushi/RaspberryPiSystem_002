from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
ENTRYPOINT = ROOT / "scripts/deploy/pi5-blue-green.sh"
MODULE_DIR = ROOT / "scripts/deploy/lib/pi5-blue-green"
EXPECTED_MODULES = [
    "policy.sh",
    "state.sh",
    "images-evidence.sh",
    "runtime.sh",
    "legacy.sh",
    "migrations.sh",
    "lifecycle.sh",
    "cleanup-reconcile.sh",
    "status.sh",
]
FUNCTION_START = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\(\) \{")
HEREDOC_START = re.compile(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?")


@dataclass(frozen=True)
class FunctionDefinition:
    name: str
    start: int
    end: int

    @property
    def line_count(self) -> int:
        return self.end - self.start + 1


def parse_functions(path: Path) -> tuple[list[str], list[FunctionDefinition]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    definitions: list[FunctionDefinition] = []
    index = 0
    while index < len(lines):
        match = FUNCTION_START.match(lines[index])
        if match is None:
            index += 1
            continue
        start = index
        if re.search(r";\s*}\s*$", lines[index]):
            definitions.append(FunctionDefinition(match.group(1), start, start))
            index += 1
            continue
        heredoc: str | None = None
        index += 1
        while index < len(lines):
            line = lines[index]
            if heredoc is not None:
                if line == heredoc:
                    heredoc = None
                index += 1
                continue
            heredoc_match = HEREDOC_START.search(line)
            if heredoc_match is not None:
                heredoc = heredoc_match.group(1)
                index += 1
                continue
            if line == "}":
                definitions.append(
                    FunctionDefinition(match.group(1), start, index)
                )
                index += 1
                break
            index += 1
        else:
            raise AssertionError(f"unterminated function in {path}: {match.group(1)}")
    return lines, definitions


class Pi5BlueGreenStructureTest(unittest.TestCase):
    def module_paths(self) -> list[Path]:
        return [MODULE_DIR / name for name in EXPECTED_MODULES]

    def test_entrypoint_and_module_file_set_are_bounded(self) -> None:
        self.assertEqual(
            [path.name for path in sorted(MODULE_DIR.glob("*.sh"))],
            sorted(EXPECTED_MODULES),
        )
        self.assertLessEqual(
            len(ENTRYPOINT.read_text(encoding="utf-8").splitlines()), 350
        )
        for path in self.module_paths():
            with self.subTest(module=path.name):
                self.assertLessEqual(
                    len(path.read_text(encoding="utf-8").splitlines()), 500
                )
                self.assertFalse(path.stat().st_mode & 0o111)

    def test_functions_are_unique_and_bounded(self) -> None:
        definitions: list[tuple[Path, FunctionDefinition]] = []
        for path in [ENTRYPOINT, *self.module_paths()]:
            _, parsed = parse_functions(path)
            definitions.extend((path, definition) for definition in parsed)
        counts = Counter(definition.name for _, definition in definitions)
        self.assertEqual(
            [name for name, count in counts.items() if count != 1], [], counts
        )
        oversized = [
            f"{path.name}:{definition.name}:{definition.line_count}"
            for path, definition in definitions
            if definition.line_count > 120
        ]
        self.assertEqual(oversized, [])

    def test_modules_contain_only_comments_and_function_definitions(self) -> None:
        for path in self.module_paths():
            lines, definitions = parse_functions(path)
            covered: set[int] = set()
            for definition in definitions:
                covered.update(range(definition.start, definition.end + 1))
            top_level_commands = [
                f"{number + 1}:{line}"
                for number, line in enumerate(lines)
                if number not in covered and line.strip() and not line.startswith("#")
            ]
            with self.subTest(module=path.name):
                self.assertEqual(top_level_commands, [])
                self.assertNotRegex(
                    path.read_text(encoding="utf-8"),
                    r"(?m)^\s*(?:source|\.)\s+",
                )
                loaded = subprocess.run(
                    [
                        "bash",
                        "-euo",
                        "pipefail",
                        "-c",
                        'source "$1"',
                        "pi5-blue-green-structure",
                        str(path),
                    ],
                    cwd=ROOT,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(loaded.returncode, 0, loaded.stderr)
                self.assertEqual(loaded.stdout, "")
                self.assertEqual(loaded.stderr, "")

    def test_entrypoint_owns_fixed_module_loading_and_dispatch(self) -> None:
        text = ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn(
            'SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/'
            '$(basename "${BASH_SOURCE[0]}")"',
            text,
        )
        self.assertIn('SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"', text)
        loaded = re.findall(
            r'^source "\$SCRIPT_DIR/lib/pi5-blue-green/([^"/]+)"$',
            text,
            flags=re.MULTILINE,
        )
        self.assertEqual(loaded, EXPECTED_MODULES)
        self.assertIn(
            "status|bootstrap|prepare|switch|rollback|cleanup|reconcile|monitor|"
            "seal-image-ids|migration-ledger|restart-monitor",
            text,
        )
        self.assertIn("status) ;;", text)
        self.assertIn("*)", text)
        self.assertIn("flock -n 9", text)

    def test_supported_callers_use_the_public_entrypoint(self) -> None:
        rolling = (ROOT / "scripts/deploy/rolling-release.py").read_text(
            encoding="utf-8"
        )
        backend = (
            ROOT / "scripts/deploy/rolling_release/backends/pi5.py"
        ).read_text(encoding="utf-8")
        evidence = (
            ROOT / "scripts/deploy/pi5-live-migration-evidence.sh"
        ).read_text(encoding="utf-8")
        reconcile = (
            ROOT
            / "infrastructure/ansible/templates/pi5-blue-green-reconcile.service.j2"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'PHASE3 = PROJECT / "scripts/deploy/pi5-blue-green.sh"', rolling
        )
        self.assertIn('[str(runtime.PHASE3), "seal-image-ids"]', backend)
        self.assertIn('[str(runtime.PHASE3), "restart-monitor"]', backend)
        self.assertIn(
            'PHASE3="${PI5_PHASE3_SCRIPT:-${SCRIPT_DIR}/pi5-blue-green.sh}"',
            evidence,
        )
        self.assertIn('"$PHASE3" migration-ledger', evidence)
        self.assertIn("/scripts/deploy/pi5-blue-green.sh reconcile", reconcile)
        for path in self.module_paths():
            self.assertNotIn(str(path.relative_to(ROOT)), rolling + backend + evidence)


if __name__ == "__main__":
    unittest.main()
