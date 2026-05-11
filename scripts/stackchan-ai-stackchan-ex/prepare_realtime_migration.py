#!/usr/bin/env python3
"""
AI_StackChan_Ex の Realtime API 段階移行を安全に始めるための準備スクリプト。

やること:
- platformio.ini の GitHub 依存を supply-chain-lock.json で固定
- Realtime 用の YAML テンプレートを生成
- ビルドコマンドとロールバック手順をファイル化
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def load_lock(script_dir: Path) -> dict:
    with (script_dir / "supply-chain-lock.json").open("r", encoding="utf-8") as fp:
        return json.load(fp)


def run_pin_script(script_dir: Path, platformio_ini: Path) -> None:
    pin_script = script_dir / "apply_platformio_github_pins.py"
    subprocess.run(
        ["python3", str(pin_script), str(platformio_ini)],
        check=True,
        text=True,
    )


def read_git_head(repo_dir: Path) -> str | None:
    try:
        cp = subprocess.run(
            ["git", "-C", str(repo_dir), "rev-parse", "HEAD"],
            check=True,
            text=True,
            capture_output=True,
        )
        return cp.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def assert_realtime_env_exists(platformio_ini: Path, board_env: str) -> None:
    text = platformio_ini.read_text(encoding="utf-8")
    marker = f"[env:{board_env}]"
    if marker not in text:
        raise RuntimeError(f"{platformio_ini} に {marker} がありません。")


def write_templates(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    sec_yaml = """wifi:
  ssid: "<YOUR_WIFI_SSID>"
  password: "<YOUR_WIFI_PASSWORD>"

apikey:
  stt: ""
  aiservice: "<OPENAI_OR_GEMINI_API_KEY>"
  tts: ""
"""
    ex_yaml = """llm:
  type: 0
  enableMemory: false

tts:
  type: 0
  model: ""
  voice: "3"

stt:
  type: 0

wakeword:
  type: 0
  keyword: ""
"""
    (out_dir / "SC_SecConfig.realtime.template.yaml").write_text(sec_yaml, encoding="utf-8")
    (out_dir / "SC_ExConfig.realtime.template.yaml").write_text(ex_yaml, encoding="utf-8")


def write_commands(
    out_dir: Path,
    ai_stackchan_ex_dir: Path,
    board_env: str,
    with_tts: bool,
) -> None:
    firmware_dir = ai_stackchan_ex_dir / "firmware"
    build_flags = "-DREALTIME_API_WITH_TTS" if with_tts else ""

    build_sh = f"""#!/usr/bin/env bash
set -euo pipefail
cd "{firmware_dir}"
{"env PLATFORMIO_BUILD_FLAGS='-DREALTIME_API_WITH_TTS' " if with_tts else ""}pio run -e {board_env}
"""
    upload_sh = f"""#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <upload-port>"
  echo "Example: $0 /dev/cu.usbmodem1101"
  exit 1
fi
PORT="$1"
cd "{firmware_dir}"
{"env PLATFORMIO_BUILD_FLAGS='-DREALTIME_API_WITH_TTS' " if with_tts else ""}pio run -e {board_env} -t upload --upload-port "$PORT"
"""
    rollback_md = f"""# Rollback 手順（最小）

1. 既存 private bridge 向け env で再ビルドする（例: `m5stack-cores3`）。
2. 既存の `CHATGPT_API_URL` ビルドフラグ（`/api/stackchan/chat/simple`）を復元する。
3. `stackchan-community-text-only-e2e.md` の完了条件を再確認する。
"""
    checklist_md = f"""# Realtime 移行チェックリスト（Phase 1）

- [ ] `pio run -e {board_env}` が成功
- [ ] 端末表示が `Connecting...` -> `Please touch` に遷移
- [ ] タップで `Listening...` へ遷移
- [ ] 30秒無発話で正常に会話終了
- [ ] 10回連続でフリーズ/再起動なし

## Build command

`{"env PLATFORMIO_BUILD_FLAGS='-DREALTIME_API_WITH_TTS' " if with_tts else ""}pio run -e {board_env}`

## Upload command

`{"env PLATFORMIO_BUILD_FLAGS='-DREALTIME_API_WITH_TTS' " if with_tts else ""}pio run -e {board_env} -t upload --upload-port <PORT>`
"""

    build_path = out_dir / "build-realtime.sh"
    build_path.write_text(build_sh, encoding="utf-8")
    build_path.chmod(0o755)
    upload_path = out_dir / "upload-realtime.sh"
    upload_path.write_text(upload_sh, encoding="utf-8")
    upload_path.chmod(0o755)
    (out_dir / "rollback-realtime.md").write_text(rollback_md, encoding="utf-8")
    (out_dir / "phase1-checklist.md").write_text(checklist_md, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "ai_stackchan_ex_dir",
        type=Path,
        help="AI_StackChan_Ex のルートディレクトリ",
    )
    parser.add_argument(
        "--board-env",
        default="m5stack-cores3-realtime",
        help="PlatformIO 環境名（既定: m5stack-cores3-realtime）",
    )
    parser.add_argument(
        "--with-tts",
        action="store_true",
        help="REALTIME_API_WITH_TTS を有効にしたビルドコマンドを出力",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(".cursor/realtime-migration"),
        help="生成物の出力先（既定: .cursor/realtime-migration）",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    lock = load_lock(script_dir)
    pinned_commit = lock["upstream_ai_stackchan_ex"]["pinned_commit"]

    ai_dir = args.ai_stackchan_ex_dir.resolve()
    firmware_dir = ai_dir / "firmware"
    platformio_ini = firmware_dir / "platformio.ini"

    if not platformio_ini.exists():
        raise RuntimeError(f"platformio.ini が見つかりません: {platformio_ini}")

    head = read_git_head(ai_dir)
    if head is None:
        print("[WARN] git HEAD を取得できませんでした。コミット一致確認をスキップします。")
    elif head != pinned_commit:
        print(
            "[WARN] 上流コミットが lock と不一致です: "
            f"head={head} pinned={pinned_commit}"
        )
    else:
        print(f"[OK] upstream commit is pinned: {head}")

    run_pin_script(script_dir, platformio_ini)
    assert_realtime_env_exists(platformio_ini, args.board_env)

    out_dir = args.output_dir.resolve()
    write_templates(out_dir)
    write_commands(out_dir, ai_dir, args.board_env, args.with_tts)

    print(f"[OK] Realtime migration artifacts generated: {out_dir}")
    print(f"[NEXT] run: {out_dir / 'build-realtime.sh'}")


if __name__ == "__main__":
    main()

