---
title: "KB-456: 製番ボードで、別の資源に完了(C)が付いた工程が未完了のまま残る"
tags: [生産スケジュール, FKOJUNST_Status, 製番ボード, 順位ボード, 資源付け替え, 組立]
audience: [開発者, 運用者]
last-verified: 2026-11-25
related: [KB-373, KB-328, ADR-20260509-fkojunst-status-completion-matching-policy]
category: knowledge-base
---

# KB-456: 製番ボードで、別の資源に完了(C)が付いた工程が未完了のまま残る

- Status: 調査済み・案を提示(コード変更なし。実装はユーザーの判断待ち)
- Date: 2026-11-25
- Data: 本番 DB を `BEGIN READ ONLY; … ROLLBACK;` で読み取りのみ

## Context

製番ボード・順位ボードの「完了を隠す」は、生産日程の行と `FKOJUNST_Status` を **製造オーダ(ProductNo)+工順(FKOJUN)+資源(FSIGENCD=FKOTEICD)の3つが一致**したときだけ完了にする([ADR-20260509](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md) の決定1)。
3つが一致する行は、すべて正しく完了になっている。問題は、生産システム側では同じ製造オーダ・同じ工順が完了(C/X)なのに、**資源の番号だけが違う**行。

## Measurements (2026-11-25)

対象: 生産日程の最新取り込み(`sourceIngestRunStartedAt` が 2026-11-24 の2回分)、資源 `10` / `MSZ` を除く。状態は製造オーダ・工順・資源ごとに `FUPDTEDT` が最新の1件。

| 区分 | 自分の資源の状態が無く、同じ製造オーダ・工順に別資源の状態がある行 | うち別資源が C/X |
|------|------|------|
| 部品(組立以外) | 179 行 | 129 行(C 121、X 8。うち 3 行は現場が手で完了済み) |
| 組立(`KUMITATE1` / `KUMITATE2`) | 4,363 行 | 1,842 行 |

依頼文の数(126 / 53 / 4,539)とは、手で完了済みの 3 行の扱いと集計の時点で少しずれる。上はこの KB の定義での値。

## Findings

### 1. 部品の行は「工程の資源が付け替えられた」ものと読める

- 179 行すべてで、状態データ側の別資源は **ちょうど1つ**。
- 179 行のうち 171 行は、生産日程にその製造オーダ・工順の行が **1行しかない**(残り 8 行は同じ工順に日程の行が2つある)。
- 付け替え先は同じ種類の機械どうしが多い: `051`/`070`/`052`(立型)→ `503`(5軸 MU-4000V)が完了 83 行・未完 40 行、研削 `58x` どうし、`501`↔`502`、`24M`/`26M`/`27M`↔`021` など。
- まだ終わっていない 50 行も、別資源の側は `P`(予定)や `R` になっている。つまり完了の前から、生産システムは別の資源でその工程を持っている。生産日程 CSV だけが元の資源のまま。
- 現場は 3 行(`581`→`589:C` 2行、`584`→`504:C`)を手で完了にしている。

両方の CSV は資源が食い違っているという事実までしか示さない。生産システム側で付け替えた理由までは、データからは分からない。

### 2. ボードに出ているのはどれか

