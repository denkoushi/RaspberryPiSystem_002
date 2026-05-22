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

## Production deploy & verification（2026-05-22）

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

## 運用手順（本番・デプロイ後）

1. Pi5 で API 再ビルド済み（上記デプロイで完了）
2. `/admin/imports/schedule` で `csv-import-rigging-slings-inspection-powerapps` を **有効化**
3. `/admin/visualization-dashboards` で吊具点検プリセット作成 → `/admin/signage/schedules` で visualization スロット割当
4. Gmail 未読・件名一致・`control_num` 解決可否を確認（取込ログ / `RiggingInspectionRecord` 件数）

## Troubleshooting

| 症状 | 想定原因 | 確認・対処 |
|------|----------|------------|
| Gmail 取込が走らない | スケジュール **disabled 既定** | `/admin/imports/schedule` で有効化 |
| 件名一致メールがあってもスキップ | `CsvDashboard.gmailSubjectPattern` 未設定 | ダッシュボード定義・seed を確認 |
| CSV 行が投影されない | `control_num` が `RiggingGear` に未解決 | `managementNumber` / `idNum` マスタ整合 |
| 同一日・同一人・同一管理番号が増えない | dedup 正常動作 | 意図どおり（更新は別経路） |
| キオスク borrow 後に点検無し | orchestrator **best-effort** / dedup | borrow は成功のまま·API ログ |
| サイネージに吊具が出ない | 可視化ダッシュボード未作成 | 管理 UI で preset + schedule 割当 |

## 仕様メモ（後続コンテキスト用）

- **dedup キー**: 正規化した管理番号 + JST 業務日（`inspectionDate` 列）+ 氏名（表示名 resolver 経由）
- **結果マッピング**: PowerApps CSV の結果列 → `RiggingInspectionResult`（PASS/FAIL/未実施等）
- **postIngest**: `csv-dashboard-post-ingest.service.ts` が dashboard ID で dispatch·手動 upload も同一 pipeline
- **共有 UI**: `loan-inspection-card` を計測機器（MI）から抽出·MI renderer は legacy adapter 経由で回帰
- **定数**: `apps/api/src/services/rigging/constants.ts`（dashboard ID・schedule 関連）

## References

- [csv-import-export.md](../guides/csv-import-export.md) Gmail スケジュール節
- [deployment.md §2026-05-22 吊具点検](../guides/deployment.md#rigging-slings-inspection-gmail-signage-2026-05-22)
- `apps/api/src/services/rigging/constants.ts`
- `apps/api/src/services/visualization/shared/loan-inspection-card/`
