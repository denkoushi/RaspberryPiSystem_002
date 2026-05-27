# キオスク負荷調整 × 生産システム — 突合分析（2026-05-27）

## 目的

キオスク負荷調整の月次工数が生産システムの「負荷残」「負荷消費」と一致しない事象について、**データ源・用語・集計定義**をコードと本番データで突合し、今後の実装判断の根拠を残す。

**索引**: [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md)（運用向け要約） / [ADR-20260527](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)（集計軸の決定）

---

## 0. 調査経緯（2026-05-27 スレッド要約）

本分析は **実装変更なし** の突合フェーズで進めた。時系列の要点:

1. **起点**: キオスク負荷調整の月次 H が生産の「負荷残」「負荷消費」と合わない。まず **取り込み・集計定義** をコード正本と DB で切り分け。
2. **N7（033）・2026-05**: 生産 **残95H / 消費301H**。キオスクには消費/残の2系統が無く、着手日タブは **×`plannedQuantity`** で過大（A≈1087H）。総分のみ S/R/C/X でも **51H / 174H** で生産 **95 / 301** には未到達。
3. **方針確認（現場）**: **生産数値との一致は要件にしない**。山崩し・平準化の目的は **キオスク内の着手日〜納期・稼働日ルール** の一貫性。比較対象は **着手日・平準化タブ**（資源CD俯瞰の納期月一括は別 KPI）。
4. **検算依頼**: 「生産の集計方法で DB から同じ値が出れば取り込みは正しい」→ Pi5 本番 `borrow_return` で SQL / `reconcile-*` スクリプト実行。Mac ローカル Docker は **DB 空**（マイグレ未適用）のため本番 SSH を使用。
5. **発見（決定的）**: 生産の積み上げグラフの日付は **`FSIGENSHOYOYMD`（資源所要量 CSV）**。キオスクの `CsvDashboardRow` には **当列なし**（033 winner 514 件で 0 件）。所要量は **1工程×複数日** の粒度。
6. **N7・2026-07**: 生産 **残706H / 消費113H**。添付 `data_scawSTSIGENSHOYORYO.csv` で 7月033合計 **735H**、`>7/1`≈706H、`≦7/9`累積≈113H（**706+113≠735** は日付重なり）。一覧スクショ **≈82行・標準工数合計≈1202H** は月次 KPI と別物。
7. **設計決定**: **`FSIGENSHOYOYMD` にキオスクを合わせない**（[ADR-20260527](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)）。実装修正候補は **×指示数削除・FKOJUNST 母集団の残/消費分離**（別タスク）。
8. **成果物**: 本分析・KB-363・ガイド追記・`reconcile-033-may-patterns.mjs`（env で 5月/7月を切替）。

---

## 1. 調査環境

| 項目 | 値 |
|------|-----|
| 本番 DB | Pi5 `borrow_return`（Tailscale `100.106.158.2`） |
| Dashboard ID | `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01` |
| 検算資源 | **033**（UI 上 N7 = 横型ニイガタ N7） |
| 検算スクリプト | `apps/api/scripts/reconcile-033-may-patterns.mjs` |
| 所要量 CSV 例 | `data_scawSTSIGENSHOYORYO.csv`（ユーザー提供・7月） |

環境変数:

```bash
RECONCILE_RESOURCE=033
RECONCILE_YEAR_MONTH=2026-07   # または 2026-05
RECONCILE_REMAIN_H=706
RECONCILE_CONSUMED_H=113
```

実行（Pi5）:

```bash
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml \
  exec -T -w /app/apps/api api node scripts/reconcile-033-may-patterns.mjs
```

---

## 2. 生産システム側の用語（解読結果）

### 2.1 画面・指標

