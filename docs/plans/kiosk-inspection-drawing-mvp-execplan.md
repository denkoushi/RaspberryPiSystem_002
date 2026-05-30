# キオスク検査図面MVP ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

キオスクで変換済み図面に測定点を置き、クリック入力と OK/NG 色分けまでを試せる MVP を、既存部品測定ドメインを壊さず並走追加する。完了後は Pi 実機で触り、次フェーズ（TIFF・順位ボード連携）を判断する。

## Progress

- [x] (2026-05-30) ブランチ `feat/kiosk-inspection-drawing-mvp` 作成・本 ExecPlan 初期化
- [x] (2026-05-30) Prisma / API / DTO 拡張（座標・上下限）— migration `20260530120000_part_measurement_template_item_inspection_marker`
- [x] (2026-05-30) 共通モジュール `features/part-measurement/inspection-drawing`
- [x] (2026-05-30) 評価用作成画面・`evaluation-sheets` / `evaluation-templates` API 隔離
- [x] (2026-05-30) 本番編集導線（`quantity===1` + 図面付きテンプレ → `inspection/edit`、通常 sheet API）
- [x] (2026-05-30) キオスクヘッダー独立タブ **「検査図面作成」**（`kioskInspectionDrawingRoutes.ts` + `KioskHeader`）
- [x] (2026-05-30) 単体テスト・Runbook/KB/deployment 補足・CI success（`26675704712` / `26676840821`）
- [x] (2026-05-30) **Pi5 本番先行**（`583aecad`）— 実機手動 OK・Phase12 **42/1/0**
- [ ] **Pi4×4 本番** — ヘッダータブ・図面導線を現場キオスクへ（未実施）

## Surprises & Discoveries

- Observation: `features/inspection-drawing-lab` に Canvas・判定・座標変換が既存
  Evidence: `InspectionDrawingCanvas.tsx`, `evaluateMeasurement.ts`

- Observation: 図面編集は `PIECE_INDEX=0` 固定のため、本番 order（複数個）へ接続すると確定不能になる
  Evidence: レビュー指摘 [P1] → **数量1のみ**に本番自動遷移を限定（2026-05-30）

- Observation: MVP 初版は作成画面が **URL 直打ちのみ**で、現場から「タブがない」と報告
  Evidence: ExecPlan 当初「ハブボタンは出さない」+ 計画上の「専用タブ」未実装 → **ヘッダー独立タブ**で解消（`583aecad`）

- Observation: `createDraft` が `visualTemplate` を include しないと図面判定できず `quantity` 初期化されない
  Evidence: 本番導線テスト修正・`partMeasurementTemplateFullInclude` で解消（`45c02e0a`）

## Decision Log

- Decision: 新ドメインは作らず `PartMeasurementTemplateItem` を拡張し、UI は `/kiosk/part-measurement/inspection/*` で並走
  Rationale: 記録・図面配信・認可を再利用し、既存表形式 UI を維持
  Date/Author: 2026-05-30 / agent

- Decision: Phase1 評価用 **作成**はヘッダー **「検査図面作成」** タブ（部品測定タブとは別）。部品測定ハブ内サブナビは採用しない
  Rationale: ユーザー要望「部品測定タブ内ではなく新規タブ」。アクティブ状態は `isKioskPartMeasurementHubPath` / `isKioskInspectionDrawingPath` で分離
  Date/Author: 2026-05-30 / agent

- Decision: 本番 **編集**導線は `quantity===1` のみ（schedule / ハブ / 下書き / 確定 / template pick）
  Rationale: inspection 編集は `PIECE_INDEX=0` のみで複数個数 order が破綻する（レビュー [P1][P2]）
  Date/Author: 2026-05-30 / agent

- Decision: 評価保存は `__INSPECTION_DRAWING_EVAL__` バケット専用 API。通常 `POST /templates` は使わない
  Rationale: 通常 create は同キーの本番テンプレを非アクティブ化する（レビュー [P1] 評価保存）
  Date/Author: 2026-05-30 / agent

- Decision: 評価用は `GET /templates`・候補・clone・改版・退役から除外。保存は multipart 一括（失敗時ファイル削除）
  Rationale: 管理画面への混入と orphan 図面（レビュー [P2][P3]）
  Date/Author: 2026-05-30 / agent

