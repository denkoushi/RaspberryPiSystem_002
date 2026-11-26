---
title: "KB-456: 製番ボードで、別の資源に完了(C)が付いた工程が未完了のまま残る"
tags: [生産スケジュール, FKOJUNST_Status, 製番ボード, 順位ボード, 資源付け替え, 組立]
audience: [開発者, 運用者]
last-verified: 2026-11-26
related: [KB-373, KB-328, ADR-20260509-fkojunst-status-completion-matching-policy]
category: knowledge-base
---

# KB-456: 製番ボードで、別の資源に完了(C)が付いた工程が未完了のまま残る

- Status: 方針決定 → [ADR-20261125](../decisions/ADR-20261125-fkojunst-resource-swap-completion.md)(付け替え先の C を保存する完了に反映。全画面に効かせる)
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

両方の CSV は資源が食い違っているという事実までしか示さない。理由は運用側で確認済み: 工程の負荷を避けるため、生産システム側で工程(資源)を変えることはよくある(2026-11-25 ユーザー回答)。生産日程 CSV がその変更に追いつかないため、この食い違いは今後も続けて起きる。

### 2. ボードに出ているのはどれか

- **順位ボード**: 通常の一覧は、その行自身の状態(`fkmail` の S/R/C/X)がある行だけを出す([`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts))。今回の行は自分の資源の状態が無いので、**順位ボードには出ていない**(見本 3 行で `fkmail` 0 件を確認)。
- **製番ボード**: 登録製番から行を集めるので、この表示条件を通らない(`fetchLeaderboardPlanningScopedParentRowIds` の `includeLegacyVisibility: false`)。今回の部品 129 行のうち、登録製番に入っているのは **13 行**(C 10、X 2、手で完了済み 1)。研削・切削の区分の切り替えで、そのうち該当する区分の行だけが見える。
- **組立の行はどちらのボードにも出ない**: 本番の `cuttingExcludedResourceCds` は `第2工場` と `shared` の両方で `{10,KUMITATE1,KUMITATE2,MSZ}`。製番ボードの「切削」「両方」から外れ、研削の固定リストにも入らない。順位ボードには組立の資源の枠が設定されておらず、行自身の状態も無い。

### 3. 「着」はすでに付け替えを完了とみなしている

[#2889](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2889) の [`process-arrival-resource-swap.ts`](../../apps/api/src/services/production-schedule/process-arrival-resource-swap.ts) が、次の工程の「着」の判定だけで、同じ製造オーダ・工順の別資源の C を完了とみなしている。保存している完了(外部完了)は変えていない。
そのため製番ボードでは、後の工程は「着」になるのに、前の工程の行は未完了のまま残る、という食い違いが起きている。

## Proposal(当初案と決定)

当初は、製番ボードの表示だけで付け替えの完了を完了とみなす案を推した。#2889 と同じ形で、保存する完了は変えない案だった。
ユーザーの判断(2026-11-25)で、負荷集計・納期管理・進捗・モバイルにも効くよう、**保存する外部完了に反映する**ことに決めた。規則と理由は [ADR-20261125](../decisions/ADR-20261125-fkojunst-resource-swap-completion.md)。

規則の要点:
1. 同じ製造オーダ・同じ工順で、別の資源の最新の状態が `C`。`X` は含めない(今回 8 行)。
2. 生産日程にその製造オーダ・工順の行が1行だけ。除外資源(`10`、`MSZ`、組立)の行は数えない。2行ある場合は対象外(今回 8 行。例 `0003840781` 工順220 の `581` と `583` に対し、状態は `580:X` 1件)。
3. 自分の資源に状態があるなら、それが `S` ではなく、別資源の `C` の方が同じか新しい。
4. どちらの資源も除外資源(`10`、`MSZ`、組立など)ではない。

### 追加(2026-11-26): 自分が `R` なら winner 2行でも適用する

研削のガントで、製造オーダ `0004174191`・`0004174221` の工順200 の資源 `26M` が済みにならなかった。同じ工順に生産日程の行が `24M` と `26M` の2行あり、状態は `24M` が `C`(11/16・11/17)、`26M` が `R`(10/20 のまま)。規則2で外れていた。

ユーザーの判断で、自分の資源の最新状態が `R` のときだけ、規則2(行が1行だけ)を外す。`R` で止まった資源は、付け替えで使われなくなった工程とみなす。ほかの条件(工順が同じ、別資源がちょうど1つで `C`、`R` が `C` と同じか古い、除外資源でない)は変えない。winner が2行のとき、相手の `C` は証拠テーブルではなく、もう一方の winner 行に一致した状態として持つので、保存の SQL は両方を見る。負荷集計用の資源は今までどおり1行のときだけ。

`O` は対象にしない。`O` の大半は10桁の工程コードで、工場の加工工程に入っていない。機械の資源で相手が `C` の `O` は16行だけだった。`P`・`S`・状態なしも今までどおり。

本番を読むだけで実装と同じ SQL を流した結果(2026-11-26): 新しく完了になるのは 213 行、製番ボードの登録製番で 15 行。今まで完了だった行で外れるものは 0 行。製造オーダ `0004030334` の工順210 は変わらない(`033`・`035` は状態の C で完了済み、`10` は除外資源)。

最新の取り込み(2026-11-24)だけで数えた見込みは、部品 112 行、製番ボードの登録製番で 9 行だった。
実装と同じ規則で生産日程の全 winner を数え直すと(2026-11-25、下の2つ目の SQL)、**新しく完了になるのは 821 行、製番ボードの登録製番で 57 行**(規則を満たすのは 825 行、うち 4 行はすでに完了)。内訳:

- 最新の取り込みの行 216 行(ボード 34 行)。自分の資源に状態が無い 106 行、`R` 107 行、`O` 2 行、`P` 1 行。最初の見込み(112 行)はこのうち「状態が無い」行にあたる。
- それより前の取り込みの行 244 行(ボード 19 行)。状態が無い 196 行、`R` 42 行、`O` 3 行、`P` 3 行。
- 取り込み日の無い古い行 361 行(ボード 4 行)。このうち `SKKT`→`051X` の 271 行など、番号の体系が違って見える組がある。どれも製番ボードには出ていない。
- 多い組は機械の付け替え(`051`→`503`、`070`→`503`、`021`→`504`、`070`→`120`、`080`→`090`、`587`→`586`)。
- 821 行のうち 514 行は、同じ工順に資源 `10` か `MSZ` の行も並ぶ。最初の数え方ではこれを「2行」として外していた。
- 割り当て(順位)の付いた行は 0 行。組立の行は 0 行。

自分の資源が `R` のまま、付け替え先が `C` の行も完了になる。別の資源で同じ製造オーダ・工順を終えたので、作業は済んでいるとみなす。

証拠テーブルには、生産日程に winner のある工程(製造オーダ+工順)の状態だけを残す。状態 CSV の全履歴(約 92 万の組)のうち、残るのは約 2.8 万行。

付け替え先が S/R/O/P で資源マスタにある場合は負荷の数字だけを付け替え先に計上する。マスタにない場合は元の機械に計上し(負荷調整は元から、自分の資源に状態の無い行を数えないので、その行は数えないまま)、表示と順位は元の資源を使う。2026-11-26 の本番読み取りでは 051→503 が116行、070→503 が72行、052→503 が33行、060→080 が12行、587→586 が4行などが移り、マスタ未登録の約39行は元に残る見込み。

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

実装と同じ規則で、付け替え完了になる行を数える(数分かかる)。`done` はすでに完了している行。

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '600s';
WITH st AS MATERIALIZED (
  SELECT DISTINCT ON (n, j, r) n, j, r, s, u FROM (
    SELECT btrim("rowData"->>'FSEZONO') n, btrim("rowData"->>'FKOJUN') j, upper(btrim("rowData"->>'FKOTEICD')) r,
      upper(btrim("rowData"->>'FKOJUNST')) s,
      CASE WHEN "rowData"->>'FUPDTEDT' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' THEN ("rowData"->>'FUPDTEDT')::timestamp END u,
      "sourceIngestRunStartedAt" g, "sourceRowOrdinal" o
    FROM "CsvDashboardRow" WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e') x
  WHERE n <> '' AND j <> '' AND r <> ''
  ORDER BY n, j, r, u DESC NULLS LAST, g DESC NULLS LAST, o DESC NULLS LAST),
w AS MATERIALIZED (
  SELECT c.id, btrim(c."rowData"->>'ProductNo') n, btrim(c."rowData"->>'FKOJUN') j, upper(btrim(c."rowData"->>'FSIGENCD')) r,
    f."statusCode" os, CASE WHEN f."sourceUpdatedAt" <> '1970-01-01' THEN f."sourceUpdatedAt" END ou,
    COALESCE(upper(f."statusCode") IN ('C', 'X'), false) OR COALESCE(p."isCompleted", false)
      OR COALESCE(e."isExternallyCompleted", false) done
  FROM "CsvDashboardRow" c
  LEFT JOIN "ProductionScheduleFkojunstMailStatus" f ON f."csvDashboardRowId" = c.id
  LEFT JOIN "ProductionScheduleProgress" p ON p."csvDashboardRowId" = c.id
  LEFT JOIN "ProductionScheduleExternalCompletion" e ON e."csvDashboardRowId" = c.id
  WHERE c."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01' AND c."supersededAt" IS NULL),
single AS (SELECT n, j FROM w WHERE n <> '' AND j <> '' AND r NOT IN ('10', 'KUMITATE1', 'KUMITATE2', 'MSZ')
  GROUP BY n, j HAVING count(*) = 1),
ev AS MATERIALIZED (SELECT st.* FROM st WHERE NOT EXISTS (SELECT 1 FROM w WHERE w.n = st.n AND w.j = st.j AND w.r = st.r)),
sw AS (
  SELECT w.id, bool_or(w.done) done
  FROM single JOIN w USING (n, j) JOIN ev ON ev.n = w.n AND ev.j = w.j AND ev.r <> w.r
  WHERE w.r <> '' AND w.r NOT IN ('10', 'KUMITATE1', 'KUMITATE2', 'MSZ')
  GROUP BY w.id
  HAVING count(*) = 1 AND bool_and(ev.s = 'C' AND ev.r NOT IN ('10', 'KUMITATE1', 'KUMITATE2', 'MSZ') AND ev.u IS NOT NULL
    AND (w.os IS NULL OR (w.os <> 'S' AND w.ou IS NOT NULL AND ev.u >= w.ou))))
SELECT count(*) total, count(*) FILTER (WHERE NOT done) newly FROM sw;
ROLLBACK;
```
