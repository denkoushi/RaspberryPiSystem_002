---
title: Phase2 安全リファクタバックログ（API薄化 / Web分割 / 境界ルール）
tags: [refactor, api, web, solid, architecture]
status: active
last-verified: 2026-03-12
---

# Phase2 安全リファクタバックログ

## Phase1 完了（2026-03-12）

Phase1（DebugSink境界導入・直書きデバッグ送信の隔離・コメント整合）はデプロイ完了・実機検証完了。Run ID: Pi5 `20260312-185557-20154`、raspberrypi4 `20260312-191202-22145`、raspi4-robodrill01 `20260312-192115-25675`。Pi3 は除外。全チェックリスト項目合格。

## P2-1 完了（2026-03-12）

P2-1（imports/schedule Route Thin化）はデプロイ完了・実機検証完了。`ImportScheduleAdminService` / `import-schedule-policy` / `import-schedule-error-mapper` を新設。Run ID: Pi5 `20260312-202321-18350`、raspberrypi4 `20260312-203452-25781`、raspi4-robodrill01 `20260312-204436-15585`。Pi3 は除外。全チェックリスト項目合格。

## P2-2 完了（2026-03-12）

P2-2（auth Route Thin化）はデプロイ完了・実機検証完了。`AuthRoleAdminService` / `role-change-policy` / `role-change-alert.service` を新設。Run ID: Pi5 `20260312-215048-2072`、raspberrypi4 `20260312-215858-31380`、raspi4-robodrill01 `20260312-220844-16241`。Pi3 は除外。全チェックリスト項目合格。

## 目的

Phase1 で導入した `DebugSink` 境界とコメント整合を前提に、次段の根治対象を安全ゲート付きで段階実行する。

- API: ルートの責務を薄くし、業務ロジックをサービス境界へ集約
- Web: 巨大コンポーネントを ViewModel / mutation / rendering へ分離
- 境界ルール: 新規流入を lint と規約で抑止

## 優先順（固定）

1. **API薄化（imports/auth）**
   - `routes` はバリデーション・認可・I/O整形に限定
   - 複合分岐や外部連携は `services/*` に移す
2. **Web分割（ProductionSchedulePage）**
   - 画面状態計算を `hooks` / `features` に分離
   - 表示専用コンポーネントを純粋化
3. **境界違反の防止**
   - `import/no-restricted-paths` を段階導入
   - PRテンプレで境界チェック項目を必須化

## スプリント分割（小PR前提）

### P2-1: API Route Thinning (imports)

- 対象: `apps/api/src/routes/imports/schedule.ts`
- 完了条件:
  - ルート関数内の分岐をサービス呼び出しへ移譲
  - 既存 API 契約（path / response / status）不変
  - 既存テストの期待値不変

### P2-2: API Route Thinning (auth)

- 対象: `apps/api/src/routes/auth.ts`
- 完了条件:
  - 役割変更通知（外部送信/副作用）を専用サービスへ分離
  - ルート層はトランザクション境界とレスポンス整形に集中
  - 既存認可仕様不変

### P2-3: Web Split (ProductionSchedulePage Part 1)

- 対象: `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`
- 完了条件:
  - 検索条件/派生状態を `use*` フックへ抽出
  - 主要表示を Presentational Component 化
  - 画面挙動（フィルタ・並び替え・保存）不変

### P2-4: Web Split (ProductionSchedulePage Part 2)

- 対象: 同ファイル（mutation・副作用系）
- 完了条件:
  - API mutation を責務単位で分離
  - 画面コンポーネントの副作用密度を低減
  - 既存導線のE2Eスモーク通過

### P2-5: Boundary Guard

- 対象: `apps/api/.eslintrc.cjs`, `apps/web/.eslintrc.*`（必要に応じて）
- 完了条件:
  - 境界違反の新規混入が lint で検知可能
  - 既存違反は一括修正せず「新規のみ失敗」ルールで段階導入

## 安全ゲート（各PR必須）

- `pnpm --filter @raspi-system/api lint`
- `pnpm --filter @raspi-system/api test`（DB依存テストは実行環境を明記）
- `pnpm --filter @raspi-system/api build`
- `pnpm --filter @raspi-system/web lint`
- `pnpm --filter @raspi-system/web test`
- `pnpm --filter @raspi-system/web build`
- 主要導線スモーク（最低1本）
  - 例: `pnpm test:e2e:smoke`

## ロールバック規約

- 1PR=1目的を厳守
- 問題時は PR 単位で即リバート
- API契約・DBスキーマは Phase2 では原則維持（変更が必要な場合は別PRで明示）

## Git運用

- `main` 直作業禁止
- `main` 最新同期後に feature ブランチを切る
- PR レビューを通して `main` へマージ
