---
title: KB-363 キオスク負荷調整と生産システムの集計突合（2026-05-27）
tags: [kiosk, production-schedule, load-balancing, reconciliation, FSIGENSHOYORYO, FSIGENSHOYOYMD]
audience: [開発者, 運用者, 設計者]
last-verified: 2026-05-27
---

# KB-363: キオスク負荷調整 × 生産システム — データ源・用語・突合結果

## Context

キオスク **負荷調整**（`/kiosk/production-schedule/load-balancing`）の月次負荷が、生産システムの「負荷残」「負荷消費」と一致しない、という現場・検証上の問いに対し、**2026-05〜05-27** に Pi5 本番 DB・生産 CSV・スクリーンショット・コード正本で突合した記録。

**結論の要約**:

- **不一致の主因は取り込み不良ではなく、データ源・粒度・月の載せ方・工数式・FKOJUNST 母集団の差**（複合）。
- 生産の積み上げグラフの日付軸は **`FSIGENSHOYOYMD`（資源所要量テーブル）** であり、キオスクの **着手日・納期・日割り** とは別物。
- **`FSIGENSHOYOYMD` にはキオスク負荷調整を合わせない**（着手日基準を正とする）。→ [ADR-20260527](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)
- 着手日タブの **`FSIGENSHOYORYO × plannedQuantity`** は過大集計の有力因（`FSIGENSHOYORYO` は行総分）。→ **2026-05-27 修正済み**（`feat/kiosk-load-balancing-aggregation-fix`）。

関連: [KB-362](./KB-362-kiosk-load-balancing.md)（機能正本） / [分析詳細](../analysis/production-load-balancing-reconciliation-with-production-system-20260527.md) / [ガイド](../guides/kiosk-production-schedule-load-balancing.md)

---

## Symptoms（よくある誤解）

| 症状 | 実際 |
|------|------|
| 「生産と合わない＝CSV が壊れている」 | **必ずしもそうではない**。定義が違うと数値は一致しない。 |
| 「着手日タブが生産の残706Hを出すべき」 | 生産 **706H** は **`FSIGENSHOYOYMD` 軸＋残/消費の重なり定義** に近い。着手日日割りとは別。 |
| 「一覧表の標準工数(H)を足せば月次と一致」 | 一覧は **工程残台帳**（5〜6月着手が多い）。**7月の月次合計そのものではない**。 |
| 「P が多いから着手日が過小」 | **ケース依存**。033・5月日割りでは P は **5月セル0H**（日付ウィンドウで按分されない）等あり。 |

---

## データ源とテーブル（2系統）

### A. 生産日程 CSV（キオスクが参照）

| 項目 | 内容 |
|------|------|
| 格納 | `CsvDashboardRow.rowData`（dashboard `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01`） |
| 粒度 | **winner 行＝1工程**（`FSEIBAN`+`FHINCD`+`FSIGENCD`+`FKOJUN`、ProductNo 最大） |
| 主な列 | `ProductNo`, `FSEIBAN`, `FHINCD`, `FSIGENCD`, `FKOJUN`, **`FSIGENSHOYORYO`（分・行総分）** |
| 補足 | `ProductionScheduleOrderSupplement.plannedStartDate` / `plannedEndDate`、`ProductionScheduleRowNote.dueDate` |
| FKOJUNST | `ProductionScheduleFkojunstMailStatus`（メール同期） |
| **無いもの** | **`FSIGENSHOYOYMD` は rowData に存在しない**（Pi5・033 行 514 件で 0 件確認） |

### B. 資源所要量 CSV（生産グラフ用・別取込）

| 項目 | 内容 |
|------|------|
| 例 | `data_scawSTSIGENSHOYORYO.csv`（列: `FSAGYOKB`, `FSEZONO`, `FSIGENCD`, **`FSIGENSHOYOYMD`**, `FKOJUN`, **`FSIGENSHOYORYO`**） |
| 粒度 | **1製番（FSEZONO）× 工程 × 日** ごとに複数行（日別按分済み） |
| 工数 | 行の `FSIGENSHOYORYO` は **その日の分（分）** |
| キオスク | **未取込・未参照** |

### 資源 CD の対応（N7）

- 生産 UI の工程名 **「横型(ニイガタ N7)」** ↔ CSV の **`FSIGENCD` = `033`**（検算・DB で使用）。

---

## FKOJUNST（工順ST）— コード正本とタブ差

正本: `apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts`

| コード | 意味（コードコメント） | 一覧表示 | 負荷「消滅」母集団（C/X 以外） |
|--------|------------------------|----------|--------------------------------|
| **C / X** | 完了（メール由来） | 表示可 | **除外** |
| **S / R** | 未完了・一覧表示 | 表示可 | **含む** |
| **O / P** | 未完了・一覧非表示 | **非表示** | **含む**（俯瞰 eligibility） |

