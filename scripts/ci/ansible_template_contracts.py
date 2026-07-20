#!/usr/bin/env python3
"""Fail-closed source validation for every repository Ansible Jinja template."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from jinja2 import Environment, TemplateSyntaxError


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TEMPLATE_ROOT = REPOSITORY_ROOT / "infrastructure/ansible"


@dataclass(frozen=True)
class TemplateContractViolation:
    path: Path
    line: int
    reason: str

    def display(self, root: Path) -> str:
        try:
            path = self.path.relative_to(root)
        except ValueError:
            path = self.path
        return f"{path}:{self.line}: {self.reason}"


def discover_templates(template_root: Path) -> tuple[Path, ...]:
    return tuple(sorted(path for path in template_root.rglob("*.j2") if path.is_file()))


def _line_number(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def _unescaped_shell_array_lengths(source: str) -> tuple[int, ...]:
    """Locate shell ``${#array[@]}`` tokens outside a Jinja expression."""

    offsets: list[int] = []
    cursor = 0
    while True:
        offset = source.find("${#", cursor)
        if offset < 0:
            return tuple(offsets)
        variable_start = source.rfind("{{", 0, offset + 1)
        variable_end = source.rfind("}}", 0, offset + 1)
        if variable_start <= variable_end:
            offsets.append(offset)
        cursor = offset + 3


def validate_template_tree(template_root: Path) -> tuple[TemplateContractViolation, ...]:
    templates = discover_templates(template_root)
    if not templates:
        return (
            TemplateContractViolation(
                path=template_root,
                line=1,
                reason="no Ansible Jinja templates were discovered",
            ),
        )

    environment = Environment()  # noqa: S701 - source-only parsing; nothing is rendered.
    violations: list[TemplateContractViolation] = []
    for path in templates:
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            violations.append(
                TemplateContractViolation(path=path, line=1, reason=f"cannot read template: {error}")
            )
            continue

        try:
            environment.parse(source)
        except TemplateSyntaxError as error:
            violations.append(
                TemplateContractViolation(
                    path=path,
                    line=error.lineno or 1,
                    reason=f"invalid Jinja syntax: {error.message}",
                )
            )

        for offset in _unescaped_shell_array_lengths(source):
            violations.append(
                TemplateContractViolation(
                    path=path,
                    line=_line_number(source, offset),
                    reason="shell array-length syntax must escape its ${# prefix through Jinja",
                )
            )

    return tuple(violations)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse every Ansible .j2 source and reject Jinja/shell delimiter collisions."
    )
    parser.add_argument(
        "--template-root",
        type=Path,
        default=DEFAULT_TEMPLATE_ROOT,
        help="directory searched recursively for .j2 files",
    )
    args = parser.parse_args()
    template_root = args.template_root.resolve()
    violations = validate_template_tree(template_root)
    if violations:
        for violation in violations:
            print(f"[ERROR] {violation.display(REPOSITORY_ROOT)}")
        return 1

    count = len(discover_templates(template_root))
    print(f"[ansible-template-contract] parsed {count} templates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
