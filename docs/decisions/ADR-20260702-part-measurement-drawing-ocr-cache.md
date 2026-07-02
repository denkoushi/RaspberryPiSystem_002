# ADR-20260702: Part Measurement Drawing OCR Cache

## Status

accepted

## Context

Inspection drawing creation should help operators fill the nominal value when they place a circled marker near a dimension. Existing drawings are already imported as `PartMeasurementVisualTemplate` images and must remain the only drawing asset. OCR output is derived metadata, not another copy of the drawing.

Initial validation on `MD100469601 / 7161サドル / 資源CD033` showed that marker 2 (`360`) and marker 5 (`25`) are straightforward, while marker 7 (`37`) needs tiled OCR because dense dimensions can cause full-page OCR to miss or misread the value.

## Decision

1. Add `PartMeasurementDrawingOcrCache` as a child of `PartMeasurementVisualTemplate`.
2. Store only OCR metadata: image size, engine, numeric text tokens, normalized bounding boxes, confidence, pass kind, and rotation.
3. Store payload as `gzip+json` in PostgreSQL `bytea`, keyed by `visualTemplateId + ocrVersion + drawingImageFingerprint`.
4. Run OCR asynchronously through a scheduler and explicit backfill script. Migrations do not process existing drawings.
5. Candidate API returns ranked values; the UI presents candidates and never auto-confirms a nominal value.
6. Use existing `tesseract.js` + `sharp` dependencies for v1. Do not require new OS packages.

## Consequences

- Good: drawing storage remains single-source; cache size is bounded by text metadata, not image duplication.
- Good: OCR version and image fingerprint make re-OCR explicit and repeatable.
- Good: candidate selection keeps human review in the loop for dense drawings.
- Cost: OCR may be delayed until the scheduler/backfill completes; the UI must handle pending/processing states.

## Validation

- Unit tests cover payload encode/decode and candidate ranking, including marker 2=`360`, marker 5=`25`, marker 7=`37` synthetic cases.
- Local validation should use temporary `pgvector/pgvector:pg15`, run migrations, focused API/Web tests, and `EXPLAIN` on OCR cache lookup/claim indexes.

## References

- [ADR-20260330: 部品測定 visual template](./ADR-20260330-part-measurement-visual-template.md)
- [KB-320: Kiosk Part Measurement](../knowledge-base/KB-320-kiosk-part-measurement.md)
