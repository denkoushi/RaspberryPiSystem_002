---
title: KB-373: FKOJUNST_Status の完了（C）が同期 DB に現れない—キー空間の乖離調査
tags: [生産スケジュール, FKOJUNST_Status, メール同期, キオスク, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-05-09
related: [KB-297, KB-370, KB-372, ADR-20260508-fkojunst-status-sole-source, ADR-20260509-fkojunst-status-completion-matching-policy]
category: knowledge-base
---

# KB-373: FKOJUNST_Status の完了（`C`）が `fkmail` にほぼ残らない理由（キー空間不一致）

## Context

- **いつ/どこ**: 2026-05-09 前後。三島研削キオスク順位ボード・`FKOJUNST_Status`（Gmail CSV）と本体生産日程（`ProductionSchedule_Mishima_Grinding`）の整合調査。
- **背景**: 一覧可視性を `S`/`R`/`C`/`X` に広げた後も、**メール同期先である `ProductionScheduleFkojunstMailStatus`（以下 `fkmail`）に `statusCode='C'` がほぼ存在しない**（実質ゼロに近い）事象を追った。
- **誤調査の教訓**: スクリーンショット上の **製番・資源表記**の読み取り誤り（例: `FSEIBAN` と `ProductNo`、`表示ラベル` と `FSIGENCD`）がクエリ結果を空にし得る。**照会は DB 上の `ProductNo` / `FSIGENCD` / `FKOJUN` を正本とする**。

## Symptoms

- **`FKOJUNST_Status` ソース CSV** には **`FKOJUNST='C'` が大量**（調査時点でユニークキー換算おおむね **~2.4 万件規模**の認識。環境により変動）。
- 一方 **`fkmail.statusCode='C'` は 0 件に近い**（同期結果が他ステータスと整合している場合でも `C` だけ欠落する印象）。
- キオスクで選べる資源 CD 集合に絞っても、**`C` 行はソース上に少数存在しうる**が、**本体生産日程 winner 行との厳密突合では一致 0 件**になり得る。

## Investigation（仮説 → 検証 → 結果）

| 仮説 | 結果 |
|------|------|
| H1: メール同期ロジックのバグで `C` だけ落ちる | **REJECTED**（**`C` 以外**は期待どおり `fkmail` に載り、**既存 `fkmail` 行とソース CSV の突合は整合**する観測）。 |
| H2: 旧「消滅」ベース外部完了や `fkst` が `C` を潰している | **REJECTED（当該経路は別）**。正本統一後は **`fkmail` の `C`/`X` のみ**がメール由来外部完了に効く設計（[ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md)）。`externallyCompletedFromFkojunstDisappeared` 系はメール同期では **`FALSE` 固定**の実装も確認済み。 |
| H3: **`C` 行の論理キー**が **本体生産日程 winner の論理キー**と**そもそも交わらない** | **CONFIRMED**。厳密3キー **`ProductNo` + 資源 CD（本体 `FSIGENCD` ↔ Status `FKOTEICD`）+ `FKOJUN`** で突合すると、**`C` 行は本体側に対応行が無い**ケースが支配的。 |
| H3b: `C` における **`FKOJUN` の分布**が本体と別世界 | **CONFIRMED（強いシグナル）**。`C` の `FKOJUN` が **特定値（例: `801`）に極端に集中**する一方、本体側の `FKOJUN` 集合と重なりが薄い、という観測。 |
| H3c: `FKOTEICD` と `FSIGENCD` の集合の重なり | **CONFIRMED（極小）**。調査時点の集計で **`FKOTEICD` と本体 `FSIGENCD` の一致率が ~0.19% 規模**など、**別キー空間**を示す数値が出た（**環境・日付で変動**）。 |
| H4: キオスク選択資源に絞った **`C` 12 件**は **タイムスタンプ違いの重複か** | **REJECTED**。**12 件はいずれも別レコード**（`ProductNo` / `FKOJUN` / `FKOTEICD` / `FUPDTEDT` が同一という意味では重複しない）。**`FUPDTEDT` の日付も単一日付に集中しない**（複数月に分散する例）。 |

## Root cause

**上流（生産システム／CSV設計）側のデータ意味のずれ**により、`FKOJUNST_Status` の **`C` 行が指す「工順・資源」の座標**が、**`ProductionSchedule_Mishima_Grinding` の winner 行が保持する座標**と**一致しない**ことが根本である。**アプリの「照合→更新」ロジックが誤っているというより、一致対象が存在しない**ため、`fkmail` に `C` が載らない。

> **補足（解釈）**: `C` は **製造 order 完了イベント**のように、**工程明細行と 1:1 で対応しない**可能性がある。詳細は上流仕様の確認が必要だが、**本システムが採用する厳密3キー同期では未マッチの `C` は反映されない**のが結果として正しい。

## Fix（この KB 時点）

- **コード変更は本トピックの主目的ではない**（調査のナレッジ化と**照合方針の ADR 化**が主成果）。
- 将来実装する場合の**方針**は [ADR-20260509-fkojunst-status-completion-matching-policy](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md) を正とする。

## Prevention / 運用上の読み方

- **`C` が `fkmail` に少ない**ときは、まず **ソース CSV のキー分布**（特に **`C` の `FKOJUN` / `FKOTEICD`**）と **本体 CSV の `FKOJUN` / `FSIGENCD`** を突き合わせる。
- **キオスクの表示欠落**を疑う前に、**`fkmail` の有無・`statusCode`** と **winner 行のキー**を同一ツール（SQL）で確認する。
- **調査用の localhost ingest (`127.0.0.1:7426` 等) はリポジトリに残さない**（[INDEX §三島研削 empty BOM](../INDEX.md) と同方針）。

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