| 生産 UI | 意味（突合での理解） | キオスクとの関係 |
|---------|----------------------|----------------|
| **負荷残** | 月において未消化とみなす負荷の合計（H） | キオスクに同名列なし |
| **負荷消費** | 月において消化済みとみなす負荷の合計（H） | 同上 |
| **積み上げグラフの日付** | **`FSIGENSHOYOYMD`**（所要量テーブル） | 着手日・納期月ではない |
| **一覧の標準工数(H)** | 工程行の表示用（おおむね `FSIGENSHOYORYO/60`） | winner 行1件の総分に相当 |
| **工順ST** | `FKOJUNST`（S/R/P/C/X 等） | メール同期ステータスと対応 |

### 2.2 資源所要量 CSV（`scawSTSIGENSHOYORYO`）

ヘッダ例:

```text
FSAGYOKB,FSEZONO,FSIGENCD,FSIGENSHOYOYMD,FKOJUN,FSIGENSHOYORYO
```

- **1行 = 1日分の負荷**（同一 FSEZONO・工程で日付が複数行）。
- `FSIGENSHOYORYO` は **その日の分（分）**。
- 7月・033 の行合計: **44,102 分 = 735.0 H**。

### 2.3 生産 KPI 706H / 113H との数値関係（7月・033）

| 切り口 | H |
|--------|---|
| 7月 CSV 合計 | **735.0** |
| `FSIGENSHOYOYMD` > 2026-07-01 | **705.3**（≈ **負荷残 706**） |
| `FSIGENSHOYOYMD` ≦ 2026-07-09 累積 | **113.4**（≈ **負荷消費 113**） |
| 706 + 113 | **819**（**735 と不一致**） |

**重なり**: 7/2〜7/9 は「残」（>7/1）と「消費」（≦7/9）の **両方** に含まれる。単純な排他分割ではない。和集合は 735H。

---

## 3. 本システム側のデータと集計

### 3.1 `CsvDashboardRow`（生産日程）

`rowData` キー（Pi5 確認）:

`FHINCD`, `FHINMEI`, `FKOJUN`, `FSEIBAN`, `FSIGENCD`, `FSIGENMEI`, `FSIGENSHOYORYO`, `ProductNo`, `progress`

**`FSIGENSHOYOYMD` は存在しない。**

### 3.2 キオスク負荷調整 — 3タブ（実装正本）

詳細は [kiosk-production-schedule-load-balancing.md](../guides/kiosk-production-schedule-load-balancing.md) / [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)。

| タブ | 月 | 工数 | FKOJUNST |
|------|-----|------|----------|
| 資源CD俯瞰 | `plannedEndDate` | 総分 | S/R/O/P、C/X 除外 |
| 機種別月次 | 有効納期 | 総分 | S/R/C/X、progress 未完 |
| 着手日・平準化 | 日割り→月 | **行総分**（2026-05-27 修正） | eligibility（S/R/O/P、C/X 除外） |

着手日の総分×指示数:

```40:48:apps/api/src/services/production-schedule/load-balancing/start-date-leveling-assembler.ts
function resolveTotalMinutes(row: StartDateLevelingQueryRow): number | null {
  if (!isPositiveIntegerQuantity(row.plannedQuantity)) {
    return null;
  }
  const perUnit = Number(row.perUnitMinutes ?? 0);
  if (perUnit <= 0) {
    return null;
  }
  return perUnit * row.plannedQuantity;
}
```

`FSIGENSHOYORYO` は [分析 20260324](./production-schedule-fsigenshoyoryo-analysis-20260324.md) で **行総分（分）** と確定済み。

---

## 4. 突合結果（数値表）

### 4.1 2026-05・033 vs 生産 95H / 301H

| パターン | 5月残(H) | 5月消費(H) |
|----------|---------|-----------|
| 現行着手日（×指示数） | 231.2 | 855.9 |
| 総分のみ・S/R/C/X | **51.1** | **174.2** |
| S/R/O/P・C/X除外・日割り | 51.1 | 0 |
| 生産 | **95** | **301** |

### 4.2 2026-07・033 vs 生産 706H / 113H

**キオスク DB（日割り / 納期月）**

