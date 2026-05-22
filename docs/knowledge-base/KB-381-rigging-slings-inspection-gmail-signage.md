# KB-381: 吊具点検 Gmail 統合・サイネージ

## Context

PowerApps 吊具点検 CSV（Gmail 件名 `slingsInspectionRecord_PowerApps`）を本システムの `RiggingInspectionRecord` に取り込み、キオスク吊具持出時の点検記録作成と、計測機器点検可視化と同デザインの吊具サイネージを追加する要件（2026-05）。

## Symptoms

- Gmail 吊具点検 CSV は取り込まれず、`RiggingInspectionRecord` はキオスク/API から手動作成されていなかった
- 吊具の持出・点検状況をサイネージで一覧表示する手段がなかった

## Investigation

- 計測機器 Gmail CSV は `MeasuringInstrumentLoanEvent`（持出イベント）であり、点検記録とは別経路
- 吊具は `RiggingInspectionRecord` モデルが存在するが、Gmail 投影・キオスク自動作成・サイネージが未実装だった
- postIngest パターン（CustomerSCAW 型）が Gmail + 手動 upload 両対応に適する

## Root cause

機能ギャップ（未実装）。スキーマ変更は不要。

## Fix

1. **境界モジュール** `apps/api/src/services/rigging/inspection/`
   - `RiggingGearResolver`: `control_num` → `managementNumber` 優先、なければ `ID_num` → `idNum`
   - `RiggingInspectionDedupPolicy`: 管理番号 + JST 業務日 + 氏名で重複判定
   - `RiggingInspectionProjectionService`: Gmail ingestRun から投影
   - `RiggingBorrowInspectionOrchestrator`: キオスク `borrow` 成功後 PASS 作成（best-effort）
2. **CsvDashboard**: 固定 ID `c4e8a1b2-3d6f-7890-abcd-ef1234567891`・postIngest 配線・builtin schedule `csv-import-rigging-slings-inspection-powerapps`（**enabled: false**）
3. **サイネージ**: `rigging_loan_inspection` DataSource/Renderer（共有 `loan-inspection-card`）
4. **管理 UI**: 可視化ダッシュボード「吊具点検可視化プリセット」・サイネージ `[吊具点検]` タグ

## Prevention

- dedup・結果マッピング・resolver のユニットテスト
- postIngest dispatch テスト（dashboard ID 限定）
- スケジュール policy テスト（enabled: false 既定の確認）

## Production deploy & verification — A+B 氏名マッチ・サイネージマージ（2026-05-22）

| 項目 | 値 |
|------|-----|
| ブランチ | `feat/rigging-inspection-name-match-signage-merge` |
| 代表コミット | **`7ba9306c`** |
| CI | **`26271507686` success** |
| 対象ホスト | **`raspberrypi5` のみ**（Pi4/Pi3 **対象外**） |
| Detach Run ID | **`20260522-152051-25493`** |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` |
| Docker | **rebuild**（17 diff files） |
| マイグレーション | **新規なし**·`prisma migrate deploy` / `status` **ok** |
| 実機（自動） | `verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**） |

**変更概要（A+B）**:

- **A**: `compactEmployeeDisplayName` — CSV 氏名（スペースなし）↔ 従業員マスタ（スペースあり）を投影 resolver で一致
- **B**: `RiggingLoanInspectionDataSource` — `RiggingInspectionRecord` の点検のみ吊具を Loan 明細とマージ（`kind=active`）
- **backfill**: `backfill:rigging-inspection-gmail-projection` — 誤 gmail 記録削除 → CsvDashboardRow 全件再投影

**backfill 実施結果（Pi5·デプロイ直後）**:

| 項目 | 値 |
|------|-----|
| 削除（`notes.source=gmail`） | **46 件** |
| 再投影 scanned | **142 行** |
| created | **88** |
| deduped | **26** |
| unmatchedGear | **28**（`idNum` のみ·マスタ未解決） |
| unmatchedEmployee | **0**（A 修正後·氏名未マッチ **0**） |
| `加工担当部署` 紐づけ | **42 件**（矢田 彗遥 6·芦沢 剛 5·石井 和也 3 等） |
| section 空従業員 | **46 件**（田中俊真 30·増田雄司 16 — **要マスタ/CSV 調査**） |

