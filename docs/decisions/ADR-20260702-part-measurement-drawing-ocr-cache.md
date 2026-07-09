# ADR-20260702: Part Measurement Drawing OCR Cache v3

## Status

accepted

Amended on 2026-07-02 after v3 implementation, CI, deployment, and real-device validation.

## Context

Inspection drawing creation should help operators fill the nominal value when they place a circled marker near a dimension. Existing drawings are already imported as `PartMeasurementVisualTemplate` images and must remain the only drawing asset. OCR output is derived metadata, not another copy of the drawing.

Initial validation on `MD100469601 / 7161サドル / 資源CD033` showed that marker 2 (`360`) and marker 5 (`25`) are straightforward, while marker 7 (`37`) needs tiled OCR because dense dimensions can cause full-page OCR to miss or misread the value.

After v1/v2 validation, the normal UX issue was clear: operators should not see `OCR待ち` when placing circled markers on drawings that already exist or were just imported. Existing drawings need automatic backfill, and new imports must be queued immediately instead of waiting for the periodic scheduler.

Quality findings from real drawings:

- `180` may be misread as `1180` when a dimension line is interpreted as a digit. This must not be fixed by generating generic deletion candidates, because that increases noise.
- A rotated stacked value such as `(13)` plus `22` may be read as one raw token (`1322`). Structural split candidates are useful only when the bounding box and orientation indicate stacked or rotated dimensions.
- Geometric tolerance frames contain symbols plus numbers such as `0.050`; the symbol is not reliable input, but numbers inside detected rectangular frames are useful candidates.

DGX Spark was considered as an OCR worker, but v3 intentionally keeps OCR on the Raspberry Pi 5 API container with `tesseract.js`. The `ImageOcrLayoutPort` boundary remains the adapter seam for a future DGX worker.

## Decision

1. Keep `PartMeasurementDrawingOcrCache` as a child of `PartMeasurementVisualTemplate`. Store only OCR metadata: image size, engine, numeric tokens, normalized bounding boxes, confidence, pass kind, rotation, and preprocessing kind.
2. Store payload as `gzip+json` in PostgreSQL `bytea`, keyed by `visualTemplateId + ocrVersion + drawingImageFingerprint`.
3. Use OCR version `pm-drawing-ocr-v3`. Do not delete v2 caches; create v3 caches independently.
4. Add queue metadata `queuePriority` and `lastQueuedAt`. Claim order is manual/new import, then active referenced templates, then remaining active backfill.
5. Automatically discover missing caches, version mismatches, and fingerprint mismatches. Scheduler runs async discovery on startup, continues through cron, and wakes immediately after enqueue.
6. Requeue stale `PROCESSING` work after the configured stale threshold, and fail after the retry limit.
7. Enqueue and wake OCR for visual-template upload, inspection-drawing multipart create, and template create/revise paths that reference an existing visual template.
8. Extend OCR payload tokens with `preprocessKind: raw | lineSuppressed | boxedFrame`; extend candidate pass kind with `full | tile | frame`.
9. For line-artifacts like `1180`, do not synthesize string deletion candidates. Penalize a raw token only when an actual `lineSuppressed` OCR pass reads an overlapping shorter value and the raw digits look like extra line-artifact digits around it.
10. For stacked or rotated dimensions like `1322`, generate structural split candidates only when the token geometry indicates that layout.
11. For geometric tolerance frames, detect rectangular frames from horizontal and vertical lines, OCR frame/cell crops, and candidate only the numeric values inside the frame.
12. The UI preloads drawing-level OCR state. Marker placement and manual entry remain allowed while OCR is pending. Candidate chips are fetched only when the drawing OCR status is completed; `OCR待ち` is not shown in the candidate area.
13. Candidate selection updates only the target point `nominalRaw`; there is no automatic confirmation.
14. DGX Spark is not part of v3. Future worker integration should replace the `ImageOcrLayoutPort` adapter, not the queue/cache contract.

## Consequences

- Good: drawing storage remains single-source; cache size is bounded by text metadata, not image duplication.
- Good: OCR version and image fingerprint make re-OCR explicit and repeatable.
- Good: candidate selection keeps human review in the loop for dense drawings.
- Good: existing and newly imported drawings are queued without operator-triggered OCR becoming the normal path.
- Good: line suppression is evidence-based, avoiding noisy generic deletion candidates.
- Good: DGX Spark can still be introduced later as a worker behind the OCR port.
- Cost: v3 adds more OCR passes and more tokens; queueing, retry, and frame limits are required to keep processing bounded.
- Cost: a missing original drawing file cannot be recovered from OCR cache. The original image must be restored or re-uploaded.

