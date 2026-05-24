# KB-private-pi5-hermes-discord-e2e-and-latency: Discord 雑談 E2E・遅延・8K コンテキスト

- **Status**: operational（2026-05-24 実機確認）
- **Related**: [private-pi5-hermes-deploy.md](../runbooks/private-pi5-hermes-deploy.md) · [KB-private-pi5-hermes-dgx-403-bearer-token.md](./KB-private-pi5-hermes-dgx-403-bearer-token.md) · [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md)

## Context

私用 Pi5 上の **Hermes Agent v0.14.0**（`hermes-gateway`）から **Discord DM**（許可 User ID のみ）で DGX `system-prod-primary`（`http://100.118.82.72:38081/v1`）へ雑談。StackChan `stackchan-bridge` と **同一ホスト・同一 DGX** だが **プロセス・設定は分離**。

## 確定仕様（雑談プロファイル・config テンプレ）

正本: [`private-pi5-hermes.config.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.config.yaml.j2)

| 領域 | 設定 | 意図 |
|------|------|------|
| LLM | `provider: custom:dgx-system-prod` + `custom_providers[].key_env: OPENAI_API_KEY` | bare `provider: custom` だと `Bearer no-key-required`（Hermes #28660） |
| 起動検証 | `model.context_length: 65536` | Hermes は **最低 64K** を要求。**DGX 実 API 上限は ~8192** |
| 推論 | `model.reasoning_effort: none` | reasoning モデル待ちを短縮（雑談） |
| 圧縮 | `compression.enabled: false` | 8K モデルで補助圧縮は 64K 必須のため無効 |
| ツール | `agent.disabled_toolsets`（全主要 + `kanban`/`discord`/`discord_admin`） | 既定 `hermes-discord` ツール JSON が 8K 超の主因 |
| Discord ツール束 | `platform_toolsets.discord: []` | 明示的にツールなし |
| メモリ | `memory.memory_enabled: false` | プロンプト肥大化抑制 |
| Discord | `require_mention: false`（テンプレ既定） | DM + `DISCORD_ALLOWED_USERS` で保護。メンション必須だと無応答に見える |
| 補助 | `auxiliary.title_generation: main` + `timeout: 20` | `auto` が OpenRouter を試し **Request timed out**（非ブロックだが遅延要因） |
| 表示 | `display.show_reasoning: false` | Discord に思考ログを出さない |

秘密: [`private-pi5-hermes.env.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.env.j2) — `OPENAI_API_KEY`（DGX トークン）・`DISCORD_*`。**fragment のみ・Git 禁止**。

## DGX 側前提（認証）

- StackChan: **`X-LLM-Token`**
- Hermes: **`Authorization: Bearer`**
- DGX `gateway-server.py` は **両方受理**（`llm_shared_token_ok()`）。反映: `scp` → PID 終了 → `start-gateway-server.sh`（[dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)）
- 詳細: [KB-private-pi5-hermes-dgx-403-bearer-token.md](./KB-private-pi5-hermes-dgx-403-bearer-token.md)

## 実機 E2E タイムライン（2026-05-24）

| 時刻（JST） | 事象 |
|-------------|------|
| 基盤 | Playbook ok・`hermes-gateway` active・Discord Bot 招待済み |
| 17:44 | LLM **403 forbidden**（Bearer / gateway 未対応・`no-key-required`） |
| 17:51〜 | gateway Bearer 修正後も **圧縮 / 8K 超過** |
| 18:06 | **8193 input tokens** → 圧縮ループ → auto-reset |
| 18:23 | `/reset` 後 **~1 分**で初回応答（ホーム案内 + 本文） |
| 18:33 | 雑談応答成功。ユーザー体感 **~1 分/通**（改善余地あり） |

**成功時の応答例**: 「こんにちは！今日は何をしましょうか？」

## 症状別トラブルシュート

### 1. HTTP 403 forbidden（LLM のみ）

→ [KB-private-pi5-hermes-dgx-403-bearer-token.md](./KB-private-pi5-hermes-dgx-403-bearer-token.md)

### 2. メンションなしで無応答（ホーム案内だけ）

