#!/usr/bin/env python3
"""Build a CI-only Ansible tree without decryptable production material."""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path


class RedactedContextError(ValueError):
    pass


def _ignore_sensitive_files(directory: str, names: list[str]) -> set[str]:
    path = Path(directory)
    ignored: set[str] = set()
    if path.name == "ansible" and ".vault-pass" in names:
        ignored.add(".vault-pass")
    if path.parent.name == "host_vars" and "vault.yml" in names:
        ignored.add("vault.yml")
    return ignored


def prepare_context(source: Path, destination: Path) -> None:
    source = source.resolve()
    destination = destination.resolve()
    if not source.is_dir() or source.is_symlink():
        raise RedactedContextError("Ansible source must be a regular directory")
    if destination.exists():
        raise RedactedContextError("redacted Ansible destination must not already exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, ignore=_ignore_sensitive_files)

    if (destination / ".vault-pass").exists():
        raise RedactedContextError("Vault password entered the redacted context")
    if any((destination / "host_vars").glob("*/vault.yml")):
        raise RedactedContextError("host Vault entered the redacted context")

    config = destination / "ansible.cfg"
    content = config.read_text(encoding="utf-8")
    marker = "vault_password_file = .vault-pass"
    if marker not in content:
        raise RedactedContextError("Ansible Vault password setting was not found")
    config.write_text(
        content.replace(
            marker,
            "# vault_password_file disabled in redacted CI context",
            1,
        ),
        encoding="utf-8",
    )
    os.chmod(config, 0o600)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare_context(args.source, args.output)
    except (OSError, RedactedContextError) as error:
        print(f"redacted Ansible context failed: {error}")
        return 1
    print("Redacted Ansible context prepared without Vault files or password material.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
