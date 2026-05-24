# Private Pi5 — Hermes Agent（セキュリティ先行）

自宅 **私用 Pi5** 上で [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を **専用ユーザー + Docker 隔離 + UFW** で運用し、**Discord DM（本人のみ）** から DGX で雑談する。

## ドキュメント正本

| 種別 | パス |
|------|------|
| 計画・進捗 | [private-pi5-hermes-agent-plan.md](../../docs/plans/private-pi5-hermes-agent-plan.md) |
| Runbook | [private-pi5-hermes-deploy.md](../../docs/runbooks/private-pi5-hermes-deploy.md) |
| KB（install 障害） | [KB-private-pi5-hermes-install-noninteractive.md](../../docs/knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| KB（403 / Bearer） | [KB-private-pi5-hermes-dgx-403-bearer-token.md](../../docs/knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| KB（Discord E2E・遅延） | [KB-private-pi5-hermes-discord-e2e-and-latency.md](../../docs/knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| ADR（セキュリティ） | [ADR-20260524](../../docs/decisions/ADR-20260524-private-pi5-hermes-security-profile.md) |

## 前提

- **Docker 導入済み**（`hermes` が `docker` グループ）
- ローカル inventory: `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（**非追跡**）
- DGX token: `private_pi5_dgx_llm_shared_token`（StackChan と同値可。**分離推奨**）
- Discord（任意）: `private_pi5_hermes_discord_bot_token` / `private_pi5_hermes_discord_allowed_users` / `private_pi5_hermes_gateway_enabled: true`

## セキュリティ + 雑談プロファイル（2026-05-24）

| 項目 | 設定 |
|------|------|
| 実行ユーザー | `hermes` |
| ツール実行 | Docker（**雑談時はツール無効** — config テンプレ） |
| 承認 | `manual` |
| LLM | `custom:dgx-system-prod` → DGX Bearer |
| Discord | 許可 User のみ・テンプレ **`require_mention: false`** |
| 体感レイテンシ | **~30s〜1min/通**（keep-warm 改善候補） |

## デプロイ

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

初回 install は **10〜30 分**（async 3600s）。非対話の要点は [KB install](../../docs/knowledge-base/KB-private-pi5-hermes-install-noninteractive.md)。

Discord 有効化後は fragment を更新して再実行。初回のみ Pi5 venv へ `discord-py` が必要な場合あり（[Runbook](../../docs/runbooks/private-pi5-hermes-deploy.md)）。

## 手動確認

```bash
ssh raspi5-private@<tailscale-ip>
systemctl is-active hermes-gateway
sudo -u hermes /home/hermes/.local/bin/hermes doctor
sudo -u hermes bash -lc 'set -a; source ~/.hermes/.env; set +a; \
  curl -sf -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  http://100.118.82.72:38081/v1/models'
```

## 関連

- [private-pi5-stackchan-bridge](../private-pi5-stackchan-bridge/README.md)（別系統・併用可）
- [dgx-system-prod-local-llm.md](../../docs/runbooks/dgx-system-prod-local-llm.md)
