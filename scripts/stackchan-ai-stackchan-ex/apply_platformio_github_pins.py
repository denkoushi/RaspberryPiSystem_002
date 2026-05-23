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


def pin_url_token(token: str, lock: dict) -> str:
    """lib_deps の GitHub URL トークンを lock の SHA に正規化する。"""
    if not token.startswith("https://github.com/"):
        return token
    if "#" in token:
        base, fragment = token.split("#", 1)
    else:
        base, fragment = token, ""

    base_no_git = base[:-4] if base.endswith(".git") else base
    locked_sha = lock.get(base_no_git) or lock.get(base_no_git + ".git")
    if not locked_sha:
        return token

    # 既に同じ SHA で固定済みなら変更しない。
    if fragment == locked_sha:
        return token
    return f"{base_no_git}#{locked_sha}"


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("platformio_ini", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ini_path: Path = args.platformio_ini
    text = ini_path.read_text(encoding="utf-8")
    lock = load_lock(script_dir)
    # build_replacements は互換用に残す（README 等での参照を壊さないため）。
    _ = build_replacements(lock)

    new_lines: list[str] = []
    applied = 0
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        # コメント行や空行はそのまま。
        if not stripped or stripped.startswith(";"):
            new_lines.append(line)
            continue
        tokens = line.split()
        if not tokens:
            new_lines.append(line)
            continue
        replaced_any = False
        rebuilt_tokens: list[str] = []
        for tok in tokens:
            pinned = pin_url_token(tok, lock)
            if pinned != tok:
                replaced_any = True
            rebuilt_tokens.append(pinned)
        if replaced_any:
            # 元行の indentation を保持する。
            indent_len = len(line) - len(line.lstrip(" \t"))
            indent = line[:indent_len]
            eol = "\n" if line.endswith("\n") else ""
            line = indent + " ".join(rebuilt_tokens) + eol
            applied += 1
        new_lines.append(line)
    new_text = "".join(new_lines)

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
