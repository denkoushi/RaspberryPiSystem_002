# Surface treatment identification from FKOJUNST process codes (2026-11-05)

## Metadata

- Date: 2026-11-05
- Status: finding recorded; meaning of the two LSLH codes is not yet confirmed
- Scope: telling which parts of a seiban go to LSLH / カニゼン / 塗装, without hand-entered settings
- Data: production Pi5 DB, read-only queries (`BEGIN READ ONLY`)
- Related: D社日程エクセルの★（LSLH 処理出し日）, `ProductionScheduleDScheduleMinutes.surfaceSendOutDates`, [ADR-20260508](../decisions/ADR-20260508-fkojunst-status-sole-source.md)

## Background

D社日程エクセルの★は「LSLH 表面処理の期限」で、製番単位で取り込んでいる。同じ製番の部品の大半は塗装なので、★を製番の全部品に付けると誤りになる。LSLH の部品だけを見分ける必要がある。

これまで部品の表面処理の種類は、人が画面で登録した値しかなかった。

- `ProductionSchedulePartProcessingType`（品番ごと。納期管理の画面で登録）
- `ProductionScheduleRowNote.processingType`（行ごと。生産スケジュールの画面で登録）

2026-11-05 時点で、★のある製番の部品の大半（約 1,600 行）は未登録だった。手入力では漏れが出る。

## Finding

工程状況 CSV（`ProductionSchedule_FKOJUNST_Status`、列 `FSEZONO, FKOJUN, FKOTEICD, FKOJUNST, FUPDTEDT`）の `FKOTEICD` に、表面処理ごとのコードが出る。`FSEZONO` を本体 CSV（`ProductionSchedule_Mishima_Grinding`）の `ProductNo` と突き合わせると、品番（`FHINCD`）と製番（`FSEIBAN`）に結び付く。

| Treatment | FKOTEICD | Evidence (vs hand-registered 品番) |
| --- | --- | --- |
| LSLH | `1143016000`, `1143016002` | 登録 LSLH 59 品番すべてに付く。登録 塗装 102 品番では 1 品番だけ |
| カニゼン | `1127426000` | 登録 カニゼン 5 品番すべてに付く |
| 塗装（社内） | `568`, `569` | 登録 塗装 102 品番のうち 96 / 94 品番に付く |

Coverage for D社★:

- ★のある 34 製番すべてで、LSLH コードの付いた部品が見つかる（手入力の登録では 24 製番だけ）
- ★のある製番の部品 249 品番のうち、LSLH コード付きは 81 品番

Other observations:

- 本体 CSV の資源 `MSZ`（三島製造課）は 塗装 102 品番中 95 に付き、LSLH 59 品番には 0。補助的な手がかりになる
- 本体 CSV の資源 `SKKT`（仙台 製造課 塗装班）は登録 塗装 品番で 1 回しか出ない。目印には使えない
- 購買 CSV（`PurchaseOrder_FKOBAINO`）は品名（`FKOBAIHINMEI`）に処理の種類がほとんど書かれず、仕入先の列も無い。目印には使えない
- 他の CSV（`OrderSupplement`, `SeibanMachineNameSupplement`, `CustomerSCAW`, `ScawStFutekigo` など）に表面処理を示す列は無い

## Open question: the two LSLH codes

`FKOJUNST` の分布（2026-11-05 時点の取り込み全行）:

| FKOTEICD | C | O | P | R | S | X |
| --- | --- | --- | --- | --- | --- | --- |
| `1143016000` | 527 | 6,612 | 58,612 | 16 | 2 | 915 |
| `1143016002` | 7,280 | 23 | 93 | 1,532 | 0 | 22 |

`1143016000` は大半が未着手（P/O）、`1143016002` は大半が完了（C）。「処理に出す／戻る」の段階の違いか、取引先や時期の違いかは、データからは分からない。10 桁のコードは取引先コードの形にも見える。意味が分かったらこの節を更新する。

当面の扱い: どちらかのコードが付いた部品を LSLH とみなす。

## Decision for the board (2026-11-05)

- 製番ボードのガントでは、★（LSLH 処理出し日）は LSLH の部品のバーにだけ付ける。塗装の部品には付けない
- 過ぎた★も、その製番の LSLH の部品が全部「部品の加工完了」になるまで赤で出し続ける。消すきっかけは LSLH 工程の状態ではなく、ボード上の部品の完了
- 見た目の案（A: バーに付ける / B: 行の左端にまとめる）は未決。見本: https://claude.ai/artifact/4fw6yqAXcEj7N8Ha7Wzd7C

## Reproduce (read-only)

```sql
BEGIN READ ONLY;
WITH reg AS (
  SELECT fhincd, "processingType" AS pt FROM "ProductionSchedulePartProcessingType"
),
m AS (
  SELECT DISTINCT "rowData"->>'ProductNo' AS pn, "rowData"->>'FHINCD' AS h
  FROM "CsvDashboardRow"
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'   -- ProductionSchedule_Mishima_Grinding
),
s AS (
  SELECT DISTINCT "rowData"->>'FSEZONO' AS pn, "rowData"->>'FKOTEICD' AS cd
  FROM "CsvDashboardRow"
  WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'   -- ProductionSchedule_FKOJUNST_Status
)
SELECT reg.pt, s.cd, count(DISTINCT reg.fhincd)
FROM reg JOIN m ON m.h = reg.fhincd JOIN s ON s.pn = m.pn
GROUP BY 1, 2 HAVING count(DISTINCT reg.fhincd) >= 3
ORDER BY 1, 3 DESC;
COMMIT;
```