- **原因**: `require_mention: true` のとき、プレーンテキストはエージェント未処理。
- **対処**: テンプレ `require_mention: false` または `@Bot` 付き送信。再デプロイ + `/reset`。

### 3. `Context too large` / 圧縮 1/3〜3/3 / auto-reset

- **原因**: `hermes-discord` 既定ツール定義 + システムプロンプトが **実 API 8192 超**。request dump 例: tools JSON **~53KB 文字**。
- **対処**: `disabled_toolsets` + `platform_toolsets.discord: []` をテンプレ反映。`/reset`。

### 4. `Auxiliary compression model … 8,192 < 64,000`

- **原因**: 圧縮補助 LLM の 64K 下限と DGX 8K の不一致。
- **対処**: `compression.enabled: false`。

### 5. 遅い（1 分程度・Typing のまま）

| 要因 | 説明 | 対処 |
|------|------|------|
| DGX コールドスタート | モデル未ロード時 `/start` + 読み込み | DGX 側 keep-warm（StackChan bridge の `/start` パターン参照） |
| reasoning | `system-prod-primary` が思考付き応答 | `reasoning_effort: none`（テンプレ済） |
| title_generation | OpenRouter 試行タイムアウト | `auxiliary.title_generation: main`（テンプレ済） |
| 初回ホーム案内 | 初回 DM で `/sethome` 案内が別メッセージ | 無視可。`/sethome` 不要（雑談のみ） |
| Pi5→DGX 往復 | Tailscale + 推論生成 | 2 通目以降が速いか確認 |

**Pi5 からの smoke（参考）**: 最小 `chat/completions`（`1+1=?`）は **~7s**（2026-05-24）。

### 6. `/sethome` 案内の意味

- cron 結果・横断メッセージの**届け先チャンネル**登録用。
- **雑談のみならスキップ可**（`/sethome` 不要）。

## 検証コマンド（Pi5）

```bash
# gateway
systemctl is-active hermes-gateway

# DGX Bearer（hermes ユーザー）
sudo -u hermes bash -lc 'set -a; source ~/.hermes/.env; set +a; \
  curl -sf -o /dev/null -w "bearer=%{http_code}\n" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  http://100.118.82.72:38081/v1/models'

# Discord 向けツール数（venv）
sudo -u hermes bash -lc 'source ~/.hermes/hermes-agent/venv/bin/activate; \
  export PYTHONPATH=/home/hermes/.hermes/hermes-agent; python3 -c "
import yaml
from hermes_cli.tools_config import _get_platform_tools
cfg=yaml.safe_load(open(\"/home/hermes/.hermes/config.yaml\"))
print(\"discord toolsets\", _get_platform_tools(cfg, \"discord\"))
"'

# 直近ログ
journalctl -u hermes-gateway -n 50 --no-pager
```

期待: `bearer=200`・`discord toolsets set()`（空）。

## 運用手順（障害時）

1. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
2. `sudo systemctl restart hermes-gateway`
3. Discord **`/reset`**
4. 短いメッセージで再試行

DGX gateway 更新後は **必ず** Bearer smoke（上記 curl）。

## Prevention

- 新規 OpenAI 互換クライアント追加時は **Bearer と X-LLM-Token** を gateway で両方受理するか確認。
- Hermes custom endpoint は **`custom_providers` + `key_env`** をテンプレ固定。
- 8K 上流では **ツール無効化**を雑談プロファイルの既定とする。
- Discord 導入チェックリストに **`/reset` 後の 2 通目レイテンシ**を記録する。

## 未解決・次の改善候補

| 優先 | 項目 |
|------|------|
| 高 | DGX **keep-warm**（初回数十秒〜数分の削減） |
| 中 | Hermes 専用 **DGX トークン**（StackChan と分離） |
| 中 | Discord Bot token **ローテーション**（漏洩疑い時） |
| 低 | `context_length` と DGX 実 8K の整合（Hermes 64K 下限との両立） |
| 低 | `/sethome` 初回案内の抑制（Hermes 設定調査） |

## References

- Playbook: [`private-pi5-hermes.yml`](../../infrastructure/ansible/playbooks/private-pi5-hermes.yml)
- DGX gateway: [`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py)
- StackChan DGX クライアント: [`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py)
