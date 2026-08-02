---
id: plan-kiosk-sop-semantic-target-correction
title: Correct kiosk SOP semantic target capture
status: in_progress
date: 2026-08-02
source_of_truth: true
scope: Inspection-drawing SOP target capture, generated sheets, and popup validation
related_docs:
  - ../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md
  - ../decisions/ADR-20260801-kiosk-sop-generated-from-production-ui.md
  - ./kiosk-sop-visual-layout-correction-execplan.md
related_code:
  - packages/kiosk-sop-core/src/
  - scripts/kiosk-sop/
  - apps/web/src/features/part-measurement/inspection-drawing/
  - apps/web/src/features/kiosk-sop/
validation:
  - Core unit, lint, and build
  - Deterministic Docker regeneration
  - Chromium and Firefox popup geometry
  - Web unit, lint, build, and production image smoke
  - Disposable PostgreSQL migration, SQL, EXPLAIN, and related API tests
---

# Correct kiosk SOP semantic target capture

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain
this file in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this correction, every numbered badge in the inspection-drawing manual points to
the bottom-right corner of the actual control described by its instruction card. The
manual captures the UI state needed by each sheet instead of reusing one image for
unrelated operations. A missing, hidden, or duplicated target stops generation, so a
stale hand-authored coordinate can no longer reach production. Operators can verify the
result by opening `取説`, moving through ten sheets and selecting any of the forty-five
cards at Mac and Full HD kiosk sizes.

## Progress

- [x] (2026-08-02) Read the current ADRs, completed plans, generator, core renderer,
  popup viewer, source definition, target annotations, production React components,
  E2E coverage, Docker generator, CI job, and disposable database validator.
- [x] (2026-08-02) Confirmed 35 of 44 committed targets use manual fallback
  coordinates, all 30 edit targets are fallbacks, measured targets use element centers,
  and `register-visual` is attached to the reload button.
- [x] (2026-08-02) Confirmed clean, current `main` and created
  `fix/kiosk-sop-semantic-target-anchors`.
- [x] (2026-08-02) Split generic capture orchestration from the
  inspection-drawing fixture/state adapter and made target resolution fail closed.
- [x] (2026-08-02) Added all semantic target annotations and the ten-sheet,
  forty-five-step coordinate-free source.
- [x] (2026-08-02) Regenerated ten background PNGs, ten review PNGs, HTML,
  manifest, and documentation preview; updated decisions, registry, tests, and docs.
- [x] (2026-08-02) Completed Core, Web, Docker, browser, production-bundle, and
  disposable-PostgreSQL validation. Documentation audit remains part of the final
  scope audit below.
- [x] (2026-08-02) Audited the final generated counts, documentation inventory,
  whitespace, staged scope, Docker resources, and locally committed only the intended
  changes with `fix: make kiosk SOP targets fail closed`.
- [x] (2026-08-02) Resolved the cross-architecture freshness failure by fixing the
  generator to `linux/amd64`, regenerated the canonical artifacts, passed PR and main
  CI, and squash-merged PR 1155 as `a82f0b20091c26c9f58ed011ea28987800f9c4c0`.
- [ ] Complete the production rollout. Aggregate preflight passed migration, Pi5,
  external dependencies, and five Kiosks, but stopped before release submission
  because StoneBase01's intentional barcode-reader maintenance lease expired and the
  first Pi3 sample was below its read-only memory threshold. Pi3 subsequently reported
  131 MB available with healthy display services; renew the short StoneBase01 lease,
  merge it, rerun standard preflight, and finish the rollout.

## Surprises & Discoveries

- Observation: The accepted step-rail ADR requires target badges at control
  bottom-right corners, but the generator records control centers.
  Evidence: `ADR-20260728-inspection-drawing-sop-step-rail.md` and
  `captureScreens()` in `scripts/kiosk-sop/generate.mjs`.
- Observation: Only eleven target IDs exist in production components; nine are visible
  in the committed capture. The generator silently substitutes JSON coordinates for
  every other target.
  Evidence: `inspectionDrawingSopAnnotations.ts`, the source definition, and generated
  manifest comparison.
- Observation: One edit screenshot is reused by six sheets even though the source
  picker dialog, depth controls, OCR candidates, and history activation require
  different UI states.
  Evidence: the scenario-level `screen` field and `screenImageDataUrl` hydration.
- Observation: Docker Desktop 29.6.1 is available, no containers are currently
  running, `pgvector/pgvector:pg15` is present, and the pinned Playwright base image is
  not yet cached.
  Evidence: read-only Docker inspection before implementation.
- Observation: The nominal-value input's raw child rectangle extends 20 CSS pixels
  past the viewport because its base `w-full` style wins over the intended narrow
  width. The semantic target therefore belongs on the visible nominal setting row,
  which contains the label and input and remains wholly inside the sidebar.
  Evidence: fail-closed capture reported `right=1556` at a 1536-pixel viewport; the
  parent setting row then generated without clipping or coordinate adjustment.