タブごとの SQL 母集団:

| タブ | FKOJUNST | その他 |
|------|----------|--------|
| **資源CD俯瞰・外注** | **S/R/O/P**（C/X 除外・実効未完了） | 月=`plannedEndDate`、工数=総分のみ |
| **機種別月次・着手日（修正前）** | **S/R/C/X**（一覧可視ポリシー） | progress 未完のみ。着手日は **P/O 除外** |
| **機種別月次・着手日（修正後）** | **S/R/O/P**（eligibility） | **C/X 除外**・実効未完了・`fkmail` 必須 |
| 着手日の工数（修正後） | — | **`FSIGENSHOYORYO` 行総分のみ**（`start-date-leveling-assembler.ts`） |

**O**: `FSIGENCD` 非空が SQL 前提のため、**資源未振りの O は行ごと落ちる**（033 では O 0 件の例あり）。  
**P**: 俯瞰では入り得るが、**着手日タブの一覧可視条件で SQL 除外**。日割りで対象月に載るかは **着手/納期次第**。

---

## キオスク3タブの「月」と工数（再掲・突合用）

| タブ | 月の載せ方 | 工数 |
|------|------------|------|
| 資源CD俯瞰 | `plannedEndDate` の暦月 | `FSIGENSHOYORYO` 合計（×指示数しない） |
| 機種別月次 | 有効納期の暦月 | 同上 |
| 着手日・平準化 | 着手〜有効納期を稼働日**日割り**→月合算 | **`FSIGENSHOYORYO` 行総分**（修正後） |

`FSIGENSHOYORYO` は [所要・総分分析](../analysis/production-schedule-fsigenshoyoryo-analysis-20260324.md) のとおり **個数込み総分（分）** が正本。

---

## 突合ケース1: 資源 033（N7）・2026年5月（生産: 残95H / 消費301H）

**条件**: Pi5 DB・着手日平日日割り・検算スクリプト `apps/api/scripts/reconcile-033-may-patterns.mjs`

| パターン | 定義 | 5月・残(H) | 5月・消費(H) | 5月合計(H) |
|----------|------|-----------|-------------|------------|
| **A 現行着手日** | S/R/C/X・×指示数 | 231.2 | 855.9 | **1,087** |
| **B** | ×指示数なし・S/R/C/X | **51.1** | 174.2 | 225.3 |
| **C** | C/X除外・S/R/O/P | 51.1 | 0 | 51.1 |
| **D** | C除外・実効未完了 | 114.6 | 0 | 114.6 |
| **E/F** | S/R（+P） | 51.1 | 0 | 51.1 |
| **G/H** | C/Xのみ | 0 | **174.2** | 174.2 |
| **生産** | — | **95** | **301** | **396** |

**読み取り**:

- **×指示数**で着手日が **約5倍級**に膨らむ（A vs B）。
- **C/X を残に含める**と消費側が 174H（B 内訳）。生産 301H には未到達。
- **残95H** に最も近いのは **51H（S/R系）** で **約44H不足**。**D は114Hで過大**。
- **P199件**あるが **5月日割りでは P 按分0H**（着手/納期が5月と交差しない行が多い）。

---

## 突合ケース2: 資源 033（N7）・2026年7月（生産: 残706H / 消費113H）

### 2a. 生産所要量 CSV（`FSIGENSHOYOYMD` 軸）

添付 `data_scawSTSIGENSHOYORYO.csv`（7月・033のみ）:

| 集計 | H |
|------|---|
| **7月行の合計** | **735.0** |
| `FSIGENSHOYOYMD` **> 7/1**（残に近い） | **705.3** ≈ **706** |
| `FSIGENSHOYOYMD` **≦ 7/9** 累積（消費に近い） | **113.4** ≈ **113** |

**注意**: 706+113=**819** ≠ 735。**7/2〜7/9 が「残」と「消費」の両方に載る重なり**があり、単純な分割ではない（和集合=735H）。

### 2b. キオスク DB（着手日・納期軸）

| パターン | 7月・残(H) | 7月・消費(H) |
|----------|-----------|-------------|
| A 現行着手日（×指示数） | 30.8 | 145.8 |
| B S/R/C/X・総分のみ | 9.2 | 29.2 |
| **C/F S/R/O/P・C/X除外・日割り** | **428.6**（P **419.5**） | 0 |
| 俯瞰・納期月=7月・S/R/O/P | **430.5** | — |
| **生産** | **706** | **113** |

**読み取り**:

- **着手日現行**は P 除外で **残が過小**。
- **P を含む日割り/納期月**でも **約430H** で、**706H には約275H不足**。
- DB の未完了 **P 総分**（月按分なし）は **約993H**（別指標）。

