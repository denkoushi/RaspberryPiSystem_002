# 検査図面の丸数字を図面だけから提案する(試験端末だけ)

This ExecPlan is a living document. Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

The goal is to reduce the effort of whoever places the circled numbers (inspection-point marks) in the inspection drawing editor.

Today, no proposal appears unless a similar drawing exists (`no-sibling`). The proposal comes only from a similar drawing ([inspection-drawing-rule-placement-execplan.md](./inspection-drawing-rule-placement-execplan.md)).

This plan adds proposals made from the drawing alone, with fixed criteria:

- the 3 outer dimensions;
- the pitch and depth for each view and each thread size;
- geometric tolerances;
- fits.

The marks go where they do not overlap the dimension text. The target is "not too many, not too few", and a person fixes the rest.

The user approved this direction on 2026-11-21 as a trial (「試しで出す」). The earlier rejection of the reference-v1 approach (generic rules alone) is not reversed. This is a separate trial that runs alongside it, and it can be undone with a flag.

It is shown first on the trial terminal only (raspi4-kensaku-stonebase01). Responses to other terminals stay the same as today.

## Progress

- [x] (2026-11-22) Confirmed the prototype (`~/tools/drawing-exp/holes`) gives nearly the same result without an LLM: 561→563 marks, the only difference being 2 pitches.
- [x] (2026-11-22) Confirmed the earlier stages need only `ocr.py`, `parse.py`, `v3_roles`, `v3_chain`, `v3_synthetic` and the line classification model. Stage v10 onward is not needed.
- [x] (2026-11-22) Converted the line classification model (Keras U-Net, 1.4MB) to ONNX (455KB).
  - It runs on onnxruntime 1.20.1.
  - The output difference is 2e-5, and the classes match 100%.
- [x] (2026-11-22) PR1 implemented: baseline proposals are stored in a `baseline-v1` run, shown only to allowlisted terminals, and imported by `import:baseline-placement-proposals` (dry-run by default).
- [x] (2026-11-22) Local screen check: on an allowlisted terminal the 3 imported proposals appear at their computed positions with dashed leaders, away from the dimension text; approving them leaves no badge on the dimension text. Other terminals get today's response.
- [ ] Deploy PR1 to production and import the proposals computed for the 51 drawings (dry-run first).
- [ ] PR2: compute proposals for new drawings at night with a Python worker inside the API container.

## Surprises & Discoveries

- Production has 51 drawings. All of them have a dimension map (COMPLETED), and they overlap the drawings used to tune the prototype.
  - Only 4 drawings are unseen: 3 small test drawings and test01.
- Removing the line classification model (`--segmentation off`) reduces the marks from 563 to 518, and more pitches are missed. The model is needed.
- The API image has numpy, opencv-headless (via ndlocr-lite) and onnxruntime, but not scipy.
  - The compressed-size headroom is about 18MB under the 1.15GB limit.
  - So scipy is not added; it is replaced with cv2/numpy.
- Production OCR is `rapidocr==3.8.4`; the prototype uses `rapidocr-onnxruntime 1.4.4`.
  - The results may change with the version, so PR2 compares them.
- The name `rule-v1` was used by an older approach, so this plan uses `baseline-v1`.
- The editor ignores the proposal's own marker position when the proposal has a dimension position. It draws the marker 34px to the upper right of the dimension, so the marker lands near the dimension text.
  - Baseline proposals add `markerAtRatio`, which tells the editor to place the marker at the computed position (where it does not overlap the text).
- 17 of the 51 production drawings have no circled numbers yet. Proposals the person already has (same name and same value) are hidden, so the trial is most visible on these 17 drawings.
- To match what people actually write, the measurement names are mapped before import:
  - 横幅/縦幅/奥行き become 全幅/全長/厚み.
  - The geometric tolerance symbol picks the name (平行度, 直角度, etc.). When the symbol is not read, the name stays 幾何公差.
  - キリ穴ピッチ drops the diameter.
- (2026-11-22) The image sha256 of all 47 computed drawings matches the latest production fingerprint.
- (2026-11-22) An approved proposal with a callout tip draws a numbered badge at the tip. For baseline proposals the tip is the dimension text itself, so the badge covered the text. Approved baseline proposals now have no callout tip; the marker already sits beside the dimension.

## Decision Log

- Decision: Split the work into two parts.
  - PR1 imports proposals computed in advance and shows them on the trial terminal.
  - PR2 computes them in production.
  - Rationale: The 51 production drawings are already computed locally. Shipping the display first lets us check on site, early, whether the workers' effort goes down. Porting the computation (about 3,600 lines of Python plus replacing dependencies) needs separate verification.
  - Date/Author: 2026-11-22 / Claude
