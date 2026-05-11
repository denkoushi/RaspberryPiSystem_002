#!/usr/bin/env python3
"""
Realtime API 段階移行のブートストラップ。

実行内容:
1) AI_StackChan_Ex を指定ディレクトリへ clone（既存なら再利用）
2) supply-chain-lock.json の pinned commit へ checkout
3) prepare_realtime_migration.py を呼び出して準備物を生成
4) 任意で PlatformIO build を実行
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def run(cmd: list[str], cwd: Path | None = None) -> None:
    subprocess.run(cmd, check=True, text=True, cwd=str(cwd) if cwd else None)


def load_lock(script_dir: Path) -> dict:
    with (script_dir / "supply-chain-lock.json").open("r", encoding="utf-8") as fp:
        return json.load(fp)


def ensure_clone(repo_url: str, target_dir: Path) -> None:
    if (target_dir / ".git").exists():
        print(f"[INFO] Reusing existing clone: {target_dir}")
        return
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", repo_url, str(target_dir)])
    print(f"[OK] Cloned: {repo_url} -> {target_dir}")


def checkout_pinned(target_dir: Path, commit: str) -> None:
    run(["git", "-C", str(target_dir), "fetch", "--all", "--tags"])
    run(["git", "-C", str(target_dir), "checkout", commit])
    cp = subprocess.run(
        ["git", "-C", str(target_dir), "rev-parse", "HEAD"],
        check=True,
        text=True,
        capture_output=True,
    )
    head = cp.stdout.strip()
    if head != commit:
        raise RuntimeError(f"checkout mismatch: head={head} expected={commit}")
    print(f"[OK] Checked out pinned commit: {head}")


def run_prepare(
    script_dir: Path,
    ai_dir: Path,
    board_env: str,
    with_tts: bool,
    output_dir: Path,
) -> None:
    cmd = [
        "python3",
        str(script_dir / "prepare_realtime_migration.py"),
        str(ai_dir),
        "--board-env",
        board_env,
        "--output-dir",
        str(output_dir),
    ]
    if with_tts:
        cmd.append("--with-tts")
    run(cmd)
    print(f"[OK] Prepared realtime migration artifacts: {output_dir}")


def try_build(ai_dir: Path, board_env: str, with_tts: bool) -> None:
    firmware_dir = ai_dir / "firmware"
    if with_tts:
        run(
            [
                "env",
                "PLATFORMIO_BUILD_FLAGS=-DREALTIME_API_WITH_TTS",
                "pio",
                "run",
                "-e",
                board_env,
            ],
            cwd=firmware_dir,
        )
    else:
        run(["pio", "run", "-e", board_env], cwd=firmware_dir)
    print(f"[OK] Build completed: env={board_env} with_tts={with_tts}")


def try_upload(ai_dir: Path, board_env: str, upload_port: str) -> None:
    firmware_dir = ai_dir / "firmware"
    run(["pio", "run", "-e", board_env, "-t", "upload", "--upload-port", upload_port], cwd=firmware_dir)
    print(f"[OK] Upload completed: env={board_env} port={upload_port}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target-dir",
        type=Path,
        required=True,
        help="AI_StackChan_Ex を配置するディレクトリ（未存在なら clone）",
    )
    parser.add_argument(
        "--board-env",
        default="m5stack-cores3-realtime",
        help="PlatformIO env（既定: m5stack-cores3-realtime）",
    )
    parser.add_argument(
        "--with-tts",
        action="store_true",
        help="REALTIME_API_WITH_TTS をビルド時に付与",
    )
    parser.add_argument(
        "--run-build",
        action="store_true",
        help="準備後に pio build を実行",
    )
    parser.add_argument(
        "--run-upload",
        action="store_true",
        help="build 後に pio upload を実行（--upload-port 必須）",
    )
    parser.add_argument(
        "--upload-port",
        default="",
        help="アップロード先シリアルポート（例: /dev/cu.usbmodem1101）",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(".cursor/realtime-migration"),
        help="準備物の出力先",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    lock = load_lock(script_dir)
    repo_url = lock["upstream_ai_stackchan_ex"]["repo"]
    pinned_commit = lock["upstream_ai_stackchan_ex"]["pinned_commit"]

    target_dir = args.target_dir.resolve()
    output_dir = args.output_dir.resolve()

    ensure_clone(repo_url, target_dir)
    checkout_pinned(target_dir, pinned_commit)
    run_prepare(script_dir, target_dir, args.board_env, args.with_tts, output_dir)

    if args.run_build:
        try_build(target_dir, args.board_env, args.with_tts)
    else:
        print("[NEXT] --run-build を付けると pio build まで自動実行します。")

    if args.run_upload:
        if not args.run_build:
            raise RuntimeError("--run-upload を使う場合は --run-build も指定してください。")
        if not args.upload_port:
            raise RuntimeError("--run-upload を使う場合は --upload-port を指定してください。")
        try_upload(target_dir, args.board_env, args.upload_port)


if __name__ == "__main__":
    main()

