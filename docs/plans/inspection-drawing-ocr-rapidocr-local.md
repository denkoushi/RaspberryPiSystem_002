---
id: inspection-drawing-ocr-rapidocr-local
status: active
scope: kiosk inspection drawing OCR secondary local engine
date: 2026-07-10
source_of_truth: true
related_code:
  - apps/api/src/services/part-measurement/drawing-local-ocr-secondary-policy.ts
  - apps/api/src/services/part-measurement/drawing-local-ocr.rapidocr.adapter.ts
  - apps/api/src/services/part-measurement/drawing-local-rapidocr-worker.client.ts
  - apps/api/src/services/part-measurement/part-measurement-drawing-ocr.service.ts
  - scripts/part-measurement/drawing-local-rapidocr-worker.py
  - infrastructure/docker/Dockerfile.api
related_docs:
  - docs/decisions/ADR-20260710-inspection-drawing-ocr-rapidocr-local.md
  - docs/decisions/ADR-20260709-inspection-drawing-ocr-local-candidates.md
  - docs/knowledge-base/KB-320-kiosk-part-measurement.md
validation: >
  API unit (policy/rapidocr adapter/secondary orchestration/local crop),
  temp pgvector/pg16 integration for drawing OCR candidates (disposed)
open_items:
  - Enable PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED on Pi5 after image rebuild + latency check
  - Re-measure offline top5 / depth subset on production drawings
  - DGX VLM remains out of scope
---

# Plan: Inspection Drawing OCR RapidOCR Local Secondary

## Goal

Improve weak marker-local OCR candidates by running RapidOCR only when primary (cache + tesseract local) ranking looks weak, without changing `pm-drawing-ocr-v3`.

## Branch

`feat/inspection-drawing-ocr-rapidocr-local`

## Decisions

- Primary local engine remains tesseract (`DrawingLocalOcrTesseractAdapter`).
- Secondary engine is RapidOCR via persistent Python worker (JSON Lines).
- Secondary runs only when flag ON **and** `isWeakLocalOcrCandidates` is true.
- RapidOCR flag defaults **OFF**.
- Failures fall back to primary candidates (no 500).
- No auto-confirm. No DGX. No full-drawing engine swap.

## Weakness policy

Secondary runs when any of:

1. candidates length is 0
2. top1 `score` > `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE` (default `0.12`)
3. `depthSearch` and no depth-note evidence (`深サN` / `深さ N`) in candidate `rawText`

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED` | OFF | Enable secondary RapidOCR |
| `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_TIMEOUT_MS` | 5000 | Secondary timeout |
| `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WEAK_SCORE` | 0.12 | Weak top1 score threshold |
| `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_PYTHON` | `python3` | Python binary |
| `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_WORKER` | auto-detect script | Worker script path |

## Non-goals

- Production deploy / merge in this plan (separate instruction)
- DGX VLM
- Mandatory v3 re-backfill
- Candidate auto-confirm

## Validation Outcomes (2026-07-10)

- Unit: policy / rapidocr adapter / secondary orchestration / existing local OCR — passed
- Temp Postgres `pgvector/pgvector:pg16` on `:5432`: migrate + focused integration `-t 'drawing OCR'` — 2 passed; container removed
- `tsc -p tsconfig.build.json` — passed
- ADR: [ADR-20260710](../decisions/ADR-20260710-inspection-drawing-ocr-rapidocr-local.md)
