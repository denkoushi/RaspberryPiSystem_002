# ADR-20260710: Inspection Drawing OCR RapidOCR Local Secondary

## Status

accepted

## Context

ADR-20260709 added request-time marker-local tesseract OCR and ranking improvements while keeping `pm-drawing-ocr-v3`. Real-device use showed better candidate quality, but dense/hard regions remain weak. Offline PoC indicated:

- baseline top5 ≈46%
- + local tesseract ≈65%
- + RapidOCR local ≈71%
- DGX VLM rescue on hard misses was low (especially depth callouts)

Always running two local engines would worsen the already ~6–8s candidate POST latency.

## Decision

1. Keep full-drawing cache and primary local tesseract path unchanged.
2. Add RapidOCR as a **secondary** local engine behind `DrawingLocalOcrPort`.
3. Run RapidOCR only when `PART_MEASUREMENT_DRAWING_OCR_RAPIDOCR_ENABLED` is on **and** primary candidates are weak (`isWeakLocalOcrCandidates`).
4. Package RapidOCR as a **persistent Python worker** inside the API image (`rapidocr==3.8.4`, `onnxruntime==1.20.1`, plus `libgomp1`/`libgl1`/`libglib2.0-0` for OpenCV), spoken to via JSON Lines stdin/stdout.
5. Default RapidOCR flag **OFF** until Pi5 image rebuild + latency validation.
6. On RapidOCR failure/timeout/missing install: warn and return primary candidates.

## Alternatives

- Always-on dual local OCR: rejected for latency.
- Per-request short-lived Python process: rejected (model load cost).
- Separate Docker sidecar: deferred (ops overhead for this scope).
- DGX VLM secondary: rejected for now (low depth rescue, higher cost).

## Consequences

- Good: accuracy path can approach PoC ~71% without changing cache contracts.
- Good: port/adapter split keeps engines swappable.
- Cost: API image grows (ONNX Runtime + RapidOCR models).
- Cost: when enabled on weak points, candidate POST latency increases by secondary timeout budget.
- Ops: enablement is explicit via env after deploy validation.

## Validation

- Unit tests for weakness policy, RapidOCR adapter (mocked worker), secondary orchestration (weak/strong/failure).
- Integration: temp `pgvector/pgvector:pg16` drawing OCR candidates with local/RapidOCR flags off for determinism; container disposed.
- Build typecheck: `tsc -p tsconfig.build.json`.

## Supersedes / Related

- Follows [ADR-20260709](./ADR-20260709-inspection-drawing-ocr-local-candidates.md)
- Does not replace [ADR-20260702](./ADR-20260702-part-measurement-drawing-ocr-cache.md) cache contract

## References

- [Plan](../plans/inspection-drawing-ocr-rapidocr-local.md)
- [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-ocr-rapidocr局所-2026-07-10)
