---
id: inspection-drawing-ocr-local-candidates
status: active
scope: kiosk inspection drawing OCR candidate accuracy
date: 2026-07-09
source_of_truth: true
related_code:
  - apps/api/src/services/part-measurement/part-measurement-drawing-ocr-ranking.ts
  - apps/api/src/services/part-measurement/part-measurement-drawing-ocr.service.ts
  - apps/api/src/services/part-measurement/drawing-local-ocr.port.ts
  - apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx
related_docs:
  - docs/decisions/ADR-20260702-part-measurement-drawing-ocr-cache.md
  - docs/knowledge-base/KB-320-kiosk-part-measurement.md
validation: >
  API unit (ranking/local adapter/merge), web InspectionDrawingPointSettingsPanel,
  temp pgvector/pg16 integration for drawing OCR candidates (disposed)
open_items:
  - RapidOCR / DGX VLM production wiring (out of scope)
  - Measure candidate POST latency on Pi5 before broad rollout
---

# Plan: Inspection Drawing OCR Local Candidates

## Goal

Improve kiosk inspection-drawing nominal-value OCR candidate accuracy without breaking the existing full-drawing OCR cache contract (`pm-drawing-ocr-v3`).

## Branch

`feat/inspection-drawing-ocr-local-candidates`

## Decisions

- Keep async full-drawing cache on Pi5 `tesseract.js`.
- Add request-time marker-local crop OCR behind `DrawingLocalOcrPort`.
- Improve ranking (concat split + canonical numeric match).
- Extend candidates API with optional `measurementLabel` / `depthMode` for depth ROI.
- UI refetches candidates after measurement label selection.
- No auto-confirm. No RapidOCR/DGX VLM in this plan.

## Success Metrics

- Overall top5 / candidate presence target: **≥75%** (offline eval baseline was ~46–73% depending on stage).
- Depth subset target: **≥60%**.
- Candidate selection remains human-driven.

## Implementation Outline

1. Ranking pure improvements + unit tests.
2. `DrawingLocalOcrPort` + tesseract crop adapter; merge in `getCandidates`.
3. API schema extension + depth ROI.
4. Web client/UI refetch after label change.
5. Local Docker/temp Postgres tests; cleanup resources.
6. KB / ADR closeout.

## Non-goals

- Full-drawing engine replacement
- Mandatory v3 re-backfill
- Production deploy in this plan

## Validation Outcomes (2026-07-09)

- `pnpm --filter @raspi-system/api test -- part-measurement-drawing-ocr drawing-local-ocr` — passed
- `pnpm --filter @raspi-system/web test -- InspectionDrawingPointSettingsPanel` — passed
- Temp Postgres `pgvector/pgvector:pg16` on `:5432`: `prisma migrate deploy` + focused integration `-t 'drawing OCR'` — 2 passed; container removed
- CI: push **`29018538261`** / PR **`29018543850`** / CodeQL **`29018543903`** / Secret scan **`29018543841`** success
- Deploy: Pi5+StoneBase **`20260709-223044-17975`**, remaining Pi4×4 **`20260709-224140-20418`**, HEAD **`09a1fe66`**, Pi3 skipped
- Phase12: **PASS 45 / WARN 0 / FAIL 0**; OCR candidates smoke HTTP 200 (local OCR latency ~6–8s)
- ADR: [ADR-20260709](../decisions/ADR-20260709-inspection-drawing-ocr-local-candidates.md)
- Deployment record: [deployment §2026-07-09](../guides/deployment.md#inspection-drawing-ocr-local-candidates-2026-07-09)
