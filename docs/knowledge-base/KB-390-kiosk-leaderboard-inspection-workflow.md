# KB-390: Kiosk leader order board inspection workflow and paper report OCR handoff

## Metadata

| Field | Value |
|-------|-------|
| **id** | KB-390 |
| **status** | active |
| **scope** | Kiosk leader order board · self-inspection entry · DB-backed paper report print · OCR handoff |
| **date** | 2026-06-15 · updated 2026-06-25 |
| **source_of_truth** | This file |
| **branch** | `codex/self-inspection-paper-report-ocr-qr` → PR #527 → merge to `main` |
| **commits** | `8dfc9b13` (workflow modal) · `5116f75f` (plannedQuantity print) · `e0b3703d` (OCR record value boxes) · `3b83b577` (print disclaimer toolbar-only) · `a2158875` (record page QR + P1 fiducial removal) · `247ab019` (print preview layout polish) · **`5ef8c2ac`** (DB-backed paper report workflow) |
| **ci** | **PR #527** all success: Secret scan · CodeQL · CI (`lint-build-unit`, `e2e-smoke`, `security-docker`, `api-db-and-infra`, `e2e-tests`) |

## Context

Operators start self-inspection from the leader order board row action **検** (previously direct navigation). The new flow opens a modal to choose **デジタル入力** or **帳票紙印刷**. Paper print must carry schedule **plannedQuantity** into record-sheet column count (full self-inspection mode).

2026-06-25 update: paper print is no longer a throwaway HTML preview. It is an issued paper report path into the same `SelfInspectionSession`. The QR code is intentionally short and only resolves a DB page record; it does not carry part, process, template, or measurement-point JSON.

## Current State (2026-06-25 · DB-backed paper report)

| Item | Current behavior |
|------|------------------|
| **Entry** | Leader board row **検** → **帳票紙印刷** calls `POST /api/part-measurement/self-inspection/paper-reports/issue` before opening print. |
| **Session** | Issue service creates or reuses the existing `SelfInspectionSession` for the row. Paper is an input route into that same session, not a separate inspection object. |
| **Latest print wins** | For the same `scheduleRowId`, unfinalized paper reports in `ISSUED` / `OCR_REVIEW` become `SUPERSEDED` when reprinted. Only the newest issue is OCR-importable. |
| **Print route** | The print page uses `/kiosk/part-measurement/inspection/paper-reports/:reportId/print` and fetches DB-issued report/page data. The legacy template preview route remains for preview/dev compatibility. |
| **Kiosk print navigation** | Leader board paper print uses same-tab navigation, not `_blank`. The issued print URL may include internal `returnTo`, and the print toolbar/error screen exposes **順位ボードに戻る** for kiosk recovery without tab operations. |
| **QR payload** | Page QR is `SIP1:<pageCode>:<check>`, for example `SIP1:A7K4M2Q9:5F`. The QR resolves to `SelfInspectionPaperReportPage`. |
| **QR size** | Record-page QR is enlarged to about **22mm** and uses the previous surrounding blank space. Header reserve is widened to keep record fields usable. |
| **OCR boundary** | Backend accepts OCR candidate values and stores them as a review record. It does not write measurement values until human confirmation. |
| **Import boundary** | Confirmed values are written into existing `SelfInspectionLotEntry` and `SelfInspectionMeasurementValue` rows. Existing digital values require explicit overwrite approval. |
| **Report status** | `ISSUED`, `OCR_REVIEW`, `IMPORTED`, `SUPERSEDED`, `CANCELLED`. |
| **Pi4 rollout** | No Pi4 code deploy required. Pi4 kiosks load the Pi5-hosted web bundle; reload/restart only if an existing tab still holds the old JS. |

### Data Model

Added Prisma models:

- `SelfInspectionPaperReport`: issue unit; links `sessionId`, `scheduleRowId`, `templateId`, status, issue/import timestamps, client device, planned quantity, and template version.
- `SelfInspectionPaperReportPage`: QR target; stores `pageCode`, page number, entry range, and marker range.
- `SelfInspectionPaperOcrReview`: OCR/review history; stores source image references, OCR candidates, confirmed values, reviewer/import metadata, and failure reason.

