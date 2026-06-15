# KB-390: Kiosk leader order board inspection workflow (chooser + plannedQuantity print)

## Metadata

| Field | Value |
|-------|-------|
| **id** | KB-390 |
| **status** | active |
| **scope** | Kiosk leader order board · self-inspection entry · inspection drawing print preview |
| **date** | 2026-06-15 |
| **source_of_truth** | This file |
| **branch** | `fix/inspection-print-record-qr` → merge to `main` |
| **commits** | `8dfc9b13` (workflow modal) · `5116f75f` (plannedQuantity print) · `e0b3703d` (OCR record value boxes) · `3b83b577` (print disclaimer toolbar-only) · **`a2158875`** (record page QR + P1 fiducial removal) |
| **ci** | **`27535726878`** success (`a2158875`) · **`27532188574`** success (`3b83b577` · PR **#443**) |

## Context

Operators start self-inspection from the leader order board row action **検** (previously direct navigation). The new flow opens a modal to choose **デジタル入力** or **帳票紙印刷**. Paper print must carry schedule **plannedQuantity** into record-sheet column count (full self-inspection mode).

**Prisma / API**: no change. **Web only** · Pi5 Docker **`web`** rebuild.

## Specification (handoff)

| Item | Behavior |
|------|----------|
| **Entry** | Leader board row **検** → modal title **検査方法を選択** |
| **デジタル入力** | Enabled when `selfInspectionEntryPath` is non-empty. Navigates to existing self-inspection start/session URL. |
| **帳票紙印刷** | Enabled when `selfInspectionTemplateId` is non-empty. `window.open` to `kioskInspectionDrawingTemplatePrintPath(templateId, { plannedQuantity: row.plannedQuantity })`. |
| **Print URL** | `…/inspection/templates/:id/print?plannedQuantity=N` when N is a positive integer; omitted when null/invalid. |
| **Print cap** | `INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT = 2000` in URL parse + view model (abuse guard). |
| **Record layout** | `INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE = 5` (was 6). Full mode uses `plannedQuantity` for entry columns when set. |
| **OCR record cells** | Each measurement column renders **`MeasurementValueWriteBoxes`**: sign box · 4 integer digit boxes · decimal point · 3 decimal digit boxes (`data-testid="inspection-print-measurement-value-boxes"`). Column widths (mm): no **8** · point **24** · spec **30** · value **45**. |
| **Record text wrap** | Long point labels split across up to 2 lines (`splitRecordPointLabel`). Spec/tolerance split (`formatRecordSpecificationLines`; e.g. `合格範囲` on line 1). |
| **Print alignment** | Corner **SheetFiducials** (L-shaped markers) on **record pages only**. **P1 drawing page has no fiducials** (avoids OCR false positives on the drawing). |
| **Drawing page layout** | Padding **`INSPECTION_DRAWING_PRINT_DRAWING_PAGE_PADDING_MM = 3`** (was 5mm). Drawing area height **193mm**. |
| **Record page QR** | Each record page renders a **page-specific QR** (`data-testid="inspection-print-record-qr-code"`). Payload JSON type **`inspection-drawing-record-page`**, **`schemaVersion: 1`**, fields: `reportId` (preview identifier), `templateId`, `fhincd`, `resourceCd`, `templateVersion`, `pageNumber`, `totalPages`, `entryIndexFrom`, `entryIndexTo`, **`markerNoFrom`**, **`markerNoTo`**. Encoded with `@zxing/library` `QRCodeWriter` → SVG (print-safe). Label: **`QR P{pageNumber}`**. |
| **Record header band** | Compact manual fields (**検査日 / 作業者 / ロット / 数量**) in **`w-[72mm]`** grid (`inspection-print-record-controls`); QR sits in right column (**27mm**). |
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

## Validation

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
| P1 OCR fiducial removal | **Done** — fiducials on record pages only (`a2158875`) |
| QR scan backend / OCR ingest of printed values | **Not implemented** (payload is for future reader) |
| Formal DB-backed report ID (replace preview identifier) | **Not implemented** |
| Print disclaimer placement | **Done** — toolbar-only on screen (`3b83b577`); not on printed sheets |
| Pi5 print dialog / PDF / physical printer A4 landscape | **Not verified** on kiosk hardware |

## References

- [KB-320](./KB-320-kiosk-part-measurement.md) (self-inspection · inspection drawing)
- [KB-297](./KB-297-kiosk-due-management-workflow.md) (leader order board)
- [kiosk-part-measurement Runbook](../runbooks/kiosk-part-measurement.md)
- [deployment.md](../guides/deployment.md)
