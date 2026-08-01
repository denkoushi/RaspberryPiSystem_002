---
id: kiosk-assembly-template-editor-density
status: in-progress
scope: kiosk assembly template editor density and input workflow
date: 2026-08-01
source_of_truth: docs/plans/kiosk-assembly-template-editor-density-execplan.md
related_code:
  - apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx
  - apps/web/src/components/kiosk/AssemblyTemplateCreationGuide.tsx
related_docs:
  - docs/decisions/ADR-20260727-assembly-template-guided-creation.md
  - docs/plans/assembly-template-guided-create-execplan.md
validation:
  - scripts/test/validate-assembly-template-guided-create.sh
open_items:
  - Implement and validate the density redesign on the feature branch.
---

# Reclaim the assembly template document workspace

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The kiosk assembly template editor has a useful four-stage creation guide, but its expanded full-width block consumes about 216 pixels of vertical space and substantially reduces the document image used for authoring. After this change, an operator can see the same stage status and incomplete-item count in the local editor header, open the details as an overlay that does not resize the document, and begin a new template with the left workflow pane open and the optional right inspector closed. Repeated data entry is reduced by suggesting the template name and deriving the four fastener condition fields from a selected torque-wrench capability group.

The observable result is on the kiosk assembly template create route. At 1366 by 768 pixels the header remains one row no taller than 56 pixels, the initial canvas occupies at least 75 percent of the workspace after the required left pane, and opening the incomplete-item overlay does not change the workspace, canvas, or image rectangle.

## Progress

- [x] (2026-08-01 01:39Z) Confirmed a clean `main`, fast-forwarded from `origin/main`, and created `feat/assembly-template-editor-density`.
- [x] (2026-08-01 01:39Z) Re-read the governing repository, documentation, architecture, UI-quality, Git, and test rules and inspected the current editor, readiness, API, persistence, and automated tests.
- [x] (2026-08-01 01:42Z) Committed this ExecPlan and its short discovery link as `75432528` before feature code.
- [x] (2026-08-01 01:57Z) Integrated the four-stage guide into the editor header and moved issue details into a viewport-clamped popover.
- [x] (2026-08-01 01:57Z) Decoupled right-inspector visibility from the selected procedure step with explicit `closed`, `step`, and `markers` modes.
- [x] (2026-08-01 01:57Z) Added safe input assistance for the template name, document display label, capability group, range application, and area layout.
- [x] (2026-08-01 01:57Z) Added and updated focused unit, component, page, and Playwright tests; 331 Web test files with 1,665 tests passed, and the target Playwright file passed 15 of 16 scenarios before its one stale-geometry scenario was corrected and rerun successfully.
- [ ] Run migration, isolated PostgreSQL, SQL, EXPLAIN, full test, build, and documentation validation and record evidence.

## Surprises & Discoveries

- Observation: `guideExpanded` defaults to true and the guide is a `shrink-0` sibling above the workspace, so expanding it necessarily shrinks the document area.
  Evidence: A 16:9 browser measurement showed a 277-pixel expanded guide versus 61 pixels collapsed; the rendered document changed from 1357 by 905 to 1033 by 689 pixels.
- Observation: The right inspector opens initially even without an explicit operator request.
  Evidence: the page derives `settingsPaneOpen` from `Boolean(selectedStep || markerSettingsOpen)`, while document initialization selects the first generated procedure step.
- Observation: the apparently repetitive area fields cannot safely be removed as a UI-only change.
  Evidence: process number, area code, unit code, and area name remain required by the API and are consumed by summaries or Excel output.
- Observation: the repository already has an isolated end-to-end validation script that provisions labeled disposable PostgreSQL resources, checks SQL persistence, and requires the fastener index in EXPLAIN output.
  Evidence: `scripts/test/validate-assembly-template-guided-create.sh` owns a container, volume, network, dynamic port, and cleanup trap.
