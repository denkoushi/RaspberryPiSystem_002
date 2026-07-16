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
- **`resolveRiggingHasVisibleLoanState` ユニットテスト**（Loan あり / 返却あり / 点検のみ / 両方なし）

## Production deploy & verification — サイネージカード chrome 統一（点検のみも青）（2026-05-22）

| 項目 | 値 |
|------|-----|
| ブランチ | `fix/rigging-inspection-card-chrome-unify` |
| 代表コミット | **`cf8c13bf`** |
| CI | **`26275892524` success** |
| 対象ホスト | **`raspberrypi5` のみ**（Pi4/Pi3 **対象外**） |
| Detach Run ID | **`20260522-174718-22503`** |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` |
| Docker | **rebuild**（`Git: changed`） |
| マイグレーション | **新規なし** |
| 実機（自動） | `verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **85s**） |

**変更概要（本番反映済）**:

1. **症状**: Gmail CSV 投影の点検のみ従業員（`Loan` なし）は **ダークカード**、キオスク持出あり（石井さん型）は **青カード** — データ源ではなく **`hasVisibleLoanState = 貸出中>0 \|\| 返却>0`** の判定差。
2. **Fix（案 A）**: `RiggingLoanInspectionRenderer` が `resolveHasVisibleLoanState` を注入。**Loan または当日 `点検件数>0`** で青 chrome（infoContainer 系）。**ヘッダ数字**（`貸出中 0 ・ 返却 0`）は据え置き。
3. **共有モジュール**: `render-loan-inspection-board.ts` に optional hook **`resolveHasVisibleLoanState(row, counts, { inspectionCountColumn })`**。**計測機器（MI）は未指定のまま**（従来判定）。
4. **実装**: [`resolveRiggingHasVisibleLoanState`](../../apps/api/src/services/visualization/renderers/rigging-loan-inspection/rigging-loan-inspection-renderer.ts)·テスト [`rigging-loan-inspection-renderer.test.ts`](../../apps/api/src/services/visualization/renderers/rigging-loan-inspection/__tests__/rigging-loan-inspection-renderer.test.ts) **5 件**。

**デプロイコマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/rigging-inspection-card-chrome-unify infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

**トラブルシュート（本デプロイ固有）**:

| 症状 | 想定原因 | 確認・対処 |
|------|----------|------------|
| CSV 点検者だけダークのまま | Pi5 `api` が **`cf8c13bf` 未反映** | Detach **`20260522-174718-22503`**·`Git: changed`·Docker rebuild |
| 点検なし従業員まで青 | `点検件数` が 0 以外 | DataSource の groupBy 窓・従業員行の集計を確認 |
| MI サイネージの見た目が変わった | hook が MI に誤注入 | **吊具 renderer のみ** hook 指定（`49386387` 以降の分離パターンと同様） |

## Production deploy & verification — dedup refresh · idNum 登録 · サイネージデザイン分離（2026-05-22）

