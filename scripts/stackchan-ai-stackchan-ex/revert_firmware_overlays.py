#!/usr/bin/env python3
"""Remove voice/utterance overlay artifacts and restore patched sources from git HEAD."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Tracked files modified by apply_chatgpt_private_bridge / overlay scripts
RESTORE_PATHS = (
    "firmware/src/mod/AiStackChan/AiStackChanMod.cpp",
    "firmware/src/WebAPI.cpp",
    "firmware/src/llm/ChatGPT/ChatGPT.cpp",
)

PRIVATE_BRIDGE_DIR = Path("firmware/src/llm/PrivateBridge")


def _force_clean_enabled(force_flag: bool) -> bool:
    if force_flag:
        return True
    value = (os.getenv("STACKCHAN_FORCE_CLEAN") or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _relevant_dirty_lines(status_output: str) -> list[str]:
    lines: list[str] = []
    for line in status_output.splitlines():
        if len(line) < 4:
            continue
        path = line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip().strip('"')
        if path in RESTORE_PATHS or path.startswith("firmware/src/llm/PrivateBridge"):
            lines.append(line)
    return lines


def _assert_safe_to_revert(clone: Path, force: bool) -> None:
    if _force_clean_enabled(force):
        return

    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=clone,
        capture_output=True,
        text=True,
        check=True,
    )
    dirty = _relevant_dirty_lines(result.stdout)
    bridge_dir = clone / PRIVATE_BRIDGE_DIR
    if bridge_dir.exists() and not any("PrivateBridge" in line for line in dirty):
        dirty.append(f"?? {PRIVATE_BRIDGE_DIR.as_posix()}/ (untracked overlay tree)")

    if not dirty:
        return

    print("Refusing to revert firmware overlays: clone has local changes that would be lost.", file=sys.stderr)
    for line in dirty:
        print(f"  {line}", file=sys.stderr)
    print(
        "\nUse a dedicated build clone (e.g. STACKCHAN_FW_DIR=~/AI_StackChan_Ex-bridge-build), "
        "commit/stash your work, or re-run with STACKCHAN_FORCE_CLEAN=1 / --force-clean.",
        file=sys.stderr,
    )
    raise SystemExit(1)


def revert_overlays(clone: Path, *, force: bool) -> None:
    _assert_safe_to_revert(clone, force)

    bridge_dir = clone / PRIVATE_BRIDGE_DIR
    if bridge_dir.exists():
        shutil.rmtree(bridge_dir)
        print("removed:", bridge_dir)

    for rel in RESTORE_PATHS:
        path = clone / rel
        if not path.is_file():
            continue
        subprocess.run(
            ["git", "checkout", "--", rel],
            cwd=clone,
            check=True,
        )
        print("restored from git:", rel)

    print("firmware overlays reverted; safe to re-apply chatgpt / optional voice overlay")


def main() -> None:
    parser = argparse.ArgumentParser(description="Revert StackChan firmware overlay artifacts")
    parser.add_argument("clone_dir", type=Path, help="Path to AI_StackChan_Ex clone")
    parser.add_argument(
        "--force-clean",
        action="store_true",
        help="Discard local overlay-related changes (also STACKCHAN_FORCE_CLEAN=1)",
    )
    args = parser.parse_args()
    clone = args.clone_dir.resolve()
    if not (clone / ".git").is_dir():
        raise SystemExit(f"not a git clone: {clone}")
    revert_overlays(clone, force=args.force_clean)


if __name__ == "__main__":
    main()
