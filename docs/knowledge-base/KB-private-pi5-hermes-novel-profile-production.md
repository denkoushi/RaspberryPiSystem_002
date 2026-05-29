# KB-private-pi5-hermes-novel-profile-production: Novel profile 本番反映（Discord `/novel`）

- **Status**: reference（2026-05-29 完了）
- **Related**: [Runbook §Novel](../runbooks/private-pi5-hermes-deploy.md#novel-profile--discord-novel長文創作--2026-05-29) · [ExecPlan Novel](../plans/private-pi5-hermes-novel-profile-execplan.md) · [KB Phase D5](./KB-private-pi5-hermes-phase-d5-production.md) · [DGX uncensored ExecPlan](../plans/dgx-uncensored-profile-button.md)

## Context

私用 Pi5 Hermes に **第3プロファイル `novel`** を追加。Discord **`/novel <指示>`** で長文創作専用 isolated HOME（`~/.hermes-novel`）へ委譲し、DGX には on-demand で **`POST /start {"modelProfileId":"qwen36_35b_uncensored"}`** を送る（chat keep-warm とは独立）。

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge` / `raspi5-private`）**のみ** · DGX / 業務 Pi5 / Pi3 / Pi4 は対象外（DGX 側 profile は既存登録済み）。

## 確定仕様（運用時点）

| 領域 | 仕様 |
|------|------|
| **chat** | `hermes-gateway` active · **max_tokens: 128** 維持 · toolsets 無効 |
| **tools** | D4/D5 維持 · `/task` 橋・承認中継は不変 |
| **novel profile** | `~/.hermes-novel` · isolated HOME `~/.hermes-novel/home` · **max_tokens: 2048** |
| **novel .env** | `DGX_MODEL_PROFILE_ID=qwen36_35b_uncensored` · chat トークン既定流用可 |
| **Discord `/novel`** | chat gateway plugin から `novel_profile_runner` → `hermes chat -q` |
| **DGX 起動** | novel runner が `dgx_runtime_client` 経由で profile 指定 start（keep-warm なし） |
| **plugin markers** | `novel-bridge.enabled` + 既存 `task-bridge.policy.yaml`（D5 共存） |

## fragment（Novel 必須・コミット禁止）

D5 フラグに加え:

```yaml
private_pi5_hermes_novel_profile_enabled: true
private_pi5_hermes_discord_novel_bridge_enabled: true
# 必須（/start 用）— D5 keep-warm と同値可
private_pi5_dgx_runtime_control_token: "<runtime-control-token>"
```

## 実施タイムライン（2026-05-29）

1. **repo**: branch **`feat/private-pi5-hermes-novel-profile`** · commit **`8a8b43f6`** · CI **`26634375437`** success
2. **fragment**（非コミット）: `novel_profile_enabled` / `discord_novel_bridge_enabled` を追加（`runtime_control_token` は既存）
3. **私用 Pi5 デプロイ**: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` — **`PLAY RECAP` ok=138 changed=13 failed=0**（約 **371s** · 2026-05-29 20:37 JST 頃）
4. **実機検証**:
   - systemd: `hermes-gateway` / `hermes-tools-gateway` / `stackchan-bridge` / `hermes-dgx-keep-warm.timer` → **active**
   - novel paths + `.env` `DGX_MODEL_PROFILE_ID` → **OK**
   - plugin register: **`novel` + `task` + `task-approve` + `task-deny`**
   - chat `max_tokens: 128` · novel `max_tokens: 2048` → **OK**
   - chat/novel Bearer → DGX **`200`**
   - `HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh` → **OK**（D4 非回帰）
   - ローカル: novel unittest **7 OK** · plugin register test **3 OK**
   - Discord `/novel` E2E（35B cold start）→ **未実施**（手動・数分待ち）

## 検証結果（実機）

| チェック | 期待 | 実測 |
|----------|------|------|
| `hermes-gateway` | active | **active** |
| `~/.hermes-novel/home/.hermes/config.yaml` | 存在 | **OK** |
| novel `.env` | `DGX_MODEL_PROFILE_ID=qwen36_35b_uncensored` | **OK** |
| plugin `novel-bridge.enabled` | 存在 | **OK** |
| plugin commands | novel + task 系 | **OK** |
| chat `max_tokens` | 128 | **128** |
| tools D4 契約 | `HERMES_TOOLS_PHASE=d4` | **OK** |
| Discord `/novel` E2E | 長文応答 | **未実施** |

## Investigation（デプロイ・検証トラブルシュート）

| 症状 | 根因 | Fix |
|------|------|-----|
| novel profile がデプロイされない | fragment に **`novel_profile_enabled` 未設定** | 両フラグ + `runtime_control_token` を fragment に追加して再デプロイ |
| `verify-discord-task-bridge-smoke.sh` が `unexpected commands: set()` | repo の `lib/` には **`task-bridge.policy.yaml` / `novel-bridge.enabled` が無い**（本番 plugin ディレクトリのみ） | smoke を **temp plugin_dir + `_plugin_dir` patch** に変更（2026-05-29） |
| `/novel` が Discord に出ない | `discord_novel_bridge_enabled: false` または gateway 未 restart | フラグ ON → 標準デプロイ（verify 前に gateway restart） |
| 初回 `/novel` が長時間無応答 | **35B uncensored cold start**（数分） | `DGX_RUNTIME_READY_TIMEOUT_SEC` 既定 900 · 待機または DGX で事前 warm |

## Prevention

- novel 有効化前に fragment の **3 変数**（novel profile / novel bridge / runtime control token）を checklist 化
- D5 非回帰は **`HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh`** を novel デプロイ後も実行
- plugin smoke は **本番と同じ marker ファイル**を temp 配置して `register()` を検証
- Discord E2E は **短文プロンプト**から開始 · cold start 時間を Runbook に明記

## References

- PR: [#370](https://github.com/denkoushi/RaspberryPiSystem_002/pull/370)
- CI: **`26634375437`**
- Deploy log: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` · **`ok=138 failed=0`**