### Services And Ports

| Service / Port | Responsibility |
|----------------|----------------|
| `SelfInspectionPaperReportIssueService` | Session lookup/create, old report supersede, new report/page issue. |
| `SelfInspectionPaperQrCodec` | Versioned short QR generation and check validation. |
| `SelfInspectionPaperReportResolver` | QR-to-page/report resolution and status rejection. |
| `SelfInspectionPaperOcrPort` | OCR engine abstraction; current implementation is a replaceable no-op/adapter boundary. |
| `SelfInspectionPaperOcrReviewService` | Convert OCR candidates into review records; does not persist measurement values. |
| `SelfInspectionPaperImportService` | Confirmed-value validation and import into existing self-inspection DB tables. |
| `self-inspection-paper-measurement-values.ts` | Numeric validation, duplicates, decimal places, tolerance, and overwrite policy. |

### API Endpoints

- `POST /api/part-measurement/self-inspection/paper-reports/issue`
- `GET /api/part-measurement/self-inspection/paper-reports/:id/print`
- `POST /api/part-measurement/self-inspection/paper-reports/resolve-page`
- `POST /api/part-measurement/self-inspection/paper-reports/ocr-reviews`
- `POST /api/part-measurement/self-inspection/paper-reports/ocr-reviews/:id/confirm`

### Validation Rules

- Reprinting the same `scheduleRowId` supersedes earlier unimported paper reports.
- `SUPERSEDED`, `IMPORTED`, `CANCELLED`, invalid-check, and unknown QR payloads are rejected before OCR/import.
- Already confirmed page OCR review is rejected to prevent double import.
- Confirmed import does not silently overwrite existing digital measurement values.
- Completed sessions are not valid paper reprint targets in normal operation.
- QR unreadable recovery remains manual/admin-only for v1.

### Related code

- [`self-inspection-paper-report-issue.service.ts`](../../apps/api/src/services/part-measurement/self-inspection-paper-report-issue.service.ts)
- [`self-inspection-paper-qr-codec.ts`](../../apps/api/src/services/part-measurement/self-inspection-paper-qr-codec.ts)
- [`self-inspection-paper-report-resolver.service.ts`](../../apps/api/src/services/part-measurement/self-inspection-paper-report-resolver.service.ts)
- [`self-inspection-paper-ocr-review.service.ts`](../../apps/api/src/services/part-measurement/self-inspection-paper-ocr-review.service.ts)
- [`self-inspection-paper-import.service.ts`](../../apps/api/src/services/part-measurement/self-inspection-paper-import.service.ts)
- [`schema.prisma`](../../apps/api/prisma/schema.prisma)
- [`KioskInspectionDrawingPrintPage.tsx`](../../apps/web/src/pages/kiosk/KioskInspectionDrawingPrintPage.tsx)
- [`InspectionDrawingPrintPreview.tsx`](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPrintPreview.tsx)
- [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)

### Open Items For Next AI

| Item | Status / next action |
|------|----------------------|
| OCR image ingestion UI | Not implemented. Add upload/scan UI that first resolves QR, then calls the OCR review API. |
| Real OCR adapter | Not implemented. Connect `SelfInspectionPaperOcrPort` to the selected engine and keep import service unchanged. |
| Human review screen | Not implemented. Build a review/correction UI over `SelfInspectionPaperOcrReview` and existing digital values. |
| QR unreadable recovery | Manual/admin-only in v1. Design a controlled lookup flow before enabling operators to bypass QR. |
| Overwrite UX | Backend requires explicit overwrite for existing digital values; UI must expose difference and confirmation. |
| Printer acceptance | Brother HL-L2460DW physical print and field validation reported OK by operator on 2026-06-25. Keep QR around 22mm unless a new scanner requires adjustment. |

## Specification (handoff)

This section preserves the original 2026-06-15 workflow and print layout contract. For 2026-06-25 and later, the DB-backed paper report rules above supersede the old JSON QR identity and formal report ID open item.

