---
id: plan-kiosk-sop-visual-layout-correction
title: Correct kiosk SOP leader geometry and responsive screen sizing
status: in_progress
date: 2026-08-02
source_of_truth: true
scope: Generated kiosk SOP annotation layout and popup presentation
related_docs:
  - ../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md
  - ../decisions/ADR-20260801-kiosk-sop-generated-from-production-ui.md
related_code:
  - packages/kiosk-sop-core/src/
  - apps/web/src/features/kiosk-sop/
  - scripts/kiosk-sop/
validation:
  - Core unit, lint, and build
  - Deterministic Docker regeneration
  - Chromium and Firefox popup geometry
  - Web unit, lint, build, and production image smoke
  - Disposable PostgreSQL migration, SQL, EXPLAIN, and related API tests
---

# Correct kiosk SOP leader geometry and responsive screen sizing

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain
this file in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this correction, an operator can select any instruction card and see one leader
that physically joins the card edge to the matching numbered target. The selection
remains visible after a touch until another card is selected. On large kiosk displays,
the captured production screen uses the iframe area instead of remaining capped at
1280 pixels. The nine sheets, their text, required/optional classification, offline
delivery, print size, and production React captures remain unchanged.

## Progress

- [x] (2026-08-02 09:00+09:00) Confirmed clean, current `main` and created
  `fix/kiosk-sop-visual-layout`.
- [x] (2026-08-02 09:00+09:00) Reproduced the hard-coded stage-local leader start,
  target-pin letterbox offset, and 1280-pixel runtime cap from code and browser metrics.
- [x] (2026-08-02 09:06+09:00) Added pure contained-rectangle and
  card-to-pin-boundary geometry plus a typed self-contained runtime coordinator.
- [x] (2026-08-02 09:08+09:00) Recomposed the generated HTML so leaders span the body
  and pin placement follows
  the contained image rectangle.
- [x] (2026-08-02 09:11+09:00) Expanded the selected runtime sheet and added
  Chromium/Firefox geometry coverage at all three target resolutions.
- [x] (2026-08-02 09:14+09:00) Regenerated committed artifacts and updated the accepted
  step-rail decision and documentation inventory.
- [x] (2026-08-02 09:24+09:00) Completed Core, Web, Docker, browser, documentation,
  change-classification, and disposable-DB validation.
- [x] (2026-08-02 09:31+09:00) Received explicit production deployment approval and
  expanded this plan through commit, pull request, required CI, `origin/main`
  integration, standard rolling deployment, and production evidence.
- [x] (2026-08-02 09:34+09:00) Committed and pushed the exact validated scope, then
  opened Draft PR #1151 to `main`; the initial implementation commit was `d041ec75`.
- [ ] Confirm required hosted CI at the immutable head SHA and merge the pull request.
- [ ] Run the read-only standard fleet plan against merged `main`, inspect every target
  and `unknown` reason, then start the standard rolling release.
- [ ] Confirm terminal release status, maintenance clearance, per-host production SHA,
  and a same-SHA no-op plan; record the evidence and leave the worktree clean.

## Surprises & Discoveries

- Observation: The previous hand-authored viewer measured the real card and pin
  rectangles, but the generated renderer replaced this with `x1="18%"` and an
  index-derived `y1` inside `.stage`.
  Evidence: comparison of the parent HTML with
  `packages/kiosk-sop-core/src/render.ts`.
- Observation: The committed 1280x720 edit sheets contain a 950x534 contained image
  inside a 950x638 stage, while pins are positioned against the whole stage.
  Evidence: Playwright DOM measurements and the generated `edit-basics.png`.
- Observation: Existing tests assert color tokens and active opacity, but no endpoint
  geometry or Full HD utilization.
  Evidence: `render.test.ts` and `inspection-drawing-sop-popup.spec.ts`.
- Observation: The new root-level dedicated Playwright configuration was not covered
  by the existing change classifier, even though the SOP spec itself was.
  Evidence: `scripts/ci/classify_changes.py`; the classifier and its regression test
  now select `e2e`, `kiosk_sop`, CodeQL, and repository policy for that path.
- Observation: The disposable API validation runs under the host Node 18 runtime and
  reports the repository's Node >=20.9 engine warning, but migration, API, SQL, and
  EXPLAIN checks all pass.
  Evidence: `bash scripts/kiosk-sop/validate-db-contract.sh` output on 2026-08-02.

## Decision Log

- Decision: Hide all leaders initially and display exactly one selected leader.
  Touch/click and keyboard focus persist selection until another card is selected;
  pointer hover is a temporary preview.
  Rationale: This avoids a line web while remaining usable on touch-only kiosks.
  Date/Author: 2026-08-02 / Product owner and Codex.
- Decision: Keep the rail at 330 pixels and the sheet header at 82 pixels, but make the
  selected embedded sheet fill the iframe width and height.
  Rationale: This maximizes the production screen without enlarging the instruction
  column or changing the deterministic print canvas.
  Date/Author: 2026-08-02 / Product owner and Codex.
- Decision: Keep schema version 1 and derive source image dimensions from the existing
  scenario viewport.
  Rationale: The correction needs no manual-definition migration or registry change.
  Date/Author: 2026-08-02 / Codex.

## Outcomes & Retrospective

The implementation and local validation are complete on
`fix/kiosk-sop-visual-layout`. Static 1280x720 capture
remains deterministic, while the embedded sheet fills the runtime iframe. All 44 cards
across nine sheets connect to their matching pin boundary within the two-pixel
tolerance at 1280x800, 1536x864, and 1920x1080 in Chromium and Firefox. Initial leader
count is zero and persistent selection, hover preview, keyboard focus, offline use,
iframe isolation, Escape close, and opener focus restoration are covered.