### 2c. 生産一覧スクリーンショット（標準工数 H）

- 4枚・計 **約82行**・着手は主に **5月下旬〜6月**（**7月行はほぼ無し**）。
- **標準工数(H)の単純合計 ≈ 1,202H** → 生産 **819H** とも **735H** とも一致しない（台帳合計≠月次 KPI）。

---

## Investigation（仮説と結果）

| ID | 仮説 | 結果 |
|----|------|------|
| H1 | CSV 取り込み欠損 | **REJECTED**（FKOJUNST・FSIGENCD・FSIGENSHOYORYO は整合） |
| H2 | ×plannedQuantity 過大 | **CONFIRMED**（5月 A=1087H vs B=225H） |
| H3 | 着手日タブが C/X を「残」に混在 | **CONFIRMED** |
| H4 | P 除外で着手日が過小 | **PARTIAL**（7月は P 日割りで大量に載るが 706 には不足） |
| H5 | 生産グラフは FSIGENSHOYOYMD | **CONFIRMED**（CSV・数値で裏付け） |
| H6 | FSIGENSHOYOYMD をキオスクに合わせる必要 | **REJECTED**（山崩し目的は着手基準で成立。ADR 参照） |

---

## Root cause（整理）

1. **二つのデータ源**（工程1行 vs 日別所要量）を同一 KPI とみなしていた。
2. **月の定義**がタブごとに3種類あるうえ、生産は第4種（`FSIGENSHOYOYMD`）。
3. **着手日タブの工数式**が総分に対し **×指示数**（実装バグ級の定義ずれ候補）。
4. **FKOJUNST 母集団**がタブ・ラベル（残/消費）と一致していない。
5. 生産 **消費/残** はキオスクに **未接続**（`ProductionScheduleActualHours*` は別用途）。

---

## Fix（実施済み / 未実施）

| 区分 | 内容 |
|------|------|
| **実施済み（本 KB）** | 突合結果・用語・ADR のドキュメント化 |
| **実施済み（2026-05-27）** | 着手日 **×指示数廃止**；機種別・着手日の母集団を **eligibility**（C/X 除外・S/R/O/P・実効未完了）に統一 — **`bef423fe`** |
| **実施済み（2026-05-27）** | 能力/稼働日/分類/移管の **`site` 優先 + `shared` 補完**（キオスク読み取り）— **`37a7b6d4`** · [KB-362 §能力設定](./KB-362-kiosk-load-balancing.md#能力設定と-shared--sitekey2026-05-27) |
| **本番（Pi5 のみ）** | Detach **`20260527-161741-7843`** · Phase12 **43/0/0** · PR [#350](https://github.com/denkoushi/RaspberryPiSystem_002/pull/350) — Pi4×4 **未** |
| **未実施（任意）** | 生産 KPI との **別系統参考表示**；UI で非一致を明示（EXEC_PLAN タスク3） |
| **実施しない方針** | キオスク負荷調整の正本軸を **`FSIGENSHOYOYMD` に変更** |

---

## Prevention

- 現場説明では **「生産の H とキオスクの H は定義が違う」** を明示。一致を期待しない。
- 変更時は [KB-362](./KB-362-kiosk-load-balancing.md) と本 KB の **表（タブ×月×工数×FKOJUNST）** を同時更新。
- 再検算: `RECONCILE_RESOURCE` / `RECONCILE_YEAR_MONTH` / `RECONCILE_REMAIN_H` / `RECONCILE_CONSUMED_H` 付きで `apps/api/scripts/reconcile-033-may-patterns.mjs`（Pi5 `docker compose exec`）。

---

## 調査経緯（要約）

- **2026-05-27**: 実装なしの突合。Pi5 本番 DB + 所要量 CSV + 生産 UI スクショ + コード正本。
- **現場合意**: 生産 H との一致は不要。山崩しは **着手日・平準化** の定義で十分。
- **Mac ローカル**: Docker DB は検算に不適（空）。再現は Pi5 `docker compose exec` を正とする。
- **詳細時系列**: [分析 §0](../analysis/production-load-balancing-reconciliation-with-production-system-20260527.md#0-調査経緯2026-05-27-スレッド要約)

---

## References

- [ADR-20260527: 負荷調整の集計軸は着手日（FSIGENSHOYOYMD に合わせない）](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)
- [分析: production-load-balancing-reconciliation-with-production-system-20260527.md](../analysis/production-load-balancing-reconciliation-with-production-system-20260527.md)
- [KB-362](./KB-362-kiosk-load-balancing.md)
- [改善提案](../plans/load-balancing-outsourcing-improvement-proposal.md)
- コード: `start-date-leveling-assembler.ts`, `load-balancing-eligibility.policy.ts`, `fkojunst-mail-status-completion.policy.ts`