| Item | Behavior |
|------|----------|
| **Entry** | Leader board row **検** → modal title **検査方法を選択** |
| **デジタル入力** | Enabled when `selfInspectionEntryPath` is non-empty. Navigates to existing self-inspection start/session URL. |
| **帳票紙印刷** | Enabled when `selfInspectionTemplateId` is non-empty. Current path issues a DB-backed paper report, then navigates the same kiosk tab to the issued report print route. |
| **Print URL** | `…/inspection/templates/:id/print?plannedQuantity=N` when N is a positive integer; omitted when null/invalid. |
| **Print cap** | `INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT = 2000` in URL parse + view model (abuse guard). |
| **Record layout** | `INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE = 5` (was 6). Full mode uses `plannedQuantity` for entry columns when set. |
| **OCR record cells** | Each measurement column renders **`MeasurementValueWriteBoxes`**: sign box · 4 integer digit boxes · decimal point · 3 decimal digit boxes (`data-testid="inspection-print-measurement-value-boxes"`). Cell row height **`h-[8.9mm]`** (was 8.1mm). Table row height **`h-[11.5mm]`** (was 10.5mm). Column widths (mm): no **8** · point **24** · spec **30** · value **45**. |
| **Record text wrap** | Long point labels split across up to 2 lines (`splitRecordPointLabel`). Spec/tolerance split (`formatRecordSpecificationLines`; e.g. `合格範囲` on line 1). |
| **Print alignment** | Corner **SheetFiducials** (L-shaped markers) on **record pages only**. **P1 drawing page has no fiducials** (avoids OCR false positives on the drawing). |
| **Drawing page layout** | Padding **`INSPECTION_DRAWING_PRINT_DRAWING_PAGE_PADDING_MM = 3`**. Drawing `<main>` (`data-testid="inspection-print-drawing-area"`) is **borderless white** (no P1 frame). Drawing area height **`INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM = 195`** (was 193mm). |
| **Record page QR** | Each record page renders a **page-specific QR** (`data-testid="inspection-print-record-qr-code"`) near the top right, size about **22mm**. No **`QR P{n}`** mono label. Current payload is short `SIP1:<pageCode>:<check>`; the 2026-06-15 JSON payload is superseded. SVG via `@zxing/library` `QRCodeWriter`. |
| **Record header band** | Compact manual fields (**検査日 / 作業者 / ロット / 数量**) in **`w-[72mm]`** grid (`inspection-print-record-controls`); header block reserves space for the absolute QR overlay. |
| **Record header** | Column guide **測定値（符号 / 整数4桁 / 小数3桁）**. No 判定 / 確認 / 備考 columns. |
| **Row decoration** | `selfInspectionTemplateId` / `selfInspectionEntryPath` come from **`POST …/leaderboard-decorations`** with body **`{ targetDeviceScopeKey, rowIds }`** (not `rows`). |
| **Print disclaimer** | `INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER` is **screen-only** in `.inspection-print-toolbar`. It is **not** rendered on `.inspection-print-sheet` pages (print CSS hides toolbar). |

### Related code

