# 私用 Pi5 Hermes Agent 標準デプロイ

最終更新: 2026-05-24

## 目的

自宅 **私用 Pi5** に [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を **セキュリティ先行プロファイル**で再現可能に配置する。StackChan `stackchan-bridge` と **同じホスト**で併用するが、**業務 Pi5 の `update-all-clients.sh` には載せない**。

## 標準ファイル

| 種別 | パス |
|------|------|
| Playbook | `infrastructure/ansible/playbooks/private-pi5-hermes.yml` |
| Config / env / systemd | `infrastructure/ansible/templates/private-pi5-hermes.*.j2` |
| Deploy wrapper | `scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| Inventory（ローカル） | `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（**非追跡**） |
| Inventory sample | `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml` |
| 計画 | [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md) |
| KB（install 障害） | [KB-private-pi5-hermes-install-noninteractive.md](../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |

## 前提

- 私用 Pi5 が **Tailscale** 参加済みで、Mac から Ansible SSH 可能。
- **Docker 導入済み**（`docker` グループに `raspi5-private` が所属。Playbook が `hermes` も追加）。
- ローカル fragment に **`private_pi5_dgx_llm_shared_token`**（または Playbook 用エイリアス）が設定済み。
- **秘密（パスワード・トークン）は fragment のみ**。Git / チャットに載せない。

## 手順

### 1. ローカル inventory fragment

StackChan bridge と **同一 fragment** を使う（ホスト名 `private-pi5-stackchan-bridge`）。

```bash
cp infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml \
  infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml
```

最低限:

- `ansible_host`（Tailscale IP）
- `private_pi5_dgx_llm_shared_token`
- 鍵未整備時のみ `ansible_password` / `ansible_become_password`

Discord 有効化時は追記（[§Discord 有効化](#discord-有効化)）。

### 2. デプロイ

リポジトリ直下:

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

詳細ログ:

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh -vv
```

**初回 install** は Pi5（ARM）上で **10〜30 分**かかることがある（Playbook `async: 3600` / `poll: 30`）。

### 3. Playbook が行うこと（順序）

1. Tailscale preflight（`tailscale_enabled: true` 時）
2. `git` / `curl` / `ca-certificates`
3. 専用ユーザー **`hermes`** + **`docker` グループ**
4. **UFW**: 既定 deny・OpenSSH・**`192.168.128.0/24` → tcp/18080**（`stackchan-bridge`）
5. `~/.hermes` **0700**
6. **apt 先行**: `ripgrep`, `ffmpeg`, `build-essential`, `python3-dev`, `libffi-dev`（install.sh の sudo 対話回避）
7. 公式 `install.sh` を `/tmp/hermes-agent-install.sh` に取得
8. **非対話 install**: `--skip-setup` `--skip-browser`・`stdin: /dev/null`
9. `config.yaml` / `.env` **0600** 配備
10. `hermes-gateway.service` 配備（**既定は stopped / disabled**）
11. **`hermes doctor`**・DGX **`/healthz`**・**`docker run hello-world`**（`hermes` ユーザー）

## 検証（2026-05-24 実機）

Playbook 成功後:

```bash
# Tailscale 経由（管理者）
ssh raspi5-private@<tailscale-ip> 'sudo -u hermes /home/hermes/.local/bin/hermes --version'
# 例: Hermes Agent v0.14.0 (2026.5.16)

ssh raspi5-private@<tailscale-ip> 'stat -c "%a %n" /home/hermes/.hermes /home/hermes/.hermes/.env'
# 700 /home/hermes/.hermes
# 600 /home/hermes/.hermes/.env

ssh raspi5-private@<tailscale-ip> 'sudo ufw status'
# 18080/tcp ALLOW 192.168.128.0/24
# OpenSSH ALLOW Anywhere

ssh raspi5-private@<tailscale-ip> 'systemctl is-active stackchan-bridge; systemctl is-active hermes-gateway'
# active
# inactive  （Discord 未設定時）

ssh raspi5-private@<tailscale-ip> 'sudo -u hermes bash -lc "hermes doctor 2>&1 | tail -20"'
```

DGX（`hermes` から）:

```bash
ssh raspi5-private@<tailscale-ip> \
  'sudo -u hermes bash -lc "set -a; source ~/.hermes/.env; curl -fsS -H \"X-LLM-Token: \$OPENAI_API_KEY\" http://100.118.82.72:38081/healthz"'
# ok
```

**doctor の警告**（未使用機能）は雑談用途では許容:

- `discord.py` 未インストール（Discord 未有効化時）
- 各種 OAuth / OpenRouter 未設定
- Skills Hub 未初期化 → 必要なら `hermes skills list`

## Discord 有効化

1. Discord Developer Portal で Bot 作成・**自分の User ID** を取得。
2. ローカル fragment に追記（**コミットしない**）:

```yaml
private_pi5_hermes_discord_bot_token: "<bot-token>"
private_pi5_hermes_discord_allowed_users: "<your-discord-user-id>"
private_pi5_hermes_gateway_enabled: true
```

3. Playbook 再実行:

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

4. 確認:

```bash
systemctl is-enabled hermes-gateway   # enabled
systemctl is-active hermes-gateway    # active
```

5. Discord で Bot をサーバーに入れず **DM のみ**・メンション必須（`require_mention: true`）で雑談テスト。

## ロールバック

| 対象 | 手順 |
|------|------|
| Gateway のみ停止 | fragment で `private_pi5_hermes_gateway_enabled: false` → Playbook 再実行 |
| Hermes 全体 | `systemctl stop hermes-gateway`・必要なら `userdel` / `~/.hermes` 退避（手動・要バックアップ） |
| UFW | `ufw disable` は bridge 露出に注意。ルール単体削除は `ufw status numbered` 参照 |

## 関連

- [private-pi5-stackchan-bridge-deploy.md](./private-pi5-stackchan-bridge-deploy.md)（別系統・ポート 18080 共有）
- [dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md)
- [ADR-20260524-private-pi5-hermes-security-profile.md](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)
