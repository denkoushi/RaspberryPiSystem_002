# KB-private-pi5-hermes-dgx-403-bearer-token: Hermes Discord で HTTP 403 forbidden

- **Status**: resolved（2026-05-24）
- **Related**: [private-pi5-hermes-deploy.md](../runbooks/private-pi5-hermes-deploy.md) · [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md) · `scripts/dgx-local-llm-system/gateway-server.py`

## Context

私用 Pi5 の **Hermes Agent**（Discord DM）から DGX `system-prod-primary`（`http://100.118.82.72:38081/v1`）へ LLM 呼び出し。Discord 接続・gateway 起動は成功したが、応答は `HTTP 403: forbidden`。

## Symptoms

- Discord: `⚠️ Non-retryable error (HTTP 403): HTTP 403: forbidden`
- Pi5 `hermes-gateway` ログ: `PermissionDeniedError` / `base_url=http://100.118.82.72:38081/v1`
- 同一トークンで:
  - `Authorization: Bearer <token>` → **403**
  - `X-LLM-Token: <token>` → **200**

## Investigation

| 仮説 | 検証 | 結果 |
|------|------|------|
| Hermes の `OPENAI_API_KEY` が空・不一致 | `~/.hermes/.env` を source して curl | **REJECTED**（X-LLM-Token は 200） |
| DGX gateway が Bearer 非対応 | `gateway-server.py` は `X-LLM-Token` のみ比較 | **CONFIRMED** |
| Hermes v0.14 が `custom_headers` で `X-LLM-Token` を送れる | `runtime_provider.py` の custom provider 解決に headers なし | **INCONCLUSIVE**（実装依存・未採用） |

Hermes（OpenAI 互換クライアント）は **`Authorization: Bearer`** を送る。StackChan bridge は **`X-LLM-Token`**（`dgx_runtime_client.py`）。

## Root cause（2段階）

1. **DGX gateway**: `X-LLM-Token` のみ受理（Bearer 非対応）→ 修正済み。
2. **Hermes（本番で残っていた原因）**: `model.provider: custom` のまま非 OpenAI URL を指定すると、セキュリティ上 **`OPENAI_API_KEY` を送らず** `Authorization: Bearer no-key-required` になる（#28660）。DGX はこれを 403 とする。

request dump 例: `Authorization: Bearer no-key-required`

## Fix

1. **DGX** `gateway-server.py` に `llm_shared_token_ok()` を追加し、**`X-LLM-Token` と `Authorization: Bearer <token>` を同等**に受理。repo から **`scp`** → **PID 終了→`start-gateway-server.sh`**。
2. **Hermes `config.yaml`**: 名前付き custom provider + `key_env: OPENAI_API_KEY`（テンプレ `private-pi5-hermes.config.yaml.j2`）:

```yaml
model:
  provider: custom:dgx-system-prod
custom_providers:
  - name: dgx-system-prod
    base_url: http://100.118.82.72:38081/v1
    key_env: OPENAI_API_KEY
```

3. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` → `systemctl restart hermes-gateway`。

**実績（2026-05-24）**: Pi5 curl `bearer=200`・`chat/completions` 200。request dump が `no-key-required` から実トークンに変わることを確認。

## 関連: 8K 上限で圧縮ループ / auto-reset

**症状**: `Context too large (~3,830 tokens)` → 圧縮 1/3〜3/3 → `Cannot compress further` → Session auto-reset。ログに `maximum context length is 8192`・`8193 input tokens`。

**原因**: Hermes 既定の **hermes-discord ツール群**（tools JSON だけで数万文字）+ システムプロンプトが、初回「こんにちは」でも **DGX 実効 8K を超過**。`compression.enabled: false` でも API 400 時に圧縮リトライ経路に入る。

**対処**: `agent.disabled_toolsets` で全ツール無効化 + `platform_toolsets.discord: []` + `memory.memory_enabled: false`（テンプレ反映後 gateway 再起動・`/reset`）。

## 関連: 圧縮モデル ValueError（8K vs 64K）

403 解消後、Discord で `Auxiliary compression model … 8,192 … below minimum 64,000` が出る場合:

- **原因**: `compression` の補助 LLM が main と同じ `system-prod-primary`（実効 ~8K）で、Hermes は圧縮用に 64K を要求。
- **対処（雑談）**: `compression.enabled: false`（テンプレ既定）。長会話は DGX の ~8K 上限に注意。

## Prevention

- 新しい OpenAI 互換クライアントを DGX に載せる前に、**Bearer と X-LLM-Token のどちらを送るか**を Runbook に明記する。
- DGX gateway 変更後は **`healthz` + `/v1/models`（Bearer）** を Pi5 から smoke する。
- `gateway-server.py` の単体テスト（`tests/test_gateway_server.py`）に Bearer ケースを維持する。

## References

- Hermes env: `infrastructure/ansible/templates/private-pi5-hermes.env.j2`（`OPENAI_API_KEY` = DGX 共有トークン）
- StackChan: `scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py`
