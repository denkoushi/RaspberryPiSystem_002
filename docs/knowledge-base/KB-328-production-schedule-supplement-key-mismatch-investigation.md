---
title: "KB-328: 生産日程本体CSVと部品納期個数（補助）の照合ずれ・上流データ・表示設計の整理"
tags: [production-schedule, ProductionScheduleOrderSupplement, csv-dashboard, winner-dedup, unmatched, upstream-erp]
audience: [開発者, 運用者, 生産管理システム連携担当]
last-verified: 2026-04-04
related:
  - ./KB-297-kiosk-due-management-workflow.md
  - ./KB-326-manual-upload-order-supplement-sync.md
  - ./KB-324-gmail-order-supplement-prisma-transaction.md
  - ../guides/csv-import-export.md
category: knowledge-base
---

# KB-328: 生産日程本体CSVと部品納期個数（補助）の照合ずれ・上流データ・表示設計の整理

## Context

2026-04-03 前後、キオスク生産日程で **Gmail 経由の部品納期個数CSV（補助）** を取り込んでも、一部行で **納期・指示数（`plannedQuantity` / `plannedStartDate` / `plannedEndDate`）が空**のままになる事象の調査を実施した。あわせて、**本体生産日程CSV**（件名例: `生産日程_三島_研削工程`）の取込成否・列不一致・手動アップロードUIの落とし穴も切り分けた。

本KBは **コード改修の記録ではなく**、調査で確定した仕様・事象・上流とのギャップ・将来判断用の背景を **再現可能な形**で残す。

## Symptoms（現場で見えること）

- 補助CSVは `CsvDashboardRow` に入り、同期ログも `COMPLETED` になることがあるが、キオスクの該当工程行だけ **納期・個数が `-`**。
- **別の工程行**では同じ製造オーダー番号（`ProductNo`）が反映されているように見える（「番号は入ったのにこの行だけ空」のように見える）。
- 管理画面の **手動CSV取込**で「アップロードに失敗した」とだけ出て、API に届いていない（別要因: UI の二重ファイル入力。下記）。

## 本システム上の仕様（コード正）

### 1. 本体（生産日程）の「同一行」と winner

- **論理キー（同一行の定義）**: `FSEIBAN` + `FHINCD` + `FSIGENCD` + `FKOJUN`（固定配列 `PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS`）。
- **同じ論理キーに複数の `ProductNo` が来た場合**: 数値として **大きい `ProductNo` を winner** とする（取込時の DEDUP・表示時の SQL winner 条件で共通化）。
- **実装参照**: `apps/api/src/services/production-schedule/row-resolver/constants.ts`, `max-product-no-resolver.ts`, `max-product-no-sql.ts`, `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`。

### 2. 補助（部品納期個数）の照合キー

- 補助側の1行は、本体の **winner 行**に対して **次の3つが完全一致**するときだけ `ProductionScheduleOrderSupplement` に載る:
  - `ProductNo`（補助CSVの列）
  - `FSIGENCD`（正規化: trim + 大文字化）
  - `FKOJUN`
- **製番（`FSEIBAN`）・品番（`FHINCD`）は照合キーに含めない**（`KB-297` の設計判断: `FSIGENCD + ProductNo` だけでは衝突があり得るため、工順を含めた3キー）。
- **実装参照**: `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts`（`buildOrderSupplementKey`, `resolveWinnerIdByKey`, `buildReplacementCreateInputs`）。
- **同期結果**: `matched` / `unmatched` がログ・手動アップロード応答の `orderSupplementSync` に出る。`unmatched` は **誤結合を避けるため仕様どおり捨てる**（補助を無関係な本体行に誤マージしない）。

### 3. 手動アップロードと Gmail の扱い

- **どちらの経路も**、補助ダッシュボードIDのとき取込成功後に **`syncFromSupplementDashboard`** が走る（Gmail だけ同期していた実装差は **KB-326 で解消**）。
- **取込先ダッシュボードは URL の `:id` で決まる**。ファイル内容で本体／補助を自動判定はしない。本体用CSVを補助ダッシュボードに上げると列マッピングが破綻する（運用ミス扱い）。

### 4. 本体CSV取込失敗（列不一致）と運用上の副作用

- 本体ダッシュボードで必須列（例: `FHINCD`）がヘッダ不一致だと **`CSV_HEADER_MISMATCH`** で FAILED になり得る。
- **NON_RETRIABLE** 扱いの失敗メールは Gmail 側で **既読・ゴミ箱** 等の後処理に寄る（再試行待ちに残さない設計）。**「メールは取得できているが中身が取り込まれていない」**と体感しうる。
- その間も **過去に取込済みの本体行はDBに残る**。補助だけ新しい `ProductNo` で届くと、**本体の該当論理キー行は古い `ProductNo` のまま**になり、補助3キーと一致せず **unmatched** になる。

### 5. 「同じアイテムなのに本装置では別行」になりうる理由（背景）

上流の生産管理システム側では、例えば次のような **照合・繰り上げ想定**がありうる（現場調査メモ・2026-04 時点）:

- **製番 + 工順 + 製造オーダー番号 + 品番** の組で行を管理している。
- **製造オーダー番号だけが繰り上がる**パターンは、本システムの **winner（同一論理キー内で大きい ProductNo）** と整合しやすい。
- **工順や資源（工程）が変わる**パターンは、上流では「同じアイテムの続き」でも、本システムでは **論理キーが別行**になる。補助は **製造オーダー + 資源CD + 工順** で突き合わせるため、**本体の行キーとズレると永続的に unmatched** になりうる。

また、上流の抽出クエリ（例: **切削オンリー**系）で **`FSIGENCD` が欠落**していた事例があり、**クエリ修正・追加済み**との報告がある（本リポジトリ外の一次情報。**本番CSVの列への反映は、その後の出力次第**）。

