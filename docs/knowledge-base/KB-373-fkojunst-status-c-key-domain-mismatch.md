---
title: KB-373: FKOJUNST_Status の完了（C）が同期 DB に現れない—キー空間の乖離調査
tags: [生産スケジュール, FKOJUNST_Status, メール同期, キオスク, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-05-09
related: [KB-297, KB-370, KB-372, ADR-20260508-fkojunst-status-sole-source, ADR-20260509-fkojunst-status-completion-matching-policy]
category: knowledge-base
---

# KB-373: FKOJUNST_Status の完了（`C`）が `fkmail` にほぼ残らない理由（キー空間不一致）

## Context（この KB の目的）

- この KB は「**なぜ `C` が 0 件に見えるのか**」を、**調査の時系列**と**根拠**まで残すための記録。
- 対象は以下の 2 ソース:
  - 本体: `ProductionSchedule_Mishima_Grinding`（winner 行の正本）
  - Status: `FKOJUNST_Status`（Gmail CSV、`fkmail` 同期元）
- 問題の焦点は、UI 改修ではなく **照合対象そのものが合っているか**。

## 先に結論

- `C` が `fkmail` に乗らない主因は、**照合ロジックの実装不具合ではなく、上流データのキー空間乖離**。
- 具体的には、`FKOJUNST_Status` の `C` 行が持つ `FKOJUN` / `FKOTEICD` が、本体 winner の `FKOJUN` / `FSIGENCD` と交わらない。
- そのため、システムが採用する厳密照合（`ProductNo + 資源CD + FKOJUN`）では、`C` は**未マッチとして無視**される。

## 調査の時系列（要約）

1. まず「S/R は順位ボードに漏れなく出るか」「X/C がチップのグレーアウトへ反映されるか」を確認。
2. 次に「`C` はソース CSV にも無いのか / 同期先 DB だけ無いのか」を分離して確認。
3. その結果、**ソースには `C` が大量にある**一方、**`fkmail` では `C` がほぼ 0**を確認。
4. 同期ロジック破損を疑って突合したが、`C` 以外は正常に同期されるため、ロジック単独故障は弱い。
5. そこで照合キー分布を比較し、`C` の `FKOJUN` / `FKOTEICD` が本体キー集合と乖離していることを確認。
6. 最後に「選択資源で見える `C` 12 件」の同一性（重複かどうか）を精査し、**重複ではなく別レコード**と確定。

## 症状（観測）

- `FKOJUNST_Status` ソースには `FKOJUNST='C'` が大量（調査時点でおおむね **~2.4 万件規模**）。
- 一方 `ProductionScheduleFkojunstMailStatus`（`fkmail`）側の `statusCode='C'` はほぼ 0。
- キオスクで選択可能な資源に絞っても、`C` 行は存在し得るが、本体 winner と 3 キーで結びつかない。

## 仮説検証（Hypothesis Log）

| 仮説 | 検証結果 | 補足 |
|------|----------|------|
| H1: 同期ロジックが `C` だけ落としている | **REJECTED** | `C` 以外は同期整合。既存 `fkmail` とソースの一致も確認。 |
| H2: 旧「消滅」系や `fkst` フォールバックが `C` を潰す | **REJECTED** | 現行は `fkmail` 正本。メール由来完了は `C`/`X` のみ（[ADR-20260508](../decisions/ADR-20260508-fkojunst-status-sole-source.md)）。 |
| H3: `C` のキーが本体 winner のキー集合と交わらない | **CONFIRMED** | 厳密 3 キー (`ProductNo + FSIGENCD/FKOTEICD + FKOJUN`) で一致 0 が支配的。 |
| H3b: `C` の `FKOJUN` 分布が特異 | **CONFIRMED** | `C` の `FKOJUN` は **`801` 集中**が強く、本体側集合と重なりが薄い。 |
| H3c: `FKOTEICD` ↔ `FSIGENCD` が別集合 | **CONFIRMED** | 一致率が **~0.19% 規模**の観測（時点差あり）。 |
| H4: 資源選択下の `C` 12 件はタイムスタンプ違い重複 | **REJECTED** | 12 件は別レコード。`FUPDTEDT` 日付も単日集中ではない。 |

## 重要な観測値（時点依存のため参考値）

- `C` はソース上で大量、同期先でほぼ 0。
- `C` の `FKOJUN` は `801` 偏重（会話中の検証では「大半」を占める）。
- `FKOTEICD` と本体 `FSIGENCD` の重なりは極小（~0.19% 規模）。
- 選択資源内 `C=12` の内訳例: `581:4, 060:2, 305:2, 585:2, 584:1, 586:1`。
- 上記 12 件は `ProductNo/FKOJUN/FKOTEICD/FUPDTEDT` の組で重複しない。

> 注記: これらは調査時の DB スナップショットに依存するため、再計測で数値は変動し得る。

## Root cause（根因）

**上流（生産システム/CSV設計）のデータ意味の差**で、`C` 行が指す工程座標が本体 winner と一致しない。  
つまり「照合しても対象が無い」状態であり、現在の厳密照合ルールでは `C` を取り込めない。

## ユーザー合意の最終方針（この調査で確定）

この調査を受けて確定した方針は [ADR-20260509](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md) を正本とする。

- 反映対象は **`ProductNo + 資源CD + FKOJUN` 厳密一致行のみ**。
- 照合キーは **trim + uppercase** で正規化。
- 再計算は **Status 取込時 / 本体取込時の両方**で実施。
- 同一キー衝突は **`FUPDTEDT` 最新**を勝者（新しい非 `C` が完了を巻き戻し得る）。
- **未マッチ `C` は無視**（表示・件数に載せない）。

## 調査運用チェックリスト（再発時）

1. `C` が見えない場合、先に `fkmail` 件数と `statusCode` 分布を確認。
2. 次に `C` の `FKOJUN` / `FKOTEICD` 分布を取り、本体 `FKOJUN` / `FSIGENCD` と比較。
3. 3 キー一致件数を確認（0 なら実装ではなくキー空間問題の可能性が高い）。
4. 「一部 `C` がある」場合は重複判定（`FUPDTEDT` だけ違うのか）を切り分ける。
5. 調査用 localhost ingest（`127.0.0.1:7426` 等）はリポジトリへ残さない。

## 固定 ID（参照用）

| 名称 | `CsvDashboard` ID (UUID) |
|------|---------------------------|
| 三島研削・本体生産日程 | `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01` |
| `FKOJUNST_Status`（正本） | `b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e` |
| 旧 `FKOJUNST`（レガシー） | `9e4f2c1a-8b7d-4e6f-a5c4-1d2e3f4a5b6c` |

## フィールド対応（メール Status CSV ↔ 本体）

| Status CSV | 本体（`rowData`） |
|------------|-------------------|
| `FSEZONO` | `ProductNo` |
| `FKOTEICD` | `FSIGENCD`（資源 CD） |
| `FKOJUN` | `FKOJUN` |
| `FKOJUNST` | ステータスコード（`S`/`R`/`C`/`X`/他） |
| `FUPDTEDT` | 更新時刻（**衝突時の優先度判定**に使う前提） |

## References

- [ADR-20260509-fkojunst-status-completion-matching-policy](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md)
- [ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md)
- [KB-297 §外部完了](./KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)
- [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)
- [KB-372](./KB-372-fkojunst-mail-winner-triple-postgres-bind-chunk.md)
- [`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts)
- [`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)