| 項目 | 値 |
|------|-----|
| ブランチ | `fix/loan-inspection-card-combined-mgmt-numbers` |
| 代表コミット | **`49386387`**（系列: **`d5ee97ab`** → **`e328bcd2`** → **`49386387`**） |
| 対象ホスト | **`raspberrypi5` のみ**（Pi4/Pi3 **対象外**） |
| Detach Run ID | **`20260522-160832-6784`**（初回·Docker rebuild 中 **`--attach`** 追尾）/ **`20260522-163138-380`**（完了確認） |
| PLAY RECAP | `ok=134` `changed=4` `failed=0` / `unreachable=0` |
| マイグレーション | **新規なし** |
| 実機（自動） | `verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0** |

**変更概要（本番反映済）**:

1. **投影 dedup refresh** — 同一 dedup キー（管理番号 + JST 業務日 + compact 氏名）で再投影時、既存行があっても **incoming の `inspectedAt` が新しければ UPDATE**（`RiggingInspectionProjectionService`·カウンタ **`refreshed`**）。**根因**: 旧実装は dedup スキップで **dashboard 行の古い日付**が残り、サイネージ DataSource の **暦日 `today_jst`（0:00–24:00 JST）** 窓から漏れる。
2. **idNum マスタ補完** — `register-rigging-inspection-missing-id-num-gears.ts` + `pnpm register:rigging-inspection-missing-id-num-gears:prod`。**初回 created 4**（idNum **80/73/69/82**·`managementNumber = idNum`）·**再実行 skipped 4**。
3. **サイネージカード本文デザイン分離** — **計測機器（MI）** は共有 `layout-body.ts` の **従来レイアウト**（1 機器 = 管理番号行 + 名称行·`tone: secondary`）。**吊具点検のみ** `rigging-layout-body.ts` で active 2 件以上を **`M33E ・ M02E` 形式**（管理番号 `primary`·名称 `secondary`）。`RiggingLoanInspectionRenderer` が `layoutBodyWithinMaxHeight: layoutRiggingBodyWithinMaxHeight` を注入。

**backfill 再実行（最新·Pi5·デプロイ後）**:

| 項目 | 値 |
|------|-----|
| 削除（`notes.source=gmail`） | （dry-run 相当·再投影前） |
| csvRowsScanned | **190** |
| created | **103** |
| refreshed | **7** |
| deduped | **74** |
| unmatchedGear | **6** |
| unmatchedEmployee | **0** |

**2026_05_22.csv 調査（加工担当部署·5/22 暦日）**:

| 観点 | 結果 |
|------|------|
| CSV 全行 | **26 行**（PowerApps 当日分） |
| サイネージ表示（加工担当部署·`today_jst`） | **18 件 / 10 名** |
| 意図的除外 | **田中俊真 6 行** — `section ≠ 加工担当部署`（投影先従業員の section が空/別部署） |
| マスタ未解決 | **unmatchedGear 6 件**（id 78/68 等·`control_num` 空 + `idNum` 未登録） |
| dedup refresh 効果 | **refreshed 7** — 暦日窓漏れの主因だった古い `inspectedAt` を更新 |

**表示例（加工担当部署·5/22）**: 清水（idNum 80）·上野（73）·矢田（M02G/M56F/69/M05G/M13D）·田村（M36E/M02H/M12D）等。

**デプロイコマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/loan-inspection-card-combined-mgmt-numbers infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

**トラブルシュート（本デプロイ固有）**:

- **デプロイロック競合** — 既存 detach run 実行中は新規起動不可 → **`--status`** で runId 確認後 **`--attach <runId>`** で追尾。
- **CSV 26 行あるのに 7 名しか出ない（A+B 直後）** → (1) dedup が古い `inspectedAt` を残す → **本修正 + backfill**、(2) `unmatchedGear` → idNum 登録、(3) section 不一致 → 従業員マスタ調査（田中 6 行は仕様どおり除外）。

### idNum マスタ登録手順（本番·1 回）

```bash
# dry-run（対象 idNum の確認）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  pnpm register:rigging-inspection-missing-id-num-gears:prod -- --dry-run

