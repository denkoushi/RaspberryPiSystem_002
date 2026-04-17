# ExecPlan: キオスク集計 BI レイアウト（非スクロール・Top N）

## 目的

- `/kiosk/rigging-analytics` で**縦スクロール前提の一覧テーブル**がビューポート外にはみ出す問題を解消する。
- **1画面内**で状況把握できる KPI 帯＋2×2 グリッドに再構成する（[デザインプレビュー](../design-previews/kiosk-analytics-bi-dashboard-preview.html) と整合）。

## 非目標（本 ExecPlan ではやらない）

- API 契約の変更（`loan-analytics` は既存のまま）。
- コミット・push・デプロイ（別タスク）。

## アーキテクチャ方針（SOLID / 境界）

| 原則 | 適用 |
|------|------|
| **SRP** | 表示件数・ソート・集約は `analyticsDisplayPolicy`（純関数）。UI は描画のみ。 |
| **OCP** | 上限値は定数オブジェクト `ANALYTICS_KIOSK_DISPLAY_LIMITS` に集約。変更は数値差し替え＋テスト。 |
| **DIP** | ページは具体的ソート実装を知らず、policy の公開関数のみ呼ぶ。 |
| **疎結合** | KPI 帯は独立コンポーネント。パネルは `theme` とデータ props のみ。 |

## 実装タスク

1. `features/kiosk-loan-analytics/analyticsDisplayPolicy.ts` — 上限・ランキング・当日サマリ集約。
2. `analyticsDisplayPolicy.test.ts` — 境界値・タイブレーク。
3. `KioskAnalyticsKpiStrip.tsx` — 5 KPI スコアカード。
4. `KioskAnalyticsPanels.tsx` — 社員・資産パネルは **overflow 廃止**、`Top N` バッジ；当日ペインは **最大 5 件**＋当日ミニ KPI；詳細テーブル `UsageTablePanel` はキオスクから削除。
5. `KioskRiggingAnalyticsPage.tsx` — ヘッダーからインライン KPI を除去し KPI 帯へ移行；**2×2 グリッド**＋`min-h-0`。

## 検証

- `pnpm exec vitest run` 対象: `analyticsDisplayPolicy.test.ts`, `KioskRiggingAnalyticsPage.test.tsx`
- （任意）キオスク実機で `/kiosk/rigging-analytics` を開き、縦スクロールが不要であること。

## 完了条件

- 上記テストが緑。
- 本番 API 不要の単体テストで表示ロジックが固定されている。

## 実装メモ（2026-04-17）

- ブランチ: `feat/kiosk-analytics-bi-dashboard`（コミット・push は依頼どおり未実施の想定）。
- 追加: `analyticsDisplayPolicy.ts` / `analyticsDisplayPolicy.test.ts`、`kioskAnalyticsTheme.ts`、`KioskAnalyticsKpiStrip.tsx`。
- 変更: `KioskRiggingAnalyticsPage.tsx`（KPI 帯・2×2 グリッド・テーブル除去）、`KioskAnalyticsPanels.tsx`（パネル整理、キオスク用の表示上限前提）。
- 静的モック: [kiosk-analytics-bi-dashboard-preview.html](../design-previews/kiosk-analytics-bi-dashboard-preview.html)。
