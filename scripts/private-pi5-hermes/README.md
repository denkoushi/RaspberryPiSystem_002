# Private Pi5 — Hermes Agent（セキュリティ先行）

自宅 **私用 Pi5** 上で [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を **専用ユーザー + Docker 隔離 + UFW** で運用するための手順。

## ドキュメント正本

| 種別 | パス |
|------|------|
| 計画・進捗 | [private-pi5-hermes-agent-plan.md](../../docs/plans/private-pi5-hermes-agent-plan.md) |
| Runbook | [private-pi5-hermes-deploy.md](../../docs/runbooks/private-pi5-hermes-deploy.md) |
| KB（install 障害） | [KB-private-pi5-hermes-install-noninteractive.md](../../docs/knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| ADR（セキュリティ） | [ADR-20260524](../../docs/decisions/ADR-20260524-private-pi5-hermes-security-profile.md) |

## 前提

- **Docker 導入済み**（`raspi5-private` / `hermes` が `docker` グループ）
- ローカル inventory: `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（非追跡）
- DGX token: `private_pi5_dgx_llm_shared_token`（StackChan bridge と同値可。**分離推奨**）

## セキュリティプロファイル（デフォルト）

| 項目 | 設定 |
|------|------|
| 実行ユーザー | `hermes`（専用） |
| ツール実行 | `terminal.backend: docker`・永続コンテナなし |
| 承認 | `approvals.mode: manual` |
| 秘密 | `~/.hermes/.env` **0600** |
| 外向き | UFW 既定 deny（SSH + 自宅 LAN の bridge **18080** のみ） |
| ブラウザ自動化 | インストール時 **`--skip-browser`** |
| Discord | **未設定時は gateway 起動しない**（systemd は installed・stopped） |

## デプロイ

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

Playbook は **対話プロンプト回避**のため、次を行う:

1. `ripgrep` / `ffmpeg` / ビルドツールを **root で apt 先行インストール**
2. 公式 `install.sh` を `/tmp` に取得し、`command` + `stdin: /dev/null` で **`--skip-setup --skip-browser`** 実行（**`curl | bash` は TTY 経由で止まりやすい** — [KB](../../docs/knowledge-base/KB-private-pi5-hermes-install-noninteractive.md)）

初回インストールは Pi5 上で **10〜30 分**かかることがある（async 3600s）。

Discord 準備後（Bot token・自分の User ID を fragment に追記）:

```yaml
private_pi5_hermes_discord_bot_token: "..."
private_pi5_hermes_discord_allowed_users: "123456789012345678"
private_pi5_hermes_gateway_enabled: true
```

再実行:

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

## 手動確認

```bash
ssh raspi5-private@<tailscale-ip>
sudo -u hermes /home/hermes/.local/bin/hermes doctor
sudo -u hermes bash -lc 'set -a; source ~/.hermes/.env; curl -fsS -H "X-LLM-Token: $OPENAI_API_KEY" http://100.118.82.72:38081/healthz'
```

## 関連

- [private-pi5-stackchan-bridge](../private-pi5-stackchan-bridge/README.md)（別系統・併用可・同一 UFW 18080）
- [dgx-system-prod-local-llm.md](../../docs/runbooks/dgx-system-prod-local-llm.md)
