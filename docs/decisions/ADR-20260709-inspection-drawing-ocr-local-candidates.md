# ADR-20260709: Inspection Drawing OCR Local Candidates

## Status

accepted

## Context

ADR-20260702 established async full-drawing OCR cache (`pm-drawing-ocr-v3`) and sync-on-read ranking for nominal candidates. Offline evaluation on production drawings showed baseline top5 ≈46%. Failures clustered around concatenated OCR tokens, dense-region ranking, and depth callouts (`深サN`) outside the marker neighborhood.

Replacing the full-drawing engine or wiring RapidOCR/DGX VLM into production was out of scope for this change. The cache/queue contract must remain stable.

## Decision

1. Keep `pm-drawing-ocr-v3` full-drawing cache unchanged as the primary token source.
2. On `POST .../ocr/candidates`, optionally run request-time marker-local crop OCR behind `DrawingLocalOcrPort` (default tesseract adapter via existing `ImageOcrLayoutPort`).
3. Merge local tokens into the ranking input; local OCR failure falls back to cache-only candidates.
4. Extend candidate request body with optional `measurementLabel` and `depthMode` (`measured` | `through`).
5. When the label is depth-like and mode is not `through`, expand local ROI / secondary annulus and prefer depth-note values (`深サ8`, `深さ 12.5`).
6. Improve pure ranking: concat split for 5–6 digit / glued decimals, canonical numeric dedupe (`0.030` ≡ `0.03`), mild short-dimension preference. Do not synthesize generic one-digit deletions.
7. UI sends label/depthMode and refetches candidates after name/depthMode change (and material nudge).
8. Feature flag: `PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED` (default on). Timeout: `PART_MEASUREMENT_DRAWING_OCR_LOCAL_TIMEOUT_MS` (default 8000).

## Alternatives

- RapidOCR / macOS Vision / EasyOCR as production engines: deferred; keep behind future port adapters.
- DGX VLM fallback: deferred; offline rescue rate on hard misses was low for depth callouts.
- Bumping mandatory OCR version / re-backfill: rejected; local pass is request-time.

## Consequences

- Good: accuracy path improves without invalidating existing caches.
- Good: depth ROI can use measurement label selected after placement.
- Cost: candidate POST latency increases when local OCR runs (bounded ROI/rotations/timeout).
- Cost: depth callouts still hard when text is absent from expanded ROI.

## Validation

- Unit: ranking, local adapter (stub layout OCR), merge ranking path.
- Integration (temp `pgvector/pgvector:pg16`, disposed): drawing OCR candidate schema/path with `measurementLabel`/`depthMode` (local OCR disabled in that test to keep deterministic ranking).
- Plan: [inspection-drawing-ocr-local-candidates.md](../plans/inspection-drawing-ocr-local-candidates.md)

## Supersedes / Related

- Amends open items of [ADR-20260702](./ADR-20260702-part-measurement-drawing-ocr-cache.md) regarding candidate accuracy follow-up; does not replace the v3 cache contract.

## References

- [KB-320 OCR section](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-ocrキャッシュ候補提示-2026-07-02)
- [Plan](../plans/inspection-drawing-ocr-local-candidates.md)