- [`LeaderBoardInspectionWorkflowModal.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardInspectionWorkflowModal.tsx)
- [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)
- [`kioskInspectionDrawingRoutes.ts`](../../apps/web/src/features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes.ts)
- [`inspectionDrawingPrintViewModel.ts`](../../apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingPrintViewModel.ts)
- [`inspectionDrawingPrintConstants.ts`](../../apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingPrintConstants.ts)
- [`InspectionDrawingPrintPreview.tsx`](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPrintPreview.tsx)

## Deployment

| Host | Required | Notes |
|------|----------|-------|
| **`raspberrypi5`** | Yes | SPA + `web` image rebuild |
| **Pi4×4** | No | Leader board **検** workflow is Pi5-only; Pi4 rollout not needed for this feature |
| **Pi3** | No | `skipping: no hosts matched` |

**Standard command**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh main \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

Reference: [deployment.md](../guides/deployment.md) · [quick-start-deployment.md](../guides/quick-start-deployment.md)

### Production deploy (2026-06-25 · DB-backed paper report + short QR · Pi5 only)

| Field | Value |
|-------|-------|
| **Branch / PR** | `codex/self-inspection-paper-report-ocr-qr` · **#527** |
| **Detach Run ID** | **`20260625-142435-14087`** |
| **Git HEAD (Pi5)** | **`5ef8c2ac`** |
| **PLAY RECAP** | **`ok=134` `changed=4` `failed=0`** |
| **Docker** | `api` + `web` rebuild/recreate (`Git: changed`) |
| **Prisma** | `migrate deploy` and `migrate status` OK; migration `20260625120000_add_self_inspection_paper_reports` applied |
| **Health** | `https://100.106.158.2/api/system/health` returned `status: ok` |
| **Operator real-machine validation** | 2026-06-25: user reported実機検証OK after Pi5 deploy |

### Production deploy (2026-06-15 · workflow + plannedQuantity · Pi5 only)

| Field | Value |
|-------|-------|
| **Detach Run ID** | `20260615-110704-22124` |
| **Git HEAD (Pi5)** | `5116f75f` |
| **PLAY RECAP** | `ok=134` `changed=4` **`failed=0`** |
| **Web bundle** | `/srv/site/assets/index-B-ixv-BH.js` (contains `plannedQuantity`) |

### Production deploy (2026-06-15 · OCR record value boxes · Pi5 only)

| Field | Value |
|-------|-------|
| **Detach Run ID** | `20260615-161806-4705` |
| **Git HEAD (Pi5)** | `e0b3703d` |
| **PLAY RECAP** | `ok=134` `changed=4` **`failed=0`** |
| **Docker** | `web` rebuild (`Git: changed`) |

### Production deploy (2026-06-15 · print disclaimer toolbar-only · Pi5 only)

| Field | Value |
|-------|-------|
| **Branch / PR** | `review/inspection-print-preview-polish` · **#443** |
| **Detach Run ID** | `20260615-171427-5539` |
| **Git HEAD (Pi5)** | `3b83b577` |
| **PLAY RECAP** | `ok=134` `changed=4` **`failed=0`** |
| **Docker** | `web` rebuild (`Git: changed`) |
| **Web bundle** | `index-C1vJd6pe.js` (`HTMLプレビュー` ×1 · `inspection-print-toolbar` present) |

### Production deploy (2026-06-15 · record page QR + P1 fiducial removal · Pi5 only)

| Field | Value |
|-------|-------|
| **Branch** | `fix/inspection-print-record-qr` |
| **Detach Run ID** | **`20260615-183021-14261`** |
| **Git HEAD (Pi5)** | **`a2158875`** |
| **PLAY RECAP** | **`ok=134` `changed=5` `failed=0`** |
| **Docker** | `web` rebuild (`Git: changed`) |
| **Web bundle** | **`index-CQrgpR0u.js`** (contains `inspection-print-record-qr-code` · `inspection-drawing-record-page` · `markerNoFrom` · `markerNoTo` · `inspection-print-sheet-fiducial`) |

### Production deploy (2026-06-15 · print preview layout polish · Pi5 only)

| Field | Value |
|-------|-------|
| **Branch** | `fix/inspection-print-preview-layout` |
| **Detach Run ID** | **`20260615-191941-17013`** |
| **Git HEAD (Pi5)** | **`247ab019`** |
| **PLAY RECAP** | **`ok=134` `changed=4` `failed=0`** |
| **Docker** | `web` rebuild (`Git: changed`) |
| **Web bundle** | **`index-DIXoz0NY.js`** (`inspection-print-drawing-area` · `right-[10mm]` · `h-[18mm]` · `h-[8.9mm]`; no `QR P` label; no P1 drawing border) |

## Validation

### Automated (2026-06-25 · same-tab paper print navigation)

```bash
pnpm --filter @raspi-system/web test -- src/features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes.test.ts src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPrintPreview.test.tsx src/pages/kiosk/KioskInspectionDrawingPrintPage.test.tsx
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web build
```

**Result**: all passed locally. Build produced only existing chunk-size/browser-data freshness warnings.

### Automated and production (2026-06-25 · after DB-backed paper report deploy `5ef8c2ac`)

Local pre-push:

```bash
pnpm --filter @raspi-system/api prisma:generate
pnpm --filter @raspi-system/api build
pnpm --filter @raspi-system/web build
pnpm --filter @raspi-system/api lint
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/api test -- --run src/services/part-measurement/__tests__/self-inspection-paper-report.test.ts
pnpm --filter @raspi-system/web test -- --run src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPrintPreview.test.tsx src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingPrintViewModel.test.ts src/features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes.test.ts src/features/kiosk/leaderOrderBoard/__tests__/LeaderBoardInspectionWorkflow.test.tsx src/pages/kiosk/KioskInspectionDrawingPrintPage.test.tsx
```

GitHub Actions on PR #527: Secret scan, CodeQL, and CI all success.

Pi5 production checks:

```bash
./scripts/deploy/verify-phase12-real.sh
```

**Result**: PASS **43** / WARN **0** / FAIL **0**

DB verification after deploy:

- `_prisma_migrations` includes `20260625120000_add_self_inspection_paper_reports`.
- `SelfInspectionPaperReport`, `SelfInspectionPaperReportPage`, and `SelfInspectionPaperOcrReview` exist.

### Automated (2026-06-15 · after layout polish deploy `247ab019`)

```bash
./scripts/deploy/verify-phase12-real.sh
```

**Result**: PASS **43** / WARN **0** / FAIL **0** (~56s)

### Manual kiosk (2026-06-15 · layout polish · after `247ab019` deploy)

**Access**: Pi5 SSH + Tailscale HTTPS · bundle **`index-DIXoz0NY.js`**

| Step | Expected | Observed |
|------|----------|----------|
| Pi5 Git HEAD | **`247ab019`** | OK |
| Print preview URL | HTTP **200** (`…/inspection/templates/…/print?plannedQuantity=5`) | OK |
| Web bundle markers | `inspection-print-drawing-area` · `right-[10mm]` · `h-[18mm]` · `h-[8.9mm]` each ≥1; **`QR P`** absent | OK (grep) |
| P1 drawing frame | No legacy P1 border/gray background in bundle | OK (`border-slate-900 bg-slate-50` count **0**) |
| Unit/component tests | `InspectionDrawingPrintPreview.test.tsx` **8/8** pass | OK (pre-deploy local) |

### Automated (2026-06-15 · after record page QR deploy `a2158875`)

```bash
./scripts/deploy/verify-phase12-real.sh
```

**Result**: PASS **43** / WARN **0** / FAIL **0** (~74s)

### Manual kiosk (2026-06-15 · record page QR · after `a2158875` deploy)

**Access**: SSH tunnel `-L 18443:127.0.0.1:443` · bundle served as **`index-CQrgpR0u.js`**

| Step | Expected | Observed |
|------|----------|----------|
| Pi5 Git HEAD | **`a2158875`** | OK |
| Print preview URL | HTTP **200** for `…/templates/310b30ae-…/print?plannedQuantity=5` | OK |
| Web bundle markers | QR testids + payload field names present in **`index-CQrgpR0u.js`** | OK (grep counts ≥1 each) |
| P1 fiducials | Fiducial testid on **record pages only** (not drawing page) | OK (unit test contract) |
| Record QR payload | `type=inspection-drawing-record-page` · page/entry/marker ranges | OK (unit + component tests) |

### Automated (2026-06-15 · after print disclaimer deploy `3b83b577`)

```bash
./scripts/deploy/verify-phase12-real.sh
```

**Result**: PASS **43** / WARN **0** / FAIL **0** (~65s)

### Automated (2026-06-15 · after OCR deploy `e0b3703d`)

```bash
./scripts/deploy/verify-phase12-real.sh
```

**Result**: PASS **43** / WARN **0** / FAIL **0** (~54s)

### Local (pre-push)

- Web unit tests: `LeaderBoardInspectionWorkflow`, `inspectionDrawingPrintViewModel`, `kioskInspectionDrawingRoutes`, `KioskInspectionDrawingPrintPage`, print preview (~34 targeted + full web suite 1026 pass)
- ESLint: import group spacing fix in `kioskInspectionDrawingRoutes.ts`
- No API/Prisma migration in this branch

### Manual kiosk (2026-06-15 · workflow · Pi5 · Mac browser via SSH tunnel)

**Access**: `https://127.0.0.1:18443/...` (not local Python proxy on `:19080` for POST APIs). Mac default client key: `client-key-mac-kiosk1` · scope example: **第2工場 · kensakuMain**.

| Step | Expected | Observed |
|------|----------|----------|
| Leader board **検** | Modal **検査方法を選択** with **デジタル入力** / **帳票紙印刷** | OK |
| **帳票紙印刷** | New tab URL includes `plannedQuantity=5`; preview shows **1件目…5件目** | OK (`dd7d5c5f-…/print?plannedQuantity=5`) |
| **デジタル入力** | Self-inspection session opens; **入力件（1 / 5）** matches planned quantity | OK (session `0fd8e983-…`) |

### Manual kiosk (2026-06-15 · OCR layout · after `e0b3703d` deploy)

| Step | Expected | Observed |
|------|----------|----------|
| Print preview direct URL | `plannedQuantity=5`; **1件目…5件目**; **60** `inspection-print-measurement-value-boxes` (12 points × 5 entries) | OK |
| Leader board **検** → **帳票紙印刷** | Same print URL opens with OCR boxes | OK |
| Record table guide | **測定値（符号 / 整数4桁 / 小数3桁）** visible; no 判定/確認/備考 | OK (unit test + DOM) |

### Manual kiosk (2026-06-15 · print disclaimer · after `3b83b577` deploy)

**Access**: `https://127.0.0.1:18443/...` via SSH tunnel `-L 18443:127.0.0.1:443`

| Step | Expected | Observed |
|------|----------|----------|
| Print preview direct URL | `…/templates/dd7d5c5f-…/print?plannedQuantity=5`; disclaimer in **toolbar only** | OK (`disclaimerInToolbar=true` · `disclaimerInSheets=false` · sheets **2** · value boxes **60**) |
| Sheet content | No `HTMLプレビュー` text on `.inspection-print-sheet` | OK |

## Local Notes JA

- UI labels (do not rename in docs): **検査方法を選択** · **デジタル入力** · **帳票紙印刷** · row button **検**
- 順位ボード装飾 API の POST ボディは **`rowIds`**。`rows` オブジェクト配列は無視され装飾が空になる（検証スクリプト注意）

## Open Items

| Item | Status |
|------|--------|
| Pi4 kiosk deploy for inspection print / leader board | **Not required** (entry is Pi5 leader board only) |
| `verification-checklist.md` dedicated § | Not added; reuse leader board + part-measurement manual steps |
| Full Pi4 rollout for shared print layout | Optional only if Pi4 opens inspection print from non–leader-board routes |
| Record page QR identity (page/entry/marker ranges) | **Done** — `a2158875` · Pi5 deploy **`20260615-183021-14261`** |
| Print preview layout polish (P1 borderless · QR overlay · taller OCR cells) | **Done** — `247ab019` · Pi5 deploy **`20260615-191941-17013`** |
| P1 OCR fiducial removal | **Done** — fiducials on record pages only (`a2158875`) |
| Short QR and DB-backed report ID | **Done** — `5ef8c2ac` · Pi5 deploy **`20260625-142435-14087`** |
| QR scan backend resolver | **Done** for API (`resolve-page`); OCR scan UI not implemented |
| OCR ingest of printed values | Backend review/import APIs present; real OCR adapter and review UI not implemented |
| Print disclaimer placement | **Done** — toolbar-only on screen (`3b83b577`); not on printed sheets |
| Pi5 print dialog / PDF / physical printer A4 landscape | **Verified by operator** on 2026-06-25 after HL-L2460DW setup; QR/文字 were field-accepted after QR enlargement |

## References

- [KB-320](./KB-320-kiosk-part-measurement.md) (self-inspection · inspection drawing)
- [KB-297](./KB-297-kiosk-due-management-workflow.md) (leader order board)
- [kiosk-part-measurement Runbook](../runbooks/kiosk-part-measurement.md)
- [deployment.md](../guides/deployment.md)