Core unit/lint/build, all 1,666 Web tests, Web lint/build, byte-identical Docker
generation, 18 dedicated browser tests, three Caddy production-bundle smoke tests,
documentation audit, change-classifier tests, and `git diff --check` passed. Disposable
PostgreSQL validation applied all 157 migrations, reported zero unfinished migrations,
passed three related API integration tests, and completed SQL and EXPLAIN checks. Its
container, volume, and network were removed, as were the temporary Web container and
image. No API contract or database schema changed. Publication, `main` integration,
and the approved production rollout are now in progress; this plan cannot return to
`complete` until the four-state SHA audit required by `AGENTS.md` is recorded.

## Context and Orientation

`packages/kiosk-sop-core/src/render.ts` composes HTML from the separated style,
geometry, and runtime modules. The body-wide SVG leaders and image-contained pins are
updated from live DOM measurements. The generator in
`scripts/kiosk-sop/generate.mjs` captures two production React routes, hydrates target
coordinates, renders nine 1280x720 review sheets, and stores a deterministic manifest.
The Web popup adapts this immutable HTML through
`apps/web/src/features/kiosk-sop/buildKioskSopSrcDoc.ts`; the selected sheet fills the
iframe without changing standalone print dimensions. The iframe is sandboxed with
scripts only and makes no network request.

## Plan of Work

First split geometry and runtime behavior from static rendering. Add pure contained
image and leader-segment calculations that use plain rectangles. Emit a typed runtime
function as an inline script so the generated manual remains self-contained. It will
place each pin relative to the actual contained image, measure the card and pin, update
the body-wide SVG, and manage persistent and hover selection.

Then update the static markup and styles. The leader overlay will cover `.body`; lines
will start at the card's right-center and end at the numbered pin boundary. Required
and optional cards, card numbers, pins, and leaders will use their respective tokens.
Print will continue to suppress leaders. The embedded selected sheet will fill its
iframe, while standalone generated sheets remain 1280x720.

Finally add geometry-focused Core tests and a dedicated Chromium/Firefox Playwright
configuration for the existing popup spec. Regenerate all committed artifacts, update
the step-rail ADR, and execute the full validation sequence including isolated Web and
PostgreSQL Docker resources.

After local acceptance, commit and publish the scoped feature branch, open a pull
request to `main`, wait for every required hosted check, and merge only that accepted
head. Fetch and verify the immutable merged SHA from `origin/main`. Use only
`scripts/update-all-clients.sh` for the authorized production rollout: inspect the
read-only plan first, run the standard rolling release, follow any human canary gate
without pre-authorizing it, inspect final status, and prove the same SHA produces a
no-op plan.

## Concrete Steps

Run all commands from `/Users/tsudatakashi/RaspberryPiSystem_002` on branch
`fix/kiosk-sop-visual-layout`.

    pnpm --filter @raspi-system/kiosk-sop-core test
    pnpm --filter @raspi-system/kiosk-sop-core lint
    pnpm --filter @raspi-system/kiosk-sop-core build
    pnpm kiosk-sop:generate --all
    pnpm kiosk-sop:check
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build
    node scripts/docs/audit-docs.mjs --write
    node scripts/docs/audit-docs.mjs --check
    bash scripts/kiosk-sop/validate-db-contract.sh
    git diff --check

Use exact run-specific names and cleanup traps for Web and PostgreSQL Docker resources.
Do not connect validation to an existing database or container.

## Validation and Acceptance

At 1280x800, 1536x864, and 1920x1080, the initial visible leader count is zero. After
selecting a card, exactly one leader is visible and remains until the next selection.
Its start is within two CSS pixels of the card right-center and its end is within two
pixels of the target-pin boundary. All nine sheets and 44 operations must satisfy this
in Chromium and Firefox.

At Full HD, the selected sheet fills the iframe and the contained screen uses at least
90 percent of the stage in each constrained dimension. No sheet may introduce viewport
overflow, crop the production screen, or offset a pin into letterbox space. Escape,
focus restoration, offline rendering, sandboxing, and zero iframe network requests
must remain unchanged.

The Docker regeneration must be byte-identical. The Web production image must open the
manual from its Caddy-served bundle. Disposable PostgreSQL validation must report all
migrations applied, no unfinished or rolled-back rows, passing related API tests, and
successful SQL/EXPLAIN output, followed by zero run-specific Docker resources.

## Idempotence and Recovery

Generation and checks are repeatable. Generated files are replaced only by the
repository generator. Docker cleanup traps target exact run IDs on success, failure,
and interruption. There is no schema migration and no production deployment. Before
any later publication, inspect the complete diff and confirm no unrelated user work is
present.

## Artifacts and Notes

The generated HTML, two screen captures, nine sheet PNGs, and manifest remain under
`apps/web/src/generated/kiosk-sop/inspection-drawing/`. The documentation preview is
generated from the same HTML. Test screenshots and Docker logs are diagnostics and are
not committed.

## Interfaces and Dependencies

The public `KioskSopDefinition`, schema version 1, `renderKioskSopHtml()` signature,
`KioskSopManual`, and registry IDs remain unchanged. Geometry helpers and the runtime
coordinator are internal to `@raspi-system/kiosk-sop-core`. No runtime package, API,
database table, migration, or feature flag is added.