- Observation: Production builds intentionally omit the `/dev/...` preview routes.
  Production-bundle validation must therefore select the real-library and all-sheet
  geometry cases, while the pinned development-bundle run retains the preview-state
  tests.
  Evidence: all six production Chromium cases passed before the dev-only locator timed
  out; the tagged fixed-image rerun passed all twelve production cases.
- Observation: The visual-source search uses a 400-millisecond debounce whose inline
  callback is recreated by parent renders. During deterministic capture, this can
  briefly replace the fixture row with its loading state after the row was first seen.
  Evidence: back-to-back generation exposed the race; the capture-only browser context
  now tracks and clears that debounce after the dialog fixture settles, and two
  consecutive forty-five-target generations passed before the final Docker check.
- Observation: The pinned Playwright image digest is a multi-architecture manifest.
  Native ARM64 generation on Docker Desktop and AMD64 generation on GitHub Actions
  produce different PNG rasterization for the three stateful edit sheets, even though
  each architecture is internally deterministic and geometry is unchanged.
  Evidence: PR 1155 failed only the freshness comparison; running the same check with
  `linux/amd64` on the Mac reproduced the identical eight-file stale list.
- Observation: Production rollout release candidates `20260802-093200-3d95cb` and
  `20260802-093422-787f0c` were not submitted, so neither changed a host. The latter
  passed migration, Pi5 routing/resources, all nine external dependencies in three
  rounds, and five Kiosks, then stopped on StoneBase01 barcode health and a transient
  Pi3 memory sample. Read-only follow-up showed the StoneBase01 barcode container up
  but `/dev/ttyACM0` intentionally absent, while Pi3 had 131 MB available, active
  signage/lightdm/status/watchdog services, 10.1% `/opt` use, 42.9 C, and no
  throttling.
  Evidence: Standard `update-all-clients.sh` aggregate preflight and sanitized
  read-only host diagnostics on 2026-08-02.

## Decision Log

- Decision: Expand the manual to ten sheets and forty-five operations. Keep the source
  picker entrance on the closed basic sheet and place the two picker choices on a new
  dialog-open sheet.
  Rationale: One screenshot can then represent one real UI state without a composite or
  obscured targets.
  Date/Author: 2026-08-02 / Product owner and Codex.
- Decision: Keep hydrated `KioskSopDefinition` schema version 1 but remove manual
  coordinates from the generator source contract.
  Rationale: Runtime consumers need no migration; generation alone must become
  fail-closed.
  Date/Author: 2026-08-02 / Codex.
- Decision: Capture every sheet in a fresh browser context through a fixture adapter
  selected by `fixtureId`.
  Rationale: This isolates conditional state while keeping generic capture logic
  reusable for future manuals.
  Date/Author: 2026-08-02 / Codex.
- Decision: Annotate the visible nominal setting row instead of normalizing or
  clamping the overflowing child input rectangle.
  Rationale: This preserves the existing business UI while keeping the badge attached
  to a real, fully visible semantic control group.
  Date/Author: 2026-08-02 / Codex.
- Decision: Make `linux/amd64` part of the fixed generator contract for both Docker
  build and run.
  Rationale: Image digest alone does not select one member of a multi-architecture
  manifest. Matching the GitHub runner architecture makes committed pixel artifacts
  reproducible from ARM development hosts as well as CI.
  Date/Author: 2026-08-02 / Codex.
- Decision: Preserve StoneBase01's enabled barcode-agent and represent the intentional
  physical disconnect with a short, expiring maintenance lease through
  2026-08-03 18:45 JST. Keep Pi3's existing `stop_lightdm: true` release behavior and
  100 MB read-only admission threshold unchanged.
  Rationale: This records the operator-confirmed temporary condition without disabling
  safety checks, bypassing the standard planner, or weakening Pi3 resource handling.
  Date/Author: 2026-08-02 / Product owner and Codex.

## Outcomes & Retrospective

The implementation now generates ten independent background captures, ten review
PNGs, one self-contained HTML manual, and a manifest containing forty-five unique
DOM-derived anchors and zero fallback coordinates. Core passed 11 tests; generator
contract tests passed 4 tests; Web passed 331 files / 1666 tests plus lint and build.
The pinned Playwright development run passed 18 Chromium/Firefox cases, and the
production Caddy bundle passed 12 tagged Chromium/Firefox cases at 1280x800,
1536x864, and 1920x1080. Disposable PostgreSQL applied all 157 migrations, reported
an up-to-date schema, passed all three isolated API tests, ran the search SQL and both
normal and forced-index EXPLAIN plans, and removed its container, volume, network, and
storage directory. Production validation likewise removed its task-specific Caddy
container, network, and Web image. PR 1155 and exact-main CI completed successfully;
production rollout is still pending because the fail-closed preflight stopped before
release submission on the operator-confirmed temporary StoneBase01 disconnect.

## Context and Orientation