### 6. 「無効化フラグ」「展開数ゼロ」「所要量」について（本コードベース）

- **業務上の「無効アイテム」**を表す列を本システムが標準解釈している実装は **未確認**（ERP 側にフラグがあっても、現状の生産日程取込は **特に見ていない**前提）。
- `FSIGENSHOYORYO`（所要時間）は、集計クエリ等で **数値として読めれば合算、読めなければ 0** 扱いなどに使われるが、**「無効だから行を隠す」判定には使っていない**。
- 行の削除・整理は主に **1年超過の削除**と **同一論理キーの loser 行削除**（`ProductionScheduleCleanupService`）。**「補助が付かない行を自動非表示」は未実装**。

## Investigation summary（事例としての観測）

- **補助同期**: 本番で `scanned` / `matched` / `unmatched` が大量に出ることがある。`unmatched` の典型は **補助の `FSIGENCD` と本体 winner の `FSIGENCD` が一致しない**パターン（例: 補助 `503`・本体側同一 `ProductNo` は `052/584/587` のみ、など）。
- **特定キー例**（調査スレッドより）: 補助に `ProductNo=0003725173, FKOJUN=210, FSIGENCD=060` がある一方、本体の同一製番・品目の **210/060 行**は **別の `ProductNo`** のまま残り、補助3キーと一致しない → **納期・個数が付かない**。本体の別工程（例: 200/24M, 220/588）は新しい `ProductNo` で更新されていても、**論理キーが違う行は自動では繰り上がらない**（仕様どおり）。
- **本体取込**: 同一日に **COMPLETED と FAILED（FHINCD 不一致）**が短時間に連続する観測があり、**どのメール本文が成功バッチに入ったか**が結果を分ける。空／BOMのみの添付など**上流出力品質**の話も別途切り分けが必要（調査当時、保存サンプルが実質空だったケースの報告あり）。

## Root cause（整理）

事象は単一ではない。**典型は次の併存**:

1. **仕様どおりの厳密照合**により、補助3キーに合う本体 winner が無い → `unmatched` → 画面は空。
2. **本体CSVが最新化されていない**（列不一致で失敗・一部時刻帯だけ成功など）→ 本体側 `ProductNo` や工程構成が古いまま → 1 へ接続。
3. **上流で工程・資源が動く**と、補助CSVと本体CSVの **キー設計の前提がズレる** → 1 が大量発生しうる。
4. （UI）**プレビュー用ファイル入力とアップロード用入力が別**で、ユーザーがプレビューだけ選ぶと **API 未到達**（`CsvDashboardsPage.tsx`）。**KB-326 の「同期が走らない」と混同しやすい**。

## Fix / 対策候補（記録のみ・未実施のもの含む）

本節は **採用決定ではない**。判断材料としての列挙。

| 方向 | 内容 | 長所 | 注意 |
|------|------|------|------|
| 上流整合 | 補助・本体双方のCSVで **同一の3キー**が揃うよう、抽出クエリ・マスタ・出力定義を揃える | 仕様を崩さず根本解に近い | リリースサイクル・組織外依存 |
| 上流: 無効フラグ | ERP 側の **無効・展開0** 等をCSV列として落とし、本システムで **取込対象外／表示対象外** を定義する | 幽霊行を減らせる | 列定義・意味の契約が要る。現状未実装 |
| 本システム: 表示 | **補助が付かない行を非表示**にする（またはタブ分け） | UX上「空の納期」への摩擦を下げ可能 | **現場がまだ見るべき行まで消す**リスク。要件要確認 |
| 本システム: ENRICHMENT_CONTRACT | `FSEIBAN+FHINCD` 等で **別ルールの補助マージ**を足す | 柔軟 | **誤結合のリスクが高い**。ADR と堅いテストが前提 |

**重要**: `ProductNo + FSIGENCD + FKOJUN` の厳密一致は、**誤った工程行へ納期を塗る事故**を防ぐ意図があり、安易に緩めるとデータ意味が壊れうる。

## Troubleshooting checklist

1. **手動 upload の応答**に `orderSupplementSync` があるか（無い → 補助ダッシュボードIDではない／同期スキップ／クライアント側失敗。Network タブで `POST .../upload` を確認）。
2. **同期結果**の `matched` / `unmatched`。`unmatched` が多い → キー不一致パターンを疑う。
3. **本体 `CsvDashboardIngestRun`** が該当日に `COMPLETED` か、直近 `FAILED` の **`errorMessage`（FHINCD 等）** を確認。
4. **DB**: 補助のキー行はあるが本体 winner の `rowData` の3キーが一致するか（`CsvDashboardRow` + `buildMaxProductNoWinnerCondition` の考え方）。
5. **管理画面**: プレビューではなく **「CSVアップロード（取り込み）」** のファイル欄で選択しているか。

## References（コード）

- `apps/api/src/services/production-schedule/row-resolver/constants.ts`
- `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts`
- `apps/api/src/services/csv-dashboard/csv-dashboard-post-ingest.service.ts`
- `apps/api/src/services/production-schedule/retention/production-schedule-cleanup.service.ts`
- `apps/web/src/pages/admin/CsvDashboardsPage.tsx`（プレビュー／アップロードの二重 `input`）

## Related KB

- [KB-297](./KB-297-kiosk-due-management-workflow.md)（部品納期個数の境界分離・補助反映の全体）
- [KB-326](./KB-326-manual-upload-order-supplement-sync.md)（手動 upload 後の補助同期）
- [KB-324](./KB-324-gmail-order-supplement-prisma-transaction.md)（補助同期トランザクション）