| パターン | 7月残(H) | 7月消費(H) |
|----------|---------|-----------|
| 現行着手日（×指示数） | 30.8 | 145.8 |
| 総分・S/R/C/X | 9.2 | 29.2 |
| S/R/O/P・日割り | **428.6** | 0 |
| 納期月=7月・俯瞰母集団 | **430.5** | — |
| 生産 | **706** | **113** |

**所要量 CSV（FSIGENSHOYOYMD）**

| 集計 | H |
|------|---|
| 7月合計 | 735.0 |
| > 7/1（残近似） | 705.3 |
| ≦ 7/9 累積（消費近似） | 113.4 |

### 4.3 スクリーンショット（N7 一覧・標準工数 H）

- 計 **約82行**、合計 **約1,202H**。
- 着手日は **2026/5〜6月** が中心で **7月行はほぼ無し**。
- **706/113/735 のいずれとも単純合計では一致しない**（台帳 ≠ 月次 KPI）。

---

## 5. FKOJUNST と P/O（033 実データ）

| ST | winner 行数（033） | 備考 |
|----|-------------------|------|
| P | 199 | 全件 `FSIGENCD` あり |
| C | 101 | 完了 |
| R | 32 | | 
| X | 10 | |
| S | 8 | |
| O | 0 | 033 には無し |

- **着手日タブ**: P は **SQL 上除外**（S/R/C/X のみ）。
- **5月日割り**: 日付ウィンドウ内 P **52件**あるが **5月按分 0H**（期間不交差）。
- **7月日割り**: P 含む S/R/O/P で **約429H**（706 には不足）。

---

## 6. 結論と推奨タスク

### 6.1 結論

1. **生産とキオスクの不一致は、取り込み単独の不具合と断定できない。**
2. 生産グラフの日付正本は **`FSIGENSHOYOYMD`**。キオスクは **着手日・納期**。**合わせない**（[ADR](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)）。
3. **着手日 × 指示数** は過大集計の最有力因（実装修正候補）。
4. **FKOJUNST 母集団**（C/X の混在、P のタブ差）も残/消費ラベルとずれる。
5. 生産 **706/113** は **所要量 CSV の日付切り**で近似再現できるが、キオスク DB だけでは再現しない。

### 6.2 実装（2026-05-27 · `feat/kiosk-load-balancing-aggregation-fix`）

| # | タスク | コミット | 状態 |
|---|--------|----------|------|
| 1 | 着手日集計から **`× plannedQuantity` 削除**（総分のみ） | `bef423fe` | **完了** |
| 2 | 機種別・着手日の母集団を **`buildLoadBalancingRowEligibilityWhereSql`** に統一（C/X 除外・S/R/O/P・実効未完了） | `bef423fe` | **完了** |
| 3 | 能力/稼働日/分類/移管の **`site` 優先 + `shared` 補完**（キオスク `*Resolved`） | `37a7b6d4` | **完了** |
| 4 | Pi5 本番デプロイ + 実機スモーク | Detach `20260527-161741-7843` | **完了**（Pi4×4 未） |
| 5 | ドキュメント・UI に **生産 H との非一致** を注記 | — | 未着手 |
| 6 | （任意）所要量 CSV の **参考表示** | — | 未着手 |

**現場不具合（能力 `—`）**: 管理が `shared` のみに能力を保存し、キオスクが site 直読だったため。**負荷（required）は出るが能力（available）が全 null** が典型。→ タスク 3 で解消（登録済み 9 資源は Pi5 デプロイ後に `availableMinutes` 復元）。

---

## 7. 再現手順チェックリスト

- [ ] Pi5 で `reconcile-033-may-patterns.mjs` を env 付き実行
- [ ] 7月所要量 CSV で 735H / 705H / 113H を再計算
- [ ] `CsvDashboardRow` に `FSIGENSHOYOYMD` が無いことを確認
- [ ] 着手日 API の 033・2026-07 応答とパターン A を比較

---

## References

- [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md)
- [load-balancing-outsourcing-improvement-proposal.md](../plans/load-balancing-outsourcing-improvement-proposal.md) §タブ間定義差