`packages/kiosk-sop-core` validates hydrated definitions and renders self-contained
manual HTML. `scripts/kiosk-sop/generate.mjs` opens production React routes with fixed
API fixtures, records target coordinates, embeds screenshots, and emits the HTML,
review PNGs, and manifest. The current script combines generic orchestration with
inspection-drawing fixtures and permits `step.target` fallback. The production UI uses
`inspectionDrawingSopTargetProps()` to expose stable `data-kiosk-sop-target` values.
The popup registry under `apps/web/src/features/kiosk-sop/` embeds the generated HTML
without network access and scales badges against the contained screenshot rectangle.

The source definition is generator input rather than a hydrated core definition. It
currently includes manual `target` coordinates and scenario-level `screen` names. The
new source will contain only semantic target IDs. A capture adapter will make the
correct state visible for each sheet; the generic orchestrator will require exactly
one visible, non-empty element for every declared target.

## Plan of Work

First add pure bottom-right normalization geometry to the core and unit-test its valid
and invalid boundaries. Extract the inspection-drawing API fixtures and per-sheet UI
preparation into a dedicated adapter. Refactor the generator to create a fresh context
per sheet, reject manual coordinates, reject missing/hidden/duplicate targets, and
write `screens/<sheet-id>.png`.

Then extend the inspection-drawing annotation ID union and attach each ID to the
smallest real control or control group matching the instruction. Keep generic
image-canvas components domain-neutral by passing optional HTML props through
inspection-specific wrappers. Update the structured definition and popup registry to
ten sheets and forty-five steps, including the new source-picker entrance and dialog
sheet.

Finally regenerate all committed artifacts, update the accepted ADRs and documentation
entry point, and add fail-closed generator and cross-browser semantic geometry
coverage. Validate the exact result with the pinned Docker generator, a temporary
production Web container, and the existing isolated PostgreSQL validator. Remove every
task-specific temporary resource before locally committing.

## Concrete Steps

Run from `/Users/tsudatakashi/RaspberryPiSystem_002` on
`fix/kiosk-sop-semantic-target-anchors`.

    pnpm --filter @raspi-system/kiosk-sop-core test
    pnpm --filter @raspi-system/kiosk-sop-core lint
    pnpm --filter @raspi-system/kiosk-sop-core build
    bash scripts/kiosk-sop/run-in-docker.sh generate
    bash scripts/kiosk-sop/run-in-docker.sh check
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build
    node scripts/docs/audit-docs.mjs --write
    node scripts/docs/audit-docs.mjs --check
    bash scripts/kiosk-sop/validate-db-contract.sh
    git diff --check

Build `infrastructure/docker/Dockerfile.web` with the SOP flag enabled using a unique
image tag. Run one exact temporary Caddy container on a loopback random port, point the
dedicated Playwright configuration at it, and remove the container and task-specific
image through a pre-registered trap. Do not connect to an existing container or DB.

## Validation and Acceptance

Generation must report ten sheet screenshots and forty-five DOM-derived targets. Any
missing, duplicate, hidden, zero-sized, or hand-authored target must fail with its
scenario, sheet, and target ID. Every rendered badge center must follow the recorded
bottom-right anchor within two CSS pixels at 1280x800, 1536x864, and 1920x1080 in both
Chromium and Firefox. Leaders must remain hidden initially and join the selected card
right-center to the badge boundary. There must be no crop, overflow, or letterbox
offset.

The source-picker sheet must show the real open dialog and target its existing-image
choice and file input. The production bundle must retain offline srcDoc behavior,
sandboxing, Escape close, and focus restoration. Database validation must apply every
migration to only the disposable DB, report no unfinished or rolled-back migration,
pass all three related API tests, execute the inspection-drawing SQL and EXPLAIN, and
leave no named validation resource.

## Idempotence and Recovery

Generation and checks are deterministic and repeatable. Each capture uses a new browser
context. Docker names include a task or validation ID, and cleanup targets only those
exact names. Do not remove or modify an existing container, volume, network, or DB. If
generation fails, fix the missing semantic annotation or adapter state; never restore a
manual coordinate. If the worktree becomes mixed with unrelated changes, stop before
staging or committing.

## Artifacts and Notes

Generated screenshots, review sheets, `manual.html`, and `manifest.json` remain under
`apps/web/src/generated/kiosk-sop/inspection-drawing/`. The documentation preview is
regenerated from the same HTML. Test traces, temporary screenshots, containers, and
task-specific images are diagnostics and must not be committed.

## Interfaces and Dependencies

The hydrated schema version, renderer, iframe contract, HTTP API, and database remain
unchanged. The generator gains an internal adapter resolved by `fixtureId` with two
operations:

    installApiFixtures(page, sheetId, unexpectedRequests)
    prepareSheet(page, sheetId)

The core gains one pure rectangle-to-normalized-bottom-right helper. No runtime package
or external service is added. Playwright, the existing production components, fixed
fixtures, and current Dockerfiles supply all dependencies.
