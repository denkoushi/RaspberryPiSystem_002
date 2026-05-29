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
| Discord `/novel` E2E | 長文応答 | **要手動確認**（slash **Arguments 欄必須** · 1行テキスト `/novel プロット…` は 21:22 JST 成功例あり） |

## 追記 — `/novel` slash `args_hint` 修正（2026-05-29 21:56 JST）

**背景**: Discord ネイティブ slash が **引数なし**登録のままだと `get_command_args()` が空になり **usage のみ**返る（Investigation 表参照）。`args_hint="<creative prompt>"` と日本語 usage · verify 境界修正を main へ反映後、私用 Pi5 に再デプロイ。

| 項目 | 値 |
|------|-----|
| **Git** | branch **`feat/private-pi5-hermes-novel-slash-args-hint`** · commit **`66c1ff79`** · CI **`26637722184`** success |
| **対象** | 私用 Pi5 `raspi5-private`（`private-pi5-stackchan-bridge`）**のみ** |
| **手順** | 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| **結果** | **`PLAY RECAP` ok=138 changed=5 failed=0**（約 **191s** · 2026-05-29 21:56 JST 頃） |

### 実機検証（2026-05-29 21:56 JST 以降）

| チェック | 期待 | 実測 |
|----------|------|------|
| `hermes-gateway` | active · plugin より新しい起動 | **active** · **freshness_ok**（gateway ≥ `__init__.py` mtime） |
| plugin `args_hint` | novel `<creative prompt>` · task `<task instruction>` | **OK**（`__init__.py` 実機 grep + register smoke） |
| `render_novel_usage()` | 日本語 · Arguments 案内 | **OK**（「使い方: /novel …」） |
| Discord slash sync | fingerprint 変化後 reconcile | **`Safely reconciled` updated=1 recreated=50** · `last_success_at` 記録 |
| D4 非回帰 | `HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh` | **OK** |
| Playbook verify | approval relay · novel profile · discord bridge | **deploy 内 failed=0** |
| Discord `/novel` E2E | 長文（slash Arguments または 1行テキスト） | **手動未実施**（本デプロイ直後） |

### 運用上の使い分け（確定）

1. **スラッシュ UI**: `/novel` 選択 → **Arguments（プロンプト欄）** に続きを入力して送信（空だと usage）。
2. **1行テキスト（確実）**: `/novel 坂の上の雲の続きを書いて`（Hermes free-form · 21:22 JST 成功例）。
3. **初回 cold start**: DGX 35B uncensored は **数分**かかる場合あり。

## Investigation（デプロイ・検証トラブルシュート）

| 症状 | 根因 | Fix |
|------|------|-----|
| novel profile がデプロイされない | fragment に **`novel_profile_enabled` 未設定** | 両フラグ + `runtime_control_token` を fragment に追加して再デプロイ |
| `verify-discord-task-bridge-smoke.sh` が `unexpected commands: set()` | repo の `lib/` には **`task-bridge.policy.yaml` / `novel-bridge.enabled` が無い**（本番 plugin ディレクトリのみ） | smoke を **temp plugin_dir + `_plugin_dir` patch** に変更（2026-05-29） |
| `/novel` が Discord に出ない | `discord_novel_bridge_enabled: false` または gateway 未 restart | フラグ ON → 標準デプロイ（verify 前に gateway restart） |
| 初回 `/novel` が長時間無応答 | **35B uncensored cold start**（数分） | `DGX_RUNTIME_READY_TIMEOUT_SEC` 既定 900 · 待機または DGX で事前 warm |
| Discord `/novel` が **usage のみ**（20:56 JST） | plugin `register_command("novel")` に **`args_hint` 未指定** → Discord ネイティブ slash は **引数なし**登録 · `get_command_args()` が空 | **`args_hint="<creative prompt>"`** を追加して再デプロイ + gateway restart · 回避: チャットに **`/novel プロットを…`** と**続けて**入力（free-form） |
| verify approval relay が novel 必須で落ちる | `verify-discord-approval-relay.yml` が tools bridge 有効時のみ実行されるのに **novel を常時 assert** | **task 系のみ必須** · `novel-bridge.enabled` 存在時のみ novel 確認（`66c1ff79`） |
| smoke が `args_hint` 退行を検知しない | `DummyCtx.register_command` が kwargs を捨てていた | smoke で **args_hint assert** + **task-only シナリオ**追加（`66c1ff79`） |

## Prevention

- novel 有効化前に fragment の **3 変数**（novel profile / novel bridge / runtime control token）を checklist 化
- D5 非回帰は **`HERMES_TOOLS_PHASE=d4 verify-tools-profile-deploy.sh`** を novel デプロイ後も実行
- plugin smoke は **本番と同じ marker ファイル**を temp 配置して `register()` を検証
- Discord E2E は **短文プロンプト**から開始 · cold start 時間を Runbook に明記
- slash 定義変更後は gateway restart で **Discord command sync** を確認（`Safely reconciled` · fingerprint / `last_success_at`）
- verify は **有効フラグと一致**させる（approval relay ≠ novel 必須）

## References

- PR: [#370](https://github.com/denkoushi/RaspberryPiSystem_002/pull/370)（初回 novel profile）
- PR: **args_hint 修正** — branch `feat/private-pi5-hermes-novel-slash-args-hint` · **`66c1ff79`**
- CI: **`26634375437`**（初回）· **`26637722184`**（args_hint）
- Deploy log: `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` · **`ok=138 failed=0`**（初回 371s · args_hint 再デプロイ **191s**）
