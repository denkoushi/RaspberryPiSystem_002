---
title: ADR-20260219: 生産スケジュールprogressの別テーブル化決定
status: accepted
date: 2026-02-19
deciders: [開発チーム]
tags: [database, production-schedule, data-integrity, separation-of-concerns]
related: [KB-269]
---

# ADR-20260219: 生産スケジュールprogressの別テーブル化決定

## Status

**accepted** (2026-02-19)

## Context

生産スケジュールの完了状態（`progress`フィールド）が`CsvDashboardRow.rowData`（JSONB）に直接保存されていた。

**問題点**:
- CSV取り込み（DEDUP更新）時に`rowData`が上書きされ、ユーザーが設定した完了状態が失われるリスクがあった
- 他のユーザー操作データ（備考、納期、処理列、加工順序割当）は既に別テーブル（`ProductionScheduleRowNote`、`ProductionScheduleRowOrder`等）で管理されていたが、完了状態のみ`rowData`に残っていた
- データの整合性と分離の観点から、完了状態も別テーブルで管理すべきだった

**技術的背景**:
- `CsvDashboardIngestor`のDEDUP更新処理で`rowData`が完全置換される
- `rowData`はCSVデータの生データを保持するためのフィールドであり、ユーザー操作データとは分離すべき

## Decision

**`ProductionScheduleProgress`テーブルを新設し、完了状態を`rowData`から分離する**

以下の設計を採用:
- `csvDashboardRowId`を主キーとする1対1の関係
- `isCompleted`（Boolean）で完了状態を管理
- `onDelete: Cascade`で`CsvDashboardRow`削除時に自動削除
- `(csvDashboardId, isCompleted)`の複合インデックスを追加（進捗集計クエリ最適化）
- APIレスポンスで`rowData.progress`を合成し、フロントエンド互換性を維持

## Alternatives Considered

### 1. `rowData`の部分更新（マージ）

**検討内容**: CSV取り込み時に`rowData`の特定フィールド（`progress`）を保持し、他のフィールドのみ更新する

**却下理由**:
- `rowData`の構造が複雑で、部分更新のロジックが複雑になる
- CSV取り込みロジックに完了状態の保持処理を追加する必要があり、責務が混在する
- 他のユーザー操作データと一貫性がなくなる

### 2. CSV取り込み時の`progress`保持

**検討内容**: CSV取り込み時に既存の`rowData.progress`を保持し、他のフィールドのみ更新する

**却下理由**:
- CSV取り込みロジックに完了状態の保持処理を追加する必要があり、責務が混在する
- CSV取り込みと完了状態の管理が密結合になる
- 他のユーザー操作データと一貫性がなくなる

### 3. 現状維持（`rowData`に保存）

**検討内容**: 完了状態を`rowData`に保存し続ける

**却下理由**:
- CSV取り込み時の上書きリスクが残る
- 他のユーザー操作データと一貫性がなくなる
- データの整合性が保証されない

## Consequences

### Positive

- **データ整合性の向上**: CSV取り込み時の上書きリスクが解消され、完了状態が確実に保持される
- **設計の一貫性**: 他のユーザー操作データと同様に、別テーブルで管理される
- **責務の分離**: CSV取り込みロジックと完了状態の管理が分離され、保守性が向上
- **フロントエンド互換性**: APIレスポンスで`rowData.progress`を合成することで、フロントエンドの変更が不要

### Negative

- **テーブル数の増加**: 新しいテーブルが追加され、スキーマが複雑になる
- **JOINの追加**: 一覧取得や進捗集計で`LEFT JOIN`が必要になり、クエリが複雑になる（ただし、インデックスにより性能影響は最小限）
- **マイグレーション作業**: 既存データの移行が必要

### Neutral

- **既存機能への影響**: APIレスポンスの形式は維持されるため、フロントエンドへの影響は最小限
- **パフォーマンス**: インデックスにより、JOINの性能影響は最小限

## Implementation Notes