- Observation: one storyboard E2E scenario cached the document image rectangle before the first marker selection; the new initial closed inspector intentionally changes that rectangle when marker settings open.
  Evidence: the first target Playwright run passed 15 of 16 tests. Re-measuring the image after inspector opening made the crop scenario pass and better models the responsive UI.

## Decision Log

- Decision: Keep all API, Prisma, database, shared DTO, and Excel contracts unchanged.
  Rationale: the problem is presentation density and repeated entry; changing persisted contracts would add migration and compatibility risk without improving the requested experience.
  Date/Author: 2026-08-01 / Codex
- Decision: Keep four stages and issue navigation, but render the stage summary in the local header and details through `AnchoredDropdownPortal`.
  Rationale: operators retain the successful guidance while the overlay avoids document layout shifts and reuses the repository's viewport-clamped primitive.
  Date/Author: 2026-08-01 / Codex
- Decision: Represent the right inspector as `closed`, `step`, or `markers` independently of step selection.
  Rationale: a selected step is required by the canvas model but should not force an optional 20-rem inspector to consume space.
  Date/Author: 2026-08-01 / Codex
- Decision: Select a capability group before showing its four fastener conditions as a read-only summary.
  Rationale: the group already owns those exact compatibility fields, so one valid selection removes duplicate input while existing readiness and server validation remain defense layers.
  Date/Author: 2026-08-01 / Codex
- Decision: Do not add an ADR unless implementation discovers a need to change a public or persisted contract.
  Rationale: this plan changes an existing presentation and interaction without a new architectural boundary.
  Date/Author: 2026-08-01 / Codex

## Outcomes & Retrospective

The UI implementation and focused automated validation are complete. Isolated PostgreSQL, migration, SQL, EXPLAIN, full build, and final documentation validation remain. No public contract, existing database, deployment, or remote branch has been changed.

## Context and Orientation

`apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx` owns loading, editor state, readiness evaluation, focus navigation, and save serialization. `apps/web/src/components/kiosk/AssemblyTemplateCreationGuide.tsx` renders the current four-stage full-width guide. `apps/web/src/pages/kiosk/assemblyTemplateReadiness.ts` is the pure source of truth for whether the draft may be saved. The procedure pane edits documents, required template basics, and areas; the bolt inspector edits marker and torque-wrench traceability fields; the step inspector edits optional instructions.

A capability group is a server-provided record containing a group identifier and a compatible nominal diameter, bolt length, material, and strength class. A REQUIRED template bolt stores both the chosen group and a snapshot of those four fields. The server rejects a mismatch. The redesigned selector must therefore commit a known group and all four snapshot fields in one state update, while the existing readiness and server checks remain unchanged.

The editor's local header is distinct from the immersive kiosk navigation header. This plan uses the local header's currently unused horizontal area. The global kiosk layout and its reveal behavior remain out of scope.

## Plan of Work

First, extract a pure presentation model that maps readiness stage results to compact header stages and issue summary text. Replace the standalone expanded guide with a header component containing content-width stage chips, an incomplete-count trigger, and a viewport-clamped issue popover. The popover must close on outside pointer input and Escape, restore focus on Escape, and invoke the existing issue-focus callback after closing.

Next, replace the derived right-pane boolean with an explicit inspector mode. New and loaded editors keep their selected procedure step for canvas behavior but start with the inspector closed. Explicit step settings open `step`; bolt or check selection opens `markers`; issue navigation opens the appropriate mode. A close control returns to `closed` without clearing the selected step.

Then add pure helpers for the suggested name and capability-group snapshot. A direct new template starts in automatic-name mode and proposes `<model code> <procedure pattern> 組立` when both inputs exist. Manual edits disable following until the operator selects the restore action. Clone, revision, and existing edit retain their loaded name in manual mode. Make document display label editing and range application opt-in disclosures. Keep the four required area fields in a compact two-column grid.

