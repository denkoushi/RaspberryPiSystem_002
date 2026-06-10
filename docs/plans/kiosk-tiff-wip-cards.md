# Plan: Kiosk TIFF Import + Self-Inspection WIP Participant Names

## Metadata

| Field | Value |
|-------|-------|
| id | `kiosk-tiff-wip-cards` |
| status | **in_progress** — **`main` マージ済** · Pi5 deployed · Pi4 / manual TIFF pending |
| branch | `feat/kiosk-tiff-wip-cards` |
| commits | `26978e5c` (feat) · `027d7eb9` (test fix) |
| scope | API + Web · **Prisma migration なし** |
| related | [Runbook §WIP](../runbooks/kiosk-part-measurement.md#kiosk-ux-settings-wip-and-tab-order-2026-06-10) · [Runbook §PDF/TIFF](../runbooks/kiosk-part-measurement.md#検査図面--pdf-取込2026-06-02) · [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) · [verification-checklist §6.6](../guides/verification-checklist.md) |

## Purpose

1. **検査図面**: TIFF/TIF アップロードを PDF と同契約（preview/save 同一 JPEG・変換キュー共有）で取り込む。
2. **自主検査 WIP**: 仕掛中カードに **測定者氏名**（entryIndex 昇順・重複除去）を表示。API は entries 全件 include を避け SQL 集約。

## Progress

- [x] (2026-06-10) ブランチ `feat/kiosk-tiff-wip-cards` 実装
- [x] API: MIME/magic bytes · `convert-tiff-to-jpeg.ts` (inline eval worker + timeout + terminate 待ち) · 共有 `drawing-raster-convert-semaphore`
- [x] API: `participantEmployeeNames` — 一覧/resolve-or-create/complete で集約 · `self-inspection-participant-names.query.ts`
- [x] Web: TIFF accept/preview hook · WIP 6列グリッド · `selfInspectionWipCardPresentation.ts`
- [x] 単体/統合テスト · lint/build/tsc
- [x] CI — **`27262590375`** success（`027d7eb9`）
- [x] Pi5 デプロイ — Detach **`20260610-174920-4518`** · **`failed=0`** · Phase12 **43/0/0**
- [ ] Pi5 キオスク **手動目視**（TIFF プレビュー/保存 · WIP 氏名表示）
- [ ] Pi4×4 順次デプロイ（Pi5 目視 OK 後）
- [x] `main` マージ — PR [#428](https://github.com/denkoushi/RaspberryPiSystem_002/pull/428) · squash **`b3d923d4`**

## Specification (implemented)

### TIFF 取込

| 項目 | 契約 |
|------|------|
| 入力 | `image/tiff` / `.tif` / `.tiff` · 上限 **30MB** |
| 変換 | `sharp`（worker 内）→ JPEG · magic bytes · max **16384px** · `limitInputPixels` |
| キュー | PDF/TIFF 共通 · 同時 1 · 待ち最大 4 · 超過 **503** |
| timeout | **30s** · timeout 時 worker **terminate 完了後**にスロット解放 |
| Web | `usePartMeasurementDrawingLocalPreview` — preview API → 同一 JPEG File で save |
| 保存 | `drawingImageRelativePath` は `.jpg` のみ |

代表: `apps/api/src/lib/convert-tiff-to-jpeg.ts` · `part-measurement-drawing-import.ts` · `part-measurement-drawing-preview.ts`

### 自主検査 WIP · participantEmployeeNames

| 経路 | `participantEmployeeNames` |
|------|---------------------------|
| `GET …/sessions?status=in_progress` | SQL 集約（`ROW_NUMBER` で先頭出現のみ） |
| `POST …/resolve-or-create` | 新規 **[]** · 既存セッション **登録済み氏名** |
| `POST …/complete` | transaction **commit 後**に集約 |
| `GET …/sessions/:id` (detail) | `session.entries` から算出 |

Web: `KioskSelfInspectionPage` — 6列グリッド · 氏名 2行 + `title` 全文

## Decision Log

- **TIFF worker は file path ではなく inline `eval: true` worker** — Vitest / `tsx watch` で `.ts`/`.js` worker パス解決が壊れるため。2026-06-10
- **metadata + JPEG 変換は worker 内一括** — 親プロセスでの timeout なし `sharp().metadata()` を排除。2026-06-10
- **一覧の entries include 廃止** — `loadParticipantEmployeeNamesBySessionIds` で N+1/大量 load 回避。2026-06-10
- **`completeSession` の氏名集約は transaction 外** — global Prisma を transaction 内から呼ばない。2026-06-10
- **検証記録**: PDF 実績（`8307c995`）と TIFF 未確認を verification-checklist で **行分離**（TIFF は `[ ]` 維持）。2026-06-10

## Validation

```bash
# API
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/borrow_return'
pnpm --dir apps/api exec vitest run \
  src/lib/__tests__/convert-tiff-to-jpeg.test.ts \
  src/routes/__tests__/part-measurement-drawing-tiff.integration.test.ts \
  src/services/part-measurement/__tests__/self-inspection-participant-names.test.ts \
  src/services/part-measurement/__tests__/self-inspection-participant-names.query.test.ts

# Web
pnpm --dir apps/web exec vitest run \
  src/features/part-measurement/partMeasurementDrawingLocalPreview.test.ts \
  src/features/part-measurement/__tests__/selfInspectionWipCardPresentation.test.ts
pnpm --filter @raspi-system/web exec eslint \
  src/features/part-measurement/inspection-drawing/KioskInspectionDrawingVisualUploadModal.tsx \
  src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx
```

| 区分 | 結果 |
|------|------|
| API 単体/統合（変更範囲） | **22 passed**（`postgres-test-local`） |
| Web 単体 | **16 passed** |
| API/Web `tsc` | PASS |
| CI `27262590375` | success |
| Pi5 Phase12（デプロイ後） | **43 / 0 / 0** |

## Deployment

| ホスト | Detach Run ID | PLAY RECAP | 備考 |
|--------|---------------|------------|------|
| `raspberrypi5` | **`20260610-174920-4518`** | `ok=134` **`failed=0`** | `api`/`web` 再ビルド · migrate 変更なし |
| Pi4×4 | — | — | **未** |

標準手順: [deployment.md](../guides/deployment.md) · `--limit raspberrypi5` 先行 → Pi5 目視 → Pi4 1台ずつ。

## Open Items

1. **Pi5 手動**: 自主検査 WIP 氏名 · TIFF プレビュー/保存/再読込座標（[verification-checklist §6.6](../guides/verification-checklist.md) TIFF 行 `[ ]`）
2. **Pi4×4 デプロイ**: `raspi4-kensaku-stonebase01` 先行 → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`
3. **`main` マージ**後 Pi4 反映

## Local Notes JA

- 仕掛中ハブ基盤（タブ順・migration）は先行ブランチ `feat/kiosk-self-inspection-wip-and-tab-order`（`c9b265a9`）で本番済。本ブランチは **TIFF + participant 集約 + WIP 表示 polish**。
- TIFF 統合テスト `part-measurement-drawing-tiff.integration.test.ts` は DB 必須。Mac では既存 `postgres-test-local` を利用。