- **順位ボード**: 通常の一覧は、その行自身の状態(`fkmail` の S/R/C/X)がある行だけを出す([`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts))。今回の行は自分の資源の状態が無いので、**順位ボードには出ていない**(見本 3 行で `fkmail` 0 件を確認)。
- **製番ボード**: 登録製番から行を集めるので、この表示条件を通らない(`fetchLeaderboardPlanningScopedParentRowIds` の `includeLegacyVisibility: false`)。今回の部品 129 行のうち、登録製番に入っているのは **13 行**(C 10、X 2、手で完了済み 1)。研削・切削の区分の切り替えで、そのうち該当する区分の行だけが見える。
- **組立の行はどちらのボードにも出ない**: 本番の `cuttingExcludedResourceCds` は `第2工場` と `shared` の両方で `{10,KUMITATE1,KUMITATE2,MSZ}`。製番ボードの「切削」「両方」から外れ、研削の固定リストにも入らない。順位ボードには組立の資源の枠が設定されておらず、行自身の状態も無い。

### 3. 「着」はすでに付け替えを完了とみなしている

[#2889](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2889) の [`process-arrival-resource-swap.ts`](../../apps/api/src/services/production-schedule/process-arrival-resource-swap.ts) が、次の工程の「着」の判定だけで、同じ製造オーダ・工順の別資源の C を完了とみなしている。保存している完了(外部完了)は変えていない。
そのため製番ボードでは、後の工程は「着」になるのに、前の工程の行は未完了のまま残る、という食い違いが起きている。

## Proposal

### 部品の行: 製番ボードの表示だけ、付け替えの完了を完了とみなす(推奨)

ADR-20260509 の決定1は「保存する完了・工順ST の上書き」の範囲を決めている。そこは変えない。#2889 と同じく、**表示の判定だけ**で次の条件をすべて満たす行を完了として扱う。

1. 同じ製造オーダ・同じ工順で、別の資源の最新の状態が `C`。`X`(場外)は #2889 にそろえて含めない(今回 8 行)。
2. 生産日程にその製造オーダ・工順の行が1行だけ。2行ある場合(今回 8 行。例 `0003840781` 工順220 の `581` と `583` に対し状態は `580:X` 1件)は、どちらの行の完了か決められないので対象外。
3. 自分の資源に状態があるなら、`S` ではなく、別資源の `C` の方が新しいか同じ時刻(#2889 と同じ)。
4. どちらの資源も除外資源(`10`、`MSZ`、組立など)ではない。

この条件だと今回は部品 112 行が完了になり、製番ボードの登録製番では 9 行。

理由:
- 製造オーダと工順は厳密一致のままで、ADR が退けた案(製番単位の推測、工順を無視した照合)には当たらない。資源だけを、相手が1つに決まるときに限って許す。
- 同じ規則をすでに「着」で使っており、行の完了と「着」の食い違いが消える。
- 保存する完了を変えないので、取り消しや再計算の仕組みに手を入れない。

残る影響: 負荷の集計・納期管理・進捗一覧・モバイルは保存した完了を使うので、これらの行は未完了のまま数えられる。全画面で完了にしたいなら、ADR-20260509 の決定1を改める新しい ADR が要る。

### 採らない案

- 外部完了(`ProductionScheduleExternalCompletion` / `fkmail`)に書き込む: ADR-20260509 の決定1に反する。
- 何もしない: 現場が手で完了にし続ければ表示は合う(今回 3 行)。ただし「着」との食い違いは残る。

### 組立の行: 変えない

組立の行は付け替えではなく、生産日程の `KUMITATE1/2` と状態データの `301`/`306`/`309`/`311`/`434` という **別の番号の体系**のずれ([KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md) と同じ種類)。1つの組立の行に、状態側の番号が1対1で決まる保証も無い。どちらのボードにも出ていないので、表示の問題は起きていない。組立の完了を使う画面を作るときに、番号の対応表を別に決める。

## Re-check

```sql
BEGIN READ ONLY;
WITH sc AS MATERIALIZED (
  SELECT r.id, upper(btrim("rowData"->>'ProductNo')) k_no, upper(btrim("rowData"->>'FKOJUN')) k_jun,
         upper(btrim("rowData"->>'FSIGENCD')) k_cd
  FROM "CsvDashboardRow" r
  WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
    AND "sourceIngestRunStartedAt"::date = '2026-11-24'
    AND upper(btrim("rowData"->>'FSIGENCD')) NOT IN ('10', 'MSZ')),
st AS MATERIALIZED (
  SELECT DISTINCT ON (k_no, k_jun, k_cd) k_no, k_jun, k_cd, st, upd FROM (
    SELECT upper(btrim("rowData"->>'FSEZONO')) k_no, upper(btrim("rowData"->>'FKOJUN')) k_jun,
           upper(btrim("rowData"->>'FKOTEICD')) k_cd, upper(btrim("rowData"->>'FKOJUNST')) st, "rowData"->>'FUPDTEDT' upd
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'
      AND upper(btrim("rowData"->>'FSEZONO')) IN (SELECT DISTINCT k_no FROM sc)) x
  ORDER BY k_no, k_jun, k_cd, upd DESC NULLS LAST),
agg AS (SELECT k_no, k_jun, array_agg(k_cd) cds, bool_or(st IN ('C', 'X')) anydone FROM st GROUP BY 1, 2)
SELECT sc.k_cd LIKE 'KUMITATE%' AS assembly, agg.anydone, count(*)
FROM sc JOIN agg USING (k_no, k_jun)
WHERE NOT (sc.k_cd = ANY (agg.cds))
GROUP BY 1, 2;
ROLLBACK;
```

状態は製造オーダで先に絞ってから突き合わせる。行ごとの相関サブクエリにすると数分かかる(2026-11-25 に取り消した)。