- Decision: 実験用編集は `evaluation-sheets` 専用 API。評価用テンプレ由来・数量1のみ（URL 直打ちでも本番 sheet は 409）
  Rationale: inspection/edit が本番 1 個目を書き換え可能だった（レビュー [P2]）
  Date/Author: 2026-05-30 / agent

- Decision: 評価用 PATCH body は Zod で `quantity: 1`・`pieceIndex: 0` のみ。正規化後に通常 patch へ渡す
  Rationale: 評価用 API 直叩きで quantity/pieceIndex 制約を破れる（レビュー [P2]）
  Date/Author: 2026-05-30 / agent

- Decision: Phase1 は PNG/JPEG/WebP のみ（TIFF 後回し）
  Rationale: 既存 `PartMeasurementDrawingStorage` 制約と Pi4 負荷
  Date/Author: 2026-05-30 / agent

## Outcomes & Retrospective

- **評価用作成**: ヘッダー「検査図面作成」→ `/kiosk/part-measurement/inspection/create`。図面・測定点・評価用テンプレ保存・同一画面テスト入力まで可能（本番 active テンプレは差し替えない）。
- **本番編集（数量1のみ）**: 図面付き本番テンプレ + `quantity===1` の sheet は各導線から `inspection/edit` へ自動分岐。保存・確定は通常 sheet API。`quantity>1` / 図面なしは表形式 `/edit`。
- **隔離**: 評価用 `__INSPECTION_DRAWING_EVAL__`・`evaluation-templates` / `evaluation-sheets`・通常 API との **409** 相互ブロックを維持。
- **本番デプロイ（Pi5 のみ・2026-05-30）**: Detach `20260530-153416-23422`（HEAD `583aecad`）·Phase12 **42/0/1**·現場手動 OK。**Pi4×4 未**のためキオスク実機ではヘッダー変更は Pi5 経由のブラウザ確認まで。
- **未着手**: 本番テンプレ作成の昇格、複数個数図面UI、TIFF、順位ボード連携、**Pi4×4 デプロイ**。

## 代表コミット（ブランチ `feat/kiosk-inspection-drawing-mvp`）

| SHA | 概要 |
|-----|------|
| `caff87b1` | 評価用 MVP 隔離（evaluation API・create 専用） |
| `45c02e0a` | 本番 `quantity===1` 図面編集導線・policy・navigation |
| `dd27791a` | 評価用 export 復元（Web テスト） |
| `583aecad` | キオスクヘッダー「検査図面作成」タブ |

## 主要ファイル（後続読者向け）

| 領域 | パス |
|------|------|
| ヘッダー導線 | `apps/web/src/components/kiosk/KioskHeader.tsx` |
| ルート判定 | `apps/web/src/features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes.ts` |
| 本番分岐 | `productionInspectionDrawingPolicy.ts` / `kioskPartMeasurementSheetNavigation.ts` |
| API 方針 | `apps/api/src/services/part-measurement/part-measurement-inspection-drawing-policy.ts` |
| 評価アクセス | `evaluationSheetAccess.ts`（Web） |
| 作成 UI | `KioskInspectionDrawingCreatePage.tsx` |
| 編集 UI | `KioskInspectionDrawingEditPage.tsx` |

## Context and Orientation

既存キオスク部品測定は `apps/web/src/pages/kiosk/KioskPartMeasurement*.tsx` と `apps/api/src/routes/part-measurement/index.ts`。図面は `PartMeasurementVisualTemplate` + Blob 取得。

## Plan of Work

（親計画 `inspection_drawing_mvp` と同一。本ファイルは実装進捗の正本）

## Validation and Acceptance

- 単体: `evaluateMeasurement` / `kioskInspectionDrawingRoutes` / `productionInspectionDrawingPolicy` / `kioskPartMeasurementSheetNavigation`
- 統合: `part-measurement.integration.test.ts`（policy・evaluation 隔離・blank 削除）
- 自動実機: `./scripts/deploy/verify-phase12-real.sh`（部品測定スモーク含む）
- 手動（Pi5 実施済）: ヘッダー **検査図面作成** → 作成画面・点配置・保存・テスト入力。本番図面テンプレ + 数量1 → 図面 edit（任意）
- 手動（Pi4 未）: 上記を **各キオスク Firefox** で再確認（強制リロード §6.6.4）