**サイネージ DataSource 実機（2026-05-22·JST 当日）**:

- preset 相当 `{ sectionEquals: '加工担当部署', period: 'today_jst' }`
- **inspectedUsers=7**·**rowsWithInstrumentDetails=7**
- 例: 矢田 彗遥（点検 2·貸出 0·明細 2）·芦沢 剛（点検 2·貸出 0·明細 2）→ **B（点検のみ吊具の本文表示）OK**

**デプロイコマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/rigging-inspection-name-match-signage-merge infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

## Production deploy & verification（初回 · 2026-05-22）

| 項目 | 値 |
|------|-----|
| ブランチ | `feat/rigging-slings-inspection-gmail-signage` |
| 代表コミット | **`283b414b`** |
| CI | **`26267694608` success** |
| 対象ホスト | **`raspberrypi5` のみ**（Pi4/Pi3 **対象外**） |
| Detach Run ID | **`20260522-131701-20332`** |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` |
| Docker | **rebuild**（74 diff files） |
| マイグレーション | **新規なし**·`prisma migrate deploy` / `status` **ok** |
| 実機（自動） | `verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **31s**） |

**デプロイコマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/rigging-slings-inspection-gmail-signage infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

**Pi3 について**: `--limit raspberrypi5` のため Pi3 play は **`no hosts matched`**。Pi3 専用手順（リソース僅少向け）は **未適用で正**（サイネージ JPEG 正本は Pi5 API が生成し、Pi3 は既存 `signage-lite` で取得）。

