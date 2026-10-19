#!/usr/bin/env python3
"""Build a CI-only Ansible tree without decryptable production material."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.deploy.rolling_release.read_only_ansible_context import (
    RedactedContextError,
    prepare_context,
)


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