- Decision: Restrict the trial terminal with the env allowlist `INSPECTION_DRAWING_BASELINE_PLACEMENT_CLIENTS`. It holds device names (or status client IDs), not client keys, because keys are secrets. The API resolves `x-client-key` to the ClientDevice and matches its `name` or `statusClientId`. No ClientDevice column is added.
  - Rationale: No migration and no admin screen change are needed. Removing the entry restores today's behavior.
  - Date/Author: 2026-11-22 / Claude
- Decision: Show baseline proposals on every terminal. The allowlist value `*` means every caller (kiosks and signed-in users), and Ansible now sets `*` instead of the trial terminal.
  - Rationale: The user asked for every terminal to read them (2026-11-22), so that the on-site check of whether the effort goes down is not limited to one kiosk. Setting the value back to a device name, or to empty, restores the earlier behavior.
  - Date/Author: 2026-11-22 / Claude
- Decision: Put baseline proposals in a separate run with `placementVersion = baseline-v1`.
  - The existing proposals from similar drawings (layout/semantic/transfer) are neither deleted nor replaced.
  - Date/Author: 2026-11-22 / Claude

- Decision: One `baseline-v1` run per drawing image, shared by cutting and grinding. A proposal decided in one process group is decided for the other.
  - Rationale: The proposals come from the drawing alone, not from a process. The trial terminal is a grinding terminal.
  - Date/Author: 2026-11-22 / Claude
- Decision: Re-importing replaces the proposal rows, so their ids change. It is meant to run once per computed batch; an editor that is already open then records nothing for its old ids, while saved template items are unaffected.
  - Date/Author: 2026-11-22 / Claude
- Decision (after third-party review, 2026-11-22):
  - The stored dimension JSON keeps the reason under `reason`, not `text`, so the panel shows the label and value instead of an explanatory sentence.
  - The import rejects duplicate `sortOrder` within a drawing and duplicate drawings, and one failing drawing does not stop the others.
  - When every baseline proposal is decided or already present, the terminal falls back to today's proposals.
  - For baseline proposals, an existing item hides a proposal only when it has the same name and value and sits near it (0.06 of the drawing). The same pitch in another view stays visible.
  - Date/Author: 2026-11-22 / Claude

## Context and Orientation

- Proposal tables:
  - Prisma `PartMeasurementDrawingPlacementRun` (unique on visualTemplateId + drawingImageFingerprint + analysisVersion + placementVersion).
  - `PartMeasurementDrawingPlacementProposal` (sourceItemId is NOT NULL and unique together with runId).
- Service: `apps/api/src/services/part-measurement/part-measurement-drawing-placement.service.ts` (ensureRun, listForEditor, recordDecisions, backfill).
- For runs without a source drawing, the existing `part-measurement-drawing-reference-placement.service.ts` (reference-v1, unused) can serve as a model.
- Endpoints: `GET /part-measurement/visual-templates/:id/placement-proposals` and `POST .../decisions` (`apps/api/src/routes/part-measurement/visual-templates.ts`).
- env: `apps/api/src/config/env/inspection-drawing.ts`. Ansible: `infrastructure/ansible/roles/release_pi5/tasks/business-hermes-chat-prepare.yml` (next to the other inspection-drawing flags).
- Editor: `apps/web/src/features/part-measurement/inspection-drawing/`.
- Prototype: `~/tools/drawing-exp/holes` (local only). Its output for the 51 drawings is in `proposals.json` (`export.py`).

## Plan of Work

PR1:

1. Add the env `INSPECTION_DRAWING_BASELINE_PLACEMENT_CLIENTS` (comma-separated device names, empty by default; Ansible sets `raspi4-kensaku-stonebase01`). When it is empty, behavior is the same as today.
2. Add a branch to `listForEditor` and `recordDecisions`.
   - It applies only when the requesting client key is on the allowlist.
   - It uses the `baseline-v1` run that matches the current image fingerprint.
   - If that run does not exist, behavior stays as today.
3. Add a script that imports proposals computed in advance (JSON).
   - It is dry-run by default and writes only with `--apply`.
   - sourceItemId is a fixed synthetic ID.
   - The reason and the kind go into the `dimension` Json.
4. Add no UI text.

PR2 (a separate plan will be added):

- Turn the prototype's Python into a worker inside the API image.
- Replace scipy with cv2/numpy.
- Run the line classification on ONNX.
- Create the `baseline-v1` run in the nightly backfill.

## Validation and Acceptance

- Responses to terminals not on the allowlist are the same as before the change (pinned by tests).
- On an allowlisted terminal, the `baseline-v1` proposals come back, and approvals and rejections can be saved.
- For a drawing that has proposals from a similar drawing, terminals not on the allowlist keep today's proposals.
- Emptying the env restores today's behavior.
- Locally, follow the verify-screen procedure to confirm the imported proposals appear in the editor.

## Idempotence and Recovery

The import upserts the same run. To redo it, run it again with the same JSON. To roll back, empty the env (the run stays but is not used).

## Interfaces and Dependencies

No new dependencies are added.