- **マイグレーションファイル**: `apps/api/prisma/migrations/20260219120000_add_production_schedule_progress/migration.sql`
- **既存データの移行**: マイグレーションSQLで`rowData.progress='完了'`の行を新テーブルへ移行
- **API互換性**: レスポンスで`rowData.progress`を合成し、フロントエンドの変更が不要
- **CI検証**: CIでマイグレーションが正常に適用されることを確認済み
- **実機検証結果**（2026-02-19）:
  - ✅ マイグレーション状態: `Database schema is up to date!`（33 migrations found）
  - ✅ テーブル存在確認: `ProductionScheduleProgress`テーブルが存在（223件の完了状態レコード）
  - ✅ 完了トグル動作: DB `isCompleted`とAPI返却`rowData.progress`が正しく連動することを確認
  - ✅ CSV取り込み後の完了状態保持: CSV取り込み実行後も完了状態が保持されることを確認（要継続観察）
- **CSV progress同期機能の実装**（2026-02-25）:
  - ✅ `ProgressSyncFromCsvService`を新設し、CSV取り込み時に`progress`列の値を`ProductionScheduleProgress`テーブルに反映する機能を実装
  - ✅ `updatedAt`による優先順位判定（新しいCSVが優先、同時刻はシステム側優先）を実装
  - ✅ タイムゾーン非依存の`updatedAt`パース処理を実装（`Date.UTC`を使用、KB-249の知見を適用）
  - ✅ デプロイ成功（runId `20260225-213519-20840`, `state: success`, `exitCode: 0`）
  - ✅ 実機検証完了: 実装コードが正しくデプロイされ、統合されていることを確認
- **判定ロジックの妥当性確認**（2026-02-25）:
  - ✅ CSVの`progress`列の仕様確認:
    - CSVの`progress`列は常に存在する
    - CSVで`progress`は「完了」か「空」の2択のみ（その他の値は送られない）
    - CSVで`progress=''`（空）は新規アイテム追加時に送られる（未完了を意味する）
  - ✅ 判定ロジックの動作確認:
    - CSVの`progress='完了'` → `isCompleted=true`に反映（CSVの`updatedAt`が新しい場合のみ）
    - CSVの`progress=''`（空） → `isCompleted=false`に反映（CSVの`updatedAt`が新しい場合のみ）
    - CSVの`updatedAt` <= DB側の`updatedAt` → DB側（キオスクで設定した完了状態）を維持
    - 同時刻の場合 → DB側（システム側）を優先
  - ✅ 動作ケースの検証:
    - **ケース1: キオスクで完了設定 → その後、CSVで`progress=''`（空）が送られる**: CSVの`updatedAt`が新しい場合、キオスクの完了状態が上書きされる動作で問題なし（業務的に妥当）
    - **ケース2: キオスクで完了設定 → その後、CSVで`progress='完了'`が送られる**: CSVの`updatedAt`が新しい場合でも既に`true`なので実質変化なし、古い場合はDB側を維持する動作で問題なし（業務的に妥当）
  - ✅ タイムスタンプ比較の妥当性: CSVの`updatedAt`（CSVデータの更新日時）とDB側の`updatedAt`（完了状態の更新日時）を比較するロジックは業務的に妥当であることを確認
  - ✅ 現在の実装の妥当性: 生産スケジュール管理の観点で、現在の判定ロジックは妥当であることを確認

## References

- [KB-269](../knowledge-base/api.md#kb-269-生産スケジュールprogress別テーブル化csv取り込み時の上書きリスク回避): 生産スケジュールprogress別テーブル化（CSV取り込み時の上書きリスク回避）
- [KB-184](../knowledge-base/frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能): 生産スケジュールキオスクページ実装（完了状態の保存方法が変更された）
- [KB-268](../knowledge-base/frontend.md#kb-268-生産スケジュールキオスク操作で間欠的に数秒待つ継続観察): 今回の変更とKB-268の対策は衝突しない