# 実行（既定: idNum 80/73/69/82）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  pnpm register:rigging-inspection-missing-id-num-gears:prod
```

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

## 現場検証（2026-05-22 · 更新）

| # | 項目 | 結果 | 備考 |
|---|------|------|------|
| 1 | **インポートスケジュール有効化** | **OK** | UI 修正後 `/admin/imports/schedule` で保存成功 |
| 2 | **Gmail CSV 手動実行** | **OK** | スケジュール画面から手動実行 |
| 3 | **Gmail 受信箱から対象メール消失** | **OK** | 取込成功後の既存 Gmail 処理どおり（未読→処理→アーカイブ/削除） |
| 4 | **`RiggingInspectionRecord` 投影確認** | **OK（backfill 再実行済）** | 最新 backfill: **103 created / 7 refreshed / 74 deduped**·`unmatchedEmployee=0`·`unmatchedGear=6`·idNum **80/73/69/82 登録済** |
| 5 | **可視化ダッシュボード preset** | **DataSource OK** | 加工担当部署·5/22 暦日: **18 件 / 10 名**（A+B 直後 **7 名** → dedup refresh + idNum 補完で改善） |
| 6 | **サイネージ割当・JPEG 表示** | **DataSource OK** | 点検のみ従業員（貸出 0）も `吊具明細` に表示·**吊具 active 複数は `・` 結合**（MI は従来 1 行/機器） |
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
| **CSV 行はあるがサイネージに一部吊具だけ出ない** | 投影 dedup が古い `inspectedAt` を残し、暦日 `today_jst` 窓から漏れる | **`49386387` 以降**: dedup 時 **incoming が新しければ UPDATE**（`refreshed` カウンタ）→ **`backfill:rigging-inspection-gmail-projection:prod` 再実行** |
| **CSV 全行数とサイネージ人数が一致しない** | (1) section フィルタ (2) unmatchedGear (3) 暦日窓 (4) カード truncation | **`2026_05_22.csv`**: 26 行 → 加工担当 **18 件/10 名**（田中 6 行は section 不一致で除外·unmatchedGear 6） |
| **管理 UI で「時刻指定が解析できません」** | 既定 cron **`0 * * * *`（毎時）** を Web の `parseCronSchedule` が未対応（2026-05-22 修正前） | **回避**: 管理画面ログイン中に `PUT /api/imports/schedule/csv-import-rigging-slings-inspection-powerapps` で **`{ "enabled": true }` のみ**送信（schedule は変更不要）·**恒久**: Web 修正 **`fix/csv-import-hourly-cron-ui`** を Pi5 へ再デプロイ |
| **CSVダッシュボードが「選択してください」のまま** | 編集フォームで `provider=gmail` 時に csvDashboards でも件名パターン欄を表示する UI バグ（同上） | 上記 Web 修正で解消·targets.source は **`c4e8a1b2-3d6f-7890-abcd-ef1234567891`** が backup.json に既存なら API 有効化のみで可 |

## 仕様メモ（後続コンテキスト用）

- **dedup キー**: 正規化した管理番号 + JST 業務日 + **compact 氏名**（全空白除去·`compactEmployeeDisplayName`）
- **氏名照合**: CSV `inspectorName`（スペースなし）↔ `Employee.displayName`（スペースあり）は **compact キー**で一致
- **サイネージ明細**: Loan active/returned を優先し、未出現の点検吊具を `kind=active` でマージ
- **結果マッピング**: PowerApps CSV の結果列 → `RiggingInspectionResult`（PASS/FAIL/未実施等）
- **postIngest**: `csv-dashboard-post-ingest.service.ts` が dashboard ID で dispatch·手動 upload も同一 pipeline
- **共有 UI**: `loan-inspection-card` を計測機器（MI）から抽出·MI renderer は legacy adapter 経由で回帰
- **サイネージ本文レイアウト（2026-05-22 分離）**:
  - **計測機器（MI）**: 共有 [`layout-body.ts`](../../apps/api/src/services/visualization/shared/loan-inspection-card/layout-body.ts) — **1 機器 = 管理番号行 + 名称行**（従来どおり·`tone: secondary`）
  - **吊具点検**: [`rigging-layout-body.ts`](../../apps/api/src/services/visualization/renderers/rigging-loan-inspection/rigging-layout-body.ts) — **active が 2 件以上**のとき管理番号を **` ・ `（中黒）で 1 行結合**（例: `M33E ・ M02E`）·名称はユニーク集合を同形式結合·管理番号 `primary` / 名称 `secondary`
  - **注入**: `RiggingLoanInspectionRenderer` → `layoutBodyWithinMaxHeight: layoutRiggingBodyWithinMaxHeight`·MI はデフォルト `layoutBodyWithinMaxHeight` のまま
  - **意図**: 吊具は同一従業員の active 複数をコンパクト表示·計測機器は可読性優先で 1 行/機器を維持
- **dedup refresh（2026-05-22）**: `findForBusinessDay()` で既存行検索 → **incoming `inspectedAt` > existing なら update**（pipeline カウンタ `refreshed`）
- **カード chrome 統一（2026-05-22 · `cf8c13bf`）**: 吊具サイネージで **Loan なし・点検のみ**も **青カード**（`resolveRiggingHasVisibleLoanState`）。**MI は従来**（Loan ありのみ青）。**ヘッダ `貸出中/返却` 件数は Loan 実績のまま**。
- **暦日フィルタ**: サイネージ DataSource preset `period: today_jst` = **JST 0:00–24:00**（業務日 9:00 切替とは別）
- **定数**: `apps/api/src/services/rigging/constants.ts`（dashboard ID・schedule 関連）

## References

- [csv-import-export.md](../guides/csv-import-export.md) Gmail スケジュール節
- [deployment.md §2026-05-22 カード chrome 統一](../archive/deployments/2026-05.md#rigging-inspection-card-chrome-unify-2026-05-22)
- [deployment.md §2026-05-22 dedup refresh / idNum / デザイン分離](../archive/deployments/2026-05.md#rigging-inspection-dedup-refresh-signage-layout-2026-05-22)
- [deployment.md §2026-05-22 A+B 氏名マッチ](../archive/deployments/2026-05.md#rigging-inspection-name-match-signage-merge-2026-05-22)
- [deployment.md §2026-05-22 吊具点検（初回）](../archive/deployments/2026-05.md#rigging-slings-inspection-gmail-signage-2026-05-22)
- `apps/api/src/services/rigging/constants.ts`
- `apps/api/src/services/visualization/shared/loan-inspection-card/`