**UI 修正デプロイ（スケジュール編集不可）**: [PR #321](https://github.com/denkoushi/RaspberryPiSystem_002/pull/321) **`011071df`**·Pi5 Detach **`20260522-140422-2321`**（`failed=0`）。

## 現場検証（2026-05-22 · 進行中）

| # | 項目 | 結果 | 備考 |
|---|------|------|------|
| 1 | **インポートスケジュール有効化** | **OK** | UI 修正後 `/admin/imports/schedule` で保存成功 |
| 2 | **Gmail CSV 手動実行** | **OK** | スケジュール画面から手動実行 |
| 3 | **Gmail 受信箱から対象メール消失** | **OK** | 取込成功後の既存 Gmail 処理どおり（未読→処理→アーカイブ/削除） |
| 4 | **`RiggingInspectionRecord` 投影確認** | **OK（backfill 済）** | A+B + backfill 後: **88 件** gmail 由来·**加工担当部署 42 件**·`unmatchedEmployee=0`·section 空 46 件（田中/増田）は **マスタ調査要** |
| 5 | **可視化ダッシュボード preset** | **DataSource OK** | Pi5 実機: 当日 **7 名** 点検·明細あり·UI preset/割当は管理画面で継続確認可 |
| 6 | **サイネージ割当・JPEG 表示** | **DataSource OK** | 点検のみ従業員（貸出 0）も `吊具明細` に表示確認·JPEG は既存 schedule 割当で更新 |
| 7 | **キオスク吊具 borrow → PASS 点検** | **未実施** | best-effort orchestrator |

## 運用手順（本番・デプロイ後）

1. Pi5 で API 再ビルド済み（上記デプロイで完了）
2. `/admin/imports/schedule` で `csv-import-rigging-slings-inspection-powerapps` を **有効化**
3. `/admin/visualization-dashboards` で吊具点検プリセット作成 → `/admin/signage/schedules` で visualization スロット割当
4. Gmail 未読・件名一致・`control_num` 解決可否を確認（取込ログ / `RiggingInspectionRecord` 件数）

### 誤投影修復（A+B デプロイ後・1 回）

Gmail メールは処理済みのため再取込不可。**CsvDashboard 永続行**から再投影する。

```bash
# dry-run（削除件数・再投影行数の確認）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  pnpm backfill:rigging-inspection-gmail-projection:prod -- --dry-run

# 実行（notes.source=gmail を削除 → 全 CsvDashboardRow 再投影）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  pnpm backfill:rigging-inspection-gmail-projection:prod
```

## Troubleshooting

| 症状 | 想定原因 | 確認・対処 |
|------|----------|------------|
| Gmail 取込が走らない | スケジュール **disabled 既定** | `/admin/imports/schedule` で有効化 |
| 件名一致メールがあってもスキップ | `CsvDashboard.gmailSubjectPattern` 未設定 | ダッシュボード定義・seed を確認 |
| CSV 行が投影されない | `control_num` が `RiggingGear` に未解決 | `managementNumber` / `idNum` マスタ整合 |
| 同一日・同一人・同一管理番号が増えない | dedup 正常動作 | 意図どおり（更新は別経路） |
| キオスク borrow 後に点検無し | orchestrator **best-effort** / dedup | borrow は成功のまま·API ログ |
| サイネージに吊具が出ない | 可視化ダッシュボード未作成 | 管理 UI で preset + schedule 割当 |
| **サイネージに CSV 点検者が出ない** | **A**: CSV 氏名（スペースなし）と従業員マスタ（スペースあり）の不一致で投影失敗·**B**: DataSource が Loan のみカード本文表示 | **A**: `compactEmployeeDisplayName` で resolver 修正·**B**: `RiggingInspectionRecord` を Loan とマージ·既存誤投影は **backfill**（上記） |
| **投影はあるが加工担当部署に紐づかない** | 誤従業員へ投影済み（section 空の従業員等） | backfill 後も **田中俊真/増田雄司** に 46 件残存例あり → CSV `inspectorName` と従業員マスタの **compact 衝突・重複従業員** を調査 |
| **`unmatchedGear` が多い** | `control_num` 空で `ID_num` のみ·`RiggingGear.idNum` 未登録 | backfill で **28 件** skip 例·`pnpm register:rigging-inspection-missing-id-num-gears:prod`（id **80/73/69/82** 等）でマスタ補完 |
| **CSV 行はあるがサイネージに一部吊具だけ出ない** | 投影 dedup が古い `inspectedAt` を残し、暦日 `today_jst` 窓から漏れる | 再投影時 **新しい `inspectedAt` で refresh**（`RiggingInspectionProjectionService.refreshed`）→ backfill 再実行 |
| **管理 UI で「時刻指定が解析できません」** | 既定 cron **`0 * * * *`（毎時）** を Web の `parseCronSchedule` が未対応（2026-05-22 修正前） | **回避**: 管理画面ログイン中に `PUT /api/imports/schedule/csv-import-rigging-slings-inspection-powerapps` で **`{ "enabled": true }` のみ**送信（schedule は変更不要）·**恒久**: Web 修正 **`fix/csv-import-hourly-cron-ui`** を Pi5 へ再デプロイ |
| **CSVダッシュボードが「選択してください」のまま** | 編集フォームで `provider=gmail` 時に csvDashboards でも件名パターン欄を表示する UI バグ（同上） | 上記 Web 修正で解消·targets.source は **`c4e8a1b2-3d6f-7890-abcd-ef1234567891`** が backup.json に既存なら API 有効化のみで可 |

## 仕様メモ（後続コンテキスト用）

- **dedup キー**: 正規化した管理番号 + JST 業務日 + **compact 氏名**（全空白除去·`compactEmployeeDisplayName`）
- **氏名照合**: CSV `inspectorName`（スペースなし）↔ `Employee.displayName`（スペースあり）は **compact キー**で一致
- **サイネージ明細**: Loan active/returned を優先し、未出現の点検吊具を `kind=active` でマージ
- **結果マッピング**: PowerApps CSV の結果列 → `RiggingInspectionResult`（PASS/FAIL/未実施等）
- **postIngest**: `csv-dashboard-post-ingest.service.ts` が dashboard ID で dispatch·手動 upload も同一 pipeline
- **共有 UI**: `loan-inspection-card` を計測機器（MI）から抽出·MI renderer は legacy adapter 経由で回帰
- **定数**: `apps/api/src/services/rigging/constants.ts`（dashboard ID・schedule 関連）

## References

- [csv-import-export.md](../guides/csv-import-export.md) Gmail スケジュール節
- [deployment.md §2026-05-22 A+B 氏名マッチ](../guides/deployment.md#rigging-inspection-name-match-signage-merge-2026-05-22)
- [deployment.md §2026-05-22 吊具点検（初回）](../guides/deployment.md#rigging-slings-inspection-gmail-signage-2026-05-22)
- `apps/api/src/services/rigging/constants.ts`
- `apps/api/src/services/visualization/shared/loan-inspection-card/`
