# KB-private-pi5-hermes: 私用 Pi5 への Hermes 非対話インストール障害

## Context

- **いつ**: 2026-05-24
- **どこ**: 私用 Pi5（inventory `private-pi5-stackchan-bridge`）・Ansible Playbook [`private-pi5-hermes.yml`](../../infrastructure/ansible/playbooks/private-pi5-hermes.yml)
- **目的**: 公式 [`install.sh`](https://github.com/NousResearch/hermes-agent/blob/main/scripts/install.sh) で Hermes Agent を **非対話**・**セキュリティ先行**で導入

## Symptoms

### S1: Playbook が「Install Hermes Agent」で 20 分以上無応答

- Ansible ログは当該タスクで停止したまま。
- Pi5 上: `bash -s -- --skip-browser` が **`/dev/tty` を read 待ち**（`n_tty_read`）。
- `ls /home/hermes/.local/bin/hermes` → **No such file**。

### S2: `curl: (23) Failure writing output to destination`

- Playbook を `curl | bash` + `set -euo pipefail` にした直後、**数秒で失敗**（rc=23）。
- 意味: パイプ先 bash が先に終了し、curl が broken pipe。

### S3: `Group hermes does not exist`

- 初回 Playbook: `user` モジュールが `group: hermes` を指定したが、**グループ未作成**で失敗。

## Investigation

| 仮説 | 検証 | 結果 |
|------|------|------|
| ネットワーク不通 | Pi5 から raw.githubusercontent.com | **REJECTED**（到達可） |
| install が遅いだけ | `du -sh /home/hermes` 長時間不変・子プロセスなし | **REJECTED**（ハング） |
| Ansible が擬似 TTY を付与し `install.sh` が対話モード | `/proc/<pid>/fd/0` → `/dev/tty`・`install_system_packages` の `prompt_yes_no` | **CONFIRMED** |
| `curl \| bash` が pipefail で即死 | stderr `curl: (23)` | **CONFIRMED** |
| hermes グループ未作成 | Ansible エラーメッセージ | **CONFIRMED** |

**補足（install.sh の挙動）**:

- stdin が TTY のとき `IS_INTERACTIVE=true` → **sudo で ripgrep/ffmpeg を入れますか？** で停止。
- stdin が非 TTY でも **`/dev/tty` が開ける**と、同プロンプトを **tty から読む**分岐に入る（Ansible `become` 環境で発生しやすい）。
- 対策は **apt で依存を先に入れる** + **`command` モジュール + `stdin: /dev/null`** + スクリプトを **ファイルに保存して実行**（`curl | bash` を避ける）。

## Root cause

1. **対話プロンプト**: 公式 installer の optional system package / build-tools 確認が、Ansible 経由の **TTY 付き非対話**に吸い込まれ無限待ち。
2. **パイプ失敗**: `pipefail` 下の `curl | bash` が早期終了と相性が悪い。
3. **Ansible 順序**: `group` 作成より先に `user` で `group: hermes` を要求。

## Fix

Playbook 側の最小変更（2026-05-24 確定）:

1. `ansible.builtin.group` で **`hermes` グループ作成**。
2. **`apt` 先行インストール**（`ripgrep`, `ffmpeg`, `build-essential`, `python3-dev`, `libffi-dev`）。
3. `get_url` で `/tmp/hermes-agent-install.sh` を配置。
4. `ansible.builtin.command` で  
   `argv: [/bin/bash, /tmp/hermes-agent-install.sh, --skip-setup, --skip-browser]`  
   **`stdin: /dev/null`**・`creates: ~/.local/bin/hermes`・`async: 3600` / `poll: 30`。
5. ハング中プロセスは `pkill -u hermes -f install.sh` 等で手動停止してから再実行。

**成功時の Playbook サマリ**: `PLAY RECAP ok=29 changed=6 failed=0`。

## Prevention

- **Runbook** [private-pi5-hermes-deploy.md](../runbooks/private-pi5-hermes-deploy.md) に「`curl | bash` 禁止・apt 先行」を明記。
- Playbook 変更時は **Pi5 上で `pgrep -a -u hermes` と `/proc/<pid>/fd`** を見て tty 待ちを即判定。
- 初回 install は **async タイムアウト 3600s** を維持（ARM ビルド遅延）。

## References

- [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md)
- [ADR-20260524-private-pi5-hermes-security-profile.md](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)
- [`scripts/private-pi5-hermes/README.md`](../../scripts/private-pi5-hermes/README.md)
- 上流 installer: https://github.com/NousResearch/hermes-agent/blob/main/scripts/install.sh
