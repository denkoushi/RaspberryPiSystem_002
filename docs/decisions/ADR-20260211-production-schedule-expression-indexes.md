---
title: ADR-20260211: 生産スケジュールパフォーマンス最適化のための式インデックス追加
status: accepted
date: 2026-02-11
deciders: [開発チーム]
tags: [database, performance, indexes, production-schedule]
related: [KB-248]
---

# ADR-20260211: 生産スケジュールパフォーマンス最適化のための式インデックス追加

## Status

**accepted** (2026-02-11)

## Context

生産スケジュール検索画面で、資源CDの検索ボタン（資源CDピルボタン群）が表示されるまでに時間がかかる問題が発生した。

**問題の詳細**:
- `GET /kiosk/production-schedule/resources` エンドポイントの実行時間が約29秒と非常に遅かった
- コミット `fb95b9c`（2026-02-10）で `buildMaxProductNoWinnerCondition`（相関サブクエリ）が `resources` エンドポイントに追加され、DB負荷が増加
- 資源CDボタン群は `resourcesQuery` の結果で描画されるため、API応答が遅いと「ボタン登場」が遅くなる

**技術的背景**:
- `buildMaxProductNoWinnerCondition` は行ごとに「同一論理キーの中で最大ProductNoの行ID」を選ぶ相関サブクエリ
- 相関サブクエリ内で `Seq Scan` が発生し、7,211行のループで各2行をスキャン（合計約14,422行スキャン）
- `rowData->>'FSIGENCD'` に対する式インデックスが存在せず、`DISTINCT/ORDER BY` もフルスキャンに依存

## Decision

**PostgreSQLの式インデックス（Expression Indexes）を追加して、パフォーマンスを改善する**

以下の4つのインデックスを追加:

1. **`csv_dashboard_row_prod_schedule_resource_cd_idx`** (部分インデックス)
   - 用途: 資源CD抽出用（`DISTINCT/ORDER BY` 最適化）
   - 条件: `csvDashboardId` + `rowData->>'FSIGENCD'` がNULL/空文字でない行のみ

2. **`csv_dashboard_row_prod_schedule_logical_key_idx`** (部分インデックス)
   - 用途: 論理キー一致用（`WHERE` 条件最適化）
   - 条件: `csvDashboardId` + `COALESCE` による論理キー4列

3. **`csv_dashboard_row_prod_schedule_winner_lookup_idx`** (部分インデックス)
   - 用途: winner探索+ORDER BY対応（相関サブクエリ内の部分インデックス）
   - 条件: `csvDashboardId` + 論理キー + ProductNo（数値変換）+ createdAt + id

4. **`csv_dashboard_row_winner_lookup_global_idx`** (非部分インデックス)
   - 用途: 相関サブクエリ用（プランナーが確実に拾うため）
   - 条件: 上記と同じ構造だが、`WHERE` 句なし（全行対象）

## Alternatives Considered

### 1. SQL書き換え（相関サブクエリの除去）

**検討内容**: `buildMaxProductNoWinnerCondition` を `JOIN` や `LATERAL` に書き換える

**却下理由**:
- 相関サブクエリのロジックが複雑で、書き換えによる影響範囲が大きい
- 既存の動作を壊すリスクが高い
- インデックス追加の方が安全で確実

### 2. キャッシュ層の追加

**検討内容**: Redis等のキャッシュ層を追加して、資源CDリストをキャッシュする

**却下理由**:
- インフラの複雑性が増す
- キャッシュの無効化タイミングの管理が必要
- 根本原因（DBクエリの遅さ）を解決しない

### 3. 部分インデックスのみ追加

**検討内容**: 部分インデックス（`WHERE csvDashboardId = '...'`）のみ追加

**却下理由**:
- 相関サブクエリ内では、部分インデックスが十分に活用されない場合がある
- プランナーが確実にインデックスを使用できるよう、非部分インデックスも必要

## Consequences

### Positive

- **パフォーマンス大幅改善**: 実行時間が約29秒→0.08秒に改善（約357倍高速化）
- **ユーザー体験の向上**: 資源CDボタンが即座に表示される
- **DB負荷の軽減**: フルスキャンが削減され、DB負荷が大幅に軽減
- **標準機能の活用**: PostgreSQLの標準機能（式インデックス）を活用し、追加のインフラ不要

### Negative

- **インデックスサイズの増加**: 4つのインデックス追加により、ストレージ使用量が増加（約数MB程度）
- **INSERT/UPDATEのオーバーヘッド**: インデックス更新のオーバーヘッドが若干増加（ただし、読み取り頻度が高いため許容範囲）
- **マイグレーション管理**: マイグレーションファイルの管理が必要

### Neutral

- **既存機能への影響**: 既存のクエリロジックは変更せず、インデックス追加のみのため、既存機能への影響は最小限

## Implementation Notes

- **マイグレーションファイル**: `apps/api/prisma/migrations/20260211123000_add_prod_schedule_expr_indexes/migration.sql`
- **安全な適用**: `IF NOT EXISTS` 句により、既に適用済みの環境でも安全に実行可能
- **本番DB適用**: マイグレーションファイル作成前に本番DBに直接DDL適用済み（緊急対応）
- **CI検証**: CIでマイグレーションが正常に適用されることを確認済み
- **実機検証結果**（2026-02-11）:
  - ✅ キオスク端末で資源CDボタンが即座に表示されるようになった（ページマウント時に即時表示）
  - ✅ 体感速度が大幅に向上し、問題なく使用可能
  - ✅ ユーザー体験が改善され、待機時間が解消された

## References

- [KB-248](../knowledge-base/api.md#kb-248-生産スケジュール資源cdボタン表示の遅延問題式インデックス追加による高速化): 生産スケジュール資源CDボタン表示の遅延問題（式インデックス追加による高速化）
- [PostgreSQL Expression Indexes Documentation](https://www.postgresql.org/docs/current/indexes-expressional.html)
- [PostgreSQL Partial Indexes Documentation](https://www.postgresql.org/docs/current/indexes-partial.html)
