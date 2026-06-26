# ドキュメント索引

> **注意**: このINDEX.mdは、各種ドキュメント（docs/）の「入口」として機能します。
> - プロジェクト管理ドキュメント（EXEC_PLAN.md）は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照してください。
> - ドキュメント体系の基本思想については [README.md](../README.md) の「ドキュメント体系の基本思想」セクションを参照してください。

---

## 🎯 目的別インデックス

### AIエージェント運用

- **Codex/Cursor agmsg連携**: Codex主導・Cursor実行役のローカル協調手順。**記録**: [Guide](./guides/agmsg-codex-cursor-collaboration.md)

### 最新アップデート（2026-06-17 · キオスク順位ボード deferTotals 性能回復 · Pi5 先行）

- **現仕様正本**: [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)
- **関連Plan**: [`+人` 人工数表示切替](./plans/kiosk-leaderboard-labor-minutes-toggle.md) · [生産指示分割](./plans/production-schedule-split-orders.md) · [deferTotals 性能回復](./plans/leaderboard-defer-totals-performance-recovery.md)

### 最新アップデート（2026-06-15 · キオスク検査帳票 OCR 向け測定値ボックス）

- **検査帳票 記録欄 OCR レイアウト** · Web only · **Pi5 のみ本番 OK** · **`e0b3703d`** · Detach **`20260615-161806-4705`** · Phase12 **43/0/0**。**記録**: [KB-390](./knowledge-base/KB-390-kiosk-leaderboard-inspection-workflow.md)

### 最新アップデート（2026-06-15 · キオスク順位ボード 検査方法選択 + plannedQuantity 印刷）

- **検査導線正本**: [KB-390](./knowledge-base/KB-390-kiosk-leaderboard-inspection-workflow.md)。順位ボード現仕様の読み分けは [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

### 最新アップデート（2026-06-12 · キオスク順位ボード 追補完了後の更新中残留）

- **調査・修正正本**: [KB-384](./knowledge-base/KB-384-kiosk-leaderboard-append-pagesize-scope-stuck-sync.md)。現行 pageSize / 鮮度値の読み分けは [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

### 最新アップデート（2026-06-17 · キオスク順位ボード 基準時間余り帯）

- **Gantt 正本**: [kiosk-leaderboard-gantt-mode](./plans/kiosk-leaderboard-gantt-mode.md)。現仕様の読み分けは [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

### 最新アップデート（2026-06-11 · キオスク順位ボード ガント表示）

- **Gantt 正本**: [kiosk-leaderboard-gantt-mode](./plans/kiosk-leaderboard-gantt-mode.md)。8H/10H・累積境界の現仕様は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

### 最新アップデート（2026-06-07 · DGX resource runtimeProfile / resourceState）

- **DGX リソース**: `runtimeProfile` + `resourceState` + **業務復帰 async UX** + **モダン UI**（view model・状態/保守/ログタブ）本番 Pi5 反映済（**`95b4b0e4`**）。**記録**: [KB-389](./knowledge-base/KB-389-dgx-resource-runtime-profile-resource-state.md)

### 最新アップデート（2026-06-06 · Hermes Life Pilot）

- [KB Life Pilot](./knowledge-base/KB-private-pi5-hermes-life-pilot.md) — D13 `f782f59d` · D12 Obsidian · 再開正本

### 最新アップデート（2026-06-06 · 私用 Pi5 Hermes D6-pre · **Discord `/daily` Ansible sync 合格**）

- **D6-pre 完了**: Discord global `/daily` を **Ansible `present`/`absent` 管理**（`discord_command_sync.py`）· **標準 deploy 収束** · 安全 `/daily 今日の作業メモを作って` · 危険 `/daily git pushしてdeployして` rejected · unittest **149 OK** · `/task` `/novel` 維持。**スコープ**: 私用 Pi5 のみ。**記録**: [KB daily pilot](./knowledge-base/KB-private-pi5-hermes-daily-pilot.md) · [Runbook §D6-pre](./runbooks/private-pi5-hermes-deploy.md#phase-d6-pre--discord-daily-普段遣いパイロット2026-06-06-実機検証完了) · [ExecPlan D6-pre](./plans/private-pi5-hermes-daily-pilot-execplan.md) · [`EXEC_PLAN`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)

### 最新アップデート（2026-06-06 · Mac Cursor `state.vscdb` 破損復旧 · **ドキュメント記録**）

- **Cursor 状態DB復旧（開発端末）**: `state.vscdb` 約 42GB + backup 35GB · `SQLITE_CORRUPT` 大量 · **退避 76GB 後に新 DB 正常化**（integrity_check ok）· **プロジェクト/Git/WIP は無傷** · チャット/Agent 履歴は初期化。**外部SSD運用は継続**しサイズ監視。**記録**: [KB-388](./knowledge-base/KB-388-cursor-state-db-corruption-external-ssd-recovery.md) · [mac-storage-migration §state.vscdb](./guides/mac-storage-migration.md#cursor-statevscdb-の破損肥大化2026-06-06-追記) · [development §Agent復旧後](./guides/development.md#cursor-状態db復旧後の-agent-作業2026-06-06) · [`EXEC_PLAN` §Cursor復旧](../EXEC_PLAN.md#cursor-state-db-recovery-2026-06-06) · [AGENTS.md §復旧後](../AGENTS.md#cursor-状態db復旧後2026-06-06)

### 最新アップデート（2026-06-06 · 私用 Pi5 Hermes `/daily` D6-pre · **実機検証完了**）

- **D6-pre 私用 Pi5 受け入れ完了**: `/daily 今日の作業メモを作って` → **Daily Pilot Draft** · `/daily git pushしてdeployして` → **daily rejected**。**policy regex 修正** + **Discord `/daily` Ansible command sync**（`discord_command_sync.py`）· **標準 Ansible deploy 収束** · unittest **149 OK**。**記録**: [KB daily pilot](./knowledge-base/KB-private-pi5-hermes-daily-pilot.md) · [Runbook §D6-pre](./runbooks/private-pi5-hermes-deploy.md#phase-d6-pre--discord-daily-普段遣いパイロット2026-06-06-実機検証完了) · [`EXEC_PLAN`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)

### 最新アップデート（2026-06-05 · 私用 Pi5 Hermes `/daily` 普段遣いパイロット · **repo 実装**）

- **Discord `/daily` を追加**: `private_pi5_hermes_daily_pilot_enabled: true` の時だけ `daily-pilot.policy.yaml` を配備し、Cursor指示書・Codexレビュー依頼・CI/Deploy確認リストの **Markdownだけ** を返す（deterministic · LLM/worker 未呼び出し）。**自動実行なし**: Cursor/Codex CLI、terminal、git、deploy、秘密読取は拒否。**検証**: unittest **142 OK** · `--validate-daily-pilot` OK · smoke OK。**実機デプロイは次回**。**記録**: [KB daily pilot](./knowledge-base/KB-private-pi5-hermes-daily-pilot.md) · [D6-pre ExecPlan](./plans/private-pi5-hermes-daily-pilot-execplan.md) · [Runbook §D6-pre](./runbooks/private-pi5-hermes-deploy.md#phase-d6-pre--discord-daily-普段遣いパイロット2026-06-05) · [`daily-pilot.policy.yaml`](../scripts/private-pi5-hermes/config/daily-pilot.policy.yaml)

### 最新アップデート（2026-06-05 · 私用 Pi5 Hermes `/task` 安全枠 · **repo 明文化**）

- **`/task` の許可/保留境界を policy に固定**: `allowed_task_classes` / `deferred_task_classes` / `deny_prompt_patterns`（Codex/Cursor/git/deploy/terminal/秘密読取/tailnet scan は **D6+ worker まで deferred**）。**検証**: unittest **131 OK** · boundary validate OK · smoke OK · **Pi5 デプロイは次回**。**次**: D6 設計（memory）と並行で **Codex/Cursor worker 境界**（1 task = 1 worktree）。**記録**: [KB D5 §安全枠](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#task-安全枠の明文化2026-06-05--repo) · [脅威モデル](./knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md) · [執事ロードマップ](./plans/private-pi5-hermes-butler-vision-and-roadmap.md) · [`EXEC_PLAN`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)

### 最新アップデート（2026-06-05 夜 · 私用 Pi5 Hermes `/task` write E2E · **Discord 受け入れ完了**）

- **承認 `yes` が割り込みに吸われる問題を解消**: repo は **`channel:<channel_id>` 承認キー** + plugin hook 強化 · Pi5 実機は Hermes **`gateway/platforms/base.py` hotfix**（承認短文本を interrupt より先に `pre_gateway_dispatch` へ）。**E2E**: `/task Create test-20260605-2.txt …` → `yes` → workspace 作成 OK · unittest **129 OK**。**記録**: [KB D5 §yes 最終修正](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--承認-yes-が割り込みに吸われる2026-06-05-夜--discord-write-e2e-完結) · [Runbook §base.py hotfix](./runbooks/private-pi5-hermes-deploy.md#hermes-agent-本体-hotfix承認-yes-の割り込み回避2026-06-05) · [`EXEC_PLAN`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)

### 最新アップデート（2026-06-05 · 私用 Pi5 Hermes `/task` 復旧 · **repo + 実機 hotfix 済**）

- **二段障害の復旧**: (1) Discord 承認通知 **`403` / Cloudflare `1010`** → [`discord_relay.py`](../scripts/private-pi5-hermes/lib/approval_relay/discord_relay.py) に **Bot User-Agent** · (2) DGX blue 27B 起動失敗 → **`/v1/models` 502** → snapshot path · **`gpu-memory-utilization 0.65`** · **`language_model_only`**（secret は Git 禁止、example/runbook/KB のみ）。**検証**: unittest **127 OK** · smoke OK · Pi5 read-only `/task` 相当 OK · Discord write E2E **手動推奨**。**記録**: [KB D5 §2026-06-05](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--discord-task-二段障害2026-06-05) · [KB `/task` blue 502](./knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md#追記--blue-backend-起動失敗で-v1models-5022026-06-05) · [Hermes Runbook](./runbooks/private-pi5-hermes-deploy.md#本番復旧--task-二段障害2026-06-05) · [dgx Runbook](./runbooks/dgx-system-prod-local-llm.md) · [`EXEC_PLAN`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)

### 最新アップデート（2026-06-05 · キオスク順位ボード・資源カード行 強調レイアウト · **Pi5→Pi4×4 本番・実機 OK**）

- **UI履歴正本**: [KB-297 §カード行強調](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-card-row-emphasis-layout-2026-06-05)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-card-row-emphasis-layout-2026-06-05) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-card-row-emphasis-layout-verification-2026-06-05)。

### 最新アップデート（2026-06-10 · キオスク UX 設定 · 仕掛中ハブ + ヘッダータブ順 · **Pi5+Pi4×4 本番**）

- **ブランチ**: **`feat/kiosk-self-inspection-wip-and-tab-order`** · **`c9b265a9`** · Phase12 **43/0/0** · **記録**: [Runbook §キオスク UX 設定](./runbooks/kiosk-part-measurement.md#kiosk-ux-settings-wip-and-tab-order-2026-06-10)

### 最新アップデート（2026-06-05 · キオスク自主検査・セッション ボタンUI統一 + 操作誘導 · **Pi5 本番・実機 OK**）

- **見た目統一**（押せる/押せない 1 形 · 白枠なし）+ **`入力を保存` / `自主検査を完了` のみ** 押せるとき **青外枠**（`highlighted` = 既存 `enabled` · 文言追加なし）。**ブランチ**: **`feat/kiosk-self-inspection-button-ui`** · **`f2b374f5`** / **`ffdaebda`** · **CI** **`26990244892`** success · **本番**: Pi5 Detach **`20260605-105452-27065`** · Phase12 **43/0/0** · **Pi5 目視 OK** · Pi4×4 **未**。**将来**: 他画面への横展開は別機会。**記録**: [deployment §ボタンUI](./guides/deployment.md#kiosk-self-inspection-session-button-ui-2026-06-05) · [KB-320 §ボタンUI](./knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション-ボタンui統一-2026-06-05) · [Runbook §ボタンUI](./runbooks/kiosk-part-measurement.md#自主検査-セッション-ボタンui統一-2026-06-05) · [要件](./design-previews/kiosk-self-inspection-session-buttons-requirements.md)

### 最新アップデート（2026-06-04 · キオスク自主検査・セッション操作ボタン活性 · **Pi5→Pi4×4 本番・Phase12 OK**）

- **保存 / 自主検査を完了 / 再開**の活性を `selfInspectionSessionActionState` に集約。完了は **required slot** + 未保存ドラフトなし（公差最終は API 正本）。**ブランチ**: **`feat/kiosk-self-inspection-button-actions`** · **`4f44dbb9`** · **CI** **`26949777126`** success · **本番**: Pi5 **`20260604-205746-21197`** → Pi4×4 順次（各 `failed=0`）· Phase12 **43/0/0** · Pi3 **対象外**。**記録**: [deployment §ボタン活性](./guides/deployment.md#kiosk-self-inspection-session-button-actions-2026-06-04) · [KB-320 §ボタン活性](./knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04) · [Runbook §ボタン活性](./runbooks/kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04)

### 最新アップデート（2026-06-04 · Pi3 サイネージ・Tailscale Key expiry · **復旧・Disable key expiry 全端末**）

- **事象**: 現場 Pi3（`raspberrypi-2`）で **デスクトップのみ**・管理画面 **Expired**・Pi5 の `current-image` は **200**。**復旧**: オフィス移設後 tailnet 復旧 → 現場戻し後もサイネージ表示 OK（Pi3 上コマンド未実行の例あり）。**恒久**: Tailscale **Disable key expiry** を全常時稼働端末に適用。**記録**: [KB-386](./knowledge-base/infrastructure/signage.md#kb-386-pi3サイネージ非表示tailscale-key-expiryとネットワーク経路) · [KB-387](./knowledge-base/infrastructure/security.md#kb-387-常時稼働端末の-tailscale-key-expiry-無効化全端末-disable-key-expiry) · [Runbook](./runbooks/pi3-signage-tailscale-recovery.md) · [deployment §2026-06-04](./guides/deployment.md#pi3-signage-tailscale-key-expiry-2026-06-04) · `scripts/ops/recover-pi3-signage-remote.sh`

### 最新アップデート（2026-06-02 · キオスク順位ボード・過去納期滞留調査 · **調査中断・ドキュメントのみ**）

- **調査正本**: [KB-383](./knowledge-base/KB-383-kiosk-leaderboard-stale-past-due-investigation.md)。関連: [KB-297 §調査](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-stale-past-due-investigation-2026-06-01)。

### 最新アップデート（2026-06-01 · キオスク順位ボード・完了後フッタ工程チップ装飾の再同期 · **Pi5 本番・実機 OK（自動）**）

- **完了整合正本**: [KB-375 §2026-06-01](./knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md#production-2026-06-01-completion-decoration-resync)。関連: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-completion-decoration-resync-verification-2026-06-01)。

### 最新アップデート（2026-05-29 · 私用 Pi5 Hermes `/novel` slash `args_hint` · **本番反映済**）

- **Discord `/novel` slash 引数欄 + verify 境界**: `args_hint="<creative prompt>"` · 日本語 usage · approval-relay verify は task 系のみ必須 · smoke が args_hint 退行検知。**ブランチ**: **`feat/private-pi5-hermes-novel-slash-args-hint`** · **`66c1ff79`** · CI **`26637722184`** success · **本番**: **私用 Pi5 のみ** · **`PLAY RECAP` ok=138 changed=5 failed=0**（約 **191s**）· plugin `args_hint` **OK** · Discord sync **updated=1** · D4 **OK** · Discord E2E **手動待ち**（Arguments 欄 or 1行テキスト）。**記録**: [KB §args_hint](./knowledge-base/KB-private-pi5-hermes-novel-profile-production.md#追記--novel-slash-args_hint-修正2026-05-29-2156-jst) · [Runbook §args_hint デプロイ](./runbooks/private-pi5-hermes-deploy.md#novel-profile--args_hint-修正デプロイ2026-05-29-2156-jst)

### 最新アップデート（2026-05-29 · 私用 Pi5 Hermes Novel profile · **本番反映済**）

- **Hermes 第3プロファイル `novel` + Discord `/novel`**: 雑談（128 token）・作業（`/task`）と分離し、長文創作は isolated `~/.hermes-novel` + DGX **`qwen36_35b_uncensored`** on-demand。**ブランチ**: **`feat/private-pi5-hermes-novel-profile`** · **`8a8b43f6`** · CI **`26634375437`** success · **本番**: **私用 Pi5 のみ**（`raspi5-private`）· **`PLAY RECAP` ok=138 failed=0**（約 **371s**）· DGX/業務 Pi5/Pi3/Pi4 **未実施** · verify: novel paths · plugin **`/novel`** · chat **128** / novel **2048** · D4 **OK**。**記録**: [KB Novel 本番](./knowledge-base/KB-private-pi5-hermes-novel-profile-production.md) · [Runbook §Novel 本番](./runbooks/private-pi5-hermes-deploy.md#novel-profile--本番反映2026-05-29) · [ExecPlan Novel](./plans/private-pi5-hermes-novel-profile-execplan.md)

### 最新アップデート（2026-05-29 · DGX 業務モデル意図の Pi5 伝播 · **本番反映済**）

- **業務復帰で選んだ modelProfileId を職場 Pi5 業務機能へ共有**: `BusinessProfileIntentStore` + `INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID`。photo_label / document_summary / admin_console_chat / stackchan_chat が同一 profile 意図を参照。`INFERENCE_RUNTIME_START_PROFILE_ENABLED` は既定 `false`（shadow 維持）。**ブランチ**: **`feat/dgx-business-profile-propagation`** · **`fd16b711`** / **`1edebd70`** · CI **`26618352572` success** · **本番**: **`raspberrypi5` のみ** Detach **`20260529-141701-10018`**（**`failed=0`** · 約 **930s**）· DGX/Pi4/Pi3 **未実施** · Phase12 **43/0/0**（約 **30s**）· api **`business-profile-intent*.js`** · env **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`** · Web **「Pi5 業務意図」**。**記録**: [deployment §業務モデル意図](./guides/deployment.md#dgx-business-profile-intent-propagation-2026-05-29) · [KB-365 §本番](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-business-profile-intent-propagation) · [Runbook §本番](./runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-29-business-profile-intent-propagation) · [KB-366 §2](./knowledge-base/KB-366-dgx-spark-operational-understanding.md#2-写真ラベル要領書hermes-は別モデルか)

### 最新アップデート（2026-05-28 · DGX 業務復帰 Strict Ready profile 一致 · **本番反映済**）

- **DGX 業務復帰 Strict Ready と model profile 一致**: 27B 選択なのに 35B が稼働したまま execute が success になる不具合を修正。**`/v1/models` に加え `activeProfileId` / `state.backend` 一致を Strict Ready 必須**。**ブランチ**: **`fix/dgx-strict-ready-profile-match`** · **`90ba94d9`** · CI **`26575185778` success** · **本番**: **`raspberrypi5` のみ** Detach **`20260528-221349-13434`**（**`failed=0`** · 約 **932s**）· DGX/Pi4/Pi3 **未実施** · Phase12 **43/0/0**（約 **110s**）。**記録**: [deployment §Strict Ready profile](./guides/deployment.md#dgx-strict-ready-profile-match-2026-05-28) · [KB-365 §本番](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-strict-ready-profile-match) · [Runbook §本番](./runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-strict-ready-profile-match) · [KB-366 §KPI 不一致](./knowledge-base/KB-366-dgx-spark-operational-understanding.md#dgx-strict-ready-model-profile-mismatch-2026-05-28)。

### 最新アップデート（2026-05-28 · DGX activeProfileId null · Pi5 API 契約修正 · **本番反映済**）

- **DGX activeProfileId null の Pi5 API 契約修正**: 業務復帰でモデル 2 件選べるのに **503 `DGX_MODEL_PROFILES_UNAVAILABLE`** となる不具合を修正。**`activeProfileId: null` でも allowlist 取得成功時は `overview.modelProfiles.status: ok`**。**ブランチ**: **`fix/dgx-active-profile-null-contract`** · **`f4ec13dc`** · CI **`26572037918` success** · **本番**: **`raspberrypi5` のみ** Detach **`20260528-204344-14223`**（**`failed=0`** · 約 **903s**）· DGX/Pi4/Pi3 **未実施** · **検証**: Pi5 api **`status:ok` + assert 成功** · Phase12 **43/0/0**。**記録**: [deployment §activeProfileId null](./guides/deployment.md#dgx-active-profile-null-contract-2026-05-28) · [KB-365 §本番 activeProfileId null](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-active-profile-null-contract) · [Runbook §本番 activeProfileId null](./runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-activeprofileid-null-pi5-api)。

### 最新アップデート（2026-05-28 · DGX 27B model profile ストレージパス · **本番反映済**）

- **DGX 27B `currentStorageLocation` 修正（UI でモデル 2 件選択）**: 業務復帰ドロップダウンが **1 件のみ**だった原因は 27B manifest の **`hub/` 欠落**（`status: unavailable`）。**DGX registry のみ `scp` 反映**·再起動不要。**ブランチ**: **`fix/dgx-model-profile-current-storage-path`**·**`ff5947c8`**·CI **`26569969639` success**·**本番**: **DGX Spark のみ**（Pi5/Pi4/Pi3 **未実施**）·**検証**: `GET /system/model-profiles` → **2 件とも `available`**。**記録**: [deployment §storage path](./guides/deployment.md#dgx-model-profile-storage-path-2026-05-28)·[KB-365 §本番 storage path](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-model-profile-storage-path)·[KB-366 §storage path](./knowledge-base/KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-model-profile-storage-path)·[Runbook](./runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-27b-model-profile-storage-path)。

### 最新アップデート（2026-05-28 · DGX 業務復帰モデル選択 · **本番反映済**）

- **DGX 業務復帰モデル選択**: 私用/実験→業務ガイドで `modelProfileId` を選択。DGX が allowlist と active state の正本（`/system/model-profiles` / `/system/model-profile`）、Pi5/Web は ID のみ。`planFingerprint` は ID 差分で変化。初期 profile は `business_qwen36_27b_nvfp4`（blue 推奨）と `business_qwen35_35b_gguf`（green）。**ブランチ**: **`feat/dgx-business-model-selection`**·**`91be7dcf`**·CI **`26566270315`**（`lint-build-unit` / `e2e-*` / `api-db-and-infra` **success** · `security-docker` **failure** — 本変更と無関係）·**本番**: **① `raspberrypi5` のみ** Detach **`20260528-184011-18178`**（**`failed=0`**·**`--follow` 約 1195s**）→ **② DGX Spark**（`scp` + PID 再起動·Ansible 対象外）·**Phase12 43/0/0**（約 **111s**）·DGX **`GET /system/model-profiles` → profiles 2**。**記録**: [deployment §2026-05-28](./guides/deployment.md#dgx-business-return-model-selection-2026-05-28)·[KB-365 §本番](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-business-return-model-selection)·[KB-366](./knowledge-base/KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-business-return-model-selection)·[Runbook](./runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-業務復帰モデル選択)·[`scripts/dgx-local-llm-system/README.md`](../scripts/dgx-local-llm-system/README.md)。

### 最新アップデート（2026-05-26 · キオスク完了判定の正常化 · **本番反映済**）

- **キオスク順位ボード・完了正本の正常化**: 実効完了を **手動完了 + FKOJUNST_Status `C`/`X`** に限定し、**生産日程CSV差分消失による完了**を廃止。**ブランチ**: **`fix/kiosk-completion-status-only`**·**`a970e795`**·CI **`26429750347` success**·**本番**: **`raspberrypi5` のみ**·Detach **`20260526-121604-8450`**（**`failed=0`**·**`--follow` 約 769s**）·migration **`20260526030000_disable_schedule_csv_disappearance_completion`**·**Phase12 43/0/0**（約 **30s**）·DB **消失フラグ true = 0 件**。**記録**: [deployment §2026-05-26](./guides/deployment.md#kiosk-completion-status-only-2026-05-26)·[ADR-20260526](./decisions/ADR-20260526-production-schedule-completion-status-only.md)·[KB-370](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-26-schedule-csv-disappearance-disabled)·[KB-375](./knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md#production-2026-05-26-completion-status-only)·[KB-377](./knowledge-base/KB-377-kiosk-leaderboard-resource-chip-completion-verification.md#production-2026-05-26-completion-status-only)。

### 🆕 最新アップデート（2026-05-24 · 私用 Pi5 Hermes Agent · Discord 雑談 E2E）

- **私用 Pi5 Hermes — AI執事ビジョン（2026-05-25）**: 最終的には **Discord から裏で tools**（メモ/リマインド・X 定時・簡易アプリ・HA/カメラ）。**いまはセキュア基盤優先**（chat 雑談はツール無効 · tools は file+web まで本番）。**正本**: [執事ロードマップ](./plans/private-pi5-hermes-butler-vision-and-roadmap.md)·[`EXEC_PLAN`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)。
- **私用 Pi5 Hermes Agent — Phase D3 本番（2026-05-25）**: D2 の **file** に **`web`** を追加 · `website_blocklist` 同期 · 私用 Pi5 のみデプロイ・`HERMES_TOOLS_PHASE=d3` **OK**。**記録**: [KB Phase D3 本番](./knowledge-base/KB-private-pi5-hermes-phase-d3-production.md)·[ExecPlan D3](./plans/private-pi5-hermes-tools-security-phase-d3-execplan.md)·[Runbook §D3 本番](./runbooks/private-pi5-hermes-deploy.md#phase-d3--file--web実機本番反映2026-05-25)。
- **私用 Pi5 Hermes Agent — Phase D4 本番（2026-05-25）**: D3 に **`browser`**（ローカル agent-browser symlink · `AGENT_BROWSER_ARGS`）· **私用 Pi5 のみデプロイ・検証済**。**記録**: [KB Phase D4 本番](./knowledge-base/KB-private-pi5-hermes-phase-d4-production.md)·[ExecPlan D4](./plans/private-pi5-hermes-tools-security-phase-d4-execplan.md)·[Runbook §D4](./runbooks/private-pi5-hermes-deploy.md#phase-d4--file--web--browser実機本番反映2026-05-25)。
- **私用 Pi5 Hermes Agent — Phase D5.1 承認中継（2026-05-25）**: Discord `/task` write 時の **manual 承認**を file IPC で中継 · **私用 Pi5 デプロイ済**（2026-05-25 22:36 JST session context fix 含む · handler 直呼び OK · Discord UI E2E は手動未）。**記録**: [ExecPlan D5.1](./plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md)·[KB D5 §D5.1 本番](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#phase-d51-追記2026-05-25--repo-実装--私用-pi5-本番反映)·[Runbook §D5.1](./runbooks/private-pi5-hermes-deploy.md#phase-d51--discord-承認中継2026-05-25--私用-pi5-本番反映)。
- **私用 Pi5 Hermes Agent — Phase D5 本番（2026-05-25）**: Discord **`/task`** plugin → tools（file+web+browser）· chat ツール直結なし · **私用 Pi5 デプロイ済**。**記録**: [KB Phase D5 本番](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md)·[Runbook §D5](./runbooks/private-pi5-hermes-deploy.md#phase-d5--discord-task-橋実機本番反映2026-05-25)·[ExecPlan D5](./plans/private-pi5-hermes-tools-security-phase-d5-execplan.md)·[ADR D5](./decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)。
- **私用 Pi5 Hermes Agent — Novel profile（2026-05-29 · 本番反映済）**: 第3プロファイル **`novel`** · Discord **`/novel`** · DGX **`qwen36_35b_uncensored`** on-demand · **slash `args_hint` 修正デプロイ済**（2026-05-29 21:56 JST）。**記録**: [KB Novel 本番](./knowledge-base/KB-private-pi5-hermes-novel-profile-production.md) · [ExecPlan Novel](./plans/private-pi5-hermes-novel-profile-execplan.md) · [Runbook §Novel 本番](./runbooks/private-pi5-hermes-deploy.md#novel-profile--本番反映2026-05-29)。
- **私用 Pi5 Hermes Agent（セキュリティ先行・DGX 雑談・Discord DM E2E 成功）**: 専用 **`hermes`**・**Docker 隔離**・**UFW**・**v0.14.0**・**`hermes-gateway` active**。**雑談プロファイル**: ツール無効・`compression: false`・**`max_tokens: 128`**・**簡潔 `system_prompt`**・thinking 注入（DGX gateway）・keep-warm。**Phase C 完了**（実用レベル）: keep-warm + thinking 注入 + max_tokens 128 → **8.7〜10.7 s/通**。**skills/memory 無効**（会話から自動では賢くならない）。主因 **DGX 推論**（[KB E2E](./knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md)·[KB スキル/フォーラム/設計](./knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md)）。**記録**: [plan](./plans/private-pi5-hermes-agent-plan.md)·[Runbook](./runbooks/private-pi5-hermes-deploy.md)·[KB Discord E2E](./knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md)·[ADR-20260524](./decisions/ADR-20260524-private-pi5-hermes-security-profile.md)·[`EXEC_PLAN.md`](../EXEC_PLAN.md#private-pi5-hermes-discord-2026-05-24)。

### 🆕 最新アップデート（2026-05-25 · DGXリソース `private_ok` 強制メモリ解放 · 本番反映済）

- **DGXリソース `private_ok` 強化（Comfy 向けに業務 LLM を強制退避）·本番 Pi5→DGX 順次·実機 OK（自動）**: `private_ok` は **experiment-lab / agent-container 停止**に加え、**`system-prod-gateway` を `POST /stop-force`** で **blue keep-warm を上書き**。**通常 `/stop` と分離**。**ブランチ `feat/dgx-resource-strong-private-ok`**·代表 **`7fe1ca15`** / **`2d91d032`**·CI **`26386720859` success**·Detach Pi5 **`20260525-162034-25035`**（`failed=0`）·DGX **`control-server.py` + `gateway-server.py`（`/stop-force` 転送）**·`verify-phase12-real.sh` **43/0/0**（約 **68s**）。**知見**: **`38081/stop-force` は gateway 転送必須**（control-server のみでは 404）。**記録**: [deployment §2026-05-25](./guides/deployment.md#dgx-resource-private-ok-strong-stop-force-2026-05-25)·[KB-365 §本番](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-25-dgx-private-ok-stop-force)·[KB-366 運用理解](./knowledge-base/KB-366-dgx-spark-operational-understanding.md)·[Runbook](./runbooks/dgx-system-prod-local-llm.md)·[ADR-20260428](./decisions/ADR-20260428-dgx-active-backend-prod-default.md)·[`EXEC_PLAN.md`](../EXEC_PLAN.md)。

### 🆕 最新アップデート（2026-05-22 · 順位ボード・製番左縁全件無色）

- **UI履歴正本**: [KB-297 §全件無色](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-no-color-all-items-2026-05-22)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-seiban-accent-no-color-all-items-2026-05-22) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-seiban-accent-no-color-all-items-verification-2026-05-22)。

### 🆕 最新アップデート（2026-05-22 · 順位ボード・行内順位ピッカー）

- **UI履歴正本**: [KB-297 §行内順位ピッカー](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-row-order-rank-picker-2026-05-22)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-row-order-rank-picker-2026-05-22) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-row-order-rank-picker-verification-2026-05-22)。

### 🆕 最新アップデート（2026-05-22 · 順位ボード・手動順位行ハイライト — 履歴）

- **履歴正本**: [KB-297 §手動順位行](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-manual-order-row-highlight-2026-05-22)。サイネージ側の履歴は [KB-335](./knowledge-base/infrastructure/signage.md)。

### 🆕 最新アップデート（2026-05-22 · 順位ボード・手動順位行ハイライト — 旧索引）

- **旧履歴参照**: [KB-297 §手動順位行](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-manual-order-row-highlight-2026-05-22)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-manual-order-row-highlight-2026-05-22) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-manual-order-row-highlight-verification-2026-05-22)。

### 🆕 最新アップデート（2026-05-22 · 順位ボード・スロット「順位」ボタン）

- **UI履歴正本**: [KB-297 §スロット順位](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-slot-auto-rank-2026-05-22)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-slot-auto-rank-2026-05-22) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-slot-auto-rank-verification-2026-05-22)。

### 🆕 最新アップデート（2026-05-22 · 吊具点検サイネージカード chrome 統一）

- **吊具点検サイネージカード chrome 統一（点検のみも青·API のみ·Pi5 本番反映済）**: Gmail CSV **点検のみ**従業員も **キオスク持出と同じ青カード**（`resolveRiggingHasVisibleLoanState`）·**ヘッダ `貸出中/返却` は Loan 実績のまま**·**MI は従来**。**ブランチ**: **`fix/rigging-inspection-card-chrome-unify`**（**`cf8c13bf`**·CI **`26275892524` success**）·**本番**: **`raspberrypi5` のみ**·Detach **`20260522-174718-22503`**·**Phase12** **43/0/0**（約 **85s**）。**記録**: [KB-381](./knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)·[deployment §chrome 統一](./guides/deployment.md#rigging-inspection-card-chrome-unify-2026-05-22)·[`EXEC_PLAN.md`](../EXEC_PLAN.md)。**運用デプロイ（マージ後）**: **`./scripts/update-all-clients.sh main … --limit raspberrypi5`**。

### 🆕 最新アップデート（2026-05-22 · 吊具点検 dedup refresh / サイネージデザイン分離）

- **吊具点検 dedup refresh · idNum 登録 · サイネージデザイン分離（API のみ·Pi5 本番反映済）**: 投影 dedup 時 **`inspectedAt` refresh**·idNum **80/73/69/82** マスタ登録·**吊具 active 複数のみ ` ・ ` 結合**（MI は従来 1 行/機器）。**ブランチ**: **`fix/loan-inspection-card-combined-mgmt-numbers`**（**`49386387`**）·**本番**: **`raspberrypi5` のみ**·Detach **`20260522-160832-6784`** / **`20260522-163138-380`**·**Phase12** **43/0/0**·backfill **103 created / 7 refreshed**·加工担当 **5/22 暦日 18 件/10 名**。**記録**: [KB-381](./knowledge-base/KB-381-rigging-slings-inspection-gmail-signage.md)·[deployment §dedup refresh](./guides/deployment.md#rigging-inspection-dedup-refresh-signage-layout-2026-05-22)·[`EXEC_PLAN.md`](../EXEC_PLAN.md)。**運用デプロイ（マージ後）**: **`./scripts/update-all-clients.sh main … --limit raspberrypi5`**。

### 🆕 最新アップデート（2026-05-22 · キオスク下端リビール）

- **キオスク沉浸式ヘッダー・下端中央1/3リビール（Web + Pi4 Ansible・本番反映済）**: 上端全幅廃止→**下端14px×中央1/3**で `KioskHeader` を下から表示。**`/kiosk/photo`** を沉浸式 allowlist に追加。Pi4 は **`_appRef`** + Firefox キャッシュ無効。**ブランチ**: **`feat/kiosk-bottom-center-header-reveal`**（**`cbeb6bbc`**·CI **`26262397906` success**）·**本番**: Pi5 → StoneBase01 → Pi4×3 · Detach **`20260522-101951-717`** ほか 5 本·**Phase12** **43/0/0**·**StoneBase01 実機 UI OK**。**記録**: [KB-311](./knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)·[deployment §下端リビール](./guides/deployment.md#kiosk-bottom-center-header-reveal-2026-05-22)·[deploy-status-recovery](./runbooks/deploy-status-recovery.md)·[`EXEC_PLAN.md`](../EXEC_PLAN.md)。**運用デプロイ（マージ後）**: **`./scripts/update-all-clients.sh main … --limit <host>`**（キオスク Web は Pi5 配信だが Pi4 は起動 URL・キャッシュのため **Pi4 も反映**）。

### 🆕 最新アップデート（2026-05-21 · shell 初回最適化 第1弾）

- **性能履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §shell 第1弾。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-shell-initial-opt-phase1-2026-05-21)。現行の初回/continue仕様は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

### 🆕 最新アップデート（2026-05-21 · continue chunk 80/80）

- **性能履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §continue 80/80。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-continue-chunk-80-2026-05-21)。現行continueサイズは [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

### 🆕 最新アップデート（2026-05-20 · 順位割当 A+α）

- **順位割当正本**: [KB-297 §A+α](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-order-assignment-auto-release-a-alpha-2026-05-20) · [verification](./guides/verification-checklist.md#kiosk-leaderboard-order-assignment-auto-release-verification-2026-05-20)。

### 🆕 最新アップデート（2026-05-18）

- **生産日程CSV消滅・`FKOJUNST_Status` `X` を母集団外へコード整合（本番反映済）**: 文書上は従来 **`C`/`X` はメール完了・消滅母集団外** としていたが、実装の重複条件で **`X` が母集団に残り得た**ため、**`buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql`** に **一覧・母集団双方を寄せ** **`NOT IN ('C','X')`** を単一正本化。**ブランチ**: **`fix/kiosk-completion-exclude-x-from-disappearance`**（**`49d19dce`**）·**CI**: **`2170bb18`**（**`.trivyignore` `CVE-2026-4878`** + **`ci.yml` API scan `trivyignores`**）·**本番**: **`raspberrypi5` のみ**·**Detach `20260518-175005-7497`**（**`ok=134` `changed=4` `failed=0`**·`--follow` **約 987s**·**Docker 再起動 `ok`**）·**Phase12** **43/0/0**（**`real` 約 81s**）·Pi4／Pi3 **no hosts matched**。**記録**: [deployment §2026-05-18](./guides/deployment.md#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18)·[KB-370 §2026-05-18](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-18-schedule-csv-disappearance-exclude-x-code-alignment)·[`EXEC_PLAN.md`](../EXEC_PLAN.md)。**`main`**: [PR #294](https://github.com/denkoushi/RaspberryPiSystem_002/pull/294) **squash** **`e2abadce`**。**運用デプロイ**: **`./scripts/update-all-clients.sh main … --limit raspberrypi5`**。

### 🆕 最新アップデート（2026-05-16 / 2026-05-17）

- **生産日程CSV「消滅」外部完了・正本Cの current keys（2026-05-16 本番反映）**: **本体 dedupe winner のみ**を入力に採り、**メール FK 欠落だけでは現側から落とさない**。**本番**: ブランチ **`feat/canonical-schedule-disappearance-current-keys`**（**`09f06ebf`**）·**`raspberrypi5` のみ**·**Detach `20260516-181817-25397`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0`**）·**Phase12 `verify-phase12-real.sh` 43/0/0**（約 **140s**）·Pi4／Pi3 play **no hosts matched**。**CI**: **`25956906908` success**（**Trivy Caddy/stdlib HIGH** は **`.trivyignore`**·**`0e327378`**）。**記録**: [deployment §2026-05-16](./guides/deployment.md#schedule-csv-disappearance-canonical-current-keys-2026-05-16)·[KB-370 §Production 2026-05-16](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-16-schedule-csv-disappearance-canonical-current-keys)。

- **2026-05-17 · 2CSV 交差で消滅 current keys（本番反映）**: **本体 dedupe winner** と **`tB <= tA` の最新完了 `FKOJUNST_Status` ingest run 原本CSV 1件** の **ADR-20260509 系3キー交差**を正本にする。**ブランチ**: **`fix/kiosk-completion-csv-pairing`**（**`ed733bfe`**）·**`main`**: [PR #290](https://github.com/denkoushi/RaspberryPiSystem_002/pull/290) **squash** **`f252793d`**·**本番**: **`raspberrypi5` のみ**·**Detach `20260517-151209-29249`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0`**）·**Docker 再起動 `skipping`**·**新規マイグレなし**·**Phase12** `./scripts/deploy/verify-phase12-real.sh` → **最終 43/0/0**（約 **140s**·1 回目は Pi5 SSH **`Connection closed`** で **`backup.json` 存在**のみ FAIL → **再実行で全 PASS**）。Pi4／Pi3 **no hosts matched**。**参照**: [deployment §2026-05-17](./guides/deployment.md#schedule-csv-disappearance-2csv-intersection-2026-05-17)·[KB-370 §Production 2026-05-17](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-17-schedule-csv-disappearance-2csv-current-keys)·[`EXEC_PLAN.md`](../EXEC_PLAN.md)。**会話整理（実装前メモ・旧）**: [KB-370 Follow-up 残留](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#follow-up2026-05-17--未解決残留ケースの会話整理旧)。**運用（スケジュール正本・誤読防止）**: [KB-370 §2CSV 運用](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#kb-370-2csv-schedule-operational-pairing)·[csv-import-export §FKOJUNST / 2CSV](./guides/csv-import-export.md#fkojunst-2csv-disappearance-schedule-notes)。

### 🆕 最新アップデート（2026-05-14）

- **StackChan 私用 Pi5 bridge: Home Assistant（読み取り context）、chat/SST 運用ノブ、実機フェーズアウトの引き継ぎ KB 反映**: **`home_assistant_client.py`** と env（`HOME_ASSISTANT_*`）、**chat 検証設定**（`STACKCHAN_CHAT_*`）、**`faster-whisper-local`** の **`STT_LOCAL_RETRY_WITHOUT_VAD` / `STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY`** を repo に反映。並行していた **上流 `AI_StackChan_Ex` のウェイクワード登録／オフライン（Smart Config 失敗）／USB 書き込み失敗／`pio device monitor` の termios 問題**は **KB §2026-05-14** と **text-only runbook §6.4** に集約。**正本リンク**: [KB-stackchan-community-firmware-supply-chain.md §2026-05-14](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md)·[private-pi5-stackchan-bridge-deploy.md](./runbooks/private-pi5-stackchan-bridge-deploy.md)·[`scripts/private-pi5-stackchan-bridge/README.md`](../scripts/private-pi5-stackchan-bridge/README.md)·[stackchan-community-text-only-e2e.md §6.4](./runbooks/stackchan-community-text-only-e2e.md#64-2026-05-14-引き継ぎウェイクワード登録オフラインシリアル)。

### 🆕 最新アップデート（2026-05-31）

- **StackChan CoreS3 bring-up probe 全面停止（表示互換性未解決）**: 公式 **StackChan-UserDemo-V1.4.1** は full erase + write 後 **画面 OK**（ハード正常）。一方 Arduino/M5Unified probe（Step B〜E1）は **シリアル正常でも目視真っ黒** — Step B は **以前一度表示できた**が再確認でも黒。**E1**（m5stack-avatar なし・`M5Canvas` のみ）でも黒 → **avatar 単体が主因ではない**。疑いは PlatformIO / `esp32s3box` / M5Unified / LCD・backlight / partition と公式 **IDF+LVGL** 経路のギャップ。**禁止**: full `AI_StackChan_Ex`、safe mode、voice/utterance overlay、**probe 再 upload** — 実機は **公式ファーム保持**。**記録**: [stackchan-cores3-bringup-probe.md](./runbooks/stackchan-cores3-bringup-probe.md)·[KB §2026-05-31 CoreS3 表示](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md#2026-05-31-coreS3-表示--確定結論probe-全面停止)·[ADR-20260531](./decisions/ADR-20260531-stackchan-cores3-probe-display-halt.md)·[`scripts/stackchan-ai-stackchan-ex/README.md`](../scripts/stackchan-ai-stackchan-ex/README.md)。

### 🆕 最新アップデート（2026-05-13）

- **StackChan 私用経路: 設定ドリフト・STT 読取タイムアウト・調査上の断定ルールを KB/Runbook へ追記**: **`CHATGPT_API_URL` をビルドフラグで毎回固定**しないと `pio run` が **OpenAI 既定へ戻り** private Pi5 bridge に **chat POST が来ない**ことがある。**`STACKCHAN_REQUEST_READ_TIMEOUT_SEC`**（**任意・未設定/0は読取無制限**）を**狭く**しすぎると **STT 生 WAV** で **`request read timeout` / `408`** や実機側 **read `-11`** が先に出る（**`STT_UPSTREAM_TIMEOUT` や whisper 推論とは別レイヤ**）。**OpenAPI のパス**と **`/api/stackchan/chat/simple`** の混同で「経路は合っている」錯覚が起きうるため、**WakeWord→STT→LLM→TTS の連続成功**まで原因を確定扱いしない。**記録**: [KB-stackchan-community-firmware-supply-chain.md §2026-05-13](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md#2026-05-13-追補-chatgpt_api_url-ドリフトbridge-リクエスト読取タイムアウトurl-境界の錯覚調査上の断定ルール)·[stackchan-community-text-only-e2e.md](./runbooks/stackchan-community-text-only-e2e.md)·[private-pi5-stackchan-bridge-deploy.md](./runbooks/private-pi5-stackchan-bridge-deploy.md)·[`scripts/private-pi5-stackchan-bridge/README.md`](../scripts/private-pi5-stackchan-bridge/README.md)·[`scripts/stackchan-ai-stackchan-ex/README.md`](../scripts/stackchan-ai-stackchan-ex/README.md)。

### 🆕 最新アップデート（2026-05-11）

- **StackChan Realtime 先行導入の仕様不整合を明文化し、Spark 正本へロールバック判断を固定**: Realtime（OpenAI/Gemini WebSocket）と現行 Spark 経路（`faster-whisper on private Pi5 -> Qwen3.6 on DGX Spark -> VOICEVOX`）の境界不整合を整理し、**本番は text/STT 正本を維持**する判断を文書化。CoreS3 実機では **左タッチ=WakeWord 有効化/無効化、右タッチ=WakeWord 登録** の復旧仕様も追記。**記録**: [KB-stackchan-community-firmware-supply-chain.md](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md)・[stackchan-community-realtime-api-migration.md](./runbooks/stackchan-community-realtime-api-migration.md)・[stackchan-community-text-only-e2e.md](./runbooks/stackchan-community-text-only-e2e.md)・[`scripts/stackchan-ai-stackchan-ex/README.md`](../scripts/stackchan-ai-stackchan-ex/README.md)。
- **StackChan private Pi5 bridge: 音声会話 E2E を成立（2026-05-11 実機）**: `ChatGPT.cpp` の `payload length: 0` 再発（client 寿命不整合）を修正し、さらに `M5Unified 0.2.7` への更新・`WebVoiceVoxTTS.cpp` の chunked MP3 保存対応・private Pi5 `POST /api/stackchan/stt`（`faster-whisper-local`）導入で、**WakeWord -> STT -> LLM(Qwen3.6 on DGX Spark) -> TTS(VOICEVOX)** を連続成功。**記録**: [KB-stackchan-community-firmware-supply-chain.md](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md)・[stackchan-community-text-only-e2e.md](./runbooks/stackchan-community-text-only-e2e.md#63-2026-05-11-最終到達点wakeword---stt---llm---tts-成立)・[private-pi5-stackchan-bridge-deploy.md](./runbooks/private-pi5-stackchan-bridge-deploy.md)・[`scripts/private-pi5-stackchan-bridge/README.md`](../scripts/private-pi5-stackchan-bridge/README.md)。
- **StackChan Realtime API 段階移行手順を追加（過去失敗を先に固定）**: 上流 `AI_StackChan_Ex` の Realtime 障害履歴（ヒープ不足、WebSocket優先度、Gemini修正副作用）を根拠に、**Realtime本体 -> 計測 -> TTS拡張**の安全順へ整理。既存 private Pi5 bridge 経路をロールバックとして維持しつつ、5秒級応答の検証導線を追加。**手順**: [stackchan-community-realtime-api-migration.md](./runbooks/stackchan-community-realtime-api-migration.md)。**KB更新**: [KB-stackchan-community-firmware-supply-chain.md](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md)。**実装入口**: [`scripts/stackchan-ai-stackchan-ex/README.md`](../scripts/stackchan-ai-stackchan-ex/README.md)。

### 🆕 最新アップデート（2026-05-20）

- **キオスク順位ボード・製番左縁アクセント 24 色（履歴 · 2026-05-20 · 全件ハッシュは 2026-05-22 撤回）**: [2026-05-02 常時化](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-always-progress-resource-strip-2026-05-02) 以降、**OR フィルタ OFF** では **FNV-1a ハッシュ `% 8` → `% 24`** で左縁着色していた。**2026-05-22** に全件無色へ変更 — **現行は [§全件無色（2026-05-22）](#最新アップデート2026-05-22--順位ボード製番左縁全件無色)**。**OR フィルタ向け 24 色パレット**は **維持**。**PR [#307](https://github.com/denkoushi/RaspberryPiSystem_002/pull/307)**·**`f8c1f6d2`**。**KB**: [KB-297 §24色](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-palette-24-2026-05-20)·[KB-297 §全件無色](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-accent-no-color-all-items-2026-05-22)。

### 🆕 最新アップデート（2026-05-10）

- **DGX メインAI: Pi5 API 単一キュー・用途別停止抑止・実験優先時の gateway 自動停止除外（2026-05-10 本番済）**: 推論＋ `system-prod-gateway` 起停を **`enqueueMainLocalLlmRuntimeControl`** で直列化。業務/Agent用途は `release` でも `/stop` 抑止。**`SET_POLICY` 実験優先**の自動調停から **`system-prod-gateway` 停止を削除**（私用 Comfy のみ）。**本番**: ブランチ **`feature/dgx-single-queue-stop-policy`**（**`23bce3bf`**・**`4d658897`**）·**`raspberrypi5` のみ**·**Detach `20260510-114418-29512`**（`PLAY RECAP` **`ok=134` `changed=4` `failed=0`**）·**Phase12 `verify-phase12-real.sh` 43/0/0**（約 **130s**）。**記録**: [deployment §DGX 単一キュー](./guides/deployment.md#dgx-main-llm-single-queue-stop-policy-2026-05-10)。**Runbook**: [dgx-system-prod-local-llm.md §管理コンソール](./runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)。**KB**: [KB-365 §2026-05-10 本番](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-main-llm-single-queue)·[§Pi5 メインAI（仕様項）](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#pi5-メインai-単一キュー用途別停止実験優先時の-gateway-除外2026-05)。**実装**: [`local-llm-runtime-command-queue.ts`](../apps/api/src/services/inference/runtime/local-llm-runtime-command-queue.ts)·[`local-llm-runtime-schedule.policy.ts`](../apps/api/src/services/inference/runtime/local-llm-runtime-schedule.policy.ts)·[`dgx-resource.policy-arbitrator.ts`](../apps/api/src/services/system/dgx-resource/dgx-resource.policy-arbitrator.ts)。

- **DGX AgentContainer（Control Target `agent-container`・keep-warm・2026-05-10 本番済）**: Pi5 API に補助ランタイム **`agent-container`** を追加。**`agent_container_task`** は単一キューで **`business > agent`**、`release` でも **`/stop` 抑止**。ENV **`DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_*`** / **`DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL`**（未設定時は従来互換・start/stop は設定時のみ）。**本番**: **`raspberrypi5` のみ**·**Detach `20260510-125420-15123`**（`PLAY RECAP` **`ok=139` `changed=8` `failed=0`**）→ **DGX** `scp` **`gateway-server.py`**·**PID 終了後 `start-gateway-server.sh`**（先行 tip **`9fd37c0a`**・**`main` squash PR [#284](https://github.com/denkoushi/RaspberryPiSystem_002/pull/284) `14f105c1`**）。**Phase12**: **`verify-phase12-real.sh` 43/0/0**（約 **57s**）。**記録**: [deployment §AgentContainer](./guides/deployment.md#dgx-agent-container-control-target-2026-05-10)·[KB-365 §AgentContainer 本番](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-agent-container)·**Runbook**: [dgx-system-prod-local-llm.md](./runbooks/dgx-system-prod-local-llm.md)·**gateway README**: [`README.md`](../scripts/dgx-local-llm-system/README.md)。

- **StackChan / Pi5 API 経由対話（`POST /api/system/stackchan/chat`・詳説既定・単一キュー `stackchan_chat`）**: DGX 直叩きではなく Pi5 API で **`ADMIN`/`MANAGER` JWT** 認可。**upstream / runtimeControl は admin と同一**（`LOCAL_LLM_*`）。**`/stop` 抑止**は admin と同系。**本番（2026-05-10）**: **`feat/stackchan-interactive-chat-api`**（tip **`81fe4d2a`**）·**`raspberrypi5` のみ**·**Detach `20260510-134157-20990`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0`**）·**`verify-phase12-real.sh` 43/0/0**（約 **54s**）·**追加スモーク**: 未認証 POST が **`401`**。**記録**: [deployment §StackChan 本番](./guides/deployment.md#stackchan-production-2026-05-10)·[KB-365 §StackChan](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-stackchan-pi5-api-chat)·[dgx-system-prod-local-llm §管理コンソール](./runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)。**実装**: [`stackchan.ts`](../apps/api/src/routes/system/stackchan.ts)·[`stackchan-chat-request.ts`](../apps/api/src/services/system/stackchan-chat-request.ts)。

- **StackChan 私用 Pi5 分離ワークフロー計画（会話反映・進捗管理）**: 業務用 Pi5（職場）と私用 Pi5（自宅）を分離し、**私用 Pi5 を自宅デバイス集約ポイント**にする方針を計画化。構成は **faster-whisper + Qwen3.6 on DGX Spark + VOICEVOX + Home Assistant + StackChan**。**2系統の正本**: [stackchan-private-pi5-tailnet-workflow-plan.md §2系統](./plans/stackchan-private-pi5-tailnet-workflow-plan.md#two-path-architecture-private-work-2026-05-10)。**私用 bridge 実装**: [`bridge_server.py`](../scripts/private-pi5-stackchan-bridge/bridge_server.py)・[`stackchan_chat_core.py`](../scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py)・[`dgx_runtime_client.py`](../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py)·[KB-365 §私用境界](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#private-pi5-stackchan-bridge-boundary-2026-05-10)。**標準デプロイ**: [private-pi5-stackchan-bridge-deploy.md](./runbooks/private-pi5-stackchan-bridge-deploy.md)・[`private-pi5-stackchan-bridge.yml`](../infrastructure/ansible/playbooks/private-pi5-stackchan-bridge.yml)・[`deploy-private-pi5-stackchan-bridge.sh`](../scripts/private-pi5-stackchan-bridge/deploy-private-pi5-stackchan-bridge.sh)。**2026-05-10 late**: StackChan の旧 bridge IP `192.168.128.112` と private Pi5 DHCP `192.168.128.113` のズレを確認し、**compatibility alias を playbook 標準化**。フェーズ別チェックリストと Decision Log を含む。**計画全体**: [stackchan-private-pi5-tailnet-workflow-plan.md](./plans/stackchan-private-pi5-tailnet-workflow-plan.md)。

- **StackChan 私用 Pi5 `utterance` 一括 API・ファーム overlay（2026-05-23・作業中断）**: ESP32 の STT/LLM 多段 HTTP を **`POST /api/stackchan/utterance`**（Pi5 で STT→LLM）に集約。**repo**: [`stackchan_utterance_core.py`](../scripts/private-pi5-stackchan-bridge/stackchan_utterance_core.py)・[`apply_chatgpt_private_bridge.py`](../scripts/stackchan-ai-stackchan-ex/apply_chatgpt_private_bridge.py)・[`apply_utterance_overlay.py`](../scripts/stackchan-ai-stackchan-ex/apply_utterance_overlay.py)・[`mac_usb_dev.sh`](../scripts/stackchan-ai-stackchan-ex/mac_usb_dev.sh)。**実機**: utterance ファーム書き込み後 **画面真っ黒・無音・USB 未認識**で E2E 未完了。**再開**: ハード復旧 → シリアル → Pi5 bridge → utterance スモーク。**KB**: [KB-stackchan §2026-05-23](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md#2026-05-23-私用-pi5-utterance-一括-apiファーム-overlay実機ブリングアップ作業中断)·[text-only runbook §6.5](./runbooks/stackchan-community-text-only-e2e.md#65-2026-05-23-post-apistackchanutterancepi5-一括と実機復旧)·[計画 Decision Log](./plans/stackchan-private-pi5-tailnet-workflow-plan.md)。

- **StackChan コミュニティファーム安全採用（`AI_StackChan_Ex`・供給鎖固定・トークン分離・実機 E2E 手順）**: 上流 **SHA 記録**・`platformio.ini` **GitHub 依存のコミット固定**・**`DGX_LLM_SHARED_TOKEN` は私用 Pi5 のみ**（任意 **`STACKCHAN_TOKEN` / `X-Stackchan-Token`**）。**2026-05-10〜11 実測**: SD 未挿入時の起動ループ、`wifi.txt`/YAML 併置、DHCP IP ドリフトと compatibility alias、`ChatGPT.cpp` payload 空化修正、`M5Unified 0.2.7` 更新、VOICEVOX chunked MP3 保存対応、private Pi5 STT endpoint + `faster-whisper-local` を反映し、**WakeWord 会話が成立**。**手順**: [`scripts/stackchan-ai-stackchan-ex/README.md`](../scripts/stackchan-ai-stackchan-ex/README.md)。**KB**: [KB-stackchan-community-firmware-supply-chain.md](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md)。**Runbook**: [stackchan-community-text-only-e2e.md](./runbooks/stackchan-community-text-only-e2e.md)。**パッチ適用**: `apply_chatgpt_private_bridge.py`（**`ai_stackchan_ex_private_bridge.patch` は `git apply` 不可**）。

- **KB-376 順位ボード・装飾/フッタの表示スコープ整合（>900 `rowIds`・重複 winner）**: hydrate を **チャンク結合**し、フッタ DISTINCT ON に **`preferredDisplayRowIds`**（リクエスト境界）を明示。**KB**: [KB-376](./knowledge-base/KB-376-leaderboard-footer-display-scope-winner-alignment.md)。**実装**: [`leaderboard-display-row-scope.ts`](../apps/api/src/services/production-schedule/leaderboard/leaderboard-display-row-scope.ts)·[`leaderboard-shell-hydrate.service.ts`](../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts) 他。

- **KB-377 順位ボード・資源CDフッタチップのグレーアウト検証と差分消失ロジック整合（`021`/OCR/`fkmail`/`C`・`X`以外は未完・winner 残留なら消失不立）**: チップ未完は **`row.isCompleted`（実効完了）へ帰約**。**`S`/`R` は可視未完**。**CSV消滅**は **[メール完了（`C`/`X`）以外 × `occurredAt` ±3ヶ月]** 母集団と現 winner の差のみ（[KB-370](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)·[deployment 消滅窓](./guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。過去スクショは **`tesseract-lang` の `jpn`** と前処理で製番読取→ **Pi5 Postgres** で **`"CsvDashboardRow"`** 突合。**Appendix**: **`PRODUCTION_SCHEDULE_DASHBOARD_ID` と `PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID` の別系統**、**JST 暦日境界 SQL**（誤クエリでの「当日0件」）**、`createdAt`/`updatedAt` と件数の読み替え**。**後工程完了から前工程自動完了へ伝播しない**（ユーザー合意）。**KB**: [KB-377](./knowledge-base/KB-377-kiosk-leaderboard-resource-chip-completion-verification.md#kb-377-appendix-counting)。**関連**: [KB-375](./knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md)·[KB-376](./knowledge-base/KB-376-leaderboard-footer-display-scope-winner-alignment.md)·[EXEC_PLAN.md](../EXEC_PLAN.md)。

- **KB-375 完了整合・本番ロールアウト（API+Web・キオスク 5 台順次・実機 Phase12）**: **`fix/leaderboard-completion-integrity`**（**`c063ab57`**）を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** へ **`update-all-clients.sh`・`--detach --follow`・1 台ずつ**反映（**Detach** **`20260510-074230-10392`** ほか 4 本・いずれも **`failed=0`**）。**`verify-phase12-real.sh`** **PASS 43 / WARN 0 / FAIL 0**（約 **74s**）。**Pi3** は **`skipping: no hosts matched`**（**本ロールアウトで Pi3 専用手順は不要／未実施で正**）。**記録**: [deployment.md §2026-05-10](./guides/deployment.md#kiosk-leaderboard-completion-integrity-2026-05-10)·[KB-375](./knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md)·[EXEC_PLAN.md](../EXEC_PLAN.md) **Progress** 先頭項。

### 🆕 直近アップデート（2026-05-09）

- **順位ボード・生産日程の完了整合（明示 `/completion`・CSV空progressで手動完了を落とさない・実効完了の共有）**: キオスク完了の **主経路**を `PUT …/completion` + `intent` に寄せ、**同じ intent の再適用は no-op**（`unchanged`）。従来 `PUT …/complete` は **トグル互換**として維持。**CSV→`ProductionScheduleProgress`** は `progress` 空を **手動完了済みへは適用しない**（[`progress-csv-sync-decision.policy.ts`](../apps/api/src/services/production-schedule/progress-csv-sync-decision.policy.ts)）。**KB**: [KB-375](./knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md)·[KB-297 順位ボード節](./knowledge-base/KB-297-kiosk-due-management-workflow.md#リーダー順位ボード納期ベース整列手動順-api-反映2026-04-01)。

- **生産日程CSV「消滅」外部完了の母集団を「FKOJUNST **メール完了（`C`/`X`）以外** × `occurredAt` ±3ヶ月」へ再定義（API のみ・Pi5）**: 生産日程本体 CSV は **日付窓取得**（運用 **±3ヶ月**）だが **FKOJUNST_Status CSV はより広い窓**のため、旧 **スナップショット差分**だけだと **窓外落下を誤って消滅完了**し得た。加えて **`C` は KB-373 のキー空間不一致**により **消滅母集団から除外**。**`X` は 2026-05-18 にコードで `C` と同列**（母集団外）へ揃えた（**本番** **`fix/kiosk-completion-exclude-x-from-disappearance`**·**Detach `20260518-175005-7497`**·**Phase12 43/0/0**・[deployment §2026-05-18](./guides/deployment.md#schedule-csv-disappearance-exclude-x-code-alignment-2026-05-18)）。当初の窓改訂デプロイは **Detach `20260509-170432-1808`**（**約 190s**）。**Fix**: 母集団を **メール完了以外・窓内 winner キー**にし **現 CSV winner と差分**・消滅候補 SQL は **`fkojunst-mail-status-completion.policy` と整合**（`UPPER(BTRIM(statusCode)) NOT IN ('C','X')` 相当）。**`main` マージ後**は **`main` をデプロイ引数に**。**ナレッジ**: [deployment.md §消滅窓](./guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)·[KB-370 §2026-05-09](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-09-schedule-csv-disappearance-nonc-window)·代表 **`89086089`**（初期本番）·**`49d19dce`**（`X` コード整合）。

- **`FKOJUNST_Status` の完了（`C`）が `fkmail` にほぼ載らない理由（キー空間不一致）・照合方針 ADR（全面改稿）**: 2026-05-09 の調査を、**時系列（症状→仮説→棄却/確定）**・**観測値**（`801` 偏重、`FKOTEICD`/`FSIGENCD` 極小重複、選択資源 `C=12` の重複否定）・**最終意思決定**まで再構成。結論は「**実装バグより上流キー空間差**」。運用方針は [ADR-20260509](./decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md)（厳密3キー、trim+upper、両取込再計算、`FUPDTEDT` 最新優先、未マッチ `C` 無視）。**詳細**: [KB-373](./knowledge-base/KB-373-fkojunst-status-c-key-domain-mismatch.md)・[KB-297 補遺](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-c-key-domain-mismatch-2026-05-09)・[api.md](./knowledge-base/api.md#kb-373-fkojunst_status-の-c-が-fkmail-にほぼ載らないキー空間不一致)。

- **FKOJUNST メール winner 解決の bind 上限 / 長時間化 / external completion timeout（Pi5 API のみ）**: `FKOJUNST_Status` 取込で **巨大 `IN` の bind 超過**を避けた後も、Pi5 実データでは **winner 再走査の長時間化**と **外部完了同期の transaction timeout** が残った事象。**Fix**: [`findFkojunstMailWinnerIdsByMailTriples`](../apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts) を **winner 1-pass 読込 + `Map` フィルタ**へ変更し、[`fkojunst-external-completion-sync.service.ts`](../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts) に **`timeout: 60000` / `maxWait: 15000`** を追加。**本番**: **`raspberrypi5` のみ**・**Detach `20260508-230134-12773`**・**Pi5 本処理 37.309s**・**Phase12 43/0/0**（約 **141s**）。**main 再検証（2026-05-09）**: `verify-phase12-real.sh` **42/1/0**（WARN は `auto-tuning schedulerログ確認` 0 件で `PUT global-rank/auto-generate=200` により代替正常判定）。**代表 `b6bb449a`**。**ナレッジ**: [KB-372](./knowledge-base/KB-372-fkojunst-mail-winner-triple-postgres-bind-chunk.md)·[deployment.md §mail winner チャンク](./guides/deployment.md#fkojunst-mail-winner-triple-tuple-in-chunk-2026-05-08)·[api.md](./knowledge-base/api.md)（§KB-372）。

- **CSVダッシュボード DEDUP 取込・PostgreSQL バインド上限（32767・チャンク照合・Pi5 API のみ）**: 大量 `dataHash` の一括 `IN` が Prisma / PostgreSQL の prepared statement 上限を超え **`too many bind variables` / `received 32768` 級**で落ちる事象。**Fix**: `findCsvDashboardRowsByDataHashes` を **チャンク分割＋重複排除**に隔離（[`csv-dashboard-existing-rows-by-hash.reader.ts`](../apps/api/src/services/csv-dashboard/csv-dashboard-existing-rows-by-hash.reader.ts)）。**本番**: **`raspberrypi5` のみ**・**Detach `20260508-202603-25493`**・**Phase12 43/0/0**（約 **134s**）。**`main`**: [PR #273](https://github.com/denkoushi/RaspberryPiSystem_002/pull/273)（squash **`95f32c2c`**）。**ナレッジ**: [KB-371](./knowledge-base/KB-371-csv-dashboard-dedup-postgres-bind-limit.md)·[deployment.md §DEDUP バインド上限](./guides/deployment.md#csv-dedup-ingest-postgres-bind-limit-2026-05-08)·[api.md §KB-371](./knowledge-base/api.md#kb-371-csvダッシュボード-dedup-取込の-postgresql-バインド上限too-many-bind-variables--32767)。

- **順位ボード・`FKOJUNST_Status` 完了行（`C`/`X`）の一覧再表示 + 既定完了フィルタ `all`（API+Web・Pi5→Pi4×4）**: 2026-05-08 の **`S`/`R` のみ**可視により **`C`/`X` 完了行が API から落ち**、キオスクで **グレーアウト確認ができない**状態だった。**Fix**: [`fkojunst-production-schedule-list-visibility.policy.ts`](../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts) で **`S`/`R`/`C`/`X` 可視**・[`ProductionScheduleLeaderOrderBoardPage.tsx`](../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) で **`completionFilter` 初期 `all`**。**本番**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）・**Detach `20260509-093716-30174` / `20260509-094901-17785` / `20260509-095434-23706` / `20260509-095842-2865` / `20260509-100237-8760`**・**Phase12 43/0/0**（約 **67s**）。**Pi3 除外**。**ナレッジ**: [deployment.md §2026-05-09](./guides/deployment.md#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09)·[KB-297 §外部完了](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)·[EXEC_PLAN.md](../EXEC_PLAN.md)。

- **board/continue契約履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)。関連: [deployment](./guides/deployment.md#leaderboard-board-continue-cursor-contract-2026-05-09)。
- **性能履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §装飾後取り。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-deferred-decorations-fast-initial-2026-05-19)。`pageSize 80` / continue 40 は履歴値で、現行値は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

- **性能履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §continue COUNT再利用。関連: [KB-369](./knowledge-base/KB-369-leader-order-board-api-internal-latency.md) · [deployment](./guides/deployment.md#kiosk-leaderboard-continue-count-reuse-2026-05-19)。

- **端末キャッシュ履歴正本**: [ADR-20260519](./decisions/ADR-20260519-leaderboard-terminal-cache-phase1.md) · [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §Phase 1。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-terminal-cache-phase1-2026-05-19)。現行鮮度は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

- **端末キャッシュ履歴正本**: [ADR-20260520](./decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md) §操作即表示 · [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-mutation-instant-display-2026-05-20)。`120秒` は履歴値で、現行鮮度は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

- **端末キャッシュ履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §資源CDフッタチップ。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-footer-chips-terminal-cache-2026-05-20)。
- **端末キャッシュ履歴正本**: [ADR-20260520](./decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md) §Phase 2 改訂 · [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-cache-120s-swr-lock-2026-05-20)。`120s` は履歴値で、現行鮮度は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

- **端末キャッシュ履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §製番ORクライアントキャッシュ。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-seiban-or-client-cache-filter-2026-05-20)。
- **端末キャッシュ履歴正本**: [ADR-20260520](./decisions/ADR-20260520-leaderboard-terminal-cache-phase2-swr.md) · [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §Phase 2。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19)。現行鮮度は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

- **性能履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §初回10/追補40。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-initial-10-continue-40-phase1-2026-05-19)。現行値は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。
- **性能履歴正本**: [KB-374](./knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) §deltaRows / pageSize 80。関連: [deployment](./guides/deployment.md#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18)。`pageSize 80` は履歴値で、現行値は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。
- **順位ボード追補の Network Error（API 未到達・transient と運用順序）**: Caddy **`502`/接続拒否**等で Axios が **応答なし**。**対策**: [docker-compose.server.yml](../infrastructure/docker/docker-compose.server.yml) の **`db` と `api` の healthcheck** と **`web` の `api` healthy 待ち**。クライアントは **`leaderboardContinueErrorPolicy`** で **transient を恒久的な `appendError` にしない**。**ナレッジ**: [KB-380](./knowledge-base/KB-380-kiosk-leaderboard-network-error-resilience.md)。

- **board集約API正本**: [ADR-20260508](./decisions/ADR-20260508-leaderboard-board-aggregate-api.md) · [KB-369](./knowledge-base/KB-369-leader-order-board-api-internal-latency.md)。関連: [deployment](./guides/deployment.md) 補足（2026-05-08）。

### 🆕 最新アップデート（2026-05-07）

- **カード単位 phased 履歴正本**: [KB-369](./knowledge-base/KB-369-leader-order-board-api-internal-latency.md) · [KB-297 §カード単位](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-resource-card-phased-scope-2026-05-07)。関連: [deployment](./guides/deployment.md) 2026-05-07項。現行仕様は [KB-392](./knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md)。

- **サーバ内 snapshot 履歴正本**: [ADR-20260507](./decisions/ADR-20260507-leaderboard-shell-snapshot.md) · [KB-369](./knowledge-base/KB-369-leader-order-board-api-internal-latency.md)。関連: [deployment](./guides/deployment.md) 2026-05-07 snapshot項。

- **Mobile Placement Zero2W hardening 正本**: [KB-368](./knowledge-base/KB-368-zero2w-haizen-placement-tracking.md) · [mobile-placement smartphone](./runbooks/mobile-placement-smartphone.md) · [mobile-placement API](./api/mobile-placement.md) · [Zero2W setup](./runbooks/zero2w-tanaban-edge-setup.md)。関連: [deployment](./guides/deployment.md) 2026-05-06 late項。


- **snapshot+cursor 履歴正本**: [KB-369](./knowledge-base/KB-369-leader-order-board-api-internal-latency.md) · [ADR-20260507](./decisions/ADR-20260507-leaderboard-shell-snapshot.md)。関連: [PR #270](https://github.com/denkoushi/RaspberryPiSystem_002/pull/270) · [deployment](./guides/deployment.md) 2026-05-07 snapshot+cursor項。

### 🆕 最新アップデート（2026-05-06）

- **部品納期個数補助 `P2002` 履歴正本**: [KB-328 §P2002](./knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md#order-supplement-sync-p2002-csv-dashboard-row-id) · [KB-297 §差分同期](./knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-incremental-sync-2026-05-01) · [CSV import/export](./guides/csv-import-export.md)。関連: [PR #256](https://github.com/denkoushi/RaspberryPiSystem_002/pull/256) · [deployment](./guides/deployment.md) 2026-05-06 部品納期個数補助項。

- **三島研削 CSV Gmail NON_RETRIABLE 履歴正本**: [KB-297 §空BOM・廃棄](./knowledge-base/KB-297-kiosk-due-management-workflow.md#mishima-grinding-empty-csv-bom-nonretriable-2026-05-06) · [CSV import/export](./guides/csv-import-export.md)。関連: [PR #259](https://github.com/denkoushi/RaspberryPiSystem_002/pull/259)。

- **Phase12 / Zero2W NOPASSWD 履歴正本**: [KB-367](./knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md) · [KB-368](./knowledge-base/KB-368-zero2w-haizen-placement-tracking.md) · [Zero2W setup](./runbooks/zero2w-tanaban-edge-setup.md)。関連: [deployment](./guides/deployment.md) 2026-05-06項。

- **FKOJUNST_Status 唯一正本（2026-05-08）履歴正本**: [ADR-20260508](./decisions/ADR-20260508-fkojunst-status-sole-source.md) · [KB-370 §Production 2026-05-08](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md#production-2026-05-08-fkojunst-sole-source) · [deployment](./guides/deployment.md#fkojunst-status-sole-source-2026-05-08)。関連: [ADR-20260526](./decisions/ADR-20260526-production-schedule-completion-status-only.md)。

### 🆕 最新アップデート（2026-05-05）

- **`FKOJUNST_Status` 外部完了（2026-05-08）·`fkmail` の C/X のみ・一覧正本はメール**: [ADR-20260508-fkojunst](./decisions/ADR-20260508-fkojunst-status-sole-source.md)·[KB-297 §外部完了](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)·[KB-370](./knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)。**歴史**: dedupe キー消失差分は **2026-05-05 まで**（[deployment.md](./guides/deployment.md) 2026-05-04/05 項は **経緯**として残す）。
- **`FKOJUNST_Status` dedupe キー消失差分（2026-05-05まで）履歴正本**: [KB-297 §外部完了](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02) · [deployment](./guides/deployment.md) 2026-05-04/05項。関連: [PR #250](https://github.com/denkoushi/RaspberryPiSystem_002/pull/250) · [ADR-20260508](./decisions/ADR-20260508-fkojunst-status-sole-source.md) · [ADR-20260526](./decisions/ADR-20260526-production-schedule-completion-status-only.md)。

- **Zero2W 棚番エッジ hardening 履歴正本**: [KB-368](./knowledge-base/KB-368-zero2w-haizen-placement-tracking.md) · [Zero2W setup](./runbooks/zero2w-tanaban-edge-setup.md) · [deployment](./guides/deployment.md) 2026-05-05 late項。関連: [KB-367](./knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)。

### 🆕 最新アップデート（2026-05-04）

- **Zero 2 W 棚番エッジ導入・配膳連携正本**: [Zero2W setup](./runbooks/zero2w-tanaban-edge-setup.md) · [KB-367](./knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md) · [KB-368](./knowledge-base/KB-368-zero2w-haizen-placement-tracking.md) · [tailscale policy](./security/tailscale-policy.md) · [client setup](./guides/client-initial-setup.md)。配膳/API: [mobile-placement API](./api/mobile-placement.md) · [haizen-agent](../clients/haizen-agent/README.md)。

- **Zero2W 担当棚（キオスク + `haizen-target-devices` API）履歴正本**: [KB-368](./knowledge-base/KB-368-zero2w-haizen-placement-tracking.md) · [mobile-placement smartphone](./runbooks/mobile-placement-smartphone.md) · [mobile-placement API](./api/mobile-placement.md) · [deployment](./guides/deployment.md) 2026-05-04 evening項。

- **DGX リソース Phase11（進行中表示の持続化）履歴正本**: [KB-365 Phase 11](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-04項。関連: [PR #246](https://github.com/denkoushi/RaspberryPiSystem_002/pull/246)。

- **キオスク順位ボード・製番順評価 / 登録製番ランクピッカー履歴正本**: [KB-297 §製番順評価](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-priority-eval-mode-2026-05-04) · [KB-297 §ランクピッカー](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-seiban-rank-picker-2026-05-04) · [deployment](./guides/deployment.md) 2026-05-04 late項。

### 🆕 最新アップデート（2026-05-03）

- **DGX KPI メトリクス（overview 数値・`GET /system/metrics`）履歴正本**: [KB-365 Phase 10](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 KPIメトリクス項。

- **DGX リソース Phase9（Orchestration Strict Ready・安全ロールバック）履歴正本**: [KB-365 Phase9](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Phase9項。

- **DGX リソース Phase7（運用 UI 最小化・実験シナリオ post-policy・gateway ヘルス）履歴正本**: [KB-365 Phase7](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Phase7項。

- **DGX リソース Phase6（目的別ガイド / post-policy Comfy）履歴正本**: [KB-365 Phase6](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 目的別ガイド項。

- **DGX リソース管理 UI 再設計（運用コンソール / `dgxResourceUi`）履歴正本**: [KB-365](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 UI再設計項。

- **DGX Resource Phase5（`overview.operator`・ワークロード遷移分離）履歴正本**: [KB-365 Phase5](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [ADR-20260503](./decisions/ADR-20260503-dgx-resource-operator-console.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Phase5項。

- **DGX blue vLLM × 私用 ComfyUI GPU競合（`inference-backend` WARN / `/v1/models` 502）正本**: [KB-364](./knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Control Targets項。

- **DGX Resource Phase4（`overview.monitoring`・複合シナリオ Preview/Execute）履歴正本**: [KB-365 Phase4](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Phase4項。

- **DGX Resource Phase3（experiment-lab・私用 Comfy補助起停・`SET_POLICY.applyWorkloadChanges`）履歴正本**: [KB-365 Phase3](./knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Phase3項。

- **DGX Control Targets 本番反映（`overview.targets`・`EXECUTE_TARGET_ACTION`）履歴正本**: [ADR-20260502](./decisions/ADR-20260502-dgx-resource-control-targets.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Control Targets項。

### 🆕 最新アップデート（2026-05-02）

- **DGX Control Targets（`overview.targets`・`EXECUTE_TARGET_ACTION`）設計正本**: [ADR-20260502](./decisions/ADR-20260502-dgx-resource-control-targets.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-03 Control Targets項。

- **FKOJUNST_Status 外部完了（2026-05-02履歴・現行は2026-05-08改訂）正本**: [KB-297 §外部完了](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02) · [ADR-20260508](./decisions/ADR-20260508-fkojunst-status-sole-source.md) · [deployment](./guides/deployment.md) FKOJUNST_Status項。

- **DGX `sparkHost` 既定フォールバック（admin `LOCAL_LLM_BASE_URL` `/healthz`）正本**: [KB-363](./knowledge-base/KB-363-dgx-resource-spark-status-fallback.md) · [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-02 `sparkHost`項。

- **DGX リソース管理画面タイポ改善（`/admin/tools/dgx-resource`）履歴正本**: [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-02 管理UI可読性項。

- **DGX リソース統合運用 Phase2（運用3プロファイル + Sparkホスト可視化）履歴正本**: [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) · [deployment](./guides/deployment.md) 2026-05-02 Phase2項。

- **順位ボード資源チップ結合粒度（`productNo`+`fhincd` / progress-overview整合）正本**: [KB-297 §結合粒度](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-resource-chips-part-key-overview-join-2026-05-02) · [deployment](./guides/deployment.md) 2026-05-02 結合粒度項。

- **キオスク順位ボード 行下辺・製番単位の資源進捗チップ帯 正本**: [KB-297 §行下辺](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-row-footer-resource-chips-2026-05-02) · [deployment](./guides/deployment.md) 2026-05-02 行下辺チップ項。

### 🆕 最新アップデート（2026-05-01）

- **DGX リソース管理コンソール Phase1（`/admin/tools/dgx-resource`・Pi5 API境界）正本**: [DGX Runbook](./runbooks/dgx-system-prod-local-llm.md) 管理コンソール節 · [deployment](./guides/deployment.md) 2026-05-01 Phase1項。

- **Gmail CSV PowerAutomate 日時互換（`FKOJUNST_Status` / CsvDashboard）正本**: [KB-297 §PowerAutomate 日時互換](./knowledge-base/KB-297-kiosk-due-management-workflow.md#powerautomate-csv-datetime-compat-2026-05-01) · [CSV guide](./guides/csv-import-export.md) 日付列・日時字句項 · [deployment](./guides/deployment.md) 2026-05-01 PowerAutomate日時項。

- **生産日程 三島研削 CSV 実日付なし仕様 正本**: [KB-297 §三島研削](./knowledge-base/KB-297-kiosk-due-management-workflow.md#mishima-grinding-csv-no-date-2026-05-01) · [CSV guide](./guides/csv-import-export.md) 三島研削項。

- **生産日程 部品納期個数補助 `plannedEndDate` 字句・空値維持・バックフィル正本**: [KB-297 §字句拡張](./knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-planned-end-date-parse-2026-05-01) · [KB-297 §空値維持](./knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-planned-end-date-retain-2026-05-01) · [CSV guide](./guides/csv-import-export.md) §D-補 · [KB-328](./knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md)。

- **生産日程 部品納期個数・着手日補助 差分同期正本**: [KB-297 §着手日補助の差分同期](./knowledge-base/KB-297-kiosk-due-management-workflow.md#order-supplement-incremental-sync-2026-05-01) · [KB-328](./knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md) · [Plan](./plans/order-supplement-incremental-sync-execplan.md)。

### 🆕 最新アップデート（2026-04-30）

- **キオスク順位ボード 完了フィルタ既定「未完」正本**: [KB-297 §完了フィルタ既定](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-default-completion-filter-incomplete-2026-04-30) · [deployment](./guides/deployment.md) 2026-04-30 完了フィルタ既定項。

- **キオスク 生産スケジュール 負荷調整（山崩し支援）**: `plannedEndDate` 月次集計・能力/分類/移管ルール（**`site` 優先 + `shared` 補完**）・**外注候補シミュ**・**部品推奨セット**（自動選定・契約上限 **`outsourcing-simulation.policy.ts` 正本**·**自動選定後の表示維持 `463aeabb`**）·社内移管サジェスト・**機種別月次負荷**・**着手日・平準化**（**総分のみ**·eligibility 統一）。**本番（2026-05-27）**: Pi5→Pi4×4 **`463aeabb`**（reset 境界·**実機+現場 OK**）·Pi5 **`cd42ebfe`** / **`37a7b6d4`** 系。ガイド: [kiosk-production-schedule-load-balancing.md](./guides/kiosk-production-schedule-load-balancing.md) / KB: [KB-362](./knowledge-base/KB-362-kiosk-load-balancing.md) / ADR: [外注上限](./decisions/ADR-20260527-load-balancing-outsourcing-limits.md) / デプロイ: [§表示維持](./guides/deployment.md#kiosk-load-balancing-auto-plan-reset-fix-2026-05-27) · [§集計](./guides/deployment.md#kiosk-load-balancing-aggregation-fix-2026-05-27) · [§外注契約](./guides/deployment.md#kiosk-load-balancing-ui-p0p1-contract-fix-2026-05-27) / 改善案: [load-balancing-outsourcing-improvement-proposal.md](./plans/load-balancing-outsourcing-improvement-proposal.md)。
- **負荷調整 × 生産システム突合（2026-05-27）**: 生産グラフは **`FSIGENSHOYOYMD`（資源所要量）**・キオスクは **着手日** 正本（一致非要件）。**実装済**: ×指示数廃止·eligibility·shared 能力 — PR [#350](https://github.com/denkoushi/RaspberryPiSystem_002/pull/350)。KB: [KB-363](./knowledge-base/KB-363-load-balancing-production-system-reconciliation.md) / 分析: [production-load-balancing-reconciliation-with-production-system-20260527.md](./analysis/production-load-balancing-reconciliation-with-production-system-20260527.md) / ADR: [ADR-20260527](./decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)。

- **CustomerSCAW Gmail CSV（製番→顧客名・一覧 `customerName`・順位ボード）**: 件名 **`CustomerSCAW`**・固定ダッシュボード・スケジュール **`csv-import-productionschedule-customer-scaw`**（**`31 5 * * 0`**）・`ProductionScheduleFseibanCustomerScaw`。仕様・運用: [KB-361](./knowledge-base/KB-361-customer-scaw-gmail-csv.md) / [csv-import-export.md](./guides/csv-import-export.md)。

### 🆕 最新アップデート（2026-04-29）

- **キオスク順位ボード Pi4 向け再レンダー抑制（`order-usage` 波及削減）正本**: [KB-297 §Pi4 performance](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-pi4-performance-2026-04-24) · [deployment](./guides/deployment.md) 2026-04-29 Pi4 向け再レンダー抑制項。

- **キオスク順位ボード 製番一覧パネル UI改修（末尾削除／全解除・3列・9桁表示枠）正本**: [KB-297 §製番一覧パネル](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-list-panel-2026-04-29) · [deployment](./guides/deployment.md) 2026-04-29 製番一覧パネル UI改修項。

- **キオスク順位ボード 製番一覧パネル追補（接頭辞フィルタ・共有履歴優先ソート・コントラスト・横幅）正本**: [KB-297 §製番一覧パネル](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-list-panel-2026-04-29) · [deployment](./guides/deployment.md) 2026-04-29 製番一覧パネル追補項。

- **キオスク順位ボード 表示中製番一覧パネル（共有履歴トグル）正本**: [KB-297 §製番一覧パネル](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-board-seiban-list-panel-2026-04-29) · [deployment](./guides/deployment.md) 2026-04-29 表示中製番一覧パネル項。

- **キオスク順位ボード 備考モーダルから製番登録（共有履歴）正本**: [KB-297 §備考モーダル製番登録](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-note-modal-seiban-register-2026-04-29) · [deployment](./guides/deployment.md) 2026-04-29 備考モーダル製番登録項。

- **加工機点検状況 KPI とカード配色基準の統一 正本**: [KB-360](./knowledge-base/api.md) §加工機点検状況KPI · [deployment](./guides/deployment.md) 2026-04-29 加工機日次点検 KPI項。

- **キオスク持出一覧 本文末尾揃え・サムネ108px・カード外寸固定 正本**: [KB-323 追補](./knowledge-base/KB-323-kiosk-return-card-button-layout.md) · [deployment](./guides/deployment.md) 2026-04-29 末尾揃え・108pxサムネ項。

- **キオスク持出一覧 貸出日時（秒なし・24時間制・Asia/Tokyo）正本**: [KB-323 追補](./knowledge-base/KB-323-kiosk-return-card-button-layout.md) · [deployment](./guides/deployment.md) 2026-04-29 持出一覧貸出日時項。

- **キオスク順位ボード 製番登録と進捗一覧の共有履歴同期 正本**: [KB-297 §同期](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leaderboard-progress-overview-shared-history-sync-2026-04-29) · [deployment](./guides/deployment.md) 2026-04-29 順位ボード製番登録同期項。

- **システム固定 CSV インポートスケジュール不変条件 正本**: [CSV guide](./guides/csv-import-export.md) §システム固定スケジュール行 · [deployment](./guides/deployment.md) 2026-04-29 システム CSV スケジュール項。

- **キオスク順位ボード左パネル・納期アシスト不透明背景 正本**: [KB-297 §左パネル不透明化](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-opaque-left-panel-2026-04-29) · [deployment](./guides/deployment.md) 2026-04-29 順位ボード不透明化項。

### 🆕 最新アップデート（2026-04-28）

- **写真持出 VLM 初見厳格化 正本**: [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md) · [photo-loan](./modules/tools/photo-loan.md) · [deployment](./guides/deployment.md) 2026-04-28 初見厳格化項。
- **キオスク順位ボード `resolvedMachineName` 付与 正本**: [KB-350](./knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md) · [deployment](./guides/deployment.md) 2026-04-28 leaderboard 機種名項。
- **生産日程一覧 FKOJUNST S/R 可視性 正本**: [KB-297 §FKOJUNST_Status](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28) · [deployment](./guides/deployment.md) 2026-04-28 一覧 S/R のみ項。
- **生産日程 FKOJUNST_Status Gmail 取込 正本**: [KB-297 §FKOJUNST_Status](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28) · [deployment](./guides/deployment.md) 2026-04-28 FKOJUNST_Status Gmail 項。
- **パレット可視化サイネJPEG 静的プレビュー整合 正本**: [api.md KB-355](./knowledge-base/api.md) · [deployment](./guides/deployment.md) 2026-04-28 preview parity 項 · [preview](./design-previews/pallet-board-teal-dual-vertical-preview.html)。
- **パレット可視化 サイネJPEG v3 正本**: [api.md KB-355](./knowledge-base/api.md) · [deployment](./guides/deployment.md) 2026-04-28 v3 項 · [preview](./design-previews/pallet-board-teal-dual-vertical-preview.html)。
- **パレット可視化サイネJPEG v3 追随修正 正本**: [api.md KB-355](./knowledge-base/api.md) · [deployment](./guides/deployment.md) 2026-04-28 `287c959e` 追随fix項。

- **VLM 画像 400 追加堅牢化 正本**: [deployment](./guides/deployment.md) 2026-04-28 VLM 画像 400 追加対策項 · [DGX local LLM runbook](./runbooks/dgx-system-prod-local-llm.md) upstream 400 切り分け項。

### 🆕 最新アップデート（2026-04-27）

- **PR #203 DGX/CI/運用ドキュメント収束 正本**: [ADR-20260427](./decisions/ADR-20260427-blue-llm-runtime-stop-policy.md) · [DGX local LLM runbook](./runbooks/dgx-system-prod-local-llm.md) 2026-04-27 項 · [deployment](./guides/deployment.md) 2026-04-27 PR #203 項 · [KB-357](./knowledge-base/infrastructure/security.md) · [KB-358/KB-359](./knowledge-base/ci-cd.md)。

### 🆕 最新アップデート（2026-04-25）

- **パレット可視化ボード スロット幾何・下段4明細 全幅 正本**: [api.md KB-355](./knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22) · [deployment](./guides/deployment.md) 2026-04-25 スロット幾何項。

- **パレット可視化ボード サイネージ JPEG 正本**: [api.md KB-355](./knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22) · [deployment](./guides/deployment.md) 2026-04-25 サイネージ JPEG 項 · [preview workflow](./design/preview-workflow.md)。

- **パレット可視化 部品カード UI 正本**: [KB-339 §V27](./knowledge-base/KB-339-mobile-placement-barcode-survey.md#v27-pallet-viz-item-card-ui-2026-04-25) · [api.md KB-355](./knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22) · [deployment](./guides/deployment.md) 2026-04-25 部品カード UI 項 · [preview](./design-previews/pallet-viz-card-layout-preview.html)。

### 🆕 最新アップデート（2026-04-24）

- **キオスク順位ボード Pi4 向け軽量取得 正本**: [KB-297 §Pi4 performance](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-pi4-performance-2026-04-24) · [deployment](./guides/deployment.md) 2026-04-24 Pi4 軽量取得項。

### 🆕 最新アップデート（2026-04-22）

- **加工機イラスト `pallet-machine-illustrations` Docker 永続化 正本**: [api.md KB-355](./knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22) · [KB-343 同系ストレージ永続化](./knowledge-base/infrastructure/ansible-deployment.md#kb-343-measuring-instrument-genre-image-persistence)。

- **キオスク パレット可視化 UI コンポーネント分割 正本**: [api.md KB-355](./knowledge-base/api.md#kb-355-加工機パレット可視化キオスク管理可視化ボード2026-04-22) · [KB-311](./knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)。

### 🆕 最新アップデート（2026-04-21）

- **購買照会 履歴蓄積 upsert・着手日合成 正本**: [KB-297 §FKOBAINO](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkobaino-purchase-order-lookup-from-gmail-csv-2026-04-20) · [KB-307 Caddy dependency pin](./knowledge-base/ci-cd.md#kb-307-trivy-image-web-が-usrbincaddy-の-cve-を検出して-ci-が失敗する)。

### 🆕 最新アップデート（2026-04-19）

- **管理コンソール 貸出レポート supply ツリーマップ復旧 正本**: [KB-354 §E](./knowledge-base/KB-354-admin-loan-report-gmail-draft-deploy.md#e-supply-ツリーマップ復旧2026-04-19)。

- **貸出レポート API 本番衛生化 正本**: [KB-354 §D](./knowledge-base/KB-354-admin-loan-report-gmail-draft-deploy.md#d-テレメトリ除去回帰テスト2026-04-19)。

### 🆕 最新アップデート（2026-04-18）

- **管理コンソール 貸出レポート 実メトリクス・プレビュー幅 正本**: [KB-354 §C](./knowledge-base/KB-354-admin-loan-report-gmail-draft-deploy.md#c-実メトリクスプレビュー幅2026-04-18)。

- **管理コンソール 貸出レポート Gmail 送信・レイアウト 正本**: [KB-354 §B](./knowledge-base/KB-354-admin-loan-report-gmail-draft-deploy.md#b-gmail-送信レイアウト2026-04-18)。

- **管理コンソール 貸出レポート HTML プレビュー・Gmail 下書き 正本**: [KB-354 §A](./knowledge-base/KB-354-admin-loan-report-gmail-draft-deploy.md#a-下書き初版2026-04-18)。

### 🆕 最新アップデート（2026-04-16）

- **生産日程 FKOJUNST Gmail 工順ステータス 正本**: [KB-297 §FKOJUNST](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-from-gmail-csv-2026-04-16)。

- **FKOJUNST Gmail インポートスケジュール保証 正本**: [KB-297 §FKOJUNST](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst-status-from-gmail-csv-2026-04-16)。

- **サイネージ可視化 業務日切替 JST 9:00 正本**: [KB-347](./knowledge-base/api.md#kb-347-サイネージ可視化の業務日切替jst-翌900自動表示のみ) · [modules/signage](./modules/signage/README.md)。

### 🆕 最新アップデート（2026-04-17）

- **キオスク順位ボード 資源カードレイアウト 正本**: [KB-297 §leader-order-card](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-resource-card-preview-alignment-2026-04-17) · [static preview](./design-previews/kiosk-rank-board-card-single-preview.html)。

- **生産日程 一覧API `resolvedMachineName` 共通化 正本**: [KB-350](./knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md)。

- **Gmail 製番補完 固定 `CsvDashboard` ensure 正本**: [KB-350](./knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md)。

- **生産日程 製番→機種名補完 固定 Gmail スケジュール保証 正本**: [KB-350](./knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md)。

- **生産日程 製番→機種名補完 Gmail `FHINMEI_MH_SH` 正本**: [KB-350](./knowledge-base/KB-350-seiban-machine-name-supplement-fhinmei-mh-sh.md) · [CSV guide](./guides/csv-import-export.md)。

- **キオスク サイネージプレビュー 対象端末選択 正本**: [KB-349](./knowledge-base/frontend.md#kb-349-キオスクサイネージプレビューで端末を選択して画像を取得する) · [modules/signage](./modules/signage/README.md)。

- **管理コンソール サイネージプレビュー 端末別取得 正本**: [KB-348](./knowledge-base/frontend.md#kb-348-管理コンソールサイネージプレビューが端末別レンダ結果とずれるjwtのみでレガシーglobalキャッシュを参照) · [KB-192](./knowledge-base/frontend.md#kb-192-管理コンソールのサイネージプレビュー機能実装とjwt認証問題) · [modules/signage](./modules/signage/README.md)。

- **計測機器 OK 持出 点検記録API認可 正本**: [KB-346](./knowledge-base/frontend.md#kb-346-計測機器点検記録作成apiがキオスクのx-client-keyのみで401) · [measuring-instruments UI](./modules/measuring-instruments/ui.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-17）

- **キオスク「集計」UI バランス調整 正本**: [KB-334](./knowledge-base/KB-334-kiosk-rigging-loan-analytics-deploy.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-16）

- **計測機器持出 氏名NFC自動送信 race 修正 正本**: [KB-345](./knowledge-base/frontend.md#kb-345-計測機器持出で氏名nfcスキャン後に自動送信されない) · [measuring-instruments UI](./modules/measuring-instruments/ui.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-15）

- **キオスク「集計」4パネル・当日イベント 正本**: [KB-334](./knowledge-base/KB-334-kiosk-rigging-loan-analytics-deploy.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-14）

- **キオスク「集計」統合ローン分析 正本**: [KB-344](./knowledge-base/KB-344-unified-loan-analytics.md) · [measuring-instruments UI](./modules/measuring-instruments/ui.md) · [deployment](./guides/deployment.md)。
- **キオスク計測機器持出レイアウト align（タグUID横並び・点検2列・OK時カードフッター非表示・Vitest）本番: Pi5→Pi4×4 順次（Pi3 除外）・Phase12 43/0/0**: ブランチ **`feat/kiosk-instrument-borrow-layout-align`**・コミット **`702f7b83`**（[PR #141](https://github.com/denkoushi/RaspberryPiSystem_002/pull/141)）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260414-180107-30581`（Pi5）→ `20260414-180552-4363`（`raspberrypi4`）→ `20260414-181042-26220`（`raspi4-robodrill01`）→ `20260414-181427-11297`（`raspi4-fjv60-80`）→ `20260414-182050-19017`（`raspi4-kensaku-stonebase01`）。**デプロイ前**に未コミットのプレビュー HTML があると `update-all-clients.sh` が停止するため **`git stash`** で退避。仕様は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md)、運用は [deployment.md](./guides/deployment.md)、進捗は [EXEC_PLAN.md](../EXEC_PLAN.md)。
- **計測機器ジャンル画像ストレージ永続化 正本**: [KB-343](./knowledge-base/infrastructure/ansible-deployment.md) · [measuring-instruments UI](./modules/measuring-instruments/ui.md) · [deployment](./guides/deployment.md)。
- **計測機器持出 ジャンル点検画像枠の白背景（Web + デザインプレビュー）本番: Pi5→Pi4×4 順次（Pi3 除外）・Phase12 43/0/0**: ブランチ **`fix/kiosk-genre-images-white-bg`**・コミット **`46efc534`**。`InstrumentBorrowGenreImagesPanel` の `bg-white`、プレビュー [kiosk-instrument-borrow-current.html](./design-previews/kiosk-instrument-borrow-current.html)。**Detach Run ID** 例: `20260414-145222-5812`（Pi5）〜 `20260414-151852-9755`（StoneBase）。仕様は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md)、運用は [deployment.md](./guides/deployment.md)、全体進捗は [EXEC_PLAN.md](../EXEC_PLAN.md)。
- **キオスク計測機器持出レイアウト（プレビュー準拠・API イメージ Pillow ピンで Trivy 回避）本番: Pi5→Pi4×4 順次（Pi3 除外）・Phase12 43/0/0**: ブランチ **`feat/kiosk-instrument-borrow-layout`**・コミット **`176fcc2a`**。Web `instrumentBorrow/*`、静的プレビュー [kiosk-instrument-borrow-current.html](./design-previews/kiosk-instrument-borrow-current.html)。**Detach Run ID** 例: `20260414-133528-20661`（Pi5）〜 `20260414-140948-26295`（StoneBase）。**CI ナレッジ**: [KB-342](./knowledge-base/ci-cd.md)（§KB-342）。仕様追記は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md)、運用は [deployment.md](./guides/deployment.md)、全体進捗は [EXEC_PLAN.md](../EXEC_PLAN.md)。
- **計測機器ジャンル化 正本**: [plan](./plans/measuring-instrument-genres-execplan.md) · [module README](./modules/measuring-instruments/README.md) · [API](./modules/measuring-instruments/api.md) · [UI](./modules/measuring-instruments/ui.md)。

### 🆕 最新アップデート（2026-04-13）

- **配膳スマホ V22 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md)。
- **配膳スマホ V21 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md)。
- **配膳スマホ V20 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V19 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V17 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V16 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V15 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [design preview](./design-previews/mobile-placement-verify-collapsible-preview.html)。
- **配膳スマホ V14 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V13 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [design preview](./design-previews/mobile-placement-shelf-register-layout-preview.html)。
- **配膳スマホ V12 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V11 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V9 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V8 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V7 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **配膳スマホ V6 正本**: [mobile-placement runbook](./runbooks/mobile-placement-smartphone.md) · [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md) · [API](./api/mobile-placement.md)。
- **API OCR/VLM 境界整理 正本**: [KB-340](./knowledge-base/KB-340-api-ocr-vlm-boundary-refactor-deploy.md) · [ADR-20260402](./decisions/ADR-20260402-inference-foundation-phase1.md) · [deployment](./guides/deployment.md)。

### デザインプレビュー（静的 HTML）

- **手動順番リーダー俯瞰（静的プレビュー）**: [design-previews/manual-order-leader-overview-preview.html](./design-previews/manual-order-leader-overview-preview.html) — [design-previews/README.md](./design-previews/README.md) 参照。
- **手動順番 全端末横カード＋鉛筆／下ペイン（検討用静的プレビュー）**: [design-previews/manual-order-peek-accordion-schedule-preview.html](./design-previews/manual-order-peek-accordion-schedule-preview.html)
- **手動順番 編集中グレーアウト＋大きな端末名（検討用静的プレビュー）**: [design-previews/manual-order-edit-focus-gray-preview.html](./design-previews/manual-order-edit-focus-gray-preview.html)
- **手動順番フロー（全体把握 ↔ 生産スケジュール）**: [design-previews/manual-order-schedule-to-overview-flow-preview.html](./design-previews/manual-order-schedule-to-overview-flow-preview.html)
- **手動順番 上ペイン行明細（高密度・ラベルなし）**: [design-previews/manual-order-overview-pane-row-detail-preview.html](./design-previews/manual-order-overview-pane-row-detail-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **手動順番 上ペイン端末カード（3行: 製番品番 / 工順部品名 / 機種名・本文は生産スケジュールと同じ text-xs）**: [design-previews/manual-order-device-card-location-machine-preview.html](./design-previews/manual-order-device-card-location-machine-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **手動順番 帯分け → オペレーター確定順位（静的プレビュー）**: [design-previews/manual-order-band-to-operator-rank-preview.html](./design-previews/manual-order-band-to-operator-rank-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 登録セクション重なり修正案（静的プレビュー）**: [design-previews/mobile-placement-register-section-stack-preview.html](./design-previews/mobile-placement-register-section-stack-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 照合の折りたたみ（既定は閉じる・下半を広く）（静的プレビュー）**: [design-previews/mobile-placement-verify-collapsible-preview.html](./design-previews/mobile-placement-verify-collapsible-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ メイン画面（照合折りたたみ＋下半・高視認テーマ／本番整合メモ）**: [design-previews/mobile-placement-main-page-detail-preview.html](./design-previews/mobile-placement-main-page-detail-preview.html) — 整合: [plans/mobile-placement-main-page-preview-parity.md](./plans/mobile-placement-main-page-preview-parity.md) · [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 棚一覧・俯瞰（案A〜D・色分け9ゾーン含む・静的プレビュー）**: [design-previews/mobile-placement-placement-board-all-cases-preview.html](./design-previews/mobile-placement-placement-board-all-cases-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 部品→棚を最少手数で探す（複数案・静的プレビュー）**: [design-previews/mobile-placement-part-find-min-steps-preview.html](./design-previews/mobile-placement-part-find-min-steps-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 部品名の段階的絞り込み・口頭照会・ソースX/Y（静的プレビュー）**: [design-previews/mobile-placement-part-name-incremental-search-preview.html](./design-previews/mobile-placement-part-name-incremental-search-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 五十音＋A–Z カーナビ風（よく使う語プリセット・ボタン消去・薄表示・次の1文字のみ）（静的プレビュー）**: [design-previews/mobile-placement-gojuon-prune-nav-preview.html](./design-previews/mobile-placement-gojuon-prune-nav-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **配膳スマホ 登録済み部品を探す最終案（空白区切り AND・押下で即検索・登録済みのみ表示・不要ボタンは非表示）（静的プレビュー／実装は `@raspi-system/part-search-core` とキオスク UI で対応）**: [design-previews/mobile-placement-part-keyword-and-search-preview.html](./design-previews/mobile-placement-part-keyword-and-search-preview.html) — [design-previews/README.md](./design-previews/README.md)
- **リーダー順位ボード（納期ベース・本番 `/kiosk/production-schedule/leader-order-board` の静的プレビュー）**: [design-previews/leader-due-rank-board-preview.html](./design-previews/leader-due-rank-board-preview.html) — 運用・デプロイ記録は [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md)（「リーダー順位ボード」節）
- **部品測定・テンプレート選択（提案UI・静的）**: [design-previews/kiosk-part-measurement-template-picker.html](./design-previews/kiosk-part-measurement-template-picker.html) — [design-previews/README.md](./design-previews/README.md)

### キオスク部品測定記録

- **設計判断**: [ADR-20260329-part-measurement-kiosk-record.md](./decisions/ADR-20260329-part-measurement-kiosk-record.md)（Phase1） / [ADR-20260401-part-measurement-phase2-resource-cd.md](./decisions/ADR-20260401-part-measurement-phase2-resource-cd.md)（Phase2: `resourceCd` キー・状態拡張・スケジュール起点） / [ADR-20260330-part-measurement-visual-template.md](./decisions/ADR-20260330-part-measurement-visual-template.md)（visual template・図面1枚・`displayMarker`） / [ADR-20260404-part-measurement-template-pick-kiosk.md](./decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)（キオスク・候補一覧・`clone-for-schedule-key`・**`templateScope` / `candidateFhinmei`**・matchKind `two_key_fhincd_resource` / `one_key_fhinmei`・**`FHINMEI_ONLY` 照合は 2026-04-05 以降 正規化後 `includes` 部分一致**・レガシー `allowAlternateResourceTemplate`）
- **運用手順**: [kiosk-part-measurement.md](./runbooks/kiosk-part-measurement.md)
- **検査図面 測定点位置微調整（十字ボタン · 2026-06-05 · Web のみ · Pi5+stonebase 本番・実機 OK · `da9d2675`）**: [KB-320 §十字ボタン](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-測定点位置微調整-十字ボタン-2026-06-05) · [ExecPlan](./plans/inspection-drawing-point-nudge-execplan.md) · [deployment §2026-06-05](./guides/deployment.md#kiosk-inspection-drawing-point-nudge-2026-06-05) · [Runbook §十字ボタン](./runbooks/kiosk-part-measurement.md#検査図面-測定点位置微調整-十字ボタン-2026-06-05) · CI **`26996602603`**
- **検査図面 作成/改版ヘッダー フラット band（2026-06-04 · Web のみ · Pi5+Pi4×4 · `d96da485`）**: [KB-320 §フラット band](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-作成改版ヘッダー-フラット-band-2026-06-04) · [ExecPlan](./plans/inspection-drawing-create-layout-and-return-nav.md) · [deployment §2026-06-04](./guides/deployment.md#kiosk-inspection-drawing-create-header-flat-layout-2026-06-04) · [Runbook §フラット band](./runbooks/kiosk-part-measurement.md#検査図面-作成改版ヘッダー-フラット-band-2026-06-04) · CI **`26917349311`**
- **検査図面 作成/改版レイアウト + 戻り先ナビ（2026-06-03 · Web のみ · Pi5 先行 `5274f1ee`）**: [KB-320 §作成レイアウト](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-作成改版レイアウト-2026-06-03) · [KB-320 §戻り先](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-戻り先ナビ-2026-06-03) · [ExecPlan](./plans/inspection-drawing-create-layout-and-return-nav.md) · [deployment §2026-06-03](./guides/deployment.md#kiosk-inspection-drawing-create-layout-return-nav-2026-06-03) · [Runbook](./runbooks/kiosk-part-measurement.md#検査図面-作成-layout-return-nav-2026-06-03) · [layout preview](./plans/kiosk-inspection-drawing-layout-preview.html) · CI **`26883229358`**
- **検査図面 UI/UX（符号付き公差・名称候補・上辺一覧・自主検査候補 · 2026-06-03 · `main` マージ · Pi5+stonebase 先行）**: [KB-320 §UI/UX](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-uiux-符号付き公差-2026-06-03) · [ExecPlan](./plans/inspection-drawing-signed-tolerance-uiux.md) · [deployment §UI/UX](./guides/deployment.md#kiosk-inspection-drawing-signed-tolerance-uiux-2026-06-03) · [Runbook §UI/UX デプロイ](./runbooks/kiosk-part-measurement.md#検査図面-uiux-符号付き公差-デプロイ-2026-06-03) · [layout preview](./plans/kiosk-inspection-drawing-layout-preview.html) · **`6e436cfc`** · CI **`26867660917`**
- **順位ボード「検」→ 自主検査 図面空白修正（Web のみ · 2026-06-03 · Pi5+stonebase 実機 OK）**: [KB-320 §図面空白](./knowledge-base/KB-320-kiosk-part-measurement.md#self-inspection-session-drawing-blank-2026-06-03) · [deployment §図面空白](./guides/deployment.md#kiosk-self-inspection-session-drawing-blank-2026-06-03) · [Runbook §図面空白](./runbooks/kiosk-part-measurement.md#自主検査セッション図面空白-2026-06-03) · **`9f3f0bac`** · CI **`26863128347`**
- **キオスク自主検査 ガイド polish（倍率 2.0・保存 blur · 2026-06-04 · Web のみ · Pi5 `fb10f0e0` 目視 OK · Pi4 未）**: [KB-320 §ガイド polish](./knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-ガイド-polish-倍率2-0-2026-06-04) · [Runbook §ガイド polish](./runbooks/kiosk-part-measurement.md#自主検査-ガイド-polish-倍率2-0-2026-06-04) · [deployment §polish](./guides/deployment.md#kiosk-self-inspection-guided-zoom-2-polish-2026-06-04) · Detach Pi5 **`20260604-191118-31485`** · CI **`26944967237`**
- **キオスク自主検査 ガイドフォーカス + フルリセット + 図面ガイド試行（2026-06-04 · API+Web+migration · Pi5 先行 `f16cb7ca` · Pi4 未）**: [KB-320 §ガイドフォーカス](./knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション-ガイド付きフォーカス-2026-06-04) · [KB-320 §リセット・試行](./knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-フルリセット-ガイド試行-2026-06-04) · [Runbook §ガイドフォーカス](./runbooks/kiosk-part-measurement.md#自主検査-ガイド付きフォーカス-2026-06-04) · [Runbook §リセット・試行](./runbooks/kiosk-part-measurement.md#自主検査-フルリセット-ガイド試行-2026-06-04) · [deployment §2026-06-04](./guides/deployment.md#kiosk-self-inspection-guided-focus-reset-trial-2026-06-04) · Detach Pi5 **`20260604-155553-5452`** · CI **`26935485926`** · migration **`20260604120000_self_inspection_session_reset_audit`**
- **自主検査・検査図面 仕様拡張（4モード・公差・markerNo · 2026-06-03 · Pi5+Pi4×4 本番 OK）**: [KB-320 §仕様拡張 本番](./knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-検査図面-仕様拡張-本番-2026-06-03) · [deployment §2026-06-03](./guides/deployment.md#kiosk-self-inspection-four-modes-and-tolerance-2026-06-03) · [Runbook §2026-06-03](./runbooks/kiosk-part-measurement.md#自主検査-検査図面-仕様拡張-2026-06-03) · [KB-278](./knowledge-base/infrastructure/security.md#kb-278-tailscale経由で-https-admin-にアクセスできないtagadmin-欠落)（Mac `tag:admin`）· [KB-384](./knowledge-base/infrastructure/security.md#kb-384-pi4-キオスク非表示tailscale-再認証後の-netmap-未同期)（Pi4 TS 復旧・`raspberrypi4` 再デプロイ **`20260603-115435-29435`**）· [KB-385](./knowledge-base/infrastructure/security.md#kb-385-pi5-tailscale-needslogin-と-node-key-失効) · **`2f3979ce`** / 研削メイン HEAD **`b787c273`**
- **検査図面 図面ライブラリ + 密度レイアウト（2026-06-08 · API+Web · Pi5 本番・実機 OK · Pi4×4 未 · `38b7583f`）**: [ExecPlan §visual library](./plans/kiosk-inspection-drawing-mvp-execplan.md) · CI **`27119651752`** · Detach Pi5 **`20260608-153118-7422`**
- **検査図面 図面ライブラリ 密度調整第2弾（2026-06-08 · Web のみ · Pi5 本番・実機 OK · Pi4×4 未 · `ddc3ce8b`）**: [ExecPlan](./plans/kiosk-inspection-drawing-mvp-execplan.md) · CI **`27122345564`** · Detach Pi5 **`20260608-164812-2511`**
- **検査図面（MVP + 一覧ハブ + プレビュー parity + フィルタ overflow + キャンバスズーム + **テンプレ編集図面読込・ズーム痙攣 2026-05-31**）**: [ExecPlan](./plans/kiosk-inspection-drawing-mvp-execplan.md) · [KB-320 §検査図面](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-mvp2026-05-30) · [KB-320 §認可付き図面読込](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-テンプレ編集-認可付き図面読込-2026-05-31) · [KB-320 §ズーム痙攣](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-キャンバスズーム痙攣修正-2026-05-31) · [KB-320 §プレビュー parity](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-preview-parity-2026-05-30) · [KB-320 §フィルタ overflow](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-library-filter-overflow-2026-05-30) · [KB-320 §キャンバスズーム](./knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-canvas-zoom-2026-05-30) · [deployment §2026-05-31](./guides/deployment.md#kiosk-inspection-drawing-edit-image-and-zoom-jitter-2026-05-31) · [ADR-20260530](./decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md) · [Runbook §図面読込](./runbooks/kiosk-part-measurement.md#検査図面-テンプレ編集-認可付き図面読込-2026-05-31) · [Runbook §parity](./runbooks/kiosk-part-measurement.md#検査図面-dev-プレビュー本番パリティ) · [Runbook §overflow](./runbooks/kiosk-part-measurement.md#検査図面-一覧フィルタ-overflow-2026-05-30) · [Runbook §キャンバスズーム](./runbooks/kiosk-part-measurement.md#検査図面-キャンバスズーム-2026-05-30) · [deployment §MVP](./guides/deployment.md#kiosk-inspection-drawing-mvp-2026-05-30) · [deployment §parity](./guides/deployment.md#kiosk-inspection-drawing-preview-parity-2026-05-30) · [deployment §overflow](./guides/deployment.md#kiosk-inspection-drawing-library-filter-overflow-2026-05-30) · [deployment §キャンバスズーム](./guides/deployment.md#kiosk-inspection-drawing-canvas-zoom-2026-05-30) — **Pi5**: 一覧ハブ `ef78f4dd` + parity **`ccacef85`** + overflow **`e19f9b07`** + ズーム **`364aa184`** + **図面読込/痙攣 `e12a5a9c`/`f6a9544a`**（`20260531-092334-26185` · **編集図面+拡大2回 OK 2026-05-31**）· **Pi4×4 未**。DEV: `/dev/kiosk-inspection-drawing-library` · `/dev/kiosk-inspection-drawing-create`。
- **トラブルシュート**: [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md)（図面ストレージは Docker 本番 compose で `part-measurement-drawings` をホストバインドし、rerun 時は `api/web` の `Created` 残留と summary 判定も確認。現行 UI はヘッダ 1 行優先・入力欄 5 桁幅・**編集画面上部帯**は [design-previews/kiosk-part-measurement-header-strip.html](./design-previews/kiosk-part-measurement-header-strip.html) 相当のレイアウト。**複数記録表**はセッション親子・上部カード・**別テンプレ追加**・API `{ sheet, session }`・CSV `sessionId` を KB 同一文書の「複数記録表」節参照。**管理テンプレ**は `POST …/templates/:id/revise` で版上げ（**`FHINMEI_ONLY` のみ `candidateFhinmei` 変更可**）・**削除**は `POST …/templates/:id/retire` で論理削除）
- **実機検証**: [verification-checklist.md](./guides/verification-checklist.md) 6.6.9・6.6.10、`./scripts/deploy/verify-phase12-real.sh`（`resolve-ticket`・**`templates/candidates`** スモーク含む）

### キオスク要領書（PDF）

- **仕様・トラブルシュート**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md)
- **バーコードスキャン検索（ZXing・Firefox キオスク）**: [ADR-20260329](./decisions/ADR-20260329-kiosk-document-barcode-scan-zxing.md)
- **フリーワード検索（部分一致）の判断**: [ADR-20260326](./decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)
- **詳細 API の React Query キャッシュ（チャタリング抑止）**: [ADR-20260327](./decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)
- **運用手順**: [kiosk-documents.md](./runbooks/kiosk-documents.md)
- **HTML Gmail 取り込み 検証計画**（単体・統合・手動・**2026-04-09 本番: 同名 HTML 別メール上書き実測**）: [kiosk-html-gmail-ingest-verification.md](./plans/kiosk-html-gmail-ingest-verification.md)

### 配膳スマホ（Android・Tailscale）

- **API・運用**: [api/mobile-placement.md](./api/mobile-placement.md) / [mobile-placement-smartphone.md](./runbooks/mobile-placement-smartphone.md)（… **V21 部品検索 UI モジュール化**（KB-339 V21）／**V22 棚レイアウトマスタ**: `/kiosk/mobile-placement/shelf-master`・`shelf-layout` API・`displayLabel`・[ADR-20260523](./decisions/ADR-20260523-mobile-placement-shelf-layout-master.md)／**V3**: `/kiosk/mobile-placement/shelf-register` 棚番3段階／**本番反映・検証手順は Runbook §0**）
- **Android ブラウザ殻（キオスク）方針（2026-04-18）**: **Chrome 継続 + Web UI/UX 改善**を当面の正とする。調査整理は [KB-351](./knowledge-base/KB-351-mobile-placement-android-browser-kiosk-research.md)、意思決定は [ADR-20260418](./decisions/ADR-20260418-mobile-placement-android-browser-shell.md)。**棚レイアウトマスタ（2026-05-23 機能本体 → 2026-05-24 Zero2W インライン + オーファン → 編集 Dialog ドック UX → 未使用→確定の結合解放）**: [KB-382](./knowledge-base/KB-382-mobile-placement-shelf-layout-master.md)（§[未使用解放](./knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#unused-release-merged-cells-2026-05-24)·§[ドック UX](./knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#layout-editor-dock-confirm-reset-2026-05)·§[インライン](./knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#zero2w-inline-preset-2026-05-24)·§[オーファン](./knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#orphan-zero2w-preset-clear-2026-05-24)）·[deployment.md §未使用解放](./guides/deployment.md#kiosk-shelf-master-unused-release-merged-cells-2026-05-24)·[deployment.md §ドック](./guides/deployment.md#kiosk-shelf-layout-editor-dock-confirm-reset-2026-05-24)·[deployment.md §Zero2W](./guides/deployment.md#kiosk-shelf-master-zero2w-inline-orphan-2026-05-24)·[ADR-20260523](./decisions/ADR-20260523-mobile-placement-shelf-layout-master.md)・[mobile-placement-shelf-layout-master.md](./plans/mobile-placement-shelf-layout-master.md)。進捗: [EXEC_PLAN.md](../EXEC_PLAN.md) Progress / [§棚マスタ follow-up](../EXEC_PLAN.md#shelf-master-follow-up-2026-05-24)。
- **バーコード調査ゲート**: [KB-339](./knowledge-base/KB-339-mobile-placement-barcode-survey.md)

### LocalLLM（Ubuntu / Tailscale）

- **運用手順**: [local-llm-tailscale-sidecar.md](./runbooks/local-llm-tailscale-sidecar.md)（**トークンローテーション**は同 Runbook の「共有トークンのローテーション」節）
- **DGX system-prod 段階切替 Runbook**: [dgx-system-prod-local-llm.md](./runbooks/dgx-system-prod-local-llm.md)（`green/blue` 差し替え、blue cold start・`BLUE_LLM_RUNTIME_STOP_MODE` / 互換 `BLUE_LLM_RUNTIME_KEEP_WARM`、**単一アクティブ強制**（`DGX_LLM_SINGLE_ACTIVE_GUARD`・[`dgx_llm_single_active_guard.py`](../scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py)）、`INFERENCE_PROVIDERS_JSON` / `LOCAL_LLM_*`、**コンテナ隔離の限界**とトラブルシューティング / **管理コンソール DGX リソース**: `/admin/tools/dgx-resource`・`GET/POST /api/system/dgx-resource/*`・**`overview.targets` / `EXECUTE_TARGET_ACTION`**・**Spark ホスト監視は `DGX_RESOURCE_SPARK_HOST_STATUS_URL` 未設定時でも admin `LOCAL_LLM_BASE_URL/healthz` を既定使用**） / **DGX 起動雛形・systemd**: [scripts/dgx-local-llm-system/README.md](../scripts/dgx-local-llm-system/README.md) / **ADR（blue 停止ポリシー）**: [ADR-20260427-blue-llm-runtime-stop-policy.md](./decisions/ADR-20260427-blue-llm-runtime-stop-policy.md) / **ADR（本番既定 backend: green/blue）**: [ADR-20260428-dgx-active-backend-prod-default.md](./decisions/ADR-20260428-dgx-active-backend-prod-default.md) / **ADR（Control Targets）**: [ADR-20260502-dgx-resource-control-targets.md](./decisions/ADR-20260502-dgx-resource-control-targets.md)
- **DGX Spark 移行・多用途分離運用計画**: [dgx-spark-local-llm-migration-execplan.md](./plans/dgx-spark-local-llm-migration-execplan.md)（Ubuntu PC から DGX Spark への LocalLLM 置換、公式 NVIDIA スタック優先、業務/私用/実験用途の気密分離、巨大モデル共有、ストレージ運用、段階計画と進捗管理表）
- **DGX リソース管理ダッシュボード UI Phase8（KPI 先頭・説明削減・全文可読）**: [dgx-resource-dashboard-ui-phase8.md](./plans/dgx-resource-dashboard-ui-phase8.md)（ブランチ `feat/dgx-resource-dashboard-ui-phase8`・コミット前）
- **DGX Spark private ComfyUI（コンテナ雛形・FLUX.2 Klein 9B workflow）**: [dgx-private-comfyui.md](./runbooks/dgx-private-comfyui.md) / [scripts/dgx-private-comfyui/README.md](../scripts/dgx-private-comfyui/README.md) / [KB-379](./knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md)（`private-personal` 専用・Mac **SSH `-L 8188`** 標準・Pi5 **`38081/private-comfyui/health`** 疎通。**2026-05-31**: 基準線 **`0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json`**（実在モデル整合・大幅改善）·レガシー `0525_…` は参照ずれ。**2026-05-25**: Enhancer 破綻除去・NVFP4 **3分台**。**2026-05-17**: [KB-378](./knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md)）
- **2026-04-27 追補（Pi5 整合）**: `manage-app-configs` + 必要な `apps/api` / Ansible 同期 + `api` 再ビルド後、開発端末で `./scripts/deploy/verify-phase12-real.sh` **PASS 42 / WARN 1 / FAIL 0**（Runbook ・ ExecPlan `Progress` 参照）
- **DGX Spark photo_label VLM 検証計画**: [dgx-spark-photo-label-validation-plan.md](./plans/dgx-spark-photo-label-validation-plan.md)（`photo_label` を Ubuntu fallback から Spark へ寄せるための互換性・安定性・品質・退役判断条件）
- **判断記録**: [ADR-20260328](./decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md)（Ubuntu / Tailscale 側） / [ADR-20260329](./decisions/ADR-20260329-local-llm-pi5-api-operations.md)（Pi5 API 代理・ログ方針） / [ADR-20260402](./decisions/ADR-20260402-inference-foundation-phase1.md)（推論基盤フェーズ1・複数プロバイダ・text/vision・要領書要約オプション） / [ADR-20260403](./decisions/ADR-20260403-on-demand-local-llm-runtime-control.md)（オンデマンド llama-server・VRAM 共有）
- **トラブルシュート**: [KB-317](./knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する)（Ubuntu sidecar 側） / [KB-318](./knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)（Pi5 API コンテナへの `LOCAL_LLM_*` は `docker.env` 経由） / [KB-360](./knowledge-base/KB-360-local-llm-warm-window-schedule.md)（**on_demand 昼間 warm ウィンドウ**） / [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md)（写真持出 VLM ラベル・**類似候補ギャラリー**） / [photo-tool-similarity-gallery.md](./runbooks/photo-tool-similarity-gallery.md)（**埋め込み Ansible 配線・GOOD バックフィル・シャドー観測**）
- **判断記録（類似候補）**: [ADR-20260330](./decisions/ADR-20260330-photo-tool-similarity-gallery-pgvector.md)（pgvector + 外部埋め込み HTTP、管理画面のみ候補表示） / [ADR-20260331](./decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md)（VLM への条件付き GOOD 類似補助・**シャドーモード**先行） / [ADR-20260404](./decisions/ADR-20260404-photo-tool-label-assist-active-gate.md)（本番保存・アクティブ＋**ギャラリー行数ゲート**、既定 OFF）
- **サイネージ（貸出グリッド描画エンジン）**: [ADR-20260405](./decisions/ADR-20260405-signage-loan-grid-render-engine.md)（`SIGNAGE_LOAN_GRID_ENGINE`: `svg_legacy` 既定・`playwright_html` オプトイン・Docker/Ansible 配線）
- **Tailnet ポリシー台帳**: [tailscale-policy.md](./security/tailscale-policy.md)

### 🆕 最新アップデート（2026-04-10）

- **Dropbox バックアップ推奨カタログ本番 正本**: [KB-338](./knowledge-base/infrastructure/backup-restore.md) · [deployment](./guides/deployment.md)。
- **Dropbox バックアップ coverage_gap 正本**: [KB-338](./knowledge-base/infrastructure/backup-restore.md) · [API](./api/backup.md)。

### 🆕 最新アップデート（2026-04-14）

- **キオスク「集計」月選択モーダル・タブ別資産フィルタ 正本**: [KB-334](./knowledge-base/KB-334-kiosk-rigging-loan-analytics-deploy.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-09）

- **キオスク「集計」写真タブ表示名集計 正本**: [KB-334](./knowledge-base/KB-334-kiosk-rigging-loan-analytics-deploy.md) · [deployment](./guides/deployment.md)。
- **キオスク要領書ビューア 縦スクロール安定化 正本**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md) · [Runbook](./runbooks/kiosk-documents.md)。
- **写真持出 VLM アクティブ補助 正本**: [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-08）

- **Android 軽量 `/signage-lite` 実機トラブルシュート（401・`heartbeat`・Chrome サイトデータ／キャッシュ）**: 手順は [signage-client-setup.md](./guides/signage-client-setup.md#android-signage-lite) の「トラブルシュート」節・[KB-337](./knowledge-base/infrastructure/signage.md#kb-337-android-signage-lite-401-chrome)。
- **Pi4 Firefox キオスク ブラウザ枠最小化 正本**: [KB-336](./knowledge-base/infrastructure/miscellaneous.md) · [Runbook](./runbooks/kiosk-wifi-panel-shortcut.md)。
- **サイネージ `mobile_placement_parts_shelf_grid` 正本**: [guide](./guides/signage-mobile-placement-parts-shelf-grid.md) · [KB-341](./knowledge-base/infrastructure/signage.md#kb-341-mobile-placement-parts-shelf-grid-deploy) · [deployment](./guides/deployment.md)。
- **サイネージ `kiosk_leader_order_cards` ヘッダ加工機名全文 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md#signage-leader-order-header-full-machine-name-2026-05-21)。
- **サイネージ `kiosk_leader_order_cards` 5列×2段 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md#signage-leader-order-cards-5x2-grid-10-2026-05-21)。
- **サイネージ `kiosk_leader_order_cards` 納期 Date 正規化 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md#signage-leader-order-due-date-prisma-date-2026-05-21)。
- **サイネージ `kiosk_leader_order_cards` コンパクト＋未完のみ 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md#signage-leader-order-cards-compact-incomplete-2026-05-21)。
- **サイネージ `kiosk_leader_order_cards` キオスク整合 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md#signage-leader-order-kiosk-aligned-2026-05-21)。
- **サイネージ `kiosk_leader_order_cards` 工場視認性・SOLID 分割 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md) · [preview](./design-previews/README.md)。
- **サイネージ `kiosk_leader_order_cards` 4×2・max8 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md) · [PR #95](https://github.com/denkoushi/RaspberryPiSystem_002/pull/95)。

### 🆕 最新アップデート（2026-04-07）

- **サイネージ `kiosk_leader_order_cards` 初回 JPEG 正本**: [KB-335](./knowledge-base/infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) · [deployment](./guides/deployment.md)。
- **型落ち Android タブレット向け軽量サイネージ `/signage-lite`・JPEG ポーリング・`current-image` の `key` クエリと端末キー整合**: セットアップと URL 例は [signage-client-setup.md](./guides/signage-client-setup.md#android-signage-lite)（`clientKey` 登録・`targetClientKeys`）。
- **サイネージ対象端末 管理UI 正本**: [ADR-20260407](./decisions/ADR-20260407-signage-target-client-keys.md) · [KB](./knowledge-base/infrastructure/signage.md) · [deployment](./guides/deployment.md) · [PR #89](https://github.com/denkoushi/RaspberryPiSystem_002/pull/89)。
- **サイネージ端末別スケジュール 正本**: [ADR-20260407](./decisions/ADR-20260407-signage-target-client-keys.md) · [KB](./knowledge-base/infrastructure/signage.md) · [deployment](./guides/deployment.md)。
- **サイネージ `splitCompact24` フッタ・取消視認性 正本**: [KB-333](./knowledge-base/KB-333-signage-compact24-footer-kiosk-cancel-readability.md) · [deployment](./guides/deployment.md)。
- **キオスク「集計」正本**: [KB-334](./knowledge-base/KB-334-kiosk-rigging-loan-analytics-deploy.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-06）

- **キオスク持出一覧カード 面トークン 正本**: [KB-332](./knowledge-base/KB-332-kiosk-active-loan-card-modern-surface.md) · [deployment](./guides/deployment.md)。
- **キオスク持出一覧 compact 表記 正本**: [KB-330](./knowledge-base/infrastructure/signage.md#kb-330-compact-kiosk-instrument-rigging-deploy) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-05）

- **キオスク部品測定 複数記録表 正本**: [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [Runbook](./runbooks/kiosk-part-measurement.md)。
- **キオスク部品測定 測定値入力中一覧 正本**: [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [Runbook](./runbooks/kiosk-part-measurement.md)。
- **キオスク部品測定 `FHINMEI_ONLY` 部分一致 正本**: [ADR-20260404](./decisions/ADR-20260404-part-measurement-template-pick-kiosk.md) · [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [verification](./guides/verification-checklist.md)。

### 🆕 最新アップデート（2026-04-04）

- **Web/Caddy `go-jose` CVE-2026-34986 正本**: [KB-307](./knowledge-base/ci-cd.md#kb-307-trivy-image-web-が-usrbincaddy-の-cve-を検出して-ci-が失敗する) · [deployment](./guides/deployment.md) · [verification](./guides/verification-checklist.md)。
- **キオスク部品測定 テンプレ候補選択 正本**: [ADR-20260404](./decisions/ADR-20260404-part-measurement-template-pick-kiosk.md) · [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [Runbook](./runbooks/kiosk-part-measurement.md) · [preview](./design-previews/kiosk-part-measurement-template-picker.html) · [verification](./guides/verification-checklist.md)。
- **キオスク部品測定 `clone-for-schedule-key` 自動複製 正本**: [ADR-20260404](./decisions/ADR-20260404-part-measurement-template-pick-kiosk.md) · [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [Runbook](./runbooks/kiosk-part-measurement.md) · [verification](./guides/verification-checklist.md)。
- **キオスク部品測定 編集画面上部帯 正本**: [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [preview](./design-previews/kiosk-part-measurement-header-strip.html) · [design previews](./design-previews/README.md) · [verification](./guides/verification-checklist.md)。

### 🆕 最新アップデート（2026-04-03）

- **キオスク部品測定 図面永続化・Pi5 rerun 復旧 正本**: [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [KB-329](./knowledge-base/infrastructure/ansible-deployment.md#kb-329-部品測定図面ストレージ修正後の-pi5-rerun-で-api-が-created-のまま残りsummary-が失敗を-success-扱いした) · [deployment](./guides/deployment.md)。
- **キオスク リーダー順位ボード 子行レイアウト 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#leader-order-board-child-row-layout-registered-seiban-panel-2026-04-02) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **サイネージ `splitCompact24` 貸出カード 正本**: [KB-325](./knowledge-base/infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git) · [preview](../apps/api/scripts/html-previews/signage-split-compact24-preview.html) · [deployment](./guides/deployment.md)。
- **サイネージ貸出グリッド描画エンジン 正本**: [KB-327](./knowledge-base/infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) · [ADR-20260405](./decisions/ADR-20260405-signage-loan-grid-render-engine.md) · [deployment](./guides/deployment.md)。
- **サイネージ Playwright 貸出グリッド HTML 組み立て 正本**: [KB-327](./knowledge-base/infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **サイネージ貸出グリッド HTML モダン外皮 正本**: [KB-331](./knowledge-base/infrastructure/signage.md#kb-331-signage-loan-grid-html-modern-chrome-stonebase-only) · [KB-327](./knowledge-base/infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-03）

- **写真持出: VLM ラベル出自（`Loan.photoToolVlmLabelProvenance`・`shared-types` 契約・labeling/review・管理 `/admin/photo-loan-label-reviews`）・本番5台順次・Phase12・`main` マージ**: ブランチ `feat/photo-tool-vlm-label-provenance-admin`。値は `UNKNOWN`（マイグレーション既定）/ `FIRST_PASS_VLM` / `ASSIST_ACTIVE_VLM`。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 41 / WARN 0 / FAIL 0**（**未認証 `GET …/photo-label-reviews` → 401** を追加）；Pi5 DB 列・集計例は [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md) provenance 節。**参照**: [photo-loan.md](./modules/tools/photo-loan.md) / [verification-checklist.md](./guides/verification-checklist.md) §6.6.6 / [deployment.md](./guides/deployment.md) / [EXEC_PLAN.md](../EXEC_PLAN.md)。

### 🆕 最新アップデート（2026-04-02）
- **キオスク リーダー順位ボード 共有 `search-state`・子行備考・機種名一括解決 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#順位ボード-共有登録製番子行備考機種名一括解決2026-04-02) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **キオスク リーダー順位ボード 納期アシスト左2段スタック UI 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#順位ボード-納期アシスト-ui左2段スタックモーダル-z-index2026-04-02-追補) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **キオスク リーダー順位ボード 納期アシスト製番検索・詳細シート 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#順位ボード-納期アシスト製番検索詳細シート2026-04-02) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **写真持出 VLM アクティブ補助ゲート 正本**: [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md#vlm-アクティブ補助本番保存ギャラリー行数ゲート) · [ADR-20260404](./decisions/ADR-20260404-photo-tool-label-assist-active-gate.md) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **写真持出 VLM アクティブ補助 Ansible 配線 正本**: [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md#ansible-配線photo_tool_label_assist_active_vaultinventorydocker-env2026-04-07) · [deployment](./guides/deployment.md)。
- **キオスク リーダー順位ボード UX polish 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#ux-polish-leader-order-board-2026-04-02) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **キオスク リーダー順位ボード 順位変更キャッシュ高速化 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#順位変更キャッシュ高速化leaderboardfastpath2026-04-02) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **キオスク リーダー順位ボード 行アクション・機種名フォールバック 正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#行アクション機種名フォールバック2026-04-02) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-04-01）

- **生産スケジュール 表示用納期 `effectiveDueDate`・計画列 UI 正本**: [KB-297 §表示用納期](./knowledge-base/KB-297-kiosk-due-management-workflow.md#表示用納期-effectiveduedate計画列-ui2026-04-01) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。
- **生産日程 部品納期個数（補助CSV）正本**: [KB-297 §部品納期個数CSV](./knowledge-base/KB-297-kiosk-due-management-workflow.md#部品納期個数csvの補助反映2026-04-01) · [CSV guide](./guides/csv-import-export.md) · [verification](./guides/verification-checklist.md)。
- **写真持出 ギャラリー教師登録 `photo-gallery-seed` 正本**: [KB-319 §photo-gallery-seed](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md#管理コンソール-ギャラリー教師登録photo-gallery-seed2026-04-01) · [photo-loan](./modules/tools/photo-loan.md) · [verification](./guides/verification-checklist.md)。
- **サイネージ 管理スケジュール一覧（無効レコード再編集）正本**: [KB-322](./knowledge-base/infrastructure/signage.md#kb-322-管理コンソールサイネージスケジュール一覧無効レコードの再編集api分離) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-03-31）

- **サイネージ キオスク進捗一覧 `kiosk_progress_overview` 正本**: [KB-321](./knowledge-base/infrastructure/signage.md#kb-321-キオスク進捗一覧スロットkiosk_progress_overviewのサイネージ表示デプロイ実機検証) · [verification](./guides/verification-checklist.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-03-30）

- **生産スケジュール 登録製番共有履歴 上限20→50 正本**: [KB-231](./knowledge-base/api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) · [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md) · [deployment](./guides/deployment.md)。
- **LocalLLM オンデマンド起動・管理Chat制御 正本**: [ADR-20260403](./decisions/ADR-20260403-on-demand-local-llm-runtime-control.md) · [Runbook](./runbooks/local-llm-tailscale-sidecar.md) · [KB-318](./knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env) · [KB-313](./knowledge-base/KB-313-kiosk-documents.md)。
- **キオスク部品測定 visual template・図面再利用 正本**: [ADR-20260330](./decisions/ADR-20260330-part-measurement-visual-template.md) · [KB-320](./knowledge-base/KB-320-kiosk-part-measurement.md) · [Runbook](./runbooks/kiosk-part-measurement.md) · [verification](./guides/verification-checklist.md)。
- **写真持出 人レビュー・GOODギャラリー運用知見 正本**: [KB-319 §運用知見](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md#運用知見人レビューとギャラリー2026-03-30) · [photo-loan](./modules/tools/photo-loan.md) · [Runbook](./runbooks/photo-tool-similarity-gallery.md)。

### 🆕 最新アップデート（2026-03-29）

- **写真持出 埋め込み本番配線・GOODバックフィル 正本**: [Runbook](./runbooks/photo-tool-similarity-gallery.md) · [KB-319 §類似候補ギャラリー](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md#類似候補ギャラリーpgvector) · [deployment](./guides/deployment.md)。
- **キオスク要領書 バーコードスキャン検索 正本**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md) · [ADR-20260329](./decisions/ADR-20260329-kiosk-document-barcode-scan-zxing.md) · [Runbook](./runbooks/kiosk-documents.md)。

### 🆕 最新アップデート（2026-03-28）

- **写真持出 VLM・人レビュー・類似候補ギャラリー 正本**: [photo-loan](./modules/tools/photo-loan.md) · [KB-319](./knowledge-base/KB-319-photo-loan-vlm-tool-label.md) · [ADR-20260330](./decisions/ADR-20260330-photo-tool-similarity-gallery-pgvector.md) · [Runbook](./runbooks/photo-tool-similarity-gallery.md)。
- **`docs/` 配置ポリシー（Pi5保持・Pi4/Pi3削除）正本**: [KB-319](./knowledge-base/infrastructure/ansible-deployment.md#kb-319-docs-placement-policy-by-host-role) · [deployment](./guides/deployment.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **管理コンソール LocalLLM・トークンローテーション 正本**: [Runbook](./runbooks/local-llm-tailscale-sidecar.md) · [KB-318](./knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)。
- **Pi5 LocalLLM 可観測性ログ・運用ADR 正本**: [ADR-20260329](./decisions/ADR-20260329-local-llm-pi5-api-operations.md) · [Runbook](./runbooks/local-llm-tailscale-sidecar.md)。
- **Pi5 API LocalLLM Ansible配線 正本**: [KB-318](./knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env) · [deployment](./guides/deployment.md)。
- **Pi5 API → Ubuntu LocalLLM 代理疎通 正本**: [Runbook](./runbooks/local-llm-tailscale-sidecar.md) · [KB-317](./knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する)。
- **Ubuntu LocalLLM 専用ノード・Tailscale sidecar 正本**: [KB-317](./knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する) · [ADR-20260328](./decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md) · [Runbook](./runbooks/local-llm-tailscale-sidecar.md) · [tailscale-policy](./security/tailscale-policy.md)。
- **Pi4 3台目 FJV60/80 追加 正本**: [KB-315](./knowledge-base/infrastructure/ansible-deployment.md#kb-315-pi4-fjv-third-kiosk) · [client setup](./guides/client-initial-setup.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Pi4 4台目 StoneBase01 追加 正本**: [KB-316](./knowledge-base/infrastructure/ansible-deployment.md#kb-316-pi4-stonebase-fourth-kiosk) · [deploy-status](./runbooks/deploy-status-recovery.md) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-03-27）

- **キオスク要領書 ビューアツールバー折りたたみ・一覧要約 正本**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md) · [Runbook](./runbooks/kiosk-documents.md)。
- **キオスク要領書 文書番号・要約・検索拡張 正本**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md) · [Runbook](./runbooks/kiosk-documents.md)。
- **キオスク要領書 文書切替リセット・詳細キャッシュ 正本**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md) · [ADR-20260327](./decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md) · [Runbook](./runbooks/kiosk-documents.md)。

### 調査・分析

- **Raspberry Pi UX 改善（ベースライン採取の方法論・ブランチ `improve/pi-ux-phase-c`）**: [raspberry-pi-ux-baseline-methodology.md](./investigation/raspberry-pi-ux-baseline-methodology.md) — 起動・操作遅延・ポーリング負荷の計測観点と手順テンプレ。
- **生産日程 `FSIGENSHOYORYO`（所要・総分）分析**: [analysis/production-schedule-fsigenshoyoryo-analysis-20260324.md](./analysis/production-schedule-fsigenshoyoryo-analysis-20260324.md) — current snapshot の分布、資源別偏り、外れ値、納期 coverage、帯算出への使い方を整理。再実行 SQL 付き。
- **手動順番ワークフロー・全体ランキング・所要データの議論まとめ**: [analysis/manual-order-workflow-and-ranking-discussion-summary-20260324.md](./analysis/manual-order-workflow-and-ranking-discussion-summary-20260324.md) — 手動順番画面のUI改善案、帯分けの位置づけ、`FSIGENSHOYORYO` 評価、個数/実績工数突合の意義を横断的に整理。
- **生産日程 補助CSV（部品納期個数）連携の実装方針と反映**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md#部品納期個数csvの補助反映2026-04-01) — 件名 `部品納期個数` を別CSVダッシュボードで取得し、`FKOJUN + FSIGENCD + ProductNo` で winner 行へ照合。`plannedQuantity` / `plannedStartDate` / `plannedEndDate` を補助テーブルで保持し、既存 winner ルールは据え置き。
- **生産日程 本体CSVと補助CSVのキーずれ・上流工程変更・運用トラブルシュート（2026-04 調査）**: [KB-328](./knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md) — 補助 `unmatched`、本体 `FHINCD` ヘッダ不一致、winner と `ProductNo` の更新タイミング、管理画面の二重ファイル入力、上流（切削クエリの資源CD欠落等）とのギャップ、将来の無効フラグ／非表示案の**判断材料**。
- **Gmail 補助CSV同期の Prisma `Transaction not found`**: [KB-324](./knowledge-base/KB-324-gmail-order-supplement-prisma-transaction.md) — 補助同期のトランザクション設計・未読メールが残る条件（同期完了後のみ Gmail 後処理）。

### 🆕 最新アップデート（2026-03-26）

- **キオスク要領書 ビューア表示速度・スクロール改善 正本**: [KB-313](./knowledge-base/KB-313-kiosk-documents.md) · [Runbook](./runbooks/kiosk-documents.md)。

### 🆕 最新アップデート（2026-03-25）

- **工具貸出 active loan `clientId` 手動補正 API 正本**: [KB](./knowledge-base/kb-kiosk-rigging-return-cancel-investigation.md#2026-03-25-追記-旧-active-loan-の-location-補正手段) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-24）

- **吊具マスタ `idNum`（旧番号）・持出一覧同一行表示 正本**: [KB-312](./knowledge-base/KB-312-rigging-idnum-deploy-verification.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-23）

- **実績基準時間 推定式見直し 正本**: [KB-297 §実績基準時間](./knowledge-base/KB-297-kiosk-due-management-workflow.md#実績基準時間-推定式見直し2026-03-23) · [ADR-20260323](./decisions/ADR-20260323-actual-hours-baseline-estimation.md)。
- **進捗一覧 納期・資源CDチップ重なり防止 正本**: [KB-297 §重なり防止](./knowledge-base/KB-297-kiosk-due-management-workflow.md#progress-overview-due-resource-no-overlap-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **進捗一覧 納期列コンパクト・資源CDチップ余白詰め 正本**: [KB-297 §納期列コンパクト](./knowledge-base/KB-297-kiosk-due-management-workflow.md#progress-overview-due-column-compact-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 上ペイン 工順(FKOJUN)のみ表示 正本**: [KB-297 §工順FKOJUN](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-overview-fkojun-display-only-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 上ペイン 端末カード2行ヘッダー・全体把握行ホバー格納 正本**: [KB-297 §2行カード](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-overview-card-two-line-header-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **生産スケジュール 登録製番・資源CDドロップダウン Portal 配置 正本**: [KB-297 §Portal](./knowledge-base/KB-297-kiosk-due-management-workflow.md#production-schedule-filter-dropdown-portal-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **manual-order-overview 割当資源 siteKey 正本優先 正本**: [KB-297 §siteKey 優先](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-overview-assigned-resource-sitekey-priority-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番・全体ランキング 工場共有同期（siteKey 正本）正本**: [ADR-20260323](./decisions/ADR-20260323-sitekey-canonical-manual-order-and-global-rank.md) · [KB-297 §siteKey同期](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-sitekey-canonical-sync-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 Pi4 下ペイン targetDeviceScopeKey 修正 正本**: [KB-297 §targetDeviceScopeKey](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-pi4-target-device-scope-key-web-fix-2026-03-23) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-22）

- **進捗一覧 5列・ラベル削除・presentation 分割 正本**: [KB-297 §進捗一覧5列](./knowledge-base/KB-297-kiosk-due-management-workflow.md#progress-overview-five-cols-layout-2026-03-22) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-21）

- **生産スケジュール本体 検索・資源フィルタ帯ホバー展開 正本**: [KB-297 §本体帯ホバー](./knowledge-base/KB-297-kiosk-due-management-workflow.md#production-schedule-main-toolbar-hover-2026-03-21) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **キオスク沉浸式 allowlist 拡張・手動順番行 正本**: [KB-311](./knowledge-base/KB-311-kiosk-immersive-header-allowlist.md) · [KB-297 §沉浸式拡張](./knowledge-base/KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 下ペイン帯 右端ホバー展開 正本**: [KB-297 §下ペイン帯ホバー](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-lower-pane-toolbar-hover-2026-03-21) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 ペイン polish（割当のみ overview・ラベル短縮・下ペイン折りたたみ）正本**: [KB-297 §ペイン polish](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-pane-polish-2026-03-21) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 上ペイン 資源CD割り当て 正本**: [KB-297 §資源割り当て](./knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-resource-assignment-2026-03-20) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 overview UI（上端ヘッダーリビール・カード密度・グリッド）正本**: [KB-297 §overview UI](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-overview-ui上端ヘッダーリビールカード密度グリッド2026-03-21) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-20）

- **手動順番 鉛筆時 登録製番チップ維持 正本**: [KB-297 §下ペインリセット](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-下ペイン-鉛筆工場変更時のフィルタリセット2026-03-20) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 下ペイン 鉛筆・工場変更フィルタリセット 正本**: [KB-297 §下ペインリセット](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-下ペイン-鉛筆工場変更時のフィルタリセット2026-03-20) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 overview 密度調整 + 機種名表示修正 正本**: [KB-297 §密度調整](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-overview-密度調整--機種名表示修正2026-03-20) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **手動順番 上ペイン SOLID リファクタ 正本**: [KB-297 §SOLID](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-上ペイン-solid-リファクタ2026-03-20) · [deploy-status](./runbooks/deploy-status-recovery.md) · [deployment](./guides/deployment.md)。
- **手動順番 overview 行明細 `rows[]` + 上ペイン高密度 正本**: [KB-297 §手動順番専用ページ](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-専用ページキオスク追加2026-03-20) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **📝 デザインプレビュー: 手動順番 上ペイン行明細（高密度・項目ラベルなし）**: 本番 API 拡張前の見た目合意用。[manual-order-overview-pane-row-detail-preview.html](./design-previews/manual-order-overview-pane-row-detail-preview.html) / [design-previews/README.md](./design-previews/README.md)。
- **手動順番 専用ページ（キオスク）＋登録製番履歴共有・CI安定化 正本**: [KB-297 §手動順番専用ページ](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-専用ページキオスク追加2026-03-20) · [KB-310](./knowledge-base/ci-cd.md#kb-310-trivy-action-の-github-actions-参照解決失敗unable-to-resolve-action) · [deploy-status](./runbooks/deploy-status-recovery.md) · [deployment](./guides/deployment.md)。
- **📝 GitHub メンテナ向け衛生チェックを KB 化（ForceMemo / GlassWorm 系を背景に整理）**: 2FA 有効化、期限切れ PAT 削除、セッション/SSH/GPG 確認、Cursor 拡張の最小化、ローカルクローンでの IOC 検索と `git push --dry-run` による認証確認の記録。手順・トラブルシュートは [KB-309（`infrastructure/security.md`）](./knowledge-base/infrastructure/security.md) を参照。

### 🆕 最新アップデート（2026-03-19）

- **📝 手動順番専用ページの登録製番履歴共有・機種名表示**: 仕様・デプロイ実績・Run ID は本ファイル **「最新アップデート（2026-03-20）」** 節へ集約（重複回避）。**参照**: [KB-297 手動順番専用ページ](./knowledge-base/KB-297-kiosk-due-management-workflow.md#手動順番-専用ページキオスク追加2026-03-20)。
- **手動順番の端末単位正規化（deviceScopeKey + siteKey 集計 + Mac targetDeviceScopeKey 必須）正本**: [KB-297 §Device-scope v2](./knowledge-base/KB-297-kiosk-due-management-workflow.md#device-scope-v2-manual-order-mac-proxy-pi4-scope-ui-hints-2026-03-20) · [ADR-20260319](./decisions/ADR-20260319-manual-order-device-scope-v2.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **生産順序モード拡張（自動順番/手動順番 + targetLocation + 全体像パネル）正本**: [KB-297 §生産順序モード拡張](./knowledge-base/KB-297-kiosk-due-management-workflow.md#生産順序モード拡張手動順番自動順番--targetlocation2026-03-19) · [ADR-20260319](./decisions/ADR-20260319-production-schedule-manual-order-target-location.md)。
- **統合ブランチ（生産スケジュールUI統一 + Caddy自前ビルド）正本**: [KB-308](./knowledge-base/frontend.md#kb-308-生産スケジュールuiが古いのに戻った事象ブランチ分岐によるデプロイ内容ずれ) · [KB-307 UI統一](./knowledge-base/frontend.md#kb-307-生産スケジュールui統一登録製番資源cdドロップダウン併設) · [KB-307 Caddy](./knowledge-base/ci-cd.md#kb-307-trivy-image-web-が-usrbincaddy-の-cve-を検出して-ci-が失敗する) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Caddy自前ビルド移行で Trivy image web の CVE を解消 正本**: [KB-307](./knowledge-base/ci-cd.md#kb-307-trivy-image-web-が-usrbincaddy-の-cve-を検出して-ci-が失敗する)。

### 🆕 最新アップデート（2026-03-18）

- **進捗一覧製番フィルタ 正本**: [KB-306](./knowledge-base/frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **生産スケジュールUI統一（登録製番・資源CDドロップダウン併設）正本**: [KB-307](./knowledge-base/frontend.md#kb-307-生産スケジュールui統一登録製番資源cdドロップダウン併設) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **✅ 生産スケジュール一覧 列幅調整 実装・デプロイ・実機検証完了**: 品番3行上限・製番折り返し・処理列縮小・品名優先配分を採用。`columnWidth.ts` に `priorityGrowKeys`/`shrinkFirstKeys` を追加し、画面幅変化に強い列幅再配分を実装。**デプロイ**: ブランチ `feat/kiosk-table-width-tuning`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ。**実機検証**: Phase12 全24項目PASS、実機OK。詳細は [deploy-status-recovery.md](./runbooks/deploy-status-recovery.md) の「生産スケジュール一覧 列幅調整」を参照。

### 🆕 最新アップデート（2026-03-17）

- **生産スケジュール 機種名・部品名検索 正本**: [KB-297 §機種名・部品名検索](./knowledge-base/KB-297-kiosk-due-management-workflow.md#生産スケジュール-機種名部品名検索2026-03-17) · [KB-304](./knowledge-base/frontend.md#kb-304-生産スケジュール-機種名部品名検索a条件全角半角正規化ドロップダウン空対策) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **生産スケジュール 製造order番号ポップアップ検索 正本**: [KB-305](./knowledge-base/frontend.md#kb-305-生産スケジュール-製造order番号ポップアップ検索5桁候補部品選択チェック確定) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-16）

- **除外資源CD Location整合化（site優先 + shared互換）正本**: [KB-297 §Location整合化](./knowledge-base/KB-297-kiosk-due-management-workflow.md#除外資源cd-location整合化site優先--shared互換2026-03-16-実装) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **切削除外リスト追随修正（policy統一 + resources契約拡張）正本**: [KB-297 §resources拡張](./knowledge-base/KB-297-kiosk-due-management-workflow.md#切削除外リスト追随修正policy統一--resources拡張2026-03-16-実装)。
- **切削除外リスト「一部資源CDしか除外されない」調査・収束計画 正本**: [KB-297 §調査](./knowledge-base/KB-297-kiosk-due-management-workflow.md#切削除外リストで一部資源cdのみ除外される事象2026-03-16-調査) · [production-schedule-kiosk-execplan](./plans/production-schedule-kiosk-execplan.md#切削除外リスト全件除外の収束計画2026-03-16)。
- **Location Scope Phase12（完全体化）正本**: [KB-297 §Phase12](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase12完全体化2026-03-16) · [deploy-status](./runbooks/deploy-status-recovery.md) · [location-scope-naming](./guides/location-scope-naming.md)。
- **Location Scope 安全実装フォローアップ（Phase0-4）正本**: [KB-297 §Phase0-4](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-安全実装フォローアップphase0-42026-03-15) · [ADR-20260315 Phase4 DB Go-No-Go](./decisions/ADR-20260315-location-scope-phase4-db-go-no-go.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase10（compat内部限定化）正本**: [KB-297 §Phase10](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase10compat内部限定化2026-03-15) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase9（compat呼び出し棚卸し・公開面縮小）正本**: [KB-297 §Phase9](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase9compat呼び出し棚卸し公開面縮小2026-03-15) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase8（resolver互換境界の明示化）正本**: [KB-297 §Phase8](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase8resolver互換境界の明示化2026-03-15) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase7（production-schedule境界のscope契約整理）正本**: [KB-297 §Phase7](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase7production-schedule境界のscope契約整理2026-03-15) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase6（adapter内legacy補助経路廃止）正本**: [KB-297 §Phase6](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase6adapter内legacy補助経路廃止2026-03-15) · [ADR-20260315 Phase3](./decisions/ADR-20260315-location-scope-phase3-flagged-scope-contract.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase5（due-management内の残存legacy配線整理）正本**: [KB-297 §Phase5](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase5due-management内の残存legacy配線整理2026-03-15) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase4（due-management限定: scope契約明示 + legacy依存縮小）正本**: [KB-297 §Phase4](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase4due-management限定-scope契約明示--legacy依存縮小2026-03-15) · [ADR-20260315 Phase3](./decisions/ADR-20260315-location-scope-phase3-flagged-scope-contract.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase3（scope契約統一 + Flag段階切替）正本**: [KB-297 §Phase3](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase3scope契約統一--flag段階切替2026-03-15) · [ADR-20260315 Phase3](./decisions/ADR-20260315-location-scope-phase3-flagged-scope-contract.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase2（siteスコープ正規化の段階移行）正本**: [KB-297 §Phase2](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase2siteスコープ正規化の段階移行2026-03-15) · [ADR-20260315 Phase2](./decisions/ADR-20260315-location-scope-phase2-resource-category-site-scope.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Location Scope Phase1 + 進捗一覧復活 正本**: [KB-297 §Phase1](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase1挙動不変の境界導入2026-03-14) · [KB-297 §進捗一覧復活](./knowledge-base/KB-297-kiosk-due-management-workflow.md#進捗一覧復活2026-03-15) · [phase1 audit](./plans/location-scope-phase1-audit.md)。

### 🆕 最新アップデート（2026-03-14）

- **Location Scope Phase1（挙動不変の境界導入）正本**: [KB-297 §Phase1](./knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase1挙動不変の境界導入2026-03-14) · [phase1 audit](./plans/location-scope-phase1-audit.md) · [ADR-20260314](./decisions/ADR-20260314-location-scope-boundary-phase1.md)。
- **全体ランキング自動調整（安全ガード付き）正本**: [KB-297 §全体ランキング自動調整](./knowledge-base/KB-297-kiosk-due-management-workflow.md#全体ランキング自動調整安全ガード付き2026-03-14) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理UI Phase3（左ペイン導線再構成）正本**: [KB-297 §Phase3](./knowledge-base/KB-297-kiosk-due-management-workflow.md#納期管理ui-phase3左ペイン導線再構成-入力全体ランキング当日反映2026-03-14) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理UI 左ペイン3セクション色分け 正本**: [KB-297 §色分け](./knowledge-base/KB-297-kiosk-due-management-workflow.md#納期管理ui-左ペイン3セクション色分け2026-03-14) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理UI 左ペイン中規模改善（選択/対象化導線の統合）正本**: [KB-297 §選択/対象化導線](./knowledge-base/KB-297-kiosk-due-management-workflow.md#納期管理ui-左ペイン中規模改善選択対象化導線の統合2026-03-14) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-13）

- **表面処理別納期ボタン（製番デフォルト + 処理別上書き）正本**: [KB-297 §表面処理別納期ボタン](./knowledge-base/KB-297-kiosk-due-management-workflow.md#表面処理別納期ボタン追加2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理UI Phase2（開閉アイコン化・デフォルト閉じ・状態記憶・最下段カード削除）正本**: [KB-297 §Phase2](./knowledge-base/KB-297-kiosk-due-management-workflow.md#納期管理ui-phase2開閉アイコン化デフォルト閉じ状態記憶最下段カード削除2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理UI Phase1（左ペイン開閉式・詳細パネル重複削除）正本**: [KB-297 §Phase1](./knowledge-base/KB-297-kiosk-due-management-workflow.md#納期管理ui-phase1左ペイン開閉式詳細パネル重複削除デプロイ実機検証2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理キオスク新レイアウト（V2）正本**: [KB-297 §新レイアウトV2](./knowledge-base/KB-297-kiosk-due-management-workflow.md#納期管理新レイアウトv2有効化デプロイ実機検証2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **実績基準時間 location優先 + sharedフォールバック 正本**: [KB-297 §location fallback](./knowledge-base/KB-297-kiosk-due-management-workflow.md#実績基準時間のlocation優先sharedフォールバック導入2026-03-13) · [backfill runbook](./runbooks/actual-hours-canonical-backfill.md#shared-global-rank-へのバックフィル)。
- **GroupCDマスタ統合 + 資源CDマッピングCSV一括登録 正本**: [KB-297 §GroupCD/CSV一括登録](./knowledge-base/KB-297-kiosk-due-management-workflow.md#groupcdマスタ統合とcsv一括登録2026-03-07)。
- **P2-5 Boundary Guard 正本**: [phase2 backlog §P2-5](./plans/phase2-safe-refactor-backlog.md#p2-5-完了2026-03-13) · [KB-297 §P2-5](./knowledge-base/KB-297-kiosk-due-management-workflow.md#p2-5-boundary-guard-デプロイ実機検証2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **P2-4 Web Split（ProductionSchedulePage Part 2）正本**: [phase2 backlog](./plans/phase2-safe-refactor-backlog.md) · [KB-297 §P2-4](./knowledge-base/KB-297-kiosk-due-management-workflow.md#p2-4-web-split-part-2mutation副作用分離2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **P2-3 Web Split（ProductionSchedulePage Part 1）正本**: [phase2 backlog §P2-3](./plans/phase2-safe-refactor-backlog.md#p2-3-web-split-productionschedulepage-part-1) · [KB-297 §P2-3](./knowledge-base/KB-297-kiosk-due-management-workflow.md#p2-3-web-split-デプロイ実機検証2026-03-13) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **P2-2 auth Route Thin化 正本**: [phase2 backlog](./plans/phase2-safe-refactor-backlog.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **P2-1 imports/schedule Route Thin化 正本**: [phase2 backlog](./plans/phase2-safe-refactor-backlog.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **Phase1 DebugSink境界導入 正本**: [phase2 backlog](./plans/phase2-safe-refactor-backlog.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-11）

- **非破壊段階リファクタ Phase2 バックログ 正本**: [phase2-safe-refactor-backlog](./plans/phase2-safe-refactor-backlog.md)。
- **FSIGENマスタ導入（資源CD→資源名）正本**: [KB-297 §FSIGENマスタ](./knowledge-base/KB-297-kiosk-due-management-workflow.md#fsigenマスタ導入実機検証2026-03-11)。
- **実績工数列の整合化（推定工数列廃止 + 資源CD手動マッピング）正本**: [KB-297 §実績工数列整合化](./knowledge-base/KB-297-kiosk-due-management-workflow.md#実績工数列の整合化デプロイ実機検証2026-03-11) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **ロケーション間同期共有化（納期・備考・表面処理）正本**: [KB-297 §ロケーション間同期共有化](./knowledge-base/KB-297-kiosk-due-management-workflow.md#ロケーション間同期共有化納期備考表面処理2026-03-11) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **生産日程 `progress_sync` スコープ分離（進捗管理用CSV限定）正本**: [KB-297 §進捗同期スコープ分離](./knowledge-base/KB-297-kiosk-due-management-workflow.md#進捗同期スコープ分離2026-03-11) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **全体順位表示拡張と実績工数列追加 正本**: [KB-297 §全体順位表示拡張と実績工数列追加](./knowledge-base/KB-297-kiosk-due-management-workflow.md#全体順位表示拡張と実績工数列追加デプロイ実機検証2026-03-11) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **全体順位 ソート補正 正本**: [KB-297 §全体順位 ソート補正](./knowledge-base/KB-297-kiosk-due-management-workflow.md#全体順位-ソート補正2026-03-11)。

### 🆕 最新アップデート（2026-03-10）

- **全端末共有優先順位（Mac対象ロケーション指定）正本**: [KB-297 §全端末共有優先順位](./knowledge-base/KB-297-kiosk-due-management-workflow.md#全端末共有優先順位mac対象ロケーション指定デプロイ実機検証2026-03-10) · [Mac対象ロケーション移行](./runbooks/mac-target-location-migration.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **生産スケジュール「全体順位」表示運用整合化 正本**: [KB-297 §全体順位 Phase 1](./knowledge-base/KB-297-kiosk-due-management-workflow.md#現場リーダー向け機能説明全体順位-phase-1)。
- **納期管理 B第7段階（実績工数CSV連携 + 全体ランキング連携）正本**: [KB-297 §B第7段階](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第7段階実績工数csv連携--全体ランキング連携2026-03-10) · [actual-hours backfill](./runbooks/actual-hours-canonical-backfill.md) · [KB-301](./knowledge-base/api.md#kb-301-実績工数csv手動投入で-413-payload-too-large-になる) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-09）

- **Pi4デプロイ直列化（KB-300 再発防止）正本**: [KB-300](./knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時) · [deployment](./guides/deployment.md) · [deploy-status recovery](./runbooks/deploy-status-recovery.md#5-pi4デプロイハング時の復旧手順2026-03-09-追加)。
- **納期管理 B第6段階（行単位全体順位スナップショット）Phase 1 正本**: [KB-297 §B第6段階](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第6段階行単位全体順位スナップショット導入phase-12026-03-09) · [KB-300](./knowledge-base/infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時) · [deployment](./guides/deployment.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。

### 🆕 最新アップデート（2026-03-08）

- **納期遅れ最小化モデル改善（オフライン学習評価 + イベントログ）正本**: [KB-297 §B第5段階](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第5段階オフライン学習評価--イベントログ2026-03-08) · [ADR-20260308](./decisions/ADR-20260308-due-management-offline-learning-events.md)。
- **納期管理 B第4段階補正 デプロイ・実機検証 正本**: [KB-297 §B第4段階補正](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第4段階補正デプロイ実機検証2026-03-08)。

### 🆕 最新アップデート（2026-03-07）

- **納期管理 B第4段階補正（納期設定済み限定候補 + 既存rank即時除外）正本**: [KB-297 §B第4段階補正](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第4段階補正納期設定済み限定候補--即時除外2026-03-07)。
- **納期管理 B第4段階（全体ランキング自動生成・根拠表示）正本**: [KB-297 §B第4段階](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第4段階全体ランキング自動生成根拠表示2026-03-07)。
- **納期管理 B第3次段（全体ランキング可視化・閲覧専用）正本**: [KB-297 §B第3次段](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第3次段全体ランキング可視化閲覧専用2026-03-07)。
- **納期管理 B第3段階（全体ランキング・引継ぎ）正本**: [KB-297 §B第3段階](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第3段階全体ランキング引継ぎ2026-03-07) · [KB-299](./knowledge-base/infrastructure/ansible-deployment.md#kb-299-pi4pi3実機検証時のpi5経由ssh接続) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **納期管理トリアージ B第2最小（今日の計画順）正本**: [KB-297 §B第2最小](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第2最小今日の計画順2026-03-07) · [操作説明](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第2最小の操作説明) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。
- **納期管理トリアージ（B第1段階）正本**: [KB-297 §B第1段階](./knowledge-base/KB-297-kiosk-due-management-workflow.md#b第1段階納期管理トリアージ2026-03-07) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。
- **納期管理・生産スケジュール連携拡張 正本**: [KB-297 §追加実装](./knowledge-base/KB-297-kiosk-due-management-workflow.md#追加実装2026-03-07) · [KB-297 §A修正](./knowledge-base/KB-297-kiosk-due-management-workflow.md#a修正画面整合同期遷移認証2026-03-07) · [KB-298](./knowledge-base/ci-cd.md#kb-298-ユニットテストでprismaモデル未モックtyperror-cannot-read-properties-of-undefined-reading-findmany) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md) · [deploy-status](./runbooks/deploy-status-recovery.md)。
- **キオスク納期管理（製番納期・部品優先・切削除外設定）正本**: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md) · [ADR-20260307](./decisions/ADR-20260307-kiosk-due-management-model.md) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。

### 🆕 最新アップデート（2026-03-06）

- **低レイヤー観測強化（SOLID・非破壊）正本**: [ADR-20260306](./decisions/ADR-20260306-lowlevel-observability.md) · [operation-manual §低レイヤー観測](./guides/operation-manual.md#低レイヤー観測pi5カナリア) · [KB-296](./knowledge-base/api.md#kb-296-eventloop-health-評価で起動直後テスト時に-503degraded-になる) · [KB-268](./knowledge-base/frontend.md#kb-268-生産スケジュールキオスク操作で間欠的に数秒待つ継続観察) · [KB-274](./knowledge-base/infrastructure/signage.md#kb-274-signage-render-workerの高メモリ化断続と安定化対応)。

- **登録製番ボタン並び替えUI 正本**: [KB-295](./knowledge-base/frontend.md#kb-295-生産スケジュール登録製番ボタン並び替えui) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。

- **資源CDボタン優先並び 正本**: [KB-294](./knowledge-base/frontend.md#kb-294-生産スケジュール資源cdボタン優先並び) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。

- **RealVNC Pi4/Pi3 接続復旧 正本**: [vnc-tailscale-recovery](./runbooks/vnc-tailscale-recovery.md) · [KB-293](./knowledge-base/infrastructure/security.md#kb-293-pi4pi3のrealvnc接続復旧pi5経由sshトンネル方式)。

- **端末別メンテナンス一括切替（deploy-status v2）正本**: [ADR-20260306](./decisions/ADR-20260306-deploy-status-per-client-maintenance.md) · [deployment](./guides/deployment.md) · [deploy-status recovery](./runbooks/deploy-status-recovery.md)。

- **SPLITレイアウト loans=0 件時の visualization 崩れ修正 正本**: [KB-292](./knowledge-base/infrastructure/signage.md#kb-292-splitレイアウトでloans0件のときにvisualizationがpdfフォールバックへ崩れる)。

### 🆕 最新アップデート（2026-03-05）

- **Pi4電源・連打防止実機検証 正本**: [KB-288](./knowledge-base/KB-288-power-actions-bind-mount-deleted-inode.md) · [kiosk-power-operation-recovery](./runbooks/kiosk-power-operation-recovery.md)。

- **RoboDrill01 NFC恒久対策 正本**: [KB-291](./knowledge-base/infrastructure/KB-291-robodrill01-nfc-scan-not-responding-investigation.md) · [nfc-reader-issues](./troubleshooting/nfc-reader-issues.md)。

- **Dropbox容量不足恒久対策 正本**: [KB-290](./knowledge-base/infrastructure/backup-restore.md#kb-290-dropbox容量不足の恒久対策チャンクアップロード自動削除再試行) · [backup-verification](./guides/backup-verification.md)。

- **同一ターゲット内削除限定（67c4de1）正本**: [backup-verification](./guides/backup-verification.md) · [KB-290](./knowledge-base/infrastructure/backup-restore.md#kb-290-dropbox容量不足の恒久対策チャンクアップロード自動削除再試行)。

### 🆕 最新アップデート（2026-03-02）

- **研削メイン日本語入力スムーズ化 正本**: [KB-287](./knowledge-base/frontend.md#kb-287-キオスク備考欄の日本語入力不具合ibus-ui-ウィンドウ出現で入力不安定) · [KB-investigation](./knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md)。

- **Pi4 kensakuMain Firefox移行・Super+Shift+P 正本**: [KB-289](./knowledge-base/infrastructure/miscellaneous.md#kb-289-pi4-kensakumain-の-firefox-移行と-supershiftp-キーボードショートカット上辺メニューバー表示) · [kiosk-wifi-panel-shortcut](./runbooks/kiosk-wifi-panel-shortcut.md)。

- **生産スケジュール SHアイテム除外・機種名表示追加 正本**: [KB-285 frontend](./knowledge-base/frontend.md#kb-285-生産スケジュールアイテム一覧からshアイテムも除外し機種名表示にsh追加) · [KB-285 API](./knowledge-base/api.md#kb-285-生産スケジュールhistory-progressエンドポイントのmachinename取得にsh追加) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。

### 🆕 最新アップデート（2026-03-01）

- **KB-288恒久対策・連打防止オーバーレイ強化 正本**: [KB-288](./knowledge-base/KB-288-power-actions-bind-mount-deleted-inode.md) · [kiosk-power-operation-recovery](./runbooks/kiosk-power-operation-recovery.md) · [deployment](./guides/deployment.md)。

- **キオスク備考欄 IME 診断基盤 正本**: [kiosk-ime ExecPlan](./plans/kiosk-ime-remark-field-execplan.md) · [KB-287](./knowledge-base/frontend.md#kb-287-キオスク備考欄の日本語入力不具合ibus-ui-ウィンドウ出現で入力不安定) · [kiosk-ime-diagnosis](./runbooks/kiosk-ime-diagnosis.md)。

- **電源機能SOLIDリファクタ・遅延/連打防止/KB-288復旧 正本**: [power-function ExecPlan](./plans/power-function-solid-refactor-execplan.md) · [KB-285](./knowledge-base/infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる) · [KB-286](./knowledge-base/frontend.md#kb-286-電源操作の連打防止オーバーレイ実装react-portal-による表示失敗の解決) · [KB-288](./knowledge-base/KB-288-power-actions-bind-mount-deleted-inode.md) · [kiosk-power-operation-recovery](./runbooks/kiosk-power-operation-recovery.md)。

### 🆕 最新アップデート（2026-02-28）

- **生産スケジュール登録製番ボタン3段表示・機種名表示 正本**: [KB-282 frontend](./knowledge-base/frontend.md#kb-282-生産スケジュール登録製番ボタンの3段表示と機種名表示全角半角大文字化) · [KB-282 API](./knowledge-base/api.md#kb-282-生産スケジュールhistory-progressエンドポイントにmachinename追加) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。
- **生産スケジュール検索条件の端末別localStorage保存 正本**: [KB-283](./knowledge-base/frontend.md#kb-283-生産スケジュール検索条件の端末別localstorage保存) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。
- **✅ クライアント端末の場所設定更新・デプロイ完了**: 管理コンソールでraspi4_kensakuMainとraspi3_signageMakoRoomの場所が空欄になっていた問題を解決。**実施内容**: `inventory.yml`の`status_agent_location`を更新（raspi4_kensakuMain: 「第2工場 - kensakuMain」、raspi3_signageMakoRoom: 「第2工場 - signageMakoRoom」）。DBの`ClientDevice`テーブルの`location`を直接更新（`status-agent`はlocationを送信しないため、DB直接更新が必要）。**知見**: `status_agent_location`は`register-clients.sh`で使用されるが、vaultテンプレートのためスキップされる。DBの`location`は`status-agent`のheartbeatでは更新されないため、管理コンソールから直接編集するか、DB直接更新が必要。**デプロイ結果**: Pi5でデプロイ成功（Run ID `20260228-134834-12062`, `state: success`, `exitCode: 0`）。**実機検証結果**: 管理コンソールでraspi4_kensakuMainとraspi3_signageMakoRoomの場所が正しく表示されることを確認。詳細は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。
- **ロボドリル01 Pi4追加作業 正本**: [KB-280](./knowledge-base/infrastructure/security.md#kb-280-pi4追加時のkiosk-browserservice起動エラーchromium-browserコマンド未検出) · [client-initial-setup](./guides/client-initial-setup.md)。
- **Tailscale経由VNC接続問題 正本**: [KB-277](./knowledge-base/infrastructure/security.md#kb-277-tailscale経由でのvnc接続問題acl設定不足) · [mac-ssh-access](./guides/mac-ssh-access.md) · [port-security-audit](./security/port-security-audit.md)。
- **クライアント端末管理の重複登録是正 正本**: [KB-278](./knowledge-base/infrastructure/security.md#kb-278-クライアント端末管理の重複登録inventory未解決テンプレキー混入) · [client-initial-setup](./guides/client-initial-setup.md)。
- **Trivy minimatch CVE対応 正本**: [KB-279](./knowledge-base/ci-cd.md#kb-279-trivy脆弱性スキャンでminimatchのcve-2026-2790327904が検出される) · [client-initial-setup](./guides/client-initial-setup.md)。
- **Pi4 kiosk-browser Ansible恒久化 正本**: [KB-281](./knowledge-base/infrastructure/security.md#kb-281-pi4-kiosk-browser対策のansible恒久化と実機デプロイ検証到達不可端末の切り分け含む)。

### 🆕 最新アップデート（2026-02-25）

- **signage-render-worker高メモリ化対策 正本**: [KB-274](./knowledge-base/infrastructure/signage.md#kb-274-signage-render-workerの高メモリ化断続と安定化対応)。

- **加工機点検状況サイネージ レイアウト調整 正本**: [KB-275](./knowledge-base/infrastructure/signage.md#kb-275-加工機点検状況サイネージのレイアウト調整)。

- **✅ 計測機器持出状況サイネージコンテンツの実装とCSVイベント連携・デザイン調整・CI成功・デプロイ完了・実機検証完了**: 計測機器の持出状況をサイネージで可視化する機能を実装。「加工担当部署」の従業員ごとに、本日使用中の計測機器数と名称を表示。**実装内容**: `Employee`テーブルに`section`フィールドを追加し、CSVインポートと従業員編集画面に`section`フィールドを統合。データソースを`Loan`テーブルから`MeasuringInstrumentLoanEvent`テーブル（CSV由来イベント）へ修正。名前正規化とアクティブローン判定ロジックを実装（「持ち出し」イベントから「返却」イベントを除外）。**デザイン調整**: カードの縦寸法を1.5倍に変更（128px → 192px）して計測機器名の表示行数を増加、タイトルの「（点検可視化）」を自動削除、KPIの「対象日」ラベルを削除して日付のみ表示、KPIの対象日を左寄せに変更（左端からパディング14px）。**実装ファイル**: `apps/api/prisma/schema.prisma`（`Employee.section`追加）、`apps/api/src/services/visualization/data-sources/measuring-instrument-loan-inspection/measuring-instrument-loan-inspection-data-source.ts`（CSVイベント連携）、`apps/api/src/services/visualization/renderers/measuring-instrument-loan-inspection/measuring-instrument-loan-inspection-renderer.ts`（レンダラー・デザイン調整）、`apps/web/src/pages/admin/CsvImportPage.tsx`（CSVインポート設定）、`apps/web/src/pages/tools/EmployeesPage.tsx`（従業員編集画面）。**CI実行**: GitHub Actions成功（Run ID `22387437619`）。**デプロイ結果**: Pi5でデプロイ成功（Run ID `20260225-173204-3798`）。**実機検証結果**: Sectionに「加工担当部署」を登録後、サイネージに従業員ごとのカードが表示され、CSVで取得した計測機器持出状況のデータと連携し、本日使用中の計測機器数と名称が正しく表示されることを確認。デザイン調整後、カード高さ1.5倍で計測機器名がより多く表示され、タイトルから「（点検可視化）」が削除され、KPIの日付が左寄せで表示されることを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-274](./knowledge-base/infrastructure/signage.md#kb-274-計測機器持出状況サイネージコンテンツの実装とcsvイベント連携) / [knowledge-base/index.md](./knowledge-base/index.md) / [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

### 🆕 最新アップデート（2026-02-24）

- **CSVダッシュボード重複削除共通化・エラーメール廃棄ポリシー 正本**: [KB-273](./knowledge-base/KB-273-csv-dashboard-dedup-and-error-disposition-commonization.md)。

- **✅ Gmail自動運用プロトコル フェーズ2テスト追加・CI成功・Pi5デプロイ・実機検証完了**: フェーズ2のテスト（GmailUnifiedMailboxFetcher、downloadAllBySubjectPatterns）を追加し、CI成功・Pi5限定デプロイ（Run ID `20260224-084216-12664`）・実機検証を実施。デプロイ時は未commit変更でfail-fastしたためstashで退避して実行。実機はAPI疎通・認証・主要API応答を確認。**解決策1〜4の進捗**は [plans/gmail-auto-protocol-progress.md](./plans/gmail-auto-protocol-progress.md) を参照。詳細は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **Gmail自動運用プロトコル フェーズ1実機検証 正本**: [KB-216](./knowledge-base/api.md#kb-216-gmail-apiレート制限エラー429の対処方法) · [phase1 verification checklist](./guides/gmail-auto-protocol-phase1-verification.md)。

### 🆕 最新アップデート（2026-02-22）

- **Gmail csvDashboards 10分30件運用 正本**: [KB-272](./knowledge-base/api.md#kb-272-gmail-csvdashboards取得を10分30件運用へ最適化) · [csv-import-export](./guides/csv-import-export.md)。

### 🆕 最新アップデート（2026-02-19）

- **生産スケジュールデータ削除ルール 正本**: [KB-271](./knowledge-base/api.md#kb-271-生産スケジュールデータ削除ルール重複loser即時削除1年超過は保存しない) · [csv-import-export](./guides/csv-import-export.md)。

- **生産スケジュールprogress別テーブル化 正本**: [KB-269](./knowledge-base/api.md#kb-269-生産スケジュールprogress別テーブル化csv取り込み時の上書きリスク回避) · [ADR-20260219](./decisions/ADR-20260219-production-schedule-progress-separation.md)。

### 🆕 最新アップデート（2026-02-18）

- **吊具持出画面の吊具情報表示 正本**: [KB-267](./knowledge-base/frontend.md#kb-267-吊具持出画面に吊具情報表示を追加)。

- **NFCストリーム端末分離 正本**: [KB-266](./knowledge-base/infrastructure/security.md#kb-266-nfcストリーム端末分離の実装完了acl維持横漏れ防止) · [tailscale-policy](./security/tailscale-policy.md) · [nfc-reader-issues](./troubleshooting/nfc-reader-issues.md)。

### 🆕 最新アップデート（2026-02-16）

- **CSV自動取得復旧とcron表示UI改善 正本**: [KB-216](./knowledge-base/api.md#kb-216-gmail-apiレート制限エラー429の対処方法) · [KB-111](./knowledge-base/frontend.md#kb-111-csvインポートスケジュールの表示を人間が読みやすい形式に変更) · [csv-import-export](./guides/csv-import-export.md)。

- **Dropbox証明書ピニング再発対応 正本**: [KB-199](./knowledge-base/infrastructure/backup-restore.md#kb-199-dropbox証明書ピニング検証失敗によるバックアップ500エラー)。

### 🆕 最新アップデート（2026-02-14）

- **加工機点検状況サイネージカードレイアウト 正本**: [KB-262](./knowledge-base/api.md#kb-262-加工機点検状況サイネージのカードレイアウト変更と背景色改善) · [KB-263](./knowledge-base/infrastructure/ansible-deployment.md#kb-263-pi5のみデプロイ時にメンテナンスフラグが残存する問題)。

- **✅ HTML↔SVG整合プレビューシステム実装完了・CI成功・デプロイ完了・実機検証開始**: 事前打ち合わせ（HTMLデザイン）と実機表示（SVG→JPEG）の差異要因を解消し、同一MD3トークンからHTML/CSS変数・SVG・SPLITペイン・複合サイネージプレビューを生成するシステムを構築。**実装内容**: MD3トークン→CSS変数アダプタ（`md3-css.ts`）、SVGチップ/バッジプリミティブ（`svg-primitives.ts`）、サイネージSPLITペイン幾何計算の抽出（`signage-layout-math.ts`）、デザインプレビュー生成スクリプト（`design-preview.ts`、`pnpm --filter @raspi-system/api design:preview`で実行）、未点検加工機レンダラーのチッププリミティブ適用（丸角+padding）。**トラブルシューティング**: CI初回実行で`design-preview.ts`がビルド対象に含まれビルドエラーが発生。`tsconfig.build.json`の`exclude`に追加して解決。デプロイ時に環境変数検証で一時的なエラーが発生したが、最終的にはデプロイ成功（KB-261参照）。**CI実行**: GitHub Actions Run ID `22011599165` 成功（全ジョブ成功）。**デプロイ結果**: Pi5でデプロイ成功（runId `20260214-143340-30468`, `ok=108`, `changed=5`, `failed=1`（環境変数検証エラー）だが最終的には成功、コードは正常に反映）。**実機検証結果**: APIヘルスチェック（`status: ok`）、Pi5生成画像とPi3キャッシュ画像のSHA256一致確認、Pi3サービス稼働確認（`signage-lite.service` / `signage-lite-update.timer` ともに `active`）、Pi5画像更新確認（約30秒間隔で更新）。詳細は [design/preview-workflow.md](./design/preview-workflow.md) 、トラブルシューティングは [knowledge-base/infrastructure/ansible-deployment.md#kb-261](./knowledge-base/infrastructure/ansible-deployment.md#kb-261-デプロイ時の環境変数検証エラー一時的な失敗だが最終的には成功) を参照。

- **✅ サイネージ/可視化SVGの共通デザイン仕様（Material Design 3 ダーク）を導入・デプロイ完了・実機検証開始**: 可視化レンダラーとCSVダッシュボードSVGテンプレの色・タイポグラフィ等をトークン化し、ハードコード分散を解消する方針を採用。トークンは `apps/api/src/services/visualization/renderers/_design-system/md3.ts` に集約。**トラブルシューティング**: デプロイ後にJWT秘密鍵が弱い値へフォールバックしてAPIが再起動ループする事象を確認し、Ansible側で`apps/api/.env`と`infrastructure/docker/.env`の両方に強いJWT秘密鍵が維持されるガードを追加して復旧。**CI実行**: GitHub Actions Run ID `22008450345`（JWT秘密鍵永続化ガード）、`22009259380`（ドキュメント更新）成功。**デプロイ結果**: Pi5でデプロイ成功（runId `20260214-105025-14108`, `ok=111`, `changed=4`, `failed=0`）。**実機検証結果**: APIヘルスチェック（`status: ok`）、サイネージ配信（`GET /api/signage/content` → `200`）、Pi3実機（`signage-lite.service` と `signage-lite-update.timer` が稼働、`/run/signage/current.jpg` が更新され続けていることを確認）。意思決定は [decisions/ADR-20260214-signage-design-system-md3.md](./decisions/ADR-20260214-signage-design-system-md3.md) 、移行チェックリストは [plans/signage-md3-design-system-migration.md](./plans/signage-md3-design-system-migration.md) 、JWT秘密鍵の詳細説明と運用上の注意点は [guides/deployment.md](./guides/deployment.md#本番セキュリティ設定2026-02-13追加) と [knowledge-base/infrastructure/ansible-deployment.md#kb-260](./knowledge-base/infrastructure/ansible-deployment.md#kb-260-デプロイ後にapiが再起動ループするjwt秘密鍵が弱い値で上書きされる) を参照。

### 🆕 最新アップデート（2026-02-13）

- **コード品質改善フェーズ4第五弾 + coverage B対応 正本**: [KB-258](./knowledge-base/api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張)。

- **加工機点検状況サイネージ点検結果セル背景色 正本**: [KB-256](./knowledge-base/api.md#kb-256-加工機点検状況サイネージの集計一致と2列表示最適化未点検は終端)。

### 🆕 最新アップデート（2026-02-12）

- **コード品質改善フェーズ4第四弾 正本**: [KB-258](./knowledge-base/api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張)。

- **コード品質改善フェーズ4第三弾 正本**: [KB-258](./knowledge-base/api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張)。

- **コード品質改善フェーズ4第二弾 正本**: [KB-258](./knowledge-base/api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張)。

- **コード品質改善フェーズ4第一弾 正本**: [KB-258](./knowledge-base/api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張)。

- **加工機点検状況サイネージ集計一致・2列表示 正本**: [KB-256](./knowledge-base/api.md#kb-256-加工機点検状況サイネージの集計一致と2列表示最適化未点検は終端)。

### 🆕 最新アップデート（2026-02-11）

- **`/api/kiosk`・`/api/clients` ルート分割 正本**: [KB-255](./knowledge-base/api.md#kb-255-apikiosk-と-apiclients-のルート分割サービス層抽出互換維持での実機検証)。

- **生産スケジュール資源CDボタン遅延・式インデックス 正本**: [KB-248](./knowledge-base/api.md#kb-248-生産スケジュール資源cdボタン表示の遅延問題式インデックス追加による高速化) · [ADR-20260211](./decisions/ADR-20260211-production-schedule-expression-indexes.md)。

### 🆕 最新アップデート（2026-02-10）

- **✅ クライアント端末の表示名編集機能実装・デプロイ完了・実機検証完了**: 管理コンソールでクライアント端末名を編集可能にし、`status-agent`や`heartbeat`による自動上書きを防止する機能を実装。**実装内容**: `ClientDevice.name`を「表示名（手動編集）」として定義し、`POST /api/clients/status`と`POST /api/clients/heartbeat`の`update`処理から`name`更新を除去（`create`時のみ初期値としてhostnameを使用）。`PUT /api/clients/:id`に`name`更新機能を追加（Zodスキーマで100文字以内・空文字列不可・trim処理）。管理画面`ClientsPage.tsx`で名前をインライン編集可能に（`Input`コンポーネント、バリデーション、エラーメッセージ表示）。統合テストで`name`上書きが起きないこと、`PUT`で更新できることを固定。**デプロイ**: Pi5でデプロイ成功（Run ID: 20260210-211119-16770, ok=111, changed=4, failed=0）。**実機検証**: 管理画面で名前フィールドが編集可能であることを確認、名前変更後、他の端末（Pi4/Pi3）でも反映されることを確認、ビデオ通話画面、履歴画面、Slack通知など、すべての機能が正常に動作することを確認。詳細は [knowledge-base/api.md#kb-206](./knowledge-base/api.md#kb-206-クライアント表示名を-status-agent-が上書きする問題) / [investigation/kiosk-client-status-investigation.md](./investigation/kiosk-client-status-investigation.md) / [api/overview.md](./api/overview.md) / [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **✅ 生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化・デプロイ完了**: 生産スケジュール画面で、登録製番ボタン右上の×削除ボタンの応答性が若干落ちた気がするという報告を受け、調査・修正を実施。**原因**: KB-242で実装した完未完判定機能（`useKioskProductionScheduleHistoryProgress()`）が4秒ごとにポーリングを実行し、最大400行の巨大テーブルを含む`ProductionSchedulePage`が頻繁に再レンダーされていた。React Queryの`refetchInterval`はデータが同じでも`isFetching`が変動し、ページ全体の再レンダーが発生しやすい。**修正内容**: `useKioskProductionScheduleHistoryProgress()`の`refetchInterval`を`4000`→`30000`（30秒）に変更。`useKioskProductionScheduleSearchState()`と`useKioskProductionScheduleSearchHistory()`は4秒のまま維持（端末間同期の速さを維持）。完未完表示の更新間隔は最大30秒の遅延となるが、応答性改善を優先。**デプロイ**: Pi4キオスクにデプロイ成功（Run ID: 20260210-175259-15669, ok=91, changed=9, failed=0）。詳細は [knowledge-base/frontend.md#kb-247](./knowledge-base/frontend.md#kb-247-生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化) / [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **✅ Gmailゴミ箱自動削除機能（深夜バッチ）実装・CI成功・デプロイ完了**: CSVダッシュボード取り込みで処理済みメールをゴミ箱へ移動した後、自動的に削除する機能を実装。**実装内容**: `GmailApiClient`にラベル管理機能（`findLabelIdByName`、`ensureLabel`）を追加し、`trashMessage`メソッドでゴミ箱移動前に`rps_processed`ラベルを付与。`cleanupProcessedTrash`メソッドでゴミ箱内の処理済みメール（`label:TRASH label:rps_processed older_than:30m`）を検索して完全削除。`GmailTrashCleanupService`と`GmailTrashCleanupScheduler`を新設し、`node-cron`で深夜（デフォルト: 3:00 JST）に1日1回実行。環境変数（`GMAIL_TRASH_CLEANUP_ENABLED`、`GMAIL_TRASH_CLEANUP_CRON`、`GMAIL_TRASH_CLEANUP_LABEL`、`GMAIL_TRASH_CLEANUP_MIN_AGE`）で動作を制御可能。**デプロイ**: Pi5でデプロイ成功（Run ID: 20260210-173239-17094, ok=111, changed=4, failed=0）。詳細は [knowledge-base/api.md#kb-246](./knowledge-base/api.md#kb-246-gmailゴミ箱自動削除機能深夜バッチ) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md#4-ゴミ箱自動削除深夜1回) / [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **WebRTC映像不安定・エラーダイアログ改善 正本**: [KB-243](./knowledge-base/frontend.md#kb-243-webrtcビデオ通話の映像不安定問題とエラーダイアログ改善) · [webrtc-verification](./guides/webrtc-verification.md#9-映像不安定問題の修正とエラーダイアログ改善2026-02-10実装)。

- **✅ Pi4キオスクの備考欄に日本語入力切り替え注釈修正・現在モード表示削除・IBus設定永続化・メンテナンスフラグ自動クリア修正・デプロイ成功・実機検証完了**: Pi4キオスクの備考欄で日本語入力が可能になったが、全画面表示のためシステムレベルのIMEインジケーターが見えない問題を解決。**実装内容**: 切り替え方法の注釈を「Ctrl+Space または Alt+`（半角/全角）」→「全角半角キー」に修正（実機動作に合わせて変更）。現在モード表示（「あ 日本語」「A 英字」）を削除（入力中のみ表示され、確定後は日本語入力モードでも「A 英字」に戻る不正確な動作のため）。IBus設定の永続化も実装（`kiosk/tasks/main.yml`にIBus設定タスクを追加、`engines-order`を`['xkb:jp::jpn', 'mozc-jp']`に設定、`hotkey triggers`を`['<Control>space']`に設定）。Pi4再起動ボタンのエラーハンドリング改善も実施。**メンテナンスフラグ自動クリア修正**: `deploy-staged.yml`の`post_tasks`を修正し、Pi4のみのデプロイ時もメンテナンスフラグが自動的にクリアされるように改善。**デプロイ**: Pi5とPi4でデプロイ成功（Run ID: 20260210-131708-15247）。**実機検証**: 全角半角キーの単独押しで日本語入力モードが切り替わることを確認、注釈文が実機動作と一致することを確認、現在モード表示削除により混乱が解消されたことを確認、IBus設定とメンテナンスフラグ自動クリアを確認。詳細は [knowledge-base/frontend.md#kb-244](./knowledge-base/frontend.md#kb-244-pi4キオスクの備考欄に日本語入力状態インジケーターを追加) / [knowledge-base/infrastructure/ansible-deployment.md#kb-245](./knowledge-base/infrastructure/ansible-deployment.md#kb-245-pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とibus設定の永続化) を参照。

- **Pi4キオスク日本語入力モード切替・IBus設定改善 正本**: [KB-276](./knowledge-base/frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善) · [ADR-20260228](./decisions/ADR-20260228-ibus-kiosk-multilayer-suppression.md)。

- **✅ 製造order番号繰り上がりルール実装・デプロイ成功・実機検証完了**: 生産スケジュールCSVダッシュボードで、同一キー（`FSEIBAN + FHINCD + FSIGENCD + FKOJUN`）で`ProductNo`が複数ある場合、数字が大きい方のみを有効とするルールを実装。**実装内容**: `row-resolver`モジュールを新設し、取り込み時（`CsvDashboardIngestor`）と表示時（`/kiosk/production-schedule`、`SeibanProgressService`）の両方で重複除去を適用。SQLフィルタ（`buildMaxProductNoWinnerCondition`）とTypeScript関数（`resolveToMaxProductNoPerLogicalKey`）の両方を提供し、疎結合・再利用可能な設計に。**トラブルシューティング**: テスト失敗（ProductNoの文字列比較→数値比較に修正）、SQL正規表現エラー（`\d`→`[0-9]`に修正）、TypeScriptビルドエラー（型定義の明示追加）を解決。**デプロイ**: Pi5でデプロイ成功（Run ID: 20260210-094542-30489）。**実機検証**: 同一キーで`ProductNo`が複数ある場合、数字が大きい方のみが表示されることを確認、重複除去機能が正常動作。詳細は [knowledge-base/api.md#kb-201](./knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **生産スケジュール登録製番削除ボタン進捗連動UI 正本**: [KB-242 frontend](./knowledge-base/frontend.md#kb-242-生産スケジュール登録製番削除ボタンの進捗連動ui改善) · [KB-242 API](./knowledge-base/api.md#kb-242-history-progressエンドポイント追加と製番進捗集計サービス) · [production-schedule-kiosk ExecPlan](./plans/production-schedule-kiosk-execplan.md)。

### 🆕 最新アップデート（2026-02-09）

- **✅ WebRTCビデオ通話の常時接続と着信自動切り替え機能実装・デプロイ成功・実機検証完了**: Pi4が`/kiosk/*`や`/signage`表示中でもシグナリング接続を維持し、着信時に自動的に`/kiosk/call`へ切り替わる機能を実装。**実装内容**: `WebRTCCallProvider`（React Context）を作成し、`CallAutoSwitchLayout`経由で`/kiosk/*`と`/signage`の全ルートに適用。着信時（`callState === 'incoming'`）に現在のパスを`sessionStorage`に保存し、`/kiosk/call`へ自動遷移。通話終了時（`callState === 'idle' || 'ended'`）に元のパスへ自動復帰。Pi3の通話対象除外機能を実装（`WEBRTC_CALL_EXCLUDE_CLIENT_IDS`環境変数で除外フィルタ適用）。**CI実行**: 全ジョブ（lint-and-test, e2e-smoke, docker-build, e2e-tests）成功。**デプロイ結果**: Pi5とPi4でデプロイ成功（`failed=0`）。**APIレベルでの動作確認**: 発信先一覧APIが正常に動作し、Pi3が除外されることを確認。**実機検証結果**: MacからPi4への通話が正常に動作することを確認（音声・ビデオ双方向通信）、着信時に自動的に`/kiosk/call`へ切り替わることを確認、通話終了後に元の画面へ自動復帰することを確認。詳細は [knowledge-base/frontend.md#kb-241](./knowledge-base/frontend.md#kb-241-webrtcビデオ通話の常時接続と着信自動切り替え機能実装) / [guides/webrtc-verification.md](./guides/webrtc-verification.md) を参照。

### 🆕 最新アップデート（2026-02-08）

- **モーダル共通化・アクセシビリティ標準化・E2E安定化 正本**: [KB-240](./knowledge-base/frontend.md#kb-240-モーダル共通化アクセシビリティ標準化e2eテスト安定化)。

- **キオスクヘッダーUI改善・React Portalモーダル位置修正 正本**: [KB-239](./knowledge-base/frontend.md#kb-239-キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決react-portal導入)。

- **Pi3 signage-lite xsetエラーハンドリング・サービス再起動検証 正本**: [KB-236](./knowledge-base/infrastructure/signage.md#kb-236-pi3-signage-liteserviceのxsetエラーによる起動失敗と再起動ループ) · [KB-234](./knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策)。

### 🆕 最新アップデート（2026-02-07）

- **Pi3 signage-lite xset起動失敗・再起動ループ修正 正本**: [KB-236](./knowledge-base/infrastructure/signage.md#kb-236-pi3-signage-liteserviceのxsetエラーによる起動失敗と再起動ループ)。

- **全並行デプロイ・メンテナンスフラグ早期解除検証 正本**: [KB-234](./knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策)。

- **Trivy cronスキップ・パッケージインストールスキップ最適化 正本**: [KB-234](./knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策)。

- **apt cache最適化（cache_valid_time適用）正本**: [KB-234](./knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策)。

- **Docker build最適化（変更ファイルに基づくbuild判定）正本**: [KB-235](./knowledge-base/infrastructure/ansible-deployment.md#kb-235-docker-build最適化変更ファイルに基づくbuild判定) · [KB-234](./knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策)。

- **Ansibleデプロイ性能調査・段階展開/並行化/重複タスク排除 正本**: [KB-234](./knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策)。

### 🆕 最新アップデート（2026-02-06）

- **サイネージ未完部品表示ロジック改善 正本**: [KB-232](./knowledge-base/infrastructure/signage.md#kb-232-サイネージ未完部品表示ロジック改善表示制御正規化動的レイアウト) · [production-schedule-signage](./guides/production-schedule-signage.md)。

- **Pi5デプロイ sudo パスワード問題 正本**: [KB-233](./knowledge-base/infrastructure/ansible-deployment.md#kb-233-デプロイ時のsudoパスワード問題ansible_connection-localでもmac側から実行される場合) · [deployment guide](./guides/deployment.md)。

- **生産スケジュール登録製番上限8→20・サイネージ高さ最適化 正本**: [KB-231 API](./knowledge-base/api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) · [KB-231 signage](./knowledge-base/infrastructure/signage.md#kb-231-生産スケジュールサイネージアイテム高さの最適化20件表示対応)。

- **Gmail認証切れSlack通知・実機回復 正本**: [KB-229](./knowledge-base/api.md#kb-229-gmail認証切れ時のslack通知機能追加) · [KB-230](./knowledge-base/api.md#kb-230-gmail認証切れの実機調査と回復) · [Slack guide](./guides/slack-webhook-setup.md#gmail認証切れ通知機能2026-02-06実装)。

### 🆕 最新アップデート（2026-02-03）

- **Fastify v5移行・CIゲート復帰 正本**: [KB-227](./knowledge-base/ci-cd.md#kb-227-pnpm-audit-のhighでciが失敗するfastify脆弱性--fastify-v5移行の影響範囲調査) · [KB-087](./knowledge-base/infrastructure/signage.md#kb-087-pi3-status-agenttimer-再起動時のsudoタイムアウト) · [KB-216](./knowledge-base/infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している)。

### 🆕 最新アップデート（2026-02-02）

- **キオスク入力フィールド保護ルール 正本**: [KB-225 frontend](./knowledge-base/frontend.md#kb-225-キオスク入力フィールド保護ルールの実装と実機検証) · [KB-225 investigation](./knowledge-base/kiosk-input-protection-investigation.md)。

### 🆕 最新アップデート（2026-01-31）

- **Pi4メンテナンス画面・SSH接続失敗・Git権限問題 正本**: [KB-183](./knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) · [KB-218](./knowledge-base/infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行) · [KB-219](./knowledge-base/infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗) · [deployment](./guides/deployment.md) · [mac-ssh-access](./guides/mac-ssh-access.md)。

- **サイネージ可視化ダッシュボード・Docker再ビルド確実化 正本**: [KB-217](./knowledge-base/infrastructure/ansible-deployment.md#kb-217-デプロイプロセスのコード変更検知とdocker再ビルド確実化) · [signage module](./modules/signage/README.md) · [deployment](./guides/deployment.md)。

- **Pi5ストレージメンテナンス追調査 正本**: [KB-130](./knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) · [operation manual](./guides/operation-manual.md)。

### 🆕 最新アップデート（2026-01-30）

- **Tailscale主運用・Pi3 post_tasks 一時到達不能 正本**: [ADR-20260130](./decisions/ADR-20260130-tailscale-primary-operations.md) · [KB-216](./knowledge-base/infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-01-29）

- **Gmail OAuth 7日制限対応 正本**: [KB-215](./knowledge-base/api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ) · [gmail setup](./guides/gmail-setup-guide.md)。

- **デプロイ整備・全デバイス検証 正本**: [KB-200](./knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) · [deployment](./guides/deployment.md)。

- **キオスク持出タブ 持出中一覧共有 正本**: [KB-211](./knowledge-base/frontend.md#kb-211-キオスク持出タブの持出中アイテムが端末間で共有されない問題) · [tools API](./modules/tools/api.md)。

### 🆕 最新アップデート（2026-01-28）

- **セキュリティ評価実機検証・ルーター露出評価 正本**: [evaluation report](./security/evaluation-report.md) · [production verification guide](./security/evidence/production-verification-guide.md)。

### 🆕 最新アップデート（2026-01-28）

- **生産スケジュール検索登録製番 共有状態回帰修正 正本**: [KB-210](./knowledge-base/api.md#kb-210-生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正) · [production schedule plan](./plans/production-schedule-kiosk-execplan.md)。

### 🆕 最新アップデート（2026-01-22）

- **デプロイDB整合性ゲート 正本**: [KB-191](./knowledge-base/infrastructure/ansible-deployment.md#kb-191-デプロイは成功したのにdbが古いテーブル不存在) · [deployment](./guides/deployment.md)。

### 🆕 最新アップデート（2026-01-24）

- **backup.json 旧キー自動削除 正本**: [KB-196](./knowledge-base/infrastructure/backup-restore.md#kb-196-旧キー自動削除機能の実装backupjson保存時の自動クリーンアップ) · [KB-168](./knowledge-base/infrastructure/backup-restore.md#kb-168-旧キーと新構造の衝突問題と解決方法)。

### 🆕 最新アップデート（2026-01-23）

- **スケジュール自動実行バックアップ履歴 正本**: [KB-194](./knowledge-base/infrastructure/backup-restore.md#kb-194-スケジュール自動実行時にバックアップ履歴が記録されない問題) · [backup-and-restore](./guides/backup-and-restore.md)。

- **Dropbox 409 パス不正 正本**: [KB-195](./knowledge-base/infrastructure/backup-restore.md#kb-195-dropbox-409-conflictエラーlabelサニタイズ未実施によるパス不正) · [investigation](./guides/backup-dropbox-status-investigation.md) · [results](./guides/backup-dropbox-status-investigation-results.md)。

- **✅ 管理コンソールのサイネージプレビュー機能実装完了**: 管理コンソールに「サイネージプレビュー」タブを追加し、Pi3で表示中のサイネージ画像をプレビューできるように実装。30秒ごとの自動更新と手動更新ボタンを実装。最初は`fetch`で実装していたが、JWT認証ヘッダーが付与されず401エラーが発生。`axios(api)`クライアントに変更することで、JWT認証ヘッダーが自動付与され、正常に画像を取得・表示できるようになった。Blob取得と`URL.createObjectURL`による画像表示、メモリリーク防止のための`URL.revokeObjectURL`実装を完了。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-192を追加。詳細は [knowledge-base/frontend.md#kb-192](./knowledge-base/frontend.md#kb-192-管理コンソールのサイネージプレビュー機能実装とjwt認証問題) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ CSVインポートスケジュールの間隔設定機能実装完了**: CSVインポートスケジュールが1日1回（曜日+時刻）のみで、10分ごとなどの細かい頻度設定ができなかった問題を解決。UIに「間隔（N分ごと）」モードを追加し、5分、10分、15分、30分、60分のプリセットを提供。最小5分間隔の制限をUI/API/スケジューラーの3層で実装（多層防御）。既存のcronスケジュールを解析し、UIで編集可能かどうかを判定する機能を実装。cron文字列を人間可読形式で表示する機能を追加（例: `"*/10 * * * 1,3"` → `"毎週月、水の10分ごと"`）。cron解析・生成ロジックをユーティリティ関数として分離し、保守性を向上。UIユニットテストとAPI統合テストを追加。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-191を追加。詳細は [knowledge-base/api.md#kb-191](./knowledge-base/api.md#kb-191-csvインポートスケジュールの間隔設定機能実装10分ごと等の細かい頻度設定) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVダッシュボードの列幅計算改善完了**: Pi3で表示中のサイネージのCSVダッシュボードで、フォントサイズ変更が反映されず、列幅が適切に追随しない問題を解決。列幅計算にフォントサイズを反映し、最初のページだけでなく全データ行を走査して最大文字列を考慮するように改善。日付列などフォーマット後の値で幅を計算するように修正。列名（ヘッダー）は`fontSize+4px`で太字表示されるため、列幅計算にも含めるように改善（太字係数1.06を適用）。列幅の合計がキャンバス幅を超える場合、比例的に縮小する機能を実装。仮説駆動デバッグ（fetchベースのNDJSONログ出力）により根本原因を特定。列幅計算の動作を検証するユニットテストを追加（5件すべてパス）。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-193を追加。詳細は [knowledge-base/infrastructure/signage.md#kb-193](./knowledge-base/infrastructure/signage.md#kb-193-csvダッシュボードの列幅計算改善フォントサイズ反映全行考慮列名考慮) / [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2026-01-26）

- **✅ 生産スケジュール画面のパフォーマンス最適化と検索機能改善完了**: 生産スケジュール画面で3000件のデータを表示する際、Pi4で初期表示に8秒、アイテム完了操作に23秒かかる問題を解決。**API側**: `q`パラメータを追加し、`ProductNo`と`FSEIBAN`の統合検索を実装。検索ロジックを改善（数値→ProductNo部分一致、8文字英数字→FSEIBAN完全一致、その他→OR検索）。SQLクエリを最適化し、DB側でフィルタリング・ソート・ページングを実行。`rowData`から必要なフィールドのみを選択し、レスポンスサイズを削減。デフォルト`pageSize`を400に変更。**フロントエンド側**: 検索時のみデータ取得（`enabled: hasQuery`）を実装し、初期表示を即座に「検索してください。」と表示。検索履歴の削除機能（黄色×ボタン）を追加。クリアボタンの視認性向上（`variant="secondary"`）。カラム幅計算をサンプリング（80件のみ）し、CPU負荷を削減。Macで実機検証完了、Pi4での実機検証は明日実施予定。CI成功。ナレッジベースにKB-205、KB-206を追加。詳細は [knowledge-base/api.md#kb-205](./knowledge-base/api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側) / [knowledge-base/frontend.md#kb-206](./knowledge-base/frontend.md#kb-206-生産スケジュール画面のパフォーマンス最適化と検索機能改善フロントエンド側) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-27）

- **✅ 生産スケジュールUI改善完了（チェック配色/OR検索/ソフトキーボード）**: 完了チェックボタンの配色を白背景・黒✓に変更し、状態識別を枠色（未完了=赤枠、完了=灰枠）で表現するように改善。検索履歴チップをトグル選択化し、複数選択でOR検索が可能に。`activeQuery: string`を`activeQueries: string[]`に変更し、選択中の履歴を配列で保持。選択中は色が付き（`border-emerald-300 bg-emerald-400`）、クリックで選択/解除がトグル。複数選択されたチップはカンマ区切りで`q`パラメータに結合し、API側でOR検索を実行。ソフトウェアキーボードモーダル（`KioskKeyboardModal.tsx`）を新規実装し、キーボードアイコン（⌨）ボタンでポップアップ表示。英数字入力（A-Z、0-9）、Backspace/Clear/Cancel/OKボタンを実装。OKで入力確定→モーダル閉じる。API側で`q`パラメータのカンマ区切りを解析し、トークンごとに既存ヒューリスティック（数値→ProductNo ILIKE / 8桁→FSEIBAN = / その他→OR ILIKE）を適用し、OR条件で結合。`q`パラメータの最大長を100から200に緩和。統合テストにOR検索ケースを追加。CI成功、デプロイ成功、実機検証完了（Mac・Pi4）。ナレッジベースにKB-207を追加。詳細は [knowledge-base/frontend.md#kb-207](./knowledge-base/frontend.md#kb-207-生産スケジュールui改善チェック配色or検索ソフトキーボード) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ 生産スケジュールUI改良完了（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）**: 資源CDフィルタ機能を追加し、各資源CDに2つのボタン（全件検索 / 割当済みのみ検索）を提供。検索登録製番と資源CDフィルタをAND条件で結合するように変更（テキスト条件と資源CD条件を分離し、AND結合）。加工順序番号（1-10）を資源CDごとに独立して割当可能にし、完了時に自動で詰め替え（例: 1,2,3,4 → 3完了で 4→3）。同一location（`ClientDevice.location`）の複数端末間で検索条件を同期（poll + debounce）。ドロップダウンの文字色を黒に固定し、視認性を向上。新規テーブル`ProductionScheduleOrderAssignment`と`KioskProductionScheduleSearchState`を追加。APIエンドポイント追加（`PUT /kiosk/production-schedule/:rowId/order`、`GET /kiosk/production-schedule/order-usage`、`GET/PUT /kiosk/production-schedule/search-state`）。CI成功、デプロイ成功、実機検証完了（Mac・Pi4）。ナレッジベースにKB-208を追加。詳細は [knowledge-base/frontend.md#kb-208](./knowledge-base/frontend.md#kb-208-生産スケジュールui改良資源cdfilter加工順序割当検索状態同期and検索) / [knowledge-base/api.md#kb-208](./knowledge-base/api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ 生産スケジュール行ごとの備考欄追加機能完了**: 生産スケジュールの各行に現場リーダーが備考を記入できる機能を実装。備考はlocation単位で管理し、同一locationの端末間で共有される。100文字以内・改行不可の制限を実装。インライン編集機能を実装し、Enterキーで保存、Escapeキーでキャンセルが可能。新規テーブル`ProductionScheduleRowNote`を追加。APIエンドポイント追加（`PUT /kiosk/production-schedule/:rowId/note`）。CI成功、デプロイ成功、実機検証完了（Pi5/Pi4/Pi3）。ナレッジベースにKB-212を追加。詳細は [knowledge-base/frontend.md#kb-212](./knowledge-base/frontend.md#kb-212-生産スケジュール行ごとの備考欄追加機能) / [knowledge-base/api.md#kb-212](./knowledge-base/api.md#kb-212-生産スケジュール行ごとの備考欄追加機能) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVインポートスケジュール実行ボタンの競合防止とFSEIBANバリデーション修正完了**: CSVインポートスケジュールページで、1つのスケジュールの「実行」ボタンを押すと他のスケジュールのボタンも「実行中...」と表示される問題を解決。`useRef`（`runningScheduleIdRef`）を追加し、実行中のスケジュールIDを即座に反映される参照で追跡することで競合を防止。既に実行中のスケジュールを再度実行しようとした場合、500エラーではなく409エラー（Conflict）を返すように修正。FSEIBANバリデーションを修正し、割当がない場合の`********`（8個のアスタリスク）を明示的に許可。実機検証でGmail経由のCSV取り込みが正常に動作し、`********`も正常に取得できることを確認。CI成功、デプロイ成功。ナレッジベースにKB-201（更新）、KB-204を追加。詳細は [knowledge-base/api.md#kb-201](./knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) / [knowledge-base/frontend.md#kb-204](./knowledge-base/frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-26）

- **✅ 生産スケジュール機能改良完了**: 列名変更（ProductNo→製造order番号、FSEIBAN→製番）、FSEIBAN全文表示、管理コンソールの列並び順・表示非表示機能、差分ロジック改善（updatedAt優先・完了でも更新）、CSVインポートスケジュールUI改善（409エラー時のrefetch）、バリデーション追加（ProductNo: 10桁数字、FSEIBAN: 8文字英数字）、TABLEテンプレート化を実装。実機検証でCSVダッシュボード画面とキオスク画面の動作を確認。CI成功、デプロイ成功。ナレッジベースにKB-201、KB-202、KB-203を追加。詳細は [knowledge-base/api.md#kb-201](./knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) / [knowledge-base/frontend.md#kb-202](./knowledge-base/frontend.md#kb-202-生産スケジュールキオスクページの列名変更とfseiban全文表示) / [knowledge-base/infrastructure/ansible-deployment.md#kb-203](./knowledge-base/infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) / [plans/production-schedule-kiosk-execplan.md](./plans/production-schedule-kiosk-execplan.md) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。
- **✅ CSV取り込み統合設定の追加**: マスターデータの列定義（ColumnDefinition）と手動/自動の許可、取り込み戦略を管理コンソールで統一管理できるようにし、USB一括登録とCSVインポートスケジュールを統合ページに集約。Gmail件名パターンはcsvDashboards対応を追加。詳細は [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-XX）

- **✅ 生産スケジュールキオスクページ実装・実機検証完了**: PowerAppsの生産スケジュールUIを参考に、キオスクページ（`/kiosk/production-schedule`）を実装。CSVダッシュボード（`ProductionSchedule_Mishima_Grinding`）のデータをキオスク画面で表示し、完了ボタン（赤いボタン）を押すと`progress`フィールドに「完了」が入り、完了した部品を視覚的に識別可能に。完了ボタンのグレーアウト・トグル機能を実装し、完了済みアイテムを`opacity-50 grayscale`で視覚的にグレーアウト。完了ボタンを押すと`progress`が「完了」→空文字（未完了）にトグル。チェックマーク位置調整（`pr-11`でパディング追加）と`FSEIBAN`の下3桁表示を実装。CSVダッシュボードの`gmailSubjectPattern`設定UIを管理コンソールに追加。`CsvImportSubjectPattern`モデルを追加し、マスターデータインポートの件名パターンをDB化（設計統一）。実機検証でCSVダッシュボードのデータがキオスク画面に表示され、完了ボタンの動作、グレーアウト表示、トグル機能が正常に動作することを確認。CI成功、デプロイ成功。ナレッジベースにKB-184、KB-185、KB-186を追加。詳細は [knowledge-base/frontend.md#kb-184](./knowledge-base/frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能) / [knowledge-base/api.md#kb-185](./knowledge-base/api.md#kb-185-csvダッシュボードのgmailsubjectpattern設定ui改善) / [knowledge-base/api.md#kb-186](./knowledge-base/api.md#kb-186-csvimportsubjectpatternモデル追加による設計統一マスターデータインポートの件名パターンdb化) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-19）

- **✅ Pi4デプロイ時のキオスクメンテナンス画面表示機能実装完了**: Pi4デプロイ時にキオスク画面にメンテナンス画面を表示する機能を実装。デプロイスクリプト（`scripts/update-all-clients.sh`）で`--limit raspberrypi4`使用時に自動的にメンテナンスフラグを設定・クリアし、Web UIでメンテナンス画面を表示。APIエンドポイント（`/api/system/deploy-status`）経由でフラグを管理し、`KioskLayout.tsx`で5秒間隔でポーリングして即座に反映。デプロイ完了後、メンテナンス画面は自動的に消える（最大5秒以内）。実機検証でメンテナンス画面の表示・非表示を確認。Webコンテナの再ビルドが必要であること、ブラウザキャッシュのクリアが必要な場合があることを確認。ナレッジベースにKB-183を追加。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-183](./knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Pi4デプロイ検証完了（デプロイ安定化機能の動作確認）**: KB-172で実装したデプロイ安定化機能（プリフライト・ロック・リソースガード）がPi4に対して正常に動作することを検証。デプロイ前チェック（ネットワークモード確認、プリフライトチェック、リモートロック）が正常に動作し、デプロイ成功（ok=78, changed=8, failed=0）。デプロイ後の確認（systemdサービス、API接続）で問題なし。Pi5と同様に、Pi4でもデプロイが安定して実行できることを確認。ナレッジベースにKB-182を追加。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-182](./knowledge-base/infrastructure/ansible-deployment.md#kb-182-pi4デプロイ検証結果デプロイ安定化機能の動作確認) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Dropbox証明書ピニング問題の解決・バックアップ対象の追加・UI表示問題の修正完了**: Dropboxの証明書更新により`api.dropboxapi.com`の証明書ピニングが失敗していた問題を解決。新しい証明書フィンガープリント（`sha256/9d6683591abfc0a0e0681152ed4577430bf5b00e7a3ff71b9f21098e2922a2e5`）を追加し、スケジュール実行されたDropboxバックアップのクリーンアップ処理が正常に動作するように修正。Pi5/Pi4/Pi3の環境設定ファイル（vault.yml、vault password、status-agent configs、backup.json）をバックアップ対象に追加し、すべてのバックアップ対象（合計25件）にスケジュール設定を追加。管理コンソールのバックアップ対象一覧で「バックアップ先」列に「未設定」と表示されていた問題を修正し、新構造（`options.dropbox.accessToken`）と旧構造（`options.accessToken`）の両方に対応するようにUI表示ロジックを更新。CI成功、デプロイ成功、実機検証完了。ナレッジベースにKB-179、KB-180、KB-181を追加。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-179](./knowledge-base/infrastructure/backup-restore.md#kb-179-dropbox証明書ピニング問題api-dropboxapi-comの新しい証明書フィンガープリント追加) / [knowledge-base/infrastructure/backup-restore.md#kb-180](./knowledge-base/infrastructure/backup-restore.md#kb-180-バックアップ対象の追加pi5pi4pi3の環境設定ファイル) / [knowledge-base/infrastructure/backup-restore.md#kb-181](./knowledge-base/infrastructure/backup-restore.md#kb-181-ui表示問題の修正dropbox設定の新構造対応) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) を参照。

- **✅ セキュリティ評価実施・ログの機密情報保護実装完了**: OWASP Top 10 2021、IPA「安全なウェブサイトの作り方」、CISベンチマーク、NIST Cybersecurity Framework等の標準的なセキュリティ評価指標に基づいてセキュリティ評価を実施。総合評価は良好（2.2/3.0、実施率73%）。緊急に実装すべき項目として「ログの機密情報保護」を特定し、`x-client-key`がログに平文で出力されていた問題を修正。6ファイルを修正し、認証キーを`[REDACTED]`に置換するように実装。CI成功、デプロイ成功、ログ確認完了。ナレッジベースにKB-178を追加、プレゼン用ドキュメントに第6層（ログの機密情報保護）を追加。詳細は [security/evaluation-report.md](./security/evaluation-report.md) / [security/log-redaction-implementation.md](./security/log-redaction-implementation.md) / [security/urgent-security-measures.md](./security/urgent-security-measures.md) / [knowledge-base/infrastructure/security.md#kb-178](./knowledge-base/infrastructure/security.md#kb-178-ログの機密情報保護実装x-client-keyのredacted置換) / [presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md) を参照。

### 🆕 最新アップデート（2026-01-18）

- **✅ デプロイ安定化の恒久対策実装・実機検証完了**: KB-176で発見された問題（環境変数反映、vault.yml権限問題）に対する恒久対策を実装・実機検証完了。`.env`更新時のapiコンテナ強制再作成、デプロイ後の環境変数検証（fail-fast）、vault.yml権限ドリフトの自動修復、handlersの再起動ロジック統一を実装。実機検証でPi5へのデプロイ成功（ok=91, changed=3, failed=0）、APIコンテナ内の環境変数が正しく設定されていること、vault.ymlファイルの権限が適切に設定されていることを確認。デプロイ前にvault.yml権限問題が発生したが、手動で修正。次回のデプロイからは自動修復機能が動作する。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-176](./knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) を参照。

- **✅ Slack通知チャンネル分離機能の実機検証完了**: Slack通知を4系統（deploy/ops/security/support）に分類し、それぞれ別チャンネル（`#rps-deploy`, `#rps-ops`, `#rps-security`, `#rps-support`）に着弾させる機能を実装・検証完了。Ansible VaultにWebhook URLを登録し、`docker.env.j2`テンプレートで環境変数を生成。実機検証で4チャンネルすべてでの通知受信を確認。デプロイ時のトラブルシューティング（Ansibleテンプレートの既存値保持パターン、ファイル権限問題、コンテナ再起動の必要性）をナレッジベースに記録。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-176](./knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) / [guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md) / [guides/deployment.md#slack通知のチャンネル分離](./guides/deployment.md#slack通知のチャンネル分離2026-01-18実装) を参照。

- **✅ Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了**: Phase2完全移行を実装し、API/UIをDBのみ参照に変更。APIの`/clients/alerts`はファイル走査を撤去しDBのみ参照、`/clients/alerts/:id/acknowledge`はDBのみ更新。Web管理ダッシュボードは`dbAlerts`を表示し、「アラート:」セクションにDB alertsが複数表示されることを確認。Ansible環境変数を永続化し、API integration testを追加。実機検証でPi5でのAPIレスポンス（dbAlerts=10、fileAlerts=0）・Web UI表示（DB alerts表示）・acknowledge機能・staleClientsアラートとの共存を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-175](./knowledge-base/infrastructure/ansible-deployment.md#kb-175-alerts-platform-phase2完全移行db中心運用の実機検証完了) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了**: Alerts Platform Phase2後続実装を実装し、DB版Dispatcherが正常に動作することを確認。DB版Dispatcherは`AlertDelivery(status=pending|failed, nextAttemptAt<=now)`を取得してSlackへ配送し、dedupe（`fingerprint + routeKey + windowSeconds`）により連続通知を抑制。retry/backoffで失敗時の再送を実装。Phase1（file）Dispatcherは停止し、DB中心へ完全移行。実機検証でPi5でのDB版Dispatcher起動・配送処理（10件SENT、45件SUPPRESSED）・dedupe動作・fingerprint自動計算・Phase1停止を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-174](./knowledge-base/infrastructure/ansible-deployment.md#kb-174-alerts-platform-phase2後続実装db版dispatcher-dedupe-retrybackoffの実機検証完了) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ Alerts Platform Phase2のDB取り込み実装完了**: Alerts Platform Phase2のIngest機能を実装し、`alerts/alert-*.json`をDBへ永続化する機能を追加。Prismaスキーマに`Alert`/`AlertDelivery`モデルを追加し、AlertsIngestorが60秒間隔でDB取り込みを実行。API互換性を維持し、`GET /api/clients/alerts`でDBアラート取得、`POST /api/clients/alerts/:id/acknowledge`でDB側もack対応。空ファイル（0バイト）や壊れたJSONを`errors`ではなく`skipped`として扱うように改善し、ログノイズを削減。実機検証でPi5でのDB取り込み・AlertDelivery作成・ack更新を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-173](./knowledge-base/infrastructure/ansible-deployment.md#kb-173-alerts-platform-phase2のdb取り込み実装と空ファイル処理の改善) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ Alerts Dispatcher Phase 1実装・過去のアラート再送問題修正完了**: Alerts Dispatcher Phase 1を実装し、Slack通知の一元管理を実現。B1アーキテクチャ（scriptsはalertsファイル生成、API側がSlack配送）を採用。実機検証でPi5でのSlack通知着弾を確認。過去のアラート再送問題を修正し、24時間以上古いアラートは再送されないように改善。送信済み（`status === 'sent'`）のアラートも再送されない。`.gitignore`の全階層マッチ問題も修正（`/alerts/`と`/config/`に変更）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-172](./knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) / [guides/local-alerts.md](./guides/local-alerts.md) / [plans/alerts-platform-phase2.md](../plans/alerts-platform-phase2.md) を参照。

- **✅ デプロイ安定化機能の実装完了**: デプロイプロセスの安全性と可観測性を向上させる機能を実装。プリフライトリーチビリティチェック（Pi5 + inventory hosts）、リモートロック（並行実行防止、古いロックの自動クリーンアップ）、リソースガード（メモリ120MB、ディスク90%）、環境限定リトライ（unreachable hostsのみ、3回、30秒）、ホストごとのタイムアウト（Pi3 30m / Pi4 10m / Pi5 15m）、Slack通知（start/success/failure/per-host failure）、`--limit`オプション（特定ホストのみ更新）を実装。実機検証でPi5とPi4でのデプロイ成功を確認。実装時の発見事項（locale問題、git権限問題、ESLint設定問題、`.gitignore`全階層マッチ問題）も解決。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-172](./knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) / [guides/deployment.md](./guides/deployment.md#デプロイ安定化機能2026-01-17実装) / [plans/deploy-stability-execplan.md](../plans/deploy-stability-execplan.md) を参照。

### 🆕 最新アップデート（2026-01-16）

- **✅ WebRTCビデオ通話機能の修正（clientKey/clientId未設定問題）**: `KioskCallPage.tsx`で`clientKey`と`clientId`が設定されていなかったため、WebSocket接続が確立されずビデオ通話機能が動作しない問題を解決。`useLocalStorage`フックを追加し、`localStorage`から`clientKey`と`clientId`を取得して`useWebRTC`フックに渡すように修正。`resolveClientKey`関数で`DEFAULT_CLIENT_KEY`をフォールバックとして使用するように改善。実機検証でPi4とMac間のビデオ通話が正常に動作することを確認。詳細は [knowledge-base/frontend.md#kb-171](./knowledge-base/frontend.md#kb-171-webrtcビデオ通話機能が動作しないkioskcallpageでのclientkeyclientid未設定) を参照。

### 🆕 最新アップデート（2026-01-16）

- **✅ デバイスタイプ汎用化による将来クライアント拡張対応**: `preflight-pi3-signage.yml`を`preflight-signage.yml`に汎用化し、Pi3以外のサイネージ端末（Pi Zero 2Wなど）にも対応可能に。`group_vars/all.yml`に`device_type_defaults`を追加し、デバイスタイプごとの設定（メモリ要件、lightdm停止要否、サービス停止リスト）を一元管理。inventoryファイルに`device_type`変数を追加（Pi3: `pi3`, Pi Zero 2W: `pi_zero_2w`）。`device_type`未指定時は`default`設定を使用し、後方互換性を維持。新しいデバイスタイプ追加時の手順をドキュメント化。CI成功・構文チェック完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-170](./knowledge-base/infrastructure/signage.md#kb-170-デバイスタイプ汎用化による将来クライアント拡張対応) / [guides/deployment.md](./guides/deployment.md#新しいサイネージ端末デバイスタイプの追加手順) を参照。

- **✅ Pi3デプロイ信頼性向上（lightdm停止・自動再起動）**: Pi3デプロイがメモリ不足で完了しない問題を根本解決。プレフライトチェックでlightdm（GUIディスプレイマネージャー）を停止し約100MBのメモリを確保。デプロイ完了後はPi3を自動再起動してGUIとサイネージサービスを復活。signageロール・clientロールでlightdm停止時はサービス起動をスキップし、デプロイエラーを回避。デプロイ成功（ok=101, changed=22, failed=0）、所要時間約10分を実機検証で確認。詳細は [knowledge-base/infrastructure/signage.md#kb-169](./knowledge-base/infrastructure/signage.md#kb-169-pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動) / [guides/deployment.md](./guides/deployment.md) を参照。

### 🆕 最新アップデート（2025-12-31）

- **✅ CSVインポートUI改善・計測機器・吊具対応完了**: USBメモリ経由のCSVインポートUIを4つのフォーム（従業員・工具・計測機器・吊具）に分割し、各データタイプを個別にアップロードできるように改善。新APIエンドポイント`POST /api/imports/master/:type`を追加し、単一データタイプ対応のインポート機能を実装。共通コンポーネント`ImportForm`を作成し、コードの重複を削減。各フォームで`replaceExisting`を個別に設定可能。CI通過確認済み。詳細は [knowledge-base/api.md#kb-117](./knowledge-base/api.md#kb-117-csvインポートapiの単一データタイプ対応エンドポイント追加) / [knowledge-base/frontend.md#kb-117](./knowledge-base/frontend.md#kb-117-csvインポートuiの4フォーム分割実装) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVフォーマット仕様実装・従業員編集フォーム改善完了**: 従業員CSVインポートの新フォーマット（`lastName`/`firstName`）を実装し、従業員編集フォームを`lastName`と`firstName`の個別フィールドに変更。`displayName`は自動生成されるように改善。データベーススキーマに`lastName`/`firstName`フィールドを追加し、APIとフロントエンドを更新。既存データの`displayName`から`lastName`/`firstName`への分割ロジックも実装。実機検証でCSVインポート成功、`displayName`自動生成、一覧表示、編集画面の動作をすべて確認済み。詳細は [guides/verification-checklist.md#62-従業員csvインポート新フォーマット](./guides/verification-checklist.md#62-従業員csvインポート新フォーマット) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2025-12-30）

- **✅ CSVインポート実機検証完了・UI改善**: CSVインポートスケジュールページのフォーム状態管理を改善し、削除後や編集から新規作成への切り替え時にフォームが正しくリセットされるように修正。手動実行時のリトライスキップ機能を実装し、即座に結果を確認できるように改善（自動実行は従来通りリトライあり）。実機検証でターゲット追加機能、データタイプ選択、プロバイダー選択、Gmail件名パターン管理、スケジュールCRUD、削除機能、手動実行、スケジュール表示の人間可読形式をすべて確認済み。詳細は [knowledge-base/frontend.md#kb-116](./knowledge-base/frontend.md#kb-116-csvインポートスケジュールページのフォーム状態管理改善) / [knowledge-base/api.md#kb-116](./knowledge-base/api.md#kb-116-csvインポート手動実行時のリトライスキップ機能) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-15）

- **✅ backup.json削除問題の根本的解決と復元手順確立**: `git clean -fd`による`backup.json`削除問題を根本的に解決。`.gitignore`に`config/`を追加し、**Ansibleデプロイから`git clean`を削除**することで運用データ削除リスクを排除。Dropboxからの`backup.json`復元方法、Gmail OAuth設定の復元方法、Gmail OAuthルートの新構造対応修正、旧キーと新構造の衝突問題と解決方法をナレッジベースに記録。デプロイ時の設定ファイル削除を防止し、復元手順を確立。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-163](./knowledge-base/infrastructure/backup-restore.md#kb-163-git-cleanによるbackupjson削除問題再発) / [knowledge-base/infrastructure/backup-restore.md#kb-164](./knowledge-base/infrastructure/backup-restore.md#kb-164-git-clean設計の根本的改善-fd--fdx) / [knowledge-base/infrastructure/backup-restore.md#kb-165](./knowledge-base/infrastructure/backup-restore.md#kb-165-dropboxからのbackupjson復元方法) / [knowledge-base/infrastructure/backup-restore.md#kb-166](./knowledge-base/infrastructure/backup-restore.md#kb-166-gmail-oauth設定の復元方法) / [knowledge-base/infrastructure/backup-restore.md#kb-167](./knowledge-base/infrastructure/backup-restore.md#kb-167-gmail-oauthルートの新構造対応修正) / [knowledge-base/infrastructure/backup-restore.md#kb-168](./knowledge-base/infrastructure/backup-restore.md#kb-168-旧キーと新構造の衝突問題と解決方法) を参照。

### 🆕 最新アップデート（2026-01-14）

- **✅ トークプラザ工場へのマルチサイト対応実装完了**: トークプラザ工場（別拠点）への同一システム導入に対応。inventoryファイルの分離（`inventory-talkplaza.yml`）、group_vars/host_varsの分離、プレフィックス命名規則（`talkplaza-`）の実装により、設定の混在を防止。デプロイスクリプトのinventory引数必須化により、誤デプロイのリスクを大幅に削減。Dropbox basePathの分離対応により、拠点別フォルダにバックアップを分離。デプロイスクリプトのinventory/playbookパス相対パス修正により、Pi5上での実行時のパス重複問題を解決。第1工場への導入時も同様の手順で対応可能。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-159](./knowledge-base/infrastructure/ansible-deployment.md#kb-159-トークプラザ工場へのマルチサイト対応実装inventory分離プレフィックス命名規則) / [knowledge-base/infrastructure/ansible-deployment.md#kb-160](./knowledge-base/infrastructure/ansible-deployment.md#kb-160-デプロイスクリプトのinventory引数必須化誤デプロイ防止) / [knowledge-base/infrastructure/ansible-deployment.md#kb-162](./knowledge-base/infrastructure/ansible-deployment.md#kb-162-デプロイスクリプトのinventoryplaybookパス相対パス修正pi5上での実行時) / [knowledge-base/infrastructure/backup-restore.md#kb-161](./knowledge-base/infrastructure/backup-restore.md#kb-161-dropbox-basepathの分離対応拠点別フォルダ分離) / [guides/talkplaza-rollout.md](./guides/talkplaza-rollout.md) / [guides/deployment.md](./guides/deployment.md) を参照。

### 🆕 最新アップデート（2026-01-09）

- **✅ MacとPi3のstatus-agent問題修正完了**: 管理コンソールでMacとPi3のステータスが表示されない問題を解決。Pi3の`status-agent.timer`が無効化されていたため、`systemctl enable --now status-agent.timer`で再有効化。MacにはLinux用の`status-agent.py`しか存在せず、macOSでは動作しないため、macOS専用の`status-agent-macos.py`を作成し、`launchd`設定ファイルを追加して定期実行を設定。`docs/guides/status-agent.md`にmacOS向けセットアップ手順を追加。CI成功・デプロイ完了を確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-157](./knowledge-base/infrastructure/ansible-deployment.md#kb-157-pi3のstatus-agenttimerが無効化されていた問題) / [knowledge-base/infrastructure/miscellaneous.md#kb-158](./knowledge-base/infrastructure/miscellaneous.md#kb-158-macのstatus-agent未設定問題とmacos対応) / [guides/status-agent.md](./guides/status-agent.md) を参照。

- **✅ 複数スケジュールの順番切り替え機能実装完了**: 複数のスケジュールが同時にマッチする場合、優先順位順（高い順）にソートされ、設定された間隔（デフォルト: 30秒）で順番に切り替えて表示する機能を実装。環境変数`SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS`で切り替え間隔を設定可能。優先順位100（分割表示）と優先順位10（全画面表示）が同時にマッチする場合、30秒ごとに交互に表示される。CI成功・デプロイ完了・実機検証完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-156](./knowledge-base/infrastructure/signage.md#kb-156-複数スケジュールの順番切り替え機能実装) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Pi3サイネージの画像更新方式改善完了**: Pi3サイネージの「1ページずつ表示されない」問題の再発要因を特定し、画像更新方式を改善。`signage-update.sh`が`mv`で置換していたため、更新のたびに`current.jpg`のinodeが変わり、`feh --auto-reload(inotify)`が追従できない問題を解決。既存`current.jpg`がある場合は上書き更新（inode維持）に変更し、画面更新が安定するように改善。Ansibleテンプレートも同様に修正。詳細は [knowledge-base/infrastructure/signage.md#kb-152](./knowledge-base/infrastructure/signage.md#kb-152-サイネージページ表示漏れ調査と修正) / [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) を参照。

- **✅ CSVダッシュボード機能の検証9完了**: CSVダッシュボード可視化機能の検証9（表示期間フィルタ）を実施し、表示期間フィルタ（`displayPeriodDays: 1`）が正しく動作することを確認。当日分（8行）のみが表示され、前日分（2行）は除外されている。JSTの「今日の0:00」から「今日の23:59:59」をUTCに正しく変換してフィルタリングしていることを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md) を参照。

- **✅ CSVダッシュボード機能のCI修正・デプロイ完了**: CSVダッシュボード可視化機能のCI修正とデプロイを完了。E2Eテストのstrict mode violation（「ダッシュボード」リンクが「CSVダッシュボード」リンクと重複マッチ）を修正し、`@remix-run/router`の脆弱性対応（1.23.2へ強制）を実施。GitHub Actions CIが成功し、Pi5へのデプロイも正常に完了。管理コンソールの「CSVダッシュボード」タブが表示され、機能が利用可能な状態に到達。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md) を参照。

- **✅ CSVダッシュボード機能の実機検証・修正完了**: CSVダッシュボード可視化機能の実機検証を実施し、4つの問題を発見・修正。スキーマ修正で`csvDashboardId`が保持されるように改善、手動アップロードでデータ取り込みを実行するように修正、日付フィルタリングでJST/UTCの変換を正しく計算するように修正、`displayPeriodDays`のnullチェックを追加。実機検証でCSVダッシュボードのデータが正しく表示されることを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md) を参照。

### 🆕 最新アップデート（2026-01-XX）

- **✅ CI YAML責務分離リファクタ完了**: GitHub Actions CIワークフローを品質レビューに適した構成に改善。巨大な`lint-and-test`ジョブを`static-quality`、`api-tests`、`scripts-verification`、`security`に分割し、失敗原因の特定を容易に。PostgreSQLを`services:`化し、ポート衝突と後片付けの問題を解消。共通基盤を整備（`runs-on: ubuntu-24.04`固定、`concurrency`追加、`defaults.run.shell: bash -euo pipefail`設定）。成果物を標準化（Vitest JUnit/JSON/coverage、Trivy SARIF、Playwright reportをartifact化）。`pnpm audit`をnon-blocking化し、失敗してもCIを落とさず結果をログ/レポートとして残す方針に変更。詳細は [knowledge-base/ci-cd.md#kb-027](./knowledge-base/ci-cd.md#kb-027-ci-yaml責務分離リファクタ品質レビュー強化) / [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) を参照。

### 🆕 最新アップデート（2026-01-08）

- **✅ CSVダッシュボード可視化機能実装完了**: Gmail経由でPowerAutomateから送信されたCSVファイルをサイネージで可視化表示する機能を実装。`slot.kind=csv_dashboard`の実装が完了し、FULL/SPLITレイアウトでCSVダッシュボードを表示可能に。データ構造定義、可視化テンプレート（テーブル/カードグリッド）、表示期間フィルタ、データ保持期間管理を実装。管理コンソールUIでCSVダッシュボードを選択可能に。CI通過・デプロイ完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-155](./knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ SPLITモードで左右別PDF表示に対応完了**: SPLITレイアウトで左右ともPDFを表示できる機能を実装。`SignageContentResponse`に`pdfsById`フィールドを追加し、複数PDFを辞書形式で提供可能に。レンダラーに`renderSplitWithPanes`メソッドを追加し、左右ともPDFの場合に対応。Web側の`SignageDisplayPage`を`layoutConfig`準拠の2ペインSPLIT描画に更新し、左右それぞれのスロットに応じてPDFまたは工具を描画。左右それぞれのPDFが独立してスライドショー表示されることを実機検証で確認。CI通過・デプロイ完了を確認。詳細は [knowledge-base/infrastructure/signage.md#kb-154](./knowledge-base/infrastructure/signage.md#kb-154-splitモードで左右別pdf表示に対応) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Pi3デプロイ安定化の十分条件実装完了**: Pi3デプロイ時のプレフライトチェックを自動化し、手順遵守に依存しない運用を実現。コントロールノード側でAnsibleロールのテンプレートファイル存在チェックを実装し、Pi3側でサービス停止・無効化・mask、残存AnsiballZ掃除、メモリ閾値チェック（>= 120MB）を自動実行。条件を満たせない場合はfail-fastし、エラーメッセージに手動対処手順を表示。標準手順ドキュメントを更新し、プレフライトチェックが自動実行されることを明記。実機検証でコントロールノード側のロール構造チェックとPi3側のプレフライトチェックが正常に動作し、メモリ不足時にfail-fastすることを確認。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-154](./knowledge-base/infrastructure/ansible-deployment.md#kb-154-pi3デプロイ安定化の十分条件実装プレフライトチェック自動化) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Pi3サイネージ安定化施策実装・デプロイ完了**: Pi3サイネージの安定稼働を向上させるため、SDカードへの高頻度書込み削減（tmpfs化）、systemdサービス堅牢化、画像更新停止の自己修復（Watchdog）、深夜の日次再起動、Ansibleによる設定の収束を実装。デプロイ時に`signage`ロールのテンプレートディレクトリ不足で失敗した問題を解決し、テンプレートファイルを`roles/signage/templates/`に配置してデプロイ成功。すべてのサービス（signage-lite.service、signage-lite-update.timer、signage-lite-watchdog.timer、signage-daily-reboot.timer、status-agent.timer）が正常に起動することを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-153](./knowledge-base/infrastructure/signage.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足) / [knowledge-base/infrastructure/ansible-deployment.md#kb-153](./knowledge-base/infrastructure/ansible-deployment.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足) / [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2026-01-07）

- **✅ backup.jsonの破壊的上書きを防ぐセーフガード実装・実機検証完了**: `backup.json`がフォールバック設定（デフォルト設定）で上書きされ、Gmail設定や多数のバックアップターゲットが消失する問題を解決。フォールバック検知マーカー（`FALLBACK_MARKER`）の保持（`{...config}`によるスプレッドクローンを廃止）、フォールバック保存の拒否（本番パスのみ）、破壊的上書き防止ガード（targets数が50%以上減る保存を拒否）を実装。詳細ログ（ファイル読み込み時のサイズ・要約情報、保存時の検証結果）を追加。CI通過・デプロイ完了・実機検証完了を確認。Gmail設定のトークン更新とバックアップ実行後も、ファイルサイズ（9358 bytes）、ターゲット数（17）、Gmail/Dropbox設定が維持されることを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-151](./knowledge-base/infrastructure/backup-restore.md#kb-151-backupjsonの破壊的上書きを防ぐセーフガード実装) を参照。

- **✅ サイネージレイアウト設定の実機検証完了・UI改善**: サイネージレイアウトとコンテンツの疎結合化実装の実機検証を完了。SPLITレイアウトで左PDF・右工具管理の組み合わせに対応し、タイトルを動的に表示するように改善。タイトルとアイテムの重なりを解消し、PDF表示の重複タイトルを削除。スケジュールの優先順位ロジックを改善し、優先順位が高いスケジュールが優先されることを確認。実機検証で発見された問題（Pi3のサイネージサービス更新タイマーが停止していた）も解決。すべてのレイアウトパターン（FULL/SPLIT、左PDF右工具管理、左工具管理右PDF）が正常に動作することを確認。詳細は [knowledge-base/infrastructure/signage.md#kb-150](./knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了) / [guides/signage-layout-config-verification-results.md](./guides/signage-layout-config-verification-results.md) / [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2026-01-06）

- **✅ サイネージレイアウトとコンテンツの疎結合化実装完了**: サイネージのレイアウト（全体/左右）と各エリアのコンテンツ（PDF/持出一覧/将来のCSV可視化）を分離し、新しい可視化を追加する際のコード変更を最小限に抑えられる構造を実現。`SignageSchedule`と`SignageEmergency`に`layoutConfig Json?`フィールドを追加し、レイアウトごとのキャンバス割当とslotごとのSVG生成を分離。既存の`contentType`/`pdfId`形式を新形式へ自動変換する機能を実装し、後方互換性を維持。管理コンソールUIでレイアウト（全体/左右）と各スロットのコンテンツ種別（PDF/持出一覧）を選択可能に。デプロイ時にPrisma Client再生成が必要な場合があることをナレッジベースに記録。詳細は [knowledge-base/infrastructure/signage.md#kb-150](./knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了) / [modules/signage/README.md](./modules/signage/README.md) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ バックアップ履歴ページに用途列を追加（UI改善）完了**: バックアップ履歴のテーブルに「用途」列を追加し、各バックアップ対象の用途を一目で把握できるように改善。`targetKind`と`targetSource`から用途を自動判定する`getTargetPurpose`関数を実装し、日本語で分かりやすく表示。backup.json、vault.yml、.env、データベース、CSV、画像などの用途を適切に表示。実機検証で用途列が正しく表示され、レイアウトが崩れないことを確認。詳細は [knowledge-base/frontend.md#kb-149](./knowledge-base/frontend.md#kb-149-バックアップ履歴ページに用途列を追加ui改善) を参照。

- **✅ 外部連携運用台帳ドキュメント作成完了（P2実装）**: Dropbox/Gmail/Slackなどの外部サービス連携の設定・運用情報を一元管理する運用台帳ドキュメントを作成。各外部サービスの設定場所（Ansible Vault、backup.json、環境変数）、設定手順へのリンク、運用時の注意事項、トラブルシューティング情報、設定の永続化方法、ヘルスチェック方法をまとめ。既存のセットアップガイドやナレッジベースへの参照を整理し、運用者が外部連携の設定・運用を効率的に管理できるように改善。詳細は [guides/external-integration-ledger.md](./guides/external-integration-ledger.md) を参照。

- **✅ バックアップ設定の衝突・ドリフト検出の自動化（P1実装）完了**: `backup.json`の新旧構造間の設定値の衝突や、環境変数と設定ファイル間のドリフトを自動検出する機能を実装。`BackupConfigLoader.checkHealth()`メソッドと`GET /api/backup/config/health`エンドポイントを追加し、管理コンソールUIに統合。衝突検出（旧キーと新構造の両方に値がある場合）、ドリフト検出（環境変数と設定ファイルの値の不一致）、欠落チェック（必須設定の欠落）を実装。実機検証でヘルスチェックエンドポイントが正常に動作し、UI表示が成功することを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-148](./knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装) / [api/backup.md](./api/backup.md) を参照。

- **✅ backup.jsonのprovider別名前空間化（構造的再発防止策）実装・実機検証完了**: `backup.json`の`storage.options`をprovider別名前空間（`options.dropbox.*`, `options.gmail.*`）へ移行し、Dropbox/Gmailトークン衝突を構造的に再発不能に。後方互換性を維持し、旧キーから新構造への自動正規化を実装。ネスト対応の`${ENV}`解決、OAuthコールバック/refresh/onTokenUpdateの統一、Gmail設定APIの新構造対応を実装。実機検証で旧構造の後方互換性、新構造への保存、Dropboxバックアップ、Gmail OAuth更新がすべて正常に動作することを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-147](./knowledge-base/infrastructure/backup-restore.md#kb-147-backupjsonのprovider別名前空間化構造的再発防止策) / [api/backup.md](./api/backup.md) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) を参照。

- **✅ バックアップ手動実行時の500エラー修正・client-directory kind追加完了**: 手動バックアップ実行時に一部の対象で500エラーが発生していた問題を解決。Pi5自身のファイルを`client-file`として登録していた問題と、Pi3/Pi4のディレクトリを`directory`として登録していた問題を修正。`client-directory` kindを追加し、クライアント端末のディレクトリをAnsible経由でバックアップ可能に。`backup.json`を正規化し、Pi5自身のファイルは`file`/`directory`、Pi3/Pi4のディレクトリは`client-directory`に統一。Tailscaleパスを`/etc/tailscale`から`/var/lib/tailscale`に修正。Docker Composeに証明書マウントを追加。実機検証で全バックアップ対象が正常に動作することを確認。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-144](./knowledge-base/infrastructure/backup-restore.md#kb-144-バックアップ手動実行時の500エラーclient-directory-kind追加とbackupjson正規化) / [api/backup.md](./api/backup.md) を参照。

- **✅ Dropbox設定の恒久対策とbackup.json保護機能追加・実機検証完了**: Ansibleで`.env`再生成時にDropbox設定が消失する問題を解決。KB-142でSlack Webhook URLの恒久対策を実施したが、同様の問題がDropbox設定でも発生したため、AnsibleテンプレートにDropbox環境変数を追加し、vaultで管理するように改善。さらに、`backup.json`の存在保証と健全性チェック機能を追加し、ファイル消失時に設定が失われる問題を防止。実機検証でAnsible再実行後もSlack/Dropbox設定が維持され、システムが正常に動作することを確認。CI失敗の修正（`slack-webhook.ts`のデバッグログ削除）も完了。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-143](./knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Gmail OAuthとDropboxバックアップのトークン衝突（refreshToken共有）を恒久対策（トークン分離）**: Gmail OAuthのトークン保存がDropbox用トークンを上書きしてしまい、Dropbox手動バックアップが大量に失敗する問題を解決。`backup.json`の`storage.options`でGmail用トークンを`gmailAccessToken/gmailRefreshToken`に分離し、Gmail設定の「設定済み」判定も`storage.provider`に依存しない形へ改善。CSVインポート後の自動バックアップ等のトークン更新も分離し、再発を防止。詳細は [knowledge-base/infrastructure/backup-restore.md#kb-146](./knowledge-base/infrastructure/backup-restore.md#kb-146-gmail-oauthがdropboxトークンを上書きしdropboxバックアップが失敗するトークン分離で恒久対策) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) を参照。

### 🆕 最新アップデート（2026-01-05）

- **✅ WebRTCビデオ通話機能 実装・実機検証完了**: キオスク通話（`/kiosk/call`）でPi4↔Macの音声通話・ビデオ通話の実機検証を完了し、機能が完成。**音声通話**：双方向発信/受話、マイク無し端末でのrecvonlyモード対応、60秒以上の通話維持を確認。**ビデオ通話**：片側のみビデオON、両側ビデオON、ビデオON/OFFの切り替えを確認。**長時間接続**：WebSocket keepalive（30秒ping/pong）により5分以上の通話を安定維持。実装過程で発生した問題と解決策をナレッジベースに詳細記録（KB-132〜141）。詳細は [guides/webrtc-verification.md](./guides/webrtc-verification.md) / [knowledge-base/api.md#kb-132](./knowledge-base/api.md#kb-132-webrtcシグナリングルートのダブルプレフィックス問題) / [knowledge-base/frontend.md#kb-136](./knowledge-base/frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題) / [knowledge-base/infrastructure/docker-caddy.md#kb-141](./knowledge-base/infrastructure/docker-caddy.md#kb-141-caddyがすべてのapi要求にwebsocketアップグレードヘッダーを強制する問題) を参照。

### 🆕 最新アップデート（2026-01-04）

- **✅ WebRTC通話（音声）実機検証・安定化**: キオスク通話（`/kiosk/call`）でPi4↔Macの音声通話の実機検証を実施。WebSocketシグナリング、offer/answer/ICE交換、接続維持を確認。マイク権限周りの切断問題に対して、マイク未接続端末でも受信専用（recvonly）で接続を継続するフォールバックを追加。手順は [guides/webrtc-verification.md](./guides/webrtc-verification.md) を参照。

- **✅ Pi5ストレージ経時劣化対策（10年運用対応）完了**: Pi5のストレージ使用量が27%（約270GB）と異常に高い問題を調査・解決。Docker Build Cache（237.2GB）とsignage-renderedの履歴画像（約6.2GB）を削除し、ディスク使用量を249GB→23GB（約226GB削減、27%→3%）に改善。さらに、10年運用を見据えた自動メンテナンス機能を実装。`storage-maintenance.sh`スクリプトを追加し、systemd timerで毎日実行（signage履歴画像削除、月1回build cache削除）。`monitor.sh`のディスク閾値を段階化（50%警告、70%警告、80%アラート、90%クリティカル）。`signage-render-storage.ts`を修正し、履歴画像をデフォルトで生成しないように変更（`SIGNAGE_RENDER_KEEP_HISTORY=1`で有効化可能）。Ansibleで`storage-maintenance.service/timer`を管理化。実機検証完了（APIコンテナ正常動作、storage-maintenance.timer有効化、ストレージ使用量3%維持を確認）。詳細は [knowledge-base/infrastructure/miscellaneous.md#kb-130](./knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) / [knowledge-base/api.md#kb-131](./knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題) / [guides/operation-manual.md](./guides/operation-manual.md) を参照。

- **✅ APIコンテナ再起動ループ問題修正完了**: APIコンテナが`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`環境変数の空文字でZodバリデーションエラーを起こし、再起動ループに陥っていた問題を修正。`docker-compose.server.yml`の`${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}`により未設定時でも空文字が注入されるため、`z.preprocess`で空文字を`undefined`に変換してからURL検証するように変更。実機検証完了（APIコンテナが正常起動、ヘルスチェック200、サイネージ画像取得正常を確認）。詳細は [knowledge-base/api.md#kb-131](./knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題) を参照。

- **✅ Pi5サーバー側のstatus-agent設定をAnsible管理化完了**: Pi5サーバー側のstatus-agent設定が手動設定のままで、設定のドリフトが発生していた問題を解決。Pi5に`status_agent_client_id`、`status_agent_client_key`などのホスト変数を追加（`inventory.yml`）。Pi5用vaultに`vault_status_agent_client_key`を追加（`host_vars/raspberrypi5/vault.yml`）。serverロールに`status-agent.yml`タスクを追加（設定ファイル配布、systemdユニット配布、タイマー有効化）。`main.yml`から`status-agent.yml`をインポート。Ansible実行時に自動的に設定ファイルが更新されるように改善。設定のドリフトを防止し、自動更新が可能になった。実機検証完了（設定ファイルが正しく生成、systemdサービスが正常動作、データベースに最新データが記録されることを確認）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-129](./knowledge-base/infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま) / [guides/status-agent.md](./guides/status-agent.md) を参照。

### 🆕 最新アップデート（2026-01-03）

- **✅ Pi3サイネージ正常化作業完了**: Pi3のサイネージ画面が旧デザイン（「工具管理データ」タイトル、温度表示なし）のままだった問題を解決。Pi5のTSソース（`signage.renderer.ts`）が旧い実装のままだったため、正しい実装（「持出中アイテム」＋`getClientSystemMetricsText()`）を反映し、APIコンテナを`--no-cache`で再ビルドして正常化完了。DEBUG MODEのNDJSONログでrepo/コンテナの不一致を検出し、修正前後のログ比較で正常化を確認。Pi3のサイネージ画面で「持出中アイテム」タイトルと温度表示（`CPU xx% Temp yy.y°C`）が正常に表示されることを確認済み。詳細は [knowledge-base/infrastructure/signage.md#kb-127](./knowledge-base/infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) / [investigation/temperature-display-investigation.md](./investigation/temperature-display-investigation.md) を参照。

- **✅ キオスク・サイネージUIで自端末の温度表示機能追加・実機検証完了**: キオスクUI（Pi4）とサイネージUI（Pi3）で自端末の温度を表示する機能を実装し、実機検証を完了。`ClientDevice.statusClientId`フィールドを追加し、`x-client-key`と`status-agent`の`clientId`を紐づけ。`GET /api/kiosk/config`エンドポイントを拡張し、`clientStatus`を返却。サイネージレンダラーで`getClientSystemMetricsText()`を実装し、Pi3の温度を取得して画像に埋め込む。サイネージ左ペインのタイトルを「工具管理データ」→「持出中アイテム」に変更。実機検証でPi4のキオスクUIで自端末の温度が正しく表示されることを確認済み。詳細は [knowledge-base/api.md#kb-126](./knowledge-base/api.md#kb-126-キオスクuiで自端末の温度表示機能追加) / [knowledge-base/infrastructure/signage.md#kb-127](./knowledge-base/infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) / [investigation/temperature-display-investigation.md](./investigation/temperature-display-investigation.md) を参照。

- **✅ APIエンドポイントのHTTPS化・デプロイ標準手順のブラッシュアップ完了**: APIエンドポイントをHTTPS経由（Caddy経由）に変更し、デプロイ標準手順をブラッシュアップ。`group_vars/all.yml`の`api_base_url`を`http://{{ server_ip }}:8080/api`から`https://{{ server_ip }}/api`に変更。クライアント（Pi3/Pi4）のエージェントがCaddy経由（HTTPS 443）でAPIにアクセスするように統一。ポート8080は外部公開されていない（Docker内部ネットワークでのみアクセス可能）ことを明記。デプロイドキュメントを更新し、HTTPS経由での確認方法を追加。セキュリティ強度が向上（HTTPS化、8080非公開の維持）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-128](./knowledge-base/infrastructure/ansible-deployment.md#kb-128-apiエンドポイントのhttps化caddy経由) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ キオスクお問い合わせフォームのデザイン変更・実機検証完了**: キオスクUIのお問い合わせフォームを改善し、実機検証を完了。送信者を社員名簿から選択するドロップダウンに変更し、依頼内容を「現場まで来てください。」のドロップダウンに変更。打合せ日時の選択フィールド（日付・時刻）を追加し、デフォルト値として現在の日時を設定。キオスク専用の従業員リスト取得エンドポイント（`/api/kiosk/employees`）を追加し、`x-client-key`認証のみでアクセス可能に。実機検証でフォームの各フィールドが正常に動作することを確認済み。詳細は [knowledge-base/api.md#kb-125](./knowledge-base/api.md#kb-125-キオスク専用従業員リスト取得エンドポイント追加) / [knowledge-base/frontend.md#kb-125](./knowledge-base/frontend.md#kb-125-キオスクお問い合わせフォームのデザイン変更) / [guides/verification-checklist.md#69-キオスクサポート機能slack通知](./guides/verification-checklist.md#69-キオスクサポート機能slack通知) を参照。

- **✅ キオスクSlackサポート機能実装・実機検証完了**: キオスクUIから管理者への問い合わせ機能（Slack通知）を実装し、実機検証を完了。キオスク画面ヘッダーに「お問い合わせ」ボタンを追加し、モーダルから問い合わせ内容を送信可能に。Slack Incoming Webhookを使用して通知を送信し、同時に既存のクライアントログとして保存。レート制限（1分に3件）とセキュリティ対策（Webhook URLの秘匿、タイムアウト処理）を実装。実機検証でSlack通知送信、ClientLog記録、APIログの正常動作をすべて確認済み。詳細は [knowledge-base/api.md#kb-124](./knowledge-base/api.md#kb-124-キオスクslackサポート機能の実装と実機検証完了) / [guides/verification-checklist.md#69-キオスクサポート機能slack通知](./guides/verification-checklist.md#69-キオスクサポート機能slack通知) / [guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md) を参照。

- **✅ Gmail経由CSV取り込み（手動実行）の実機検証完了**: Gmail経由でのCSVファイル自動取り込み機能の手動実行での実機検証を完了。Gmail検索・取得処理、CSVインポート処理、エラーハンドリングがすべて正常に動作することを確認。`GmailStorageProvider`が仕様通りに動作し、メールのアーカイブ処理も正常に機能。PowerAutomate設定後、スケジュール実行でのE2E検証を実施予定。詳細は [knowledge-base/api.md#kb-123](./knowledge-base/api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了) / [guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証](./guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証) を参照。

- **✅ 計測機器管理画面の部署表示・編集機能の実機検証完了**: 計測機器管理画面に`department`列と選択式編集機能を追加し、実機検証を完了。一覧表への部署列表示、新規作成フォームでの部署選択フィールド表示、部署候補の動的取得、部署の保存・更新がすべて正常に動作することを確認。詳細は [knowledge-base/api.md#kb-121](./knowledge-base/api.md#kb-121-部署一覧取得エンドポイント追加とprisma-where句の重複プロパティエラー修正) / [knowledge-base/frontend.md#kb-122](./knowledge-base/frontend.md#kb-122-計測機器管理画面にdepartment表示編集機能を追加) / [guides/verification-checklist.md#662-計測機器管理画面](./guides/verification-checklist.md#662-計測機器管理画面admintoolsmeasuring-instruments) を参照。

### 🆕 最新アップデート（2025-01-XX）

- **✅ 吊具CSVインポート検証完了・レイアウト改善**: 吊具CSVインポート（新フィールド`usableYears`）の検証を完了し、すべて正常に動作することを確認。吊具管理画面のレイアウトを改善し、一覧表と編集フォームが重ならないように修正。編集フォームを別のCardとして分離し、縦配置に変更。編集フォーム内のフィールドを2列のグリッドレイアウトに変更し、より使いやすく改善。実機検証でCSVインポート成功、`usableYears`フィールドの保存・表示・編集をすべて確認済み。詳細は [knowledge-base/frontend.md#kb-120](./knowledge-base/frontend.md#kb-120-吊具管理画面のレイアウト改善一覧表と編集フォームの重なり解消) / [guides/verification-checklist.md#64-吊具csvインポート新フィールド](./guides/verification-checklist.md#64-吊具csvインポート新フィールド) / [guides/verification-checklist.md#663-吊具管理画面](./guides/verification-checklist.md#663-吊具管理画面admintoolsrigging-gears) を参照。

- **✅ 計測機器UID編集時のバグ修正完了**: 計測機器のUIDを手動編集しても反映されない問題を修正。根本原因は1つの計測機器に複数の`MeasuringInstrumentTag`が紐づいていたこと。APIの`update`メソッドで既存タグをすべて削除してから新しいタグを1つ作成するように修正し、1対1の関係を保つように改善。フロントエンドでは`useRef`を使用して手動編集フラグを追加し、ユーザーの手動編集を`useEffect`の自動更新で上書きしないように修正。デバッグモードでランタイム証拠を収集し、根本原因を正確に特定。実機検証でUID編集が正常に反映されることを確認済み。詳細は [knowledge-base/api.md#kb-118](./knowledge-base/api.md#kb-118-計測機器uid編集時の複数タグ問題の修正) / [knowledge-base/frontend.md#kb-119](./knowledge-base/frontend.md#kb-119-計測機器uid編集時の手動編集フラグ管理) / [guides/verification-checklist.md#63-計測機器csvインポート新フィールド](./guides/verification-checklist.md#63-計測機器csvインポート新フィールド) を参照。

- **✅ CSVインポート構造改善と計測機器・吊具対応完了（CSV Import Scalingプラン完了）**: CSVインポート機能をレジストリ・ファクトリパターンでモジュール化し、計測機器・吊具のCSVインポートに対応。新しいデータタイプの追加が容易になり、コードの重複を削減。スケジュール設定を`targets`配列形式に拡張し、複数のデータタイプを1つのスケジュールで処理可能に。後方互換性を確保（旧`employeesPath`/`itemsPath`形式もサポート）。`replaceExisting=true`時の安全性を確保（参照がある個体は削除しない）。Gmail件名パターンを管理コンソールから編集できる機能を実装し、設定ファイル（`backup.json`）に保存されるように変更。**プラン完了日**: 2025-12-29（全6To-do完了）。詳細は [guides/csv-import-export.md](./guides/csv-import-export.md) / [knowledge-base/frontend.md#kb-112](./knowledge-base/frontend.md#kb-112-csvインポート構造改善と計測機器吊具対応) / [knowledge-base/frontend.md#kb-113](./knowledge-base/frontend.md#kb-113-gmail件名パターンの管理コンソール編集機能) / [knowledge-base/api.md#kb-114](./knowledge-base/api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) / [knowledge-base/api.md#kb-115](./knowledge-base/api.md#kb-115-gmail件名パターンの設定ファイル管理) を参照。

### 🆕 最新アップデート（2025-12-29）

- **✅ CSVインポートスケジュールページのUI統一・表示改善完了**: CSVインポートスケジュールページの日付指定UIをバックアップペイン（`BackupTargetForm.tsx`）と同じUIに統一。時刻入力（`type="time"`）と曜日選択ボタンを使用し、UI形式からcron形式への変換関数を実装。スケジュール表示を人間が読みやすい形式に変更（cron形式 `0 4 * * 1,2,3` → 「毎週月曜日、火曜日、水曜日の午前4時」）。デプロイ標準手順の遵守を徹底し、現在のブランチを使用するように修正。詳細は [knowledge-base/frontend.md#kb-109](./knowledge-base/frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) / [knowledge-base/frontend.md#kb-111](./knowledge-base/frontend.md#kb-111-csvインポートスケジュールの表示を人間が読みやすい形式に変更) / [knowledge-base/infrastructure/ansible-deployment.md#kb-110](./knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Gmailデータ取得機能実装完了**: PowerAutomateからGmail経由でCSVファイルやJPEGファイルをPi5に送信し、自動的にインポートする機能を実装完了。OAuth 2.0認証によるセキュアな認証フローを実装し、管理画面からGmail設定を管理できるUIを実装。Tailscale DNSをオフにした場合の`/etc/hosts`設定スクリプトを作成し、Gmail OAuth認証が正常に完了（refresh token取得済み）。GmailとDropboxのトークンリフレッシュの違いを明確化（Gmailは自動リフレッシュ、Dropboxは手動リフレッシュ）。詳細は [plans/gmail-data-acquisition-execplan.md](./plans/gmail-data-acquisition-execplan.md) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) / [knowledge-base/infrastructure/backup-restore.md#kb-108](./knowledge-base/infrastructure/backup-restore.md#kb-108-gmail-oauth認証時のtailscale-dns解決問題とetchosts設定) を参照。

### 🆕 最新アップデート（2025-12-29）

- **✅ バックアップエラーハンドリング改善完了**: Dropboxストレージプロバイダーの`download`と`delete`メソッドに、レート制限エラー（429）とネットワークエラー時のリトライ機能を追加。指数バックオフによるリトライロジック（最大5回、最大30秒）を実装。レート制限エラーや一時的なネットワークエラーが発生した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上。詳細は [guides/backup-error-handling-improvements.md](./guides/backup-error-handling-improvements.md) / [knowledge-base/infrastructure/backup-restore.md#kb-107](./knowledge-base/infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善) を参照。

- **✅ バックアップスクリプトとの整合性確認完了**: `scripts/server/backup.sh`スクリプトと管理コンソールのバックアップ機能の整合性を確認。`/api/backup/internal`エンドポイントが存在し、localhostからのアクセスのみ許可されていることを確認。バックアップスクリプトが使用する`kind`と`source`の組み合わせが管理コンソールと一致していることを確認。両方の方法で同じ設定ファイル（`backup.json`）が使用され、バックアップ履歴が正しく記録されることを確認。詳細は [guides/backup-script-integration-verification.md](./guides/backup-script-integration-verification.md) / [knowledge-base/infrastructure/backup-restore.md#kb-106](./knowledge-base/infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認) を参照。

- **✅ 実機検証完了（画像バックアップ・items.csv）**: 画像バックアップのリストア検証を完了。`tar.gz`形式のバックアップを正常に展開・復元することを確認。items.csvのバックアップ・リストア検証も完了。バリデーションエラーはデータの問題（`ITEM-XXX`形式が`TOXXXX`形式に適合しない）であり、リストア機能自体は正常動作していることを確認。詳細は [guides/backup-restore-verification-results.md](./guides/backup-restore-verification-results.md) / [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) を参照。

### 🆕 最新アップデート（2025-12-19）

- **✅ バックアップロジックのアーキテクチャ改善完了**: Factoryパターンとレジストリパターンを実装し、コード重複を完全に解消。新しいバックアップターゲット追加時の修正箇所が7箇所から2箇所に削減（約71%削減）。`BackupTargetFactory`と`StorageProviderFactory`を追加し、リストアロジックを各ターゲットに分離。設定ファイルによるパスマッピング管理を実装。`backup-scheduler.ts`に`client-file`ケースを追加して設定と実装の整合性を確保。リンター0エラー、ユニットテスト16/16成功。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md#phase-7-バックアップロジックのアーキテクチャ改善--完了) / [guides/backup-configuration.md](./guides/backup-configuration.md) を参照。

- **✅ Ansibleによるクライアント端末バックアップ機能実装完了**: クライアント端末（Pi4、Pi3など）のファイルは物理的に別マシン上に存在するため、Pi5（サーバー）のAPIから直接アクセスできない問題を解決するため、Ansibleを使用してクライアント端末のファイルをPi5に取得してバックアップする機能を実装完了。Ansibleのinventoryでクライアント端末を管理し、スケーラブルに対応。実装時にAnsibleとTailscaleの連携で問題が発生したが、`hosts: "{{ client_host }}"`への変更とSSH鍵のマウントにより解決。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) / [knowledge-base/infrastructure/backup-restore.md#kb-102](./knowledge-base/infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照。

- **✅ 画像バックアップリストア処理追加**: 画像バックアップは`tar.gz`形式で保存されるが、リストア時に展開処理がなかった問題を修正。`/api/backup/restore/from-dropbox`と`/api/backup/restore`エンドポイントに画像バックアップのリストア処理を追加。`tar.gz`を展開して写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元。既存ディレクトリの自動バックアップ機能も追加。ドキュメントを更新して画像バックアップのリストア手順を明記。詳細は [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) / [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) を参照。

### 🆕 最新アップデート（2025-12-18）

- **✅ バックアップ対象管理UI実装完了**: 管理コンソールの「バックアップ」タブからバックアップ対象（`targets`）を管理できる機能を実装完了。バックアップ対象の追加・編集・削除、有効/無効切り替え、手動バックアップ実行が可能。`backup.sh`スクリプトと管理コンソールの機能が整合性を保ち、設定ファイル（`backup.json`）の変更が即座に反映される。統合テスト・E2Eテストも実装済み。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) / [guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) を参照。

- **✅ 標準セキュリティチェックリスト監査完了**: IPA「安全なウェブサイトの作り方」、OWASP Top 10 2021、CISベンチマークに基づく監査を実施。主要なセキュリティ対策がほぼ完了していることを確認。未実施項目（CSRF対策、PostgreSQLのSSL/TLS接続強制、パスワードポリシー強化など）と必要性を評価。詳細は [security/standard-security-checklist-audit.md](./security/standard-security-checklist-audit.md) を参照。

- **✅ ポートセキュリティ強化（追加）完了**: Docker Composeのポートマッピング削除により、PostgreSQL（5432）とAPI（8080）のポートをDocker内部ネットワークでのみアクセス可能に（UFW依存を低減）。加えて、Pi5上の不要サービス（rpcbind/avahi/exim4/cups）をstop+disable+maskしてLISTEN自体を削減し、`ports-unexpected` を「外部露出 + プロセス込み」で有意にした。ベースライン証跡を保存。詳細は [security/port-security-audit.md](./security/port-security-audit.md) / [security/port-security-verification-results.md](./security/port-security-verification-results.md) / [knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ](./knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ) / [knowledge-base/infrastructure/ports-baseline-20260118.md](./knowledge-base/infrastructure/ports-baseline-20260118.md) を参照。

### 🆕 最新アップデート（2025-12-17）

- **✅ UI視認性向上カラーテーマ実装完了（Phase 1-8）**: 工場現場での視認性を向上させるため、提案3（工場現場特化・高視認性テーマ）を採用し、管理コンソール、サイネージ、キオスクのカラーテーマを改善完了。主要ページ（統合一覧、アイテム一覧、キオスク返却画面、サイネージレンダラー、管理コンソール全ページ、工具管理全ページ）に提案3カラーパレットを適用。コントラスト比約21:1（WCAG AAA準拠）を達成。詳細は [requirements/ui-visibility-color-theme.md](./requirements/ui-visibility-color-theme.md) / [modules/tools/README.md](./modules/tools/README.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Dropbox CSVインポート Phase 3完全検証・ベストプラクティス実装完了**: Phase 3の必須検証（実際のデータファイルを使用したエンドツーエンドテスト、エラーハンドリングテスト）を完了。ベストプラクティス実装（バックアップ履歴の記録機能、リストアAPIのパス処理改善）も完了。すべての検証項目が正常に動作することを確認し、本番運用可能な状態に到達。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/phase3-complete-verification-summary.md](./guides/phase3-complete-verification-summary.md) / [guides/phase3-mandatory-verification-results.md](./guides/phase3-mandatory-verification-results.md) / [guides/phase3-error-handling-test-results.md](./guides/phase3-error-handling-test-results.md) / [guides/phase3-next-tasks.md](./guides/phase3-next-tasks.md) を参照。

### 🆕 最新アップデート（2025-12-16）

- **✅ Dropbox CSVインポート Phase 3実装完了**: CSVインポート後の自動バックアップ機能、Dropboxからの自動リストア機能、バックアップ・リストア履歴機能を実装完了。`BackupHistory`モデル追加、`BackupHistoryService`実装、`BackupVerifier`による整合性検証機能、バックアップ履歴APIエンドポイント追加を完了。CIテストもすべて成功（BackupVerifier 12件、自動バックアップ機能 21件、バックアップAPI統合テストすべて成功）。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ Dropbox CSVインポート Phase 1/2補完タスク完了**: Phase 1補完として認可設定確認（mustBeAdmin適用、rateLimit設定）、大規模CSV性能テスト（1000行・10000行）、テスト独立性の問題修正を完了。Phase 2補完としてPowerAutomate側仕様のドキュメント化（`docs/guides/powerautomate-dropbox-integration.md`）、PowerAutomate未配置時のリトライ/アラート確認テスト追加、履歴APIフィルタ/ページング機能実装を完了。CIテストもすべて成功（192 passed, 21 passed, 14 passed, 18 passed, 24 passed, 4 passed）。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/powerautomate-dropbox-integration.md](./guides/powerautomate-dropbox-integration.md) を参照。

- **✅ Dropbox CSVインポート Phase 2 実機検証完了**: Phase 2の実機検証を完了。スケジュールAPI（CRUD）、手動実行API、CsvImportScheduler、ImportHistoryService（履歴記録）、ImportAlertService（アラート生成）のすべてが正常に動作することを確認。Dockerfile.apiにscriptsディレクトリを追加し、アラート生成機能も正常動作を確認。KB-101としてPi5へのSSH接続不可問題（force pushの影響）も記録。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [knowledge-base/infrastructure/ansible-deployment.md#kb-101](./knowledge-base/infrastructure/ansible-deployment.md#kb-101-pi5へのssh接続不可問題の原因と解決) を参照。

### 🆕 最新アップデート（2025-12-15）

- **✅ Dropbox CSVインポート Phase 2 実装完了**: Phase 2のスケジュール実行機能の実装とCI統合が完了。csv-import-scheduler（10件）、imports-schedule（13件）、import-alert（4件）の合計27件のテストがCIで実行され、すべて成功。ImportHistoryServiceの有効化とPrismaマイグレーション実行も完了（ローカル・実機の両方）。CsvImportHistoryテーブルが作成され、インポート履歴の記録機能が利用可能に。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/csv-import-history-migration.md](./guides/csv-import-history-migration.md) を参照。

- **✅ Dropbox CSVインポート Phase 1 実装完了**: DropboxからCSVファイルをダウンロードしてインポートする機能を実装完了。パストラバーサル防止、バリデーション強化、ログ出力、エラーハンドリング、追加テスト（13件すべてパス）を実装。CI必須化（`continue-on-error`削除）とブランチ保護設定ガイドも作成。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/ci-branch-protection.md](./guides/ci-branch-protection.md) を参照。

- **✅ Dropbox OAuth 2.0フローとリフレッシュトークン自動更新機能実装・実機検証完了**: OAuth 2.0認証フロー、リフレッシュトークンによる自動アクセストークン更新機能を実装完了し、実機検証も完了。401エラー（`expired_access_token`）時に自動的にリフレッシュし、設定ファイルを自動更新。テストも実装済み（10件すべてパス）。実機検証では、Docker Composeのconfigボリューム読み書き権限問題（KB-099）を解決し、OAuth認証フロー、リフレッシュトークン更新、ファイルバックアップの動作を確認済み。詳細は [plans/backup-modularization-execplan.md](./plans/backup-modularization-execplan.md) / [guides/dropbox-oauth-setup-guide.md](./guides/dropbox-oauth-setup-guide.md) / [guides/dropbox-oauth-verification-checklist.md](./guides/dropbox-oauth-verification-checklist.md) / [knowledge-base/infrastructure/backup-restore.md#kb-099](./knowledge-base/infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題) を参照。

### 🆕 最新アップデート（2025-12-14）

- **✅ Phase 9/10 セキュリティ強化完了**: インターネット接続時の追加防御（Phase 9）と認証・監視強化（Phase 10）を実装完了。管理画面IP制限、Webhookアラート通知、セキュリティヘッダー（Strict-Transport-Security含む）、DDoS/ブルートフォース緩和（レート制限）、MFA（多要素認証）、リアルタイム監視強化、権限監査を実装。実機テストも完了し、ローカルネットワークとインターネットの両環境で安全に運用可能。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) / [security/phase9-10-specifications.md](./security/phase9-10-specifications.md) / [security/implementation-assessment.md](./security/implementation-assessment.md) を参照。

- **📊 外部インシデント評価と追加対策**: アスクル社ランサムウェア事故を踏まえた対応可否と推奨対策（MFA、リアルタイム監視、権限監査）を実装完了。詳細は [security/implementation-assessment.md](./security/implementation-assessment.md) を参照。

### 🆕 最新アップデート（2025-12-13）

- **✅ サイネージデザイン改善（レイアウト/座標再調整）**: サーバー側レンダラーで余白を最小化しつつ、右ペインのタイトル・ファイル名とPDF表示領域の重なりを解消。外枠余白を極小化、タイトル・ファイル名のベースラインオフセットを揃え、PDFの黒地を拡大。詳細は [modules/signage/README.md](./modules/signage/README.md) / [knowledge-base/infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない](./knowledge-base/infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない) を参照。

- **✅ サイネージタブ内にPDFアップロード機能を統合**: 管理コンソールの「サイネージ」タブ（`/admin/signage/schedules`）にPDFアップロード・管理機能を追加。スケジュール設定画面と同じページでPDFをアップロード・管理できるようになり、ワークフローが改善されました。`SignagePdfManager`コンポーネントを新規作成して共通化し、サイネージタブとクライアント端末管理ページの両方で使用可能に。詳細は [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2025-12-12）

- **✅ Ansibleデプロイのブランチ指定機能追加**: `scripts/update-all-clients.sh`とAnsibleの`deploy.yml`でブランチを指定可能に。デフォルトは`main`ブランチ。開発ブランチ（`feature/production-deployment-management`）のハードコードを削除し、環境変数`ANSIBLE_REPO_VERSION`または引数でブランチを指定可能に。`scripts/update-all-clients.sh <branch> <inventory_path>`で全デバイス（Pi5 + Pi3/Pi4）を更新可能（**誤デプロイ防止のためinventory指定は必須**）。詳細は [guides/deployment.md](./guides/deployment.md) / [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) を参照。

- **✅ デプロイメントベストプラクティスの明確化**: 開発時（Pi5のみ）は`scripts/server/deploy.sh <branch>`、運用時（全デバイス）は`scripts/update-all-clients.sh <branch> <inventory_path>`を使用する使い分けをドキュメント化。デフォルトは`main`ブランチで、開発ブランチをハードコードしない設計に統一。詳細は [guides/deployment.md](./guides/deployment.md) を参照。

- **🆕 network_mode戻り・ローカルIP変動への対策**: git syncで`network_mode`が`local`へ戻る事象（KB-094）を踏まえ、デプロイ前だけでなくヘルスチェック前にも再確認する運用を追加。ローカルIPは毎回`hostname -I`で取得し`group_vars/all.yml`を更新するよう明記。キオスク向けヘルスチェックから`signage-lite`チェックを除外。詳細: [guides/deployment.md](./guides/deployment.md), [knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題](./knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題), [infrastructure/ansible/playbooks/health-check.yml](../infrastructure/ansible/playbooks/health-check.yml)

- **✅ 吊具管理モジュール 1stリリース**: Prismaスキーマ/CRUD/API/管理コンソール/キオスクを追加。吊具タグ→従業員タグで持出登録し、成功時は`defaultMode`に従い自動遷移（計測機器と同等UX）。管理コンソールでUID登録・編集・削除（空文字で削除指示）、点検記録の簡易登録、一覧にUID列を追加。UIを横幅拡大・非折返しに調整。詳細は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **✅ NFC/UIDハンドリングの共通化**: 管理コンソール（計測機器・吊具）でNFCスキャン自動入力を復旧し、UID入力欄を空にして保存するとタグ紐付けを削除する仕様に統一。計測機器タブのスキャン不能/削除不可事象を解消。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ キオスク→管理コンソール遷移の強制ログイン**: キオスクヘッダーの「管理コンソール」ボタンを`/login?force=1`遷移に変更し、既ログインでも必ず再認証を実施。戻り先は`/admin`を維持。関連: `KioskLayout.tsx` / `LoginPage.tsx`。

### 🆕 最新アップデート（2025-12-11）

- **✅ 管理コンソール: 計測機器のNFCタグ登録欄を追加**: 計測機器の登録/編集フォームに「NFC/RFIDタグUID」入力欄を追加し、保存時にタグ紐付けを同時登録（重複UIDは409で拒否）。既存のRFIDタグ管理ページも併用可能。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ キオスクUI簡素化: 返却タブ削除**: 機能重複のため「返却」「計測機器 返却」の2タブを削除し、「持出」「計測機器 持出」の2タブ構成に統一。持出画面の持出一覧から工具・計測機器の両方を返却可能。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ サイネージ左ペインの計測機器表示改善**: Pi3サイネージの工具データ左ペインで、計測機器の持出アイテムを藍系背景で表示し、管理番号を上段・名称を下段に2行表示。工具と計測機器を視覚的に識別可能に。バックエンド（`signage.service.ts`）とレンダラー（`signage.renderer.ts`）を修正。詳細は [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ 持出一覧キオスクUI改善**: 計測機器は「管理番号＋名称」を2行表示し、背景色を藍系に変更して工具と識別。写真持出は **「撮影mode」**（2026-03-26 以降。共有定数 `PHOTO_LOAN_CARD_PRIMARY_LABEL`）を表示し、端末場所は **ラベルなしで値のみ**。「アイテム情報なし」は非表示。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) / [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md) / [KB-314](./knowledge-base/KB-314-kiosk-loan-card-display-labels.md) を参照。
- **✅ 持出一覧カード: 返却・取消ボタン下段配置（2026-04-01）**: 長いアイテム名がボタン列と横方向に競合しにくいよう、`KioskActiveLoanCard` に分離し **明細の下**に **返却・取消**を配置。画像モーダル用 Blob URL は入替・アンマウント時に `revoke`。詳細は [KB-323](./knowledge-base/KB-323-kiosk-return-card-button-layout.md) / [verification-checklist.md](./guides/verification-checklist.md) §6.6.4 / [deployment-modules.md](./architecture/deployment-modules.md) を参照。

- **✅ 計測機器持出: エラー時の無限ループ修正とメッセージ改善**: エラー発生時に持出登録ボタンが無限ループ動作する問題を修正。エラー時に氏名タグをクリアして自動再送を防止し、APIエラーメッセージを短縮・ユーザーフレンドリーに改善（「タグ未登録（計測機器）」「タグ未登録（社員）」「既に貸出中です」など）。詳細は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題9-エラー時に持出登録ボタンが無限ループ動作する) を参照。

- **✅ NFC/カメラ入力のスコープ分離: 実装完了**: 計測機器モードでの氏名タグスキャン直後にPHOTOモードが誤発火する問題を解決。`useNfcStream`フックに`enabled`フラグと`enabledAt`タイムスタンプを追加し、ページ遷移前のイベントを無視。各キオスクページで`useMatch`を使用して、アクティブなページの時のみNFC購読を有効化。詳細は [plans/nfc-stream-isolation-plan.md](./plans/nfc-stream-isolation-plan.md) を参照。

- **計測機器キオスク: ドロップダウン→氏名タグで自動送信を復旧**: JWT失敗時でも`x-client-key`フォールバック後にHTTP 200へ戻すようAPIを修正し（`apps/api/src/routes/measuring-instruments/index.ts`）、Pi4キオスクで「てこ式ダイヤルゲージ」がドロップダウンに復活。さらに、タグ未登録でもドロップダウン選択＋氏名タグスキャンで自動送信されるようUI条件を緩和（`apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`）。経緯と手順は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題8-ドロップダウン選択時に氏名タグ自動送信されない) と [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **計測機器キオスク: エラーメッセージ/リセット修正**: 古いフロントビルドが配信されていたため最新文言が未反映・リセット不可だった問題を解消。未登録タグ時に「タグ未登録（アイテム/社員）」を表示し、リセットはF5リロードで初期化。手順と原因は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題6-エラーメッセージが古いリセットが効かない) を参照。
- **計測機器キオスク実機検証トラブル対応**: Pi4の`kiosk-launch.sh`が空URLで起動しカメラ/APIが動かない問題を修正。原因と対処・再発防止を [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題5-キオスクブラウザ起動が空urlでカメラapiが動かない) に追記。

- **計測機器管理システム Phase 1-3 実装完了**: データベーススキーマ、バックエンドAPI（CRUD、持ち出し/返却API）、フロントエンドAPI統合、管理コンソールUI（計測機器・点検項目・RFIDタグ・点検記録のCRUDページ）、キオスク持出・返却ページ（手入力対応）を実装完了。TS100統合と点検項目表示・NGボタン機能は未実装。詳細は [modules/measuring-instruments/README.md](./modules/measuring-instruments/README.md) / [requirements/measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **Lint統合 Phase 8 完了**: 契約テスト（API/Web）と破壊的変更検知スナップショットを追加。`pnpm lint --max-warnings=0`/e2e-smoke/e2e-tests/docker-build がCIで成功（run #641）。import/order違反ナレッジをガイドに追加。詳細は [plans/lint-integration-plan.md](./plans/lint-integration-plan.md) / [guides/lint.md](./guides/lint.md) / [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) を参照。

- **デプロイメントモジュール設計**: Tailscale/セキュリティ機能実装後に発生したサイネージ・キオスク機能不全の根本原因を分析し、設定変更を自動検知・影響範囲を自動判定してデプロイする「堅剛なロジック」を設計。4つの独立モジュール（config-detector, impact-analyzer, deploy-executor, verifier）を標準入出力（JSON）で連携する疎結合・モジュール化アーキテクチャ。テスト項目を明確化し、単体・統合・E2Eテストの計画を策定。詳細は [architecture/deployment-modules.md](./architecture/deployment-modules.md) を参照。
- **サイネージUI最終調整**: 左ペインTOOLSを3列化しサムネイルを最大化。右ペインの更新文言を削除。Pi3で再デプロイ済み（`signage-lite`再起動）。
- **キオスクUI統一**: 返却（持出）一覧を5列＋ボタン縦並びに統一。APIキー初期値を管理コンソールと同一に強制し、設定カードを非表示化。Pi4で再起動済み。
- **Phase 8 継続**: サイネージ／キオスク回帰対応を進行中。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) と [KB-080〜085](./knowledge-base/infrastructure.md) を参照。
- **Phase 7 セキュリティ検証完了**: IPアドレス切替、Tailscale経路、UFW/HTTPS、fail2ban、暗号化バックアップ復元、ClamAV/Trivy/rkhunterスキャンを一通り手動検証しました。`alerts/alert-20251205-182352.json`（fail2ban）と `alert-20251205-184324.json`（rkhunter）を生成し、監視ルートの動作も確認済み。複数ローカルネットワーク環境（会社/自宅）でのVNC接続設定も対応済み。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) および [docs/security/requirements.md](./security/requirements.md) を参照してください。ナレッジベース: [KB-078](./knowledge-base/infrastructure/security.md#kb-078-複数ローカルネットワーク環境でのvnc接続設定), [KB-079](./knowledge-base/infrastructure/security.md#kb-079-phase7セキュリティテストの実施結果と検証ポイント)
- **Phase 6 セキュリティ監視・アラート実装完了**: fail2banのBanイベントとマルウェアスキャン結果を自動監視し、管理画面でアラート表示する仕組みを実装しました。`security-monitor.sh`がsystemd timer（15分間隔）で実行され、fail2banログを監視して侵入試行を検知します。ClamAV/Trivy/rkhunterのスキャン結果も自動でアラート化され、感染検知やスキャンエラー時に即座に通知されます。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) を参照してください。ナレッジベース: [KB-076](./knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー), [KB-077](./knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化)
- **Ansibleロール化 & 新`deploy.yml`**: `common/server/client/kiosk/signage` ロールを導入し、メインプレイブックを `playbooks/deploy.yml` に刷新しました。既存の `update-clients.yml` は互換ラッパーとして残しつつ、今後は `ansible-playbook infrastructure/ansible/playbooks/deploy.yml` の利用を推奨します。詳細は [plans/ansible-phase9-role-execplan.md](./plans/ansible-phase9-role-execplan.md) を参照してください。

- **Phase 2.4 実機テスト完了**: クライアント状態可視化とデバッグ支援システムの実機テストを完了しました。Raspberry Pi 5上でstatus-agentを設定・実行し、systemd timerで1分ごとに自動実行されることを確認。管理画面で稼働状況カードが正しく表示され、CPU/メモリ/温度などのメトリクスが更新されることを確認。詳細は [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) を参照してください。
- **システム安定性向上の実装完了**: エラーハンドリングとログ出力の最適化を実装しました。エラーメッセージの詳細化、エラーログの構造化、ログレベルの環境変数制御、Dockerログローテーション設定を完了。詳細は [plans/stability-improvement-plan.md](./plans/stability-improvement-plan.md) を参照してください。ガイドドキュメント: [エラーハンドリングガイド](./guides/error-handling.md), [ログ出力ガイド](./guides/logging.md)
- **サイネージ持出中アイテム表示の改善**: 借用日時を日本標準時（JST）で表示し、12時間超のアイテムを赤色で強調してリストの先頭に配置するように改善しました。アイテムコードのフォントサイズも日時と同じサイズに調整しました。
- **Raspberry Pi 4再起動時のサービス起動ガイド**: [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) を追加。開発中に自動起動を無効化している場合の手動起動手順、Docker Compose推奨方法、Poetry直接起動の問題点と改善案を記載しました。
- **サイネージ自動レンダリングの安定化**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) と [guides/signage-test-plan.md](./guides/signage-test-plan.md) に、`SignageRenderScheduler` の自動実行・管理画面からの手動再レンダリング手順・`SIGNAGE_RENDER_DIR` の設定方法を追記しました。
- **PDFスライド & 工具サムネイル改善**: サイネージの分割表示で PDF スライドショーが必ずページ送りされるようになり、工具サムネイルは 4:3 のまま大型表示に統一されました。詳細は [knowledge-base/api.md](./knowledge-base/api.md#kb-051-サイネージのpdfスライドショーが切り替わらない) / [knowledge-base/api.md#kb-052-sharpのcompositeエラーimage-to-composite-must-have-same-dimensions-or-smaller) を参照してください。
- **軽量クライアントTLS/Troubleshooting**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) に自己署名証明書環境での `curl -k` 設定や初回キャッシュ待機ロジック、`setup-signage-lite.sh` の改善点を追加しました。
- **CPU/温度モニタリング**: 画像レンダリング時に `/proc/stat` と `/sys/class/thermal` を取得し、サイネージヘッダー右上に `CPU xx% / Temp yy.y°C` を表示するようにしました。
- **PDFトリミング問題の解消**: `fit: 'contain'` + 背景色でレターボックス表示に変更し、PDFの縦横比にかかわらず全体が映るようになりました。詳細は [knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される](./knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される) を参照してください。
- **NFCエージェントキュー処理改善**: 工具スキャンが二重登録される問題を解決。オンライン時にイベントを即座に配信し、配信成功したイベントはキューから即時削除するように変更。詳細は [knowledge-base/infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善](./knowledge-base/infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) を参照してください。
- **ナレッジベース更新**: [knowledge-base/index.md](./knowledge-base/index.md) の登録件数が 74件になり、fail2ban連携のセキュリティ監視タイマー（KB-076）とマルウェアスキャン結果の自動アラート化（KB-077）を追加しました。
- **Raspberry Pi status-agent**: クライアント端末が1分毎にメトリクスを送信する `status-agent.py`（systemd timer 同梱）を追加。ガイドは [guides/status-agent.md](./guides/status-agent.md)、ソースは `clients/status-agent/` を参照してください。
- **ローカル環境対応の通知機能**: 管理画面でのアラート表示とファイルベースの通知機能を実装しました。Ansible更新失敗時に自動的にアラートファイルを生成し、管理画面で確認できます。ガイドは [guides/local-alerts.md](./guides/local-alerts.md) を参照してください。
- **Ansible堅牢化・安定化の実装**: `git clean`による設定ファイル削除問題を解決し、システム設定ファイル（polkit設定など）をAnsibleで管理する仕組みを実装しました。バックアップ・ロールバック機能も追加。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。ガイド: [Ansibleで管理すべき設定ファイル一覧](./guides/ansible-managed-files.md)、ナレッジベース: [KB-061](./knowledge-base/infrastructure/ansible-deployment.md#kb-061-ansible実装後の設定ファイル削除問題と堅牢化対策)
- **Ansible設定ファイル管理化の実装**: systemdサービスファイル（kiosk-browser.service、signage-lite.service）とアプリケーション設定ファイル（.env）のAnsible管理化を実装しました。実用段階に到達。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。

### 初めて参加する

| やりたいこと | ドキュメント |
|-------------|-------------|
| プロジェクトの概要を理解したい | [README.md](../README.md) |
| システムアーキテクチャを理解したい | [architecture/overview.md](./architecture/overview.md) |
| 開発環境をセットアップしたい | [guides/development.md](./guides/development.md) |
| **AIアシスタントとして引き継ぐ** | **[guides/ai-handoff.md](./guides/ai-handoff.md)** |

### 開発する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 新機能を追加したい | [guides/development.md](./guides/development.md), [modules/](./modules/) |
| **計測機器管理システムを理解したい** | **[modules/measuring-instruments/README.md](./modules/measuring-instruments/README.md)**, **[requirements/measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md)** |
| **Ansibleロールを追加・修正したい** | **[guides/ansible-role-development.md](./guides/ansible-role-development.md)** |
| APIを理解したい | [api/overview.md](./api/overview.md), [api/auth.md](./api/auth.md) |
| **APIキー統一の方針とフィルタリングロジック** | [guides/api-key-policy.md](./guides/api-key-policy.md) |
| モジュール構造を理解したい | [decisions/001-module-structure.md](./decisions/001-module-structure.md) |
| サービス層を理解したい | [decisions/002-service-layer.md](./decisions/002-service-layer.md) |
| CSVインポート・エクスポートを理解したい | [guides/csv-import-export.md](./guides/csv-import-export.md) |
| **Dropbox CSV統合機能の現状を把握したい** | **[analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md)** |

### デプロイ・運用する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 本番環境にデプロイしたい | [guides/deployment.md](./guides/deployment.md) |
| **デプロイメントモジュール（原因分析・設計・テスト計画）を確認したい** | **[architecture/deployment-modules.md](./architecture/deployment-modules.md)** |
| 本番環境をセットアップしたい | [guides/production-setup.md](./guides/production-setup.md) |
| バックアップ・リストアしたい | [guides/backup-and-restore.md](./guides/backup-and-restore.md) |
| **バックアップ設定を変更したい** | **[guides/backup-configuration.md](./guides/backup-configuration.md)** |
| **バックアップ対象を管理したい** | **[guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md)** / **[requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md)** |
| **バックアップ機能を実機検証したい** | **[guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md)** |
| **外部連携（Dropbox/Gmail/Slack）の設定・運用を管理したい** | **[guides/external-integration-ledger.md](./guides/external-integration-ledger.md)** |
| **Dropbox OAuth 2.0を設定したい** | **[guides/dropbox-oauth-setup-guide.md](./guides/dropbox-oauth-setup-guide.md)** |
| **Dropbox OAuth 2.0を実機検証したい** | **[guides/dropbox-oauth-verification-checklist.md](./guides/dropbox-oauth-verification-checklist.md)** |
| **Slack Webhookを設定したい** | **[guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md)** |
| **Gmail連携を設定したい** | **[guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md)** |
| **CI必須化とブランチ保護設定** | **[guides/ci-branch-protection.md](./guides/ci-branch-protection.md)** |
| 監視・アラートを設定したい | [guides/monitoring.md](./guides/monitoring.md) |
| デジタルサイネージ機能をデプロイしたい | [guides/signage-deployment.md](./guides/signage-deployment.md) |
| デジタルサイネージクライアント端末をセットアップしたい | [guides/signage-client-setup.md](./guides/signage-client-setup.md)（Chromiumモード / `setup-signage-lite.sh` 軽量モード） |
| **サイネージレイアウト設定の実機検証を実施したい** | **[guides/signage-layout-config-verification.md](./guides/signage-layout-config-verification.md)** |
| クライアント端末を一括更新したい | [plans/production-deployment-management-plan.md](./plans/production-deployment-management-plan.md#phase-1-一括更新システムssh--ansible) |
| Ansibleの堅牢化・安定化を実施したい | [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) |
| Ansibleで管理すべき設定ファイルを確認したい | [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) |
| Ansibleエラーハンドリングを確認したい | [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) |
| Ansibleベストプラクティスを確認したい | [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) |
| git cleanの安全な使用方法を確認したい | [guides/git-clean-safety.md](./guides/git-clean-safety.md) |
| クライアント状態監視のExecPlanを確認したい | [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) |
| Raspberry Pi クライアントにSSH鍵を配布したい | [guides/ssh-setup.md](./guides/ssh-setup.md) |
| **Raspberry Pi 4 再起動時のサービス起動** | [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) |
| Raspberry Pi status-agentを導入したい | [guides/status-agent.md](./guides/status-agent.md) |
| **クライアント一括更新と監視のクイックスタート** | [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) |
| **ローカル環境対応の通知機能** | [guides/local-alerts.md](./guides/local-alerts.md) |
|| **新規クライアント端末の初期設定** | [guides/client-initial-setup.md](./guides/client-initial-setup.md) |
|| **Zero 2 W 棚番エッジ（Tailscale・status-agent・断片インベントリ）** | [runbooks/zero2w-tanaban-edge-setup.md](./runbooks/zero2w-tanaban-edge-setup.md) |
|| **MacからRaspberry Pi 5へのSSH接続** | [guides/mac-ssh-access.md](./guides/mac-ssh-access.md) |
|| **Ansible SSH接続アーキテクチャの説明** | [guides/ansible-ssh-architecture.md](./guides/ansible-ssh-architecture.md) |
|| **環境構築ガイド（ローカルネットワーク変更時）** | [guides/environment-setup.md](./guides/environment-setup.md) |
|| **システム自動起動の現状と設定** | [guides/auto-startup-status.md](./guides/auto-startup-status.md) |
|| **クライアント端末のstatus-agent設定（実機テスト用）** | [guides/setup-clients-status-agent.md](./guides/setup-clients-status-agent.md) |

### 検証する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 計測機器キオスク実機検証 | [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md) |
| 機能を検証したい | [guides/verification-checklist.md](./guides/verification-checklist.md) |
| **CSVフォーマット仕様実装を検証したい** | **[guides/verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31](./guides/verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)** |
| **Gmail自動運用プロトコル フェーズ1の実機検証を実施したい** | **[guides/gmail-auto-protocol-phase1-verification.md](./guides/gmail-auto-protocol-phase1-verification.md)** |
| USBインポートを検証したい | [guides/validation-7-usb-import.md](./guides/validation-7-usb-import.md) |
| デジタルサイネージ機能を検証したい | [guides/signage-test-plan.md](./guides/signage-test-plan.md) |
| **CSVダッシュボード可視化機能を検証したい** | **[guides/csv-dashboard-verification.md](./guides/csv-dashboard-verification.md)** |
| **計測機器持出返却イベント機能を検証したい** | **[guides/measuring-instrument-loan-events-verification.md](./guides/measuring-instrument-loan-events-verification.md)** |
| システム安定性向上機能を検証したい | [guides/stability-improvement-test.md](./guides/stability-improvement-test.md) |
| セキュリティを検証したい | [security/validation-review.md](./security/validation-review.md) |
| **セキュリティ要件を確認したい** | **[security/requirements.md](./security/requirements.md)** |
| **セキュリティ強化の実装計画を確認したい** | **[plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md)** |
| **Phase 9/10 セキュリティ機能の詳細仕様を確認したい** | **[security/phase9-10-specifications.md](./security/phase9-10-specifications.md)** |
| **セキュリティ強化のテスト計画を確認したい** | **[guides/security-test-plan.md](./guides/security-test-plan.md)** |
| **インシデント対応手順を確認したい** | **[security/incident-response.md](./security/incident-response.md)** |
| **外部インシデント評価と追加対策** | **[security/implementation-assessment.md](./security/implementation-assessment.md)** |
| **システム担当者向けセキュリティプレゼン資料** | **[presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md)** |
| **IPアドレス管理の変数化について知りたい** | **[knowledge-base/infrastructure/ansible-deployment.md#kb-069](./knowledge-base/infrastructure/ansible-deployment.md#kb-069)** |
| **運用モード可視化について知りたい** | **[knowledge-base/infrastructure/miscellaneous.md#kb-070](./knowledge-base/infrastructure/miscellaneous.md#kb-070)** |
| **Tailscale導入について知りたい** | **[knowledge-base/infrastructure/security.md#kb-071](./knowledge-base/infrastructure/security.md#kb-071)** |
| **ファイアウォール/HTTPS強化について知りたい** | **[knowledge-base/infrastructure/security.md#kb-072](./knowledge-base/infrastructure/security.md#kb-072)** |
| **fail2ban設定について知りたい** | **[knowledge-base/infrastructure/security.md#kb-073](./knowledge-base/infrastructure/security.md#kb-073)** |
| **Pi5のマルウェア対策を確認したい** | **[knowledge-base/infrastructure/security.md#kb-074](./knowledge-base/infrastructure/security.md#kb-074)** |
| **Pi4キオスクの軽量マルウェア対策を確認したい** | **[knowledge-base/infrastructure/security.md#kb-075](./knowledge-base/infrastructure/security.md#kb-075)** |
| **fail2ban連携のセキュリティ監視を確認したい** | **[knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー](./knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー)** |
| **マルウェア検知アラート化について知りたい** | **[knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化](./knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化)** |

### エラーを解決する

| やりたいこと | ドキュメント |
|-------------|-------------|
| セキュリティインシデントに対応したい | [security/incident-response.md](./security/incident-response.md) |
| トラブルシューティングしたい | [knowledge-base/troubleshooting-knowledge.md](./knowledge-base/troubleshooting-knowledge.md) |
| CI/CDの問題を解決したい | [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) |
| NFCリーダーの問題を解決したい | [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) |
| **工具管理システムのデータ整合性を確認したい** | **[modules/tools/operations.md](./modules/tools/operations.md)** |
| **工具管理システムの復旧手順を知りたい** | **[modules/tools/operations.md](./modules/tools/operations.md)** |
| **エラーハンドリングを理解したい** | **[guides/error-handling.md](./guides/error-handling.md)** |
| **ログ出力を理解したい** | **[guides/logging.md](./guides/logging.md)** |
| **Dropbox OAuth設定でエラーが発生した** | **[knowledge-base/infrastructure/backup-restore.md#kb-099](./knowledge-base/infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題)** |
| **CIテストが失敗してもマージできてしまう** | **[knowledge-base/infrastructure/ansible-deployment.md#kb-100](./knowledge-base/infrastructure/ansible-deployment.md#kb-100-ciテストが失敗してもマージが進んでしまう問題再発)** / **[.github/BRANCH_PROTECTION_SETUP.md](../.github/BRANCH_PROTECTION_SETUP.md)** |

---

## 👥 対象者別インデックス

### 新規参加者

| ドキュメント | 説明 |
|-------------|------|
| [README.md](../README.md) | プロジェクトの概要 |
| [architecture/overview.md](./architecture/overview.md) | システムアーキテクチャ |
| [guides/development.md](./guides/development.md) | 開発環境セットアップ |
| [requirements/system-requirements.md](./requirements/system-requirements.md) | 要件定義 |

### 開発者

| ドキュメント | 説明 |
|-------------|------|
| [guides/development.md](./guides/development.md) | 開発環境・ワークフロー |
| [api/overview.md](./api/overview.md) | API概要 |
| [api/auth.md](./api/auth.md) | 認証API |
| [modules/tools/README.md](./modules/tools/README.md) | 工具管理モジュール |
| [modules/tools/api.md](./modules/tools/api.md) | 工具管理API |
| [modules/tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [modules/tools/operations.md](./modules/tools/operations.md) | 工具管理運用・保守ガイド |
| [decisions/001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [decisions/002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |
| [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) | Ansibleで管理すべき設定ファイル一覧 |
| [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) | Ansibleエラーハンドリングガイド |
| [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) | Ansibleベストプラクティス |

### 運用者

| ドキュメント | 説明 |
|-------------|------|
| [guides/deployment.md](./guides/deployment.md) | デプロイ手順 |
| [guides/production-setup.md](./guides/production-setup.md) | 本番環境セットアップ（HTTPS設定含む） |
| [guides/backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [guides/monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [runbooks/ports-unexpected-and-port-exposure.md](./runbooks/ports-unexpected-and-port-exposure.md) | **Runbook**: `ports-unexpected` / ポート露出の点検と切り分け |
| [runbooks/kiosk-loan-status-repair.md](./runbooks/kiosk-loan-status-repair.md) | **Runbook**: キオスク貸出の取消混入と資産status修復 |
| [runbooks/kiosk-ime-diagnosis.md](./runbooks/kiosk-ime-diagnosis.md) | **Runbook**: キオスク備考欄 日本語入力不具合の診断 |
| [runbooks/kiosk-power-operation-recovery.md](./runbooks/kiosk-power-operation-recovery.md) | **Runbook**: 電源操作・連打防止オーバーレイ不具合の復旧 |
| [runbooks/vnc-tailscale-recovery.md](./runbooks/vnc-tailscale-recovery.md) | **Runbook**: RealVNC接続不可時の復旧（Tailscale ACL設定） |
| [runbooks/pi3-signage-tailscale-recovery.md](./runbooks/pi3-signage-tailscale-recovery.md) | **Runbook**: Pi3 サイネージ非表示（Tailscale Key expiry・`signage-lite` 復旧） |
| [runbooks/deploy-status-recovery.md](./runbooks/deploy-status-recovery.md) | **Runbook**: メンテナンス画面が戻らない場合の復旧（deploy-status強制解除） |
| [runbooks/actual-hours-canonical-backfill.md](./runbooks/actual-hours-canonical-backfill.md) | **Runbook**: 実績工数 Canonical/Feature バックフィル（Deploy後・既存Raw反映） |
| [guides/operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [modules/tools/operations.md](./modules/tools/operations.md) | **工具管理運用・保守ガイド**（データ整合性、復旧手順、エラーハンドリング） |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |
| [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) | Ansibleで管理すべき設定ファイル一覧 |
| [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) | Ansibleエラーハンドリングガイド |

### システム担当者・経営層

| ドキュメント | 説明 |
|-------------|------|
| [presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md) | **セキュリティ対策プレゼンテーション資料**（アサヒビールのランサムウェア被害を踏まえた対策と評価） |
| [security/requirements.md](./security/requirements.md) | **セキュリティ要件定義**（Tailscale主運用、IPアドレス管理、ランサムウェア対策など） |
| [security/implementation-assessment.md](./security/implementation-assessment.md) | **セキュリティ実装の妥当性評価**（現状の評価と残タスク） |
| [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) | Ansibleベストプラクティス |

### アーキテクト

| ドキュメント | 説明 |
|-------------|------|
| [architecture/overview.md](./architecture/overview.md) | システムアーキテクチャ |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | インフラ基盤 |
| [decisions/](./decisions/) | アーキテクチャ決定記録（ADR） |
| [requirements/system-requirements.md](./requirements/system-requirements.md) | 要件定義 |

---

## 📁 カテゴリ別インデックス

### アーキテクチャ（architecture/）

システム全体の設計・構造に関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [overview.md](./architecture/overview.md) | システム全体のアーキテクチャ（クライアントデバイス統合含む） |
| [infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [signage-module-architecture.md](./architecture/signage-module-architecture.md) | **デジタルサイネージモジュール アーキテクチャ**（モジュール化、コンフリクト確認、スケーラビリティ） |
| [deployment-modules.md](./architecture/deployment-modules.md) | **デプロイメントモジュール**（原因分析・設計・テスト計画統合、疎結合・モジュール化アーキテクチャ） |

### 設計決定（decisions/）

アーキテクチャ決定記録（ADR）。

| ファイル | 説明 |
|---------|------|
| [001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [003-camera-module.md](./decisions/003-camera-module.md) | **カメラ機能のモジュール化**（写真撮影持出機能） |
| [ADR-20260130-tailscale-primary-operations.md](./decisions/ADR-20260130-tailscale-primary-operations.md) | Tailscale主運用への移行決定 |
| [ADR-20260211-production-schedule-expression-indexes.md](./decisions/ADR-20260211-production-schedule-expression-indexes.md) | 生産スケジュールパフォーマンス最適化のための式インデックス追加 |
| [ADR-20260228-ibus-kiosk-multilayer-suppression.md](./decisions/ADR-20260228-ibus-kiosk-multilayer-suppression.md) | IBus UI 再発を防ぐ多層抑止とモジュール分離 |

### モジュール仕様（modules/）

機能別のモジュール仕様。

| ファイル | 説明 |
|---------|------|
| [tools/README.md](./modules/tools/README.md) | 工具管理モジュール概要 |
| [tools/operations.md](./modules/tools/operations.md) | 工具管理運用・保守ガイド |
| [tools/api.md](./modules/tools/api.md) | 工具管理API |
| [tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [tools/photo-loan.md](./modules/tools/photo-loan.md) | **写真撮影持出機能**（FR-009） |
| [measuring-instruments/README.md](./modules/measuring-instruments/README.md) | **計測機器管理モジュール概要** |
| [measuring-instruments/api.md](./modules/measuring-instruments/api.md) | **計測機器管理API仕様** |
| [measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) | **計測機器管理UI設計メモ** |
| [signage/README.md](./modules/signage/README.md) | **デジタルサイネージモジュール** |
| [signage/signage-lite.md](./modules/signage/signage-lite.md) | **デジタルサイネージ軽量モード計画** |
| [documents/README.md](./modules/documents/README.md) | ドキュメントモジュール（将来実装予定） |
| [logistics/README.md](./modules/logistics/README.md) | 物流モジュール（将来実装予定） |

### APIリファレンス（api/）

APIの概要と詳細。

| ファイル | 説明 |
|---------|------|
| [overview.md](./api/overview.md) | API概要 |
| [auth.md](./api/auth.md) | 認証API |

### 要件定義（requirements/）

システム要件と仕様。

| ファイル | 説明 |
|---------|------|
| [system-requirements.md](./requirements/system-requirements.md) | システム要件定義 |
| [measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md) | **計測機器管理システム要件定義** |

### 実装計画（plans/）

機能実装の計画と進捗。

| ファイル | 説明 |
|---------|------|
| [production-deployment-management-plan.md](./plans/production-deployment-management-plan.md) | プロダクション環境デプロイメント・更新・デバッグ管理計画 |
| [production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) | クライアント状態可視化とデバッグ支援システム実行計画 |
| [production-documents-feature-plan.md](./plans/production-documents-feature-plan.md) | **写真付きドキュメント表示機能の実装計画**（設計検討中） |
| [stability-improvement-plan.md](./plans/stability-improvement-plan.md) | システム安定性向上計画 |
| [ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) | **Ansible安定性・堅牢化・柔軟性向上計画** |
| [ansible-phase9-role-execplan.md](./plans/ansible-phase9-role-execplan.md) | **Ansible Phase 9（ロール化）実行計画** |
| [tool-management-debug-execplan.md](./plans/tool-management-debug-execplan.md) | **キオスク工具スキャン重複＆黒画像対策 ExecPlan** |
| [ts100-integration-plan.md](./plans/ts100-integration-plan.md) | **TS100 RFIDリーダー統合計画**（計測機器管理システム用） |

### 実践ガイド（guides/）

開発・デプロイ・運用の手順。

| ファイル | 説明 |
|---------|------|
| [development.md](./guides/development.md) | 開発環境セットアップ |
| [deployment.md](./guides/deployment.md) | デプロイ手順 |
| [production-setup.md](./guides/production-setup.md) | 本番環境セットアップ |
| [backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [csv-import-export.md](./guides/csv-import-export.md) | CSVインポート・エクスポート |
| [verification-checklist.md](./guides/verification-checklist.md) | 検証チェックリスト |
| [photo-loan-test-plan.md](./guides/photo-loan-test-plan.md) | **写真撮影持出機能 テスト計画**（FR-009） |
| [validation-7-usb-import.md](./guides/validation-7-usb-import.md) | USBインポート検証 |
| [signage-test-plan.md](./guides/signage-test-plan.md) | **デジタルサイネージ機能 テスト計画** |
| [signage-deployment.md](./guides/signage-deployment.md) | **デジタルサイネージ機能 デプロイメントガイド** |
| [signage-client-setup.md](./guides/signage-client-setup.md) | **デジタルサイネージクライアント端末セットアップガイド** |
| [production-schedule-signage.md](./guides/production-schedule-signage.md) | **生産スケジュール進捗サイネージ可視化ガイド** |
| [ci-troubleshooting.md](./guides/ci-troubleshooting.md) | CI/CDトラブルシューティング |
| [operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [ai-handoff.md](./guides/ai-handoff.md) | **AI引き継ぎガイド**（別AIへの引き継ぎ時） |
|| [client-initial-setup.md](./guides/client-initial-setup.md) | **新規クライアント端末の初期設定手順** |
|| [zero2w-tanaban-edge-setup.md](./runbooks/zero2w-tanaban-edge-setup.md) | **Zero 2 W 棚番エッジ（Tailscale・status-agent）** |
|| [mac-ssh-access.md](./guides/mac-ssh-access.md) | **MacからRaspberry Pi 5へのSSH接続ガイド** |
|| [auto-startup-status.md](./guides/auto-startup-status.md) | **システム自動起動の現状と設定手順** |
|| [ai-ssh-access.md](./guides/ai-ssh-access.md) | **AIアシスタントのSSHアクセスについて** |
|| [setup-clients-status-agent.md](./guides/setup-clients-status-agent.md) | **クライアント端末のstatus-agent設定手順（実機テスト用）** |
| [status-agent.md](./guides/status-agent.md) | Raspberry Pi クライアント状態送信エージェント |
| [quick-start-deployment.md](./guides/quick-start-deployment.md) | **クライアント一括更新と監視のクイックスタート** |
| [local-alerts.md](./guides/local-alerts.md) | **ローカル環境対応の通知機能ガイド** |
| [local-alerts-verification.md](./guides/local-alerts-verification.md) | **ローカル環境対応の通知機能 実機検証手順** |
| [ssd-migration.md](./guides/ssd-migration.md) | **SDカードからSSDへの移行手順** |
| [ansible-managed-files.md](./guides/ansible-managed-files.md) | **Ansibleで管理すべき設定ファイル一覧** |
| [ansible-error-handling.md](./guides/ansible-error-handling.md) | **Ansibleエラーハンドリングガイド** |
| [ansible-best-practices.md](./guides/ansible-best-practices.md) | **Ansibleベストプラクティス** |
| [git-clean-safety.md](./guides/git-clean-safety.md) | **git cleanの安全な使用方法** |
| [mac-storage-migration.md](./guides/mac-storage-migration.md) | **Macストレージ圧迫対策: Docker/Cursorデータの外付けSSD移行とGoogleドライブバックアップ** |

### トラブルシューティング（knowledge-base/, troubleshooting/）

問題解決のナレッジベース。**カテゴリ別に分割されています。**

| ファイル | 説明 |
|---------|------|
| [knowledge-base/index.md](./knowledge-base/index.md) | 📋 **ナレッジベース索引**（全65件の一覧） |
| [knowledge-base/api.md](./knowledge-base/api.md) | API関連（16件） |
| [knowledge-base/database.md](./knowledge-base/database.md) | データベース関連（3件） |
| [knowledge-base/ci-cd.md](./knowledge-base/ci-cd.md) | CI/CD関連（4件） |
| [knowledge-base/frontend.md](./knowledge-base/frontend.md) | フロントエンド関連（15件） |
| [knowledge-base/infrastructure.md](./knowledge-base/infrastructure.md) | インフラ関連（25件） |
| [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) | NFCリーダー固有の問題 |

### セキュリティ（security/）

セキュリティに関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [requirements.md](./security/requirements.md) | **セキュリティ要件定義**（Tailscale主運用、IPアドレス管理、ランサムウェア対策など） |
| [validation-review.md](./security/validation-review.md) | バリデーションレビュー |
| [pr-review-bots.md](./security/pr-review-bots.md) | **PR 自動レビュー**（CodeRabbit / Cursor Bugbot と CI ゲートの役割分担） |
| [implementation-assessment.md](./security/implementation-assessment.md) | **セキュリティ実装の妥当性評価**（現状の評価と残タスク） |
| [incident-response.md](./security/incident-response.md) | **インシデント対応手順**（侵入・マルウェア検知時の初動・封じ込め・復旧手順） |
| [port-security-audit.md](./security/port-security-audit.md) | **ポートセキュリティ監査レポート**（ポート公開状況の監査と修正内容、2025-12-18） |
| [port-security-verification.md](./security/port-security-verification.md) | **ポートセキュリティ修正後の動作確認手順**（ポートマッピング削除後の動作確認手順、2025-12-18） |
| [port-security-verification-results.md](./security/port-security-verification-results.md) | **ポートセキュリティ修正後の実機検証結果**（実機検証結果と評価、2025-12-18） |
| [standard-security-checklist-audit.md](./security/standard-security-checklist-audit.md) | **標準セキュリティチェックリスト監査レポート**（IPA、OWASP、CISベンチマークに基づく監査結果、2025-12-18） |
| [postgresql-password-policy-implementation.md](./security/postgresql-password-policy-implementation.md) | **PostgreSQLパスワードポリシー強化の実装**（環境変数によるパスワード管理の実装手順、2025-12-18完了） |
| [evaluation-plan.md](./security/evaluation-plan.md) | **セキュリティ評価計画書**（OWASP/IPA/CIS/NIST等の標準指標に基づく評価実施計画、2026-01-18作成） |
| [evaluation-report.md](./security/evaluation-report.md) | **セキュリティ評価報告書**（評価計画書に基づく評価実施結果、2026-01-18作成） |
| [external-intrusion-risk-analysis.md](./security/external-intrusion-risk-analysis.md) | **外部侵入リスク分析レポート**（外部からの不正侵入リスクの詳細分析、2026-01-18作成） |
| [urgent-security-measures.md](./security/urgent-security-measures.md) | **緊急に実装すべき安全対策機能**（USBメモリ運用予定がない前提での緊急実装項目、2026-01-18作成） |
| [log-redaction-implementation.md](./security/log-redaction-implementation.md) | **ログの機密情報保護実装レポート**（x-client-keyのログ出力を[REDACTED]に置換する実装、2026-01-18実装完了） |
| [system-inventory.md](./security/system-inventory.md) | **システム構造台帳**（評価対象/公開面/外部連携/秘密情報の所在、2026-01-28作成） |
| [evidence/production-verification-guide.md](./security/evidence/production-verification-guide.md) | **実機検証実行ガイド**（Pi5本番でのセキュリティ評価実機検証手順、2026-01-28作成） |

### プレゼンテーション（presentations/）

システム担当者・経営層向けのプレゼンテーション資料。

| ファイル | 説明 |
|---------|------|
| [security-measures-presentation.md](./presentations/security-measures-presentation.md) | **セキュリティ対策プレゼンテーション資料**（アサヒビールのランサムウェア被害を踏まえた対策と評価） |

---

## 🔗 コードとの対応関係

### 工具管理モジュール（tools）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/tools/README.md](./modules/tools/README.md), [modules/tools/operations.md](./modules/tools/operations.md) |
| **APIルート** | `apps/api/src/routes/tools/` |
| **サービス層** | `apps/api/src/services/tools/` |
| **Webページ** | `apps/web/src/pages/tools/` |
| **共通型** | `packages/shared-types/src/` |

### ドキュメントモジュール（documents）- 将来実装予定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/documents/README.md](./modules/documents/README.md) |
| **APIルート** | `apps/api/src/routes/documents/` |
| **サービス層** | `apps/api/src/services/documents/` |
| **Webページ** | `apps/web/src/pages/documents/` |

### デジタルサイネージモジュール（signage）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/signage/README.md](./modules/signage/README.md) |
| **アーキテクチャ** | [architecture/signage-module-architecture.md](./architecture/signage-module-architecture.md) |
| **APIルート** | `apps/api/src/routes/signage/` |
| **サービス層** | `apps/api/src/services/signage/` |
| **Webページ** | `apps/web/src/pages/signage/`, `apps/web/src/pages/admin/Signage*.tsx` |

### 物流モジュール（logistics）- 将来実装予定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/logistics/README.md](./modules/logistics/README.md) |
| **APIルート** | `apps/api/src/routes/logistics/` |
| **サービス層** | `apps/api/src/services/logistics/` |
| **Webページ** | `apps/web/src/pages/logistics/` |

### インフラ設定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) |
| **Docker設定** | `infrastructure/docker/` |
| **デプロイスクリプト** | `scripts/server/deploy.sh` |
| **バックアップスクリプト** | `scripts/server/backup.sh` |
| **リストアスクリプト** | `scripts/server/restore.sh` |
| **監視スクリプト** | `scripts/server/monitor.sh` |

---

## 📊 ドキュメント統計

| カテゴリ | ファイル数 |
|---------|-----------|
| アーキテクチャ | 4 |
| 設計決定 | 3 |
| モジュール仕様 | 6 |
| APIリファレンス | 2 |
| 要件定義 | 1 |
| 実装計画 | 7 |
| 実践ガイド | 31 |
| トラブルシューティング | 6 |
| セキュリティ | 3 |
| プレゼンテーション | 1 |
| **合計** | **56** |

---

## 📝 関連ドキュメント

- [EXEC_PLAN.md](../EXEC_PLAN.md): プロジェクト管理ドキュメント
- [README.md](../README.md): プロジェクト概要、ドキュメント体系の基本思想
- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md): ドキュメントリファクタリング計画

---

## 📅 更新履歴

- 2026-05-11: StackChan private Pi5 系の調査結果を更新。`HTTP 200` なのに `payload length: 0` となる `ChatGPT.cpp` ライフタイム不整合の根因と修正、late 時点の `failed` 発話・到達不能（private Pi5 SSH / bridge / DGX timeout）切り分け、音声系（`MP3:ERROR_BUFLEN 0` / `I2S ... failed`）の継続課題を [KB-stackchan-community-firmware-supply-chain.md](./knowledge-base/KB-stackchan-community-firmware-supply-chain.md)・[stackchan-community-text-only-e2e.md](./runbooks/stackchan-community-text-only-e2e.md)・[private-pi5-stackchan-bridge-deploy.md](./runbooks/private-pi5-stackchan-bridge-deploy.md)・[`scripts/private-pi5-stackchan-bridge/README.md`](../scripts/private-pi5-stackchan-bridge/README.md) に反映。
- 2026-04-18: GitHub Actions CI のジョブ分割・composite action・監査ゲート整理を [KB-353](./knowledge-base/ci-cd.md#kb-353-github-actions-のジョブ分割と-composite-action-による-ci-高速化2026-04-18) / [ci-troubleshooting.md](./guides/ci-troubleshooting.md) に記録。[deployment.md](./guides/deployment.md) 冒頭に **実機ベースライン**（`verify-phase12-real.sh`・デプロイ未実施）を追記。`EXEC_PLAN.md` の Progress / Next Steps を同期。**PR**: [#165](https://github.com/denkoushi/RaspberryPiSystem_002/pull/165)（merge `eba4cb66`）。
- 2025-11-27: 初版作成
- 2025-12-01: ローカルアラートシステム関連ドキュメント追加、ナレッジベースKB-059追加、統計更新
- 2025-12-01: 工具管理システム運用・保守ガイド追加、NFCリーダートラブルシューティング追加、ナレッジベースKB-060追加、統計更新（58件）
- 2025-12-04: 工具スキャン重複対策（KB-067）と黒画像対策（KB-068）を実装完了、ナレッジベース更新（65件）
- 2025-12-01: Ansible堅牢化・安定化計画追加、Ansibleで管理すべき設定ファイル一覧追加、ナレッジベースKB-061追加、統計更新（59件、実装計画セクション追加）
- 2025-12-01: Ansible設定ファイル管理化実装完了（systemdサービス・アプリケーション設定）、ナレッジベースKB-062追加、統計更新（60件、インフラ関連26件、実装計画5件）