Build a dedicated searchable capability-group choice control that cannot commit arbitrary text. Show group name and its four condition values in each result. Selecting a group atomically replaces group ID and all four fastener fields and refreshes only an automatically managed bolt display specification. Preserve custom display specifications. Existing invalid or inactive selections show their stored snapshot and require a valid reselection; catalog failures preserve the retry path.

Finally, update tests to exercise the new interaction rather than bypassing it. Keep payload assertions exact so any public-contract drift fails loudly. Record all commands and evidence below, then update this document's status and outcome without claiming repository completion: this branch is not authorized for push, PR, merge, or deployment.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on `feat/assembly-template-editor-density`. Use the repository's bundled Node 24 environment for Node commands.

Implement focused changes, running the relevant Vitest files after each milestone. Before final validation run:

    scripts/deploy/validate-candidate-migrations.sh origin/main HEAD
    scripts/test/validate-assembly-template-guided-create.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check
    git status --short --branch

The guided-create validation script may pull `pgvector/pgvector:pg15`. It must use only its uniquely labeled temporary container, volume, and network. Never point it or a manual SQL command at an existing database. Its exit trap and final residue check must report no remaining labeled resources.

## Validation and Acceptance

Pure tests must cover guide presentation, automatic naming, and capability-group snapshot mapping. Component and page tests must cover overlay keyboard/pointer dismissal, focus restoration, issue navigation, initial left-open/right-closed layout, explicit inspector opening, manual name override, clone and revision preservation, atomic group selection, catalog failure, invalid legacy group display, and unchanged save payloads.

Playwright must cover 1366 by 768, 1920 by 1080, and 900 by 900. At desktop sizes the local header is one row and no taller than 56 pixels. Opening the issue popover leaves workspace, canvas, and image bounding rectangles unchanged. The initial canvas pane is at least 75 percent of the available workspace; opening both panes preserves the existing 55 percent floor; closing the inspector restores the prior width. At 900 pixels the header may use two rows, all primary touch targets remain at least 40 pixels, the popover remains inside the viewport, and there is no horizontal overflow.

Database validation must deploy every migration to a new empty PostgreSQL database, verify migration status and applied counts with SQL, run REQUIRED traceability integration tests, prove failed drafts left no persisted records, seed and analyze 20,100 disposable capability groups, and show the fastener-active index in `EXPLAIN (ANALYZE, BUFFERS)`. The validation ends only after temporary container, volume, and network counts return to zero.

## Idempotence and Recovery

All UI and test edits are additive or locally reversible. Focused tests can be rerun without state cleanup. The Docker validation uses unique names and a trap for EXIT, INT, and TERM; if interrupted, rerun its label-based residue check and remove only resources bearing that run's unique label. Do not remove, restart, or mutate any pre-existing container, database, volume, or network. If API or persistence changes become necessary, stop this plan and create the required decision record before editing those contracts.

## Artifacts and Notes

Baseline evidence before implementation:

    branch: main at 2d65227fd53f5f37da254f196afb8b5af033843b
    expanded guide height: 277 px
    collapsed guide height: 61 px
    expanded document image: 1033 x 689 px
    collapsed document image: 1357 x 905 px

Validation evidence will be appended here as implementation progresses.

## Interfaces and Dependencies

Add only Web-internal interfaces: a guide presentation model derived from readiness, an inspector mode union equivalent to `'closed' | 'step' | 'markers'`, a pure template-name suggestion function, and a pure capability-group-to-bolt snapshot function. Continue to use `AnchoredDropdownPortal` for viewport placement and existing button/input primitives for kiosk touch sizing. Do not introduce a new dependency.

Revision note (2026-08-01): Created the implementation-ready plan after repository, contract, UI, test, and Docker validation analysis so work can be resumed safely from this file alone. Updated at 01:57Z with implemented milestones, focused test evidence, and the responsive-geometry E2E discovery.
