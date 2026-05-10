#!/usr/bin/env python3
"""
AI_StackChan_Ex の firmware/platformio.ini 内の GitHub lib_deps URL を
supply-chain-lock.json で固定した commit SHA 付き URL に置換する。

Usage:
  python3 apply_platformio_github_pins.py /path/to/AI_StackChan_Ex/firmware/platformio.ini
  python3 apply_platformio_github_pins.py --dry-run ...
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def load_lock(script_dir: Path) -> dict:
    data = json.loads((script_dir / "supply-chain-lock.json").read_text(encoding="utf-8"))
    return data["github_lib_deps"]


def strip_fragment(url: str) -> str:
    return url.split("#", 1)[0].rstrip("/")


def build_replacements(lock: dict) -> list[tuple[str, str]]:
    reps: list[tuple[str, str]] = []
    for base, sha in lock.items():
        base = base.rstrip("/")
        pinned = f"{base}#{sha}"
        reps.append((base + "#fix/max_data_size", pinned))
        reps.append((base + ".git#fix/max_data_size", pinned))
        reps.append((base, pinned))
        if not base.endswith(".git"):
            reps.append((base + ".git", pinned))
    reps.sort(key=lambda x: len(x[0]), reverse=True)
    return reps


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("platformio_ini", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ini_path: Path = args.platformio_ini
    text = ini_path.read_text(encoding="utf-8")
    lock = load_lock(script_dir)
    replacements = build_replacements(lock)

    new_text = text
    applied = 0
    for old_fragment, new_url in replacements:
        if old_fragment not in new_text:
            continue
        new_text = new_text.replace(old_fragment, new_url)
        applied += 1

    if args.dry_run:
        if new_text != text:
            print(f"[dry-run] would rewrite {ini_path} ({applied} pattern hits)")
        else:
            print(f"[dry-run] no changes for {ini_path}")
        return

    if new_text != text:
        ini_path.write_text(new_text, encoding="utf-8")
        print(f"Updated {ini_path} (applied replacement patterns: {applied})")
    else:
        print(f"No GitHub URLs matched in {ini_path}; check paths or lock file.")


if __name__ == "__main__":
    main()