## Implementation State

- Branch: `feat/part-measurement-drawing-ocr-cache`.
- Commits:
  - `e9621c36` `feat: automate part measurement drawing OCR v3`
  - `82b8abdd` `fix: narrow OCR raw line suppression`
- Main API code:
  - `apps/api/src/services/ocr/image-ocr-runtime.ts`
  - `apps/api/src/services/ocr/tesseract-js-image-ocr.adapter.ts`
  - `apps/api/src/services/part-measurement/part-measurement-drawing-ocr.service.ts`
  - `apps/api/src/services/part-measurement/part-measurement-drawing-ocr-engine.ts`
  - `apps/api/src/services/part-measurement/part-measurement-drawing-ocr-ranking.ts`
  - `apps/api/src/services/part-measurement/part-measurement-drawing-ocr-scheduler.ts`
  - `apps/api/src/bootstrap/start-post-listen-schedulers.ts`
  - `apps/api/src/routes/part-measurement/index.ts`
- Current production OCR engine: `tesseract.js` in the Raspberry Pi 5 API container. LLM and DGX Spark are not used for v3 OCR.

## Validation

- Local targeted tests:
  - `pnpm --filter @raspi-system/api test -- part-measurement-drawing-ocr-ranking`
  - `pnpm --filter @raspi-system/api test -- part-measurement-drawing-ocr`
  - `pnpm --filter @raspi-system/api build`
  - `git diff --check`
- CI:
  - Run `28567290460`: success.
  - Run `28569704756`: success after `82b8abdd`.
- Deployment:
  - Run `20260702-143345-12195`: success for `e9621c36`.
  - Run `20260702-153218-13336`: success for `82b8abdd`; all hosts had `failed=0`.
  - Final production HEAD on Pi5: `82b8abdd`.
- Phase12 real-device validation:
  - After first deploy: `PASS 45 / WARN 0 / FAIL 0`.
  - After final deploy: `PASS 45 / WARN 0 / FAIL 0`.
- Real OCR candidate validation on `7161サドル` visual template `dc3de0c7-24d8-42af-98fa-7d5621ecadd8`:
  - cache status `completed`, `tokenCount=3579`.
  - marker 2 expected `360`: rank 1.
  - marker 5 expected `25`: rank 1.
  - marker 7 expected `37`: top 20 after `82b8abdd`; observed rank 7.
- Production backfill observation after final deploy:
  - Active visual templates: 23.
  - Referenced by active templates: 7.
  - Referenced status observed: 5 completed, 1 processing, 1 missing original image.

## Operational Findings

- The marker 7 regression was caused by overly broad raw-token suppression. A same-region `lineSuppressed` misread (`31`) suppressed the correct raw `37`. The fix narrows suppression to raw values that look like line-artifact extensions of the line-suppressed value, preserving the `1180` to `180` behavior without suppressing same-length different values.
- One referenced active visual template cannot be OCRed because the original drawing file is missing:
  - visualTemplateId `6700f7bb-aafc-4984-9fb7-ef9f6f70cb0a`
  - visual name `サドル_表`
  - referenced by active template `MD004809542`, process `GRINDING`, resource `587`
  - missing path `/app/storage/part-measurement-drawings/4219386f-1f9c-42de-a075-142d4d250757.jpg`
- The missing original image is a production data issue, not an OCR implementation failure. Restore or re-upload the original drawing before expecting OCR completion for that visual template.

## Open Items

1. Restore or re-upload the missing `サドル_表` original drawing for visual template `6700f7bb-aafc-4984-9fb7-ef9f6f70cb0a`.
2. Let the scheduler finish remaining active-template backfill. If `PROCESSING` remains beyond the stale threshold, use the retry path and inspect `failureReason`.
3. Add OCR-specific checks to the real-device verification script if marker candidate regressions become common.
4. Evaluate DGX Spark worker integration only after v3 timing and accuracy are measured in normal production use.
5. Candidate accuracy follow-up (ranking + request-time local crop OCR + depth ROI) is recorded in [ADR-20260709](./ADR-20260709-inspection-drawing-ocr-local-candidates.md) / [Plan](../plans/inspection-drawing-ocr-local-candidates.md). Cache version remains `pm-drawing-ocr-v3`.

## References

- [ADR-20260330: 部品測定 visual template](./ADR-20260330-part-measurement-visual-template.md)
- [KB-320: Kiosk Part Measurement](../knowledge-base/KB-320-kiosk-part-measurement.md)
- [Runbook: Kiosk Part Measurement](../runbooks/kiosk-part-measurement.md#検査図面-ocrキャッシュ候補提示2026-07-02)
