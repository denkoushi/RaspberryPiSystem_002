---
title: Assembly Approved V3 UI/UX Regression Recovery ExecPlan
tags: [assembly, kiosk, uiux, regression, recovery, execplan]
audience: [operator, developer, reviewer]
last-verified: 2026-07-27
related:
  - ../decisions/ADR-20260725-kiosk-assembly-work-uiux-and-machine-name-picker.md
  - ../decisions/ADR-20260726-assembly-template-procedure-steps.md
  - ./kiosk-assembly-work-uiux-improvements.md
  - ./assembly-work-sequence-viewer-only-execplan.md
category: plans
update-frequency: high
---

# Restore the approved Assembly V3 UI/UX on the current step-based workflow

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.
Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Operators must again see the Assembly work screen and machine-name selection experience
that were approved and production-validated on 2026-07-25, without losing the later
crop-step storyboard, shared marker projection, NFC access gate, or sequence-viewer-only
work screen.

The visible result is that the work screen has no empty full-width 56px band, uses the
approved compact right pane and large result history, and shows marker state separately
from the current input target. New and create-from-template flows select a machine name
from production-schedule-backed candidates instead of accepting free text. The final
release must be merged to `main` before deployment and must pass read-only physical
acceptance on `raspi4-assembly-01`.

## Progress

- [x] (2026-07-27) Confirmed the worktree was clean at `8338957e`, verified approved
  branch head `8b4fc78d`, updated local `main`, and created
  `fix/assembly-approved-uiux-regression`.
- [x] (2026-07-27) Created this recovery ExecPlan as the first tracked change.
- [ ] Commit this initial ExecPlan before integrating the approved branch.
- [ ] Merge approved branch head `8b4fc78d` with history and resolve every conflict
  while preserving the current crop/NFC/step-viewer behavior.
- [ ] Restore the approved work-screen layout, marker semantics, shared kiosk themes,
  machine-name picker, candidate API, and catalog repository.
- [ ] Add regression tests for both the recovered V3 behavior and the later step/crop
  behavior.
- [ ] Validate the API against an isolated temporary Postgres, including SQL plans,
  and remove every temporary Docker resource.
- [ ] Run focused and full Web/API tests, lint, builds, Playwright, documentation audit,
  and whitespace checks.
- [ ] Open a PR, wait for required CI, CodeQL, and gitleaks, then merge the approved
  immutable head to `main`.
- [ ] Deploy only merged `main` through the standard rolling updater and verify release
  identity, maintenance clearing, Phase12, and a post-release no-op plan.
- [ ] Complete read-only acceptance on `raspi4-assembly-01`.

## Surprises & Discoveries

- Observation: The approved V3 implementation was deployed from
  `feat/kiosk-assembly-work-uiux` but that branch was never merged to `main`.
  Evidence: `git merge-base --is-ancestor 6d566dc3 main` returns non-zero, while the
  approved plan records production run `20260725-150046-020a76`.
- Observation: The later sequence-viewer rollout deployed `main`, so its release
  identity was correct while still replacing the unmerged V3 UI with the older UI.
  Evidence: current `main` is `8338957e`; `KioskAssemblyWorkSessionPage.tsx` contains
  the fixed `h-14` message row and the pre-V3 right pane.
- Observation: The machine-name regression includes the Web dialog and the read-only
  API/service/repository, not only a label or input component.
  Evidence: all candidate modules exist on `8b4fc78d` and are absent from current
  `main`.
- Observation: The later storyboard refactor moved basic template settings into
  `AssemblyTemplateProcedurePane`, so the old editor-page patch cannot be selected
  wholesale.
  Evidence: current `KioskAssemblyTemplateEditorPage` delegates the model value and
  mutation callback to that pane.

## Decision Log

- Decision: Integrate approved head `8b4fc78d` with a real merge rather than copying
  selected snippets or redeploying the old branch.
  Rationale: This makes the approved release history an ancestor of the repaired
  `main` and prevents the same silent loss in later main-based releases.
  Date/Author: 2026-07-27 / User and Codex.
- Decision: Resolve conflicts in favor of current workflow behavior and approved V3
  presentation simultaneously; never take an entire conflicted file from one side.
  Rationale: Current `main` owns crop steps, shared marker projection, NFC access, and
  sequence loading. The old branch owns the approved visual and machine-name behavior.
  Date/Author: 2026-07-27 / User and Codex.
- Decision: Require candidate selection only when the route has no `templateId`,
  including create-from-template. Existing revisions keep their stored model value and
  edit compatibility, but the user-facing label is `機種名`.
  Rationale: This is the accepted V3 contract and prevents new invalid free-text values
  without changing existing template lineage behavior.
  Date/Author: 2026-07-27 / User and Codex.
- Decision: Do not add a Prisma migration.
  Rationale: Candidate data already exists in production-schedule winner rows and the
  supplement table. The new API is read-only and can use existing indexes and cache
  invalidation.
  Date/Author: 2026-07-27 / User and Codex.
- Decision: Deploy only after the PR is merged to `main`.
  Rationale: Deploying the feature branch before lineage integration caused this
  regression.
  Date/Author: 2026-07-27 / User and Codex.

## Outcomes & Retrospective

Implementation is in progress. At completion this section must state the merged and
release SHA, PR, CI runs, temporary-DB evidence, rolling-release run ID, Phase12 result,
post-release no-op result, and read-only physical acceptance observations.

## Context and Orientation

The repository root is `/Users/tsudatakashi/RaspberryPiSystem_002`.

`apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` owns session loading, NFC
authorization, torque-wrench workflow, completion rules, and the two-pane work layout.
`apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx` owns the flat
full-page/crop step sequence. `AssemblyProcedureMarkerLayer.tsx` is the shared
full-page, crop, and thumbnail marker renderer.

`apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx` owns editor state and
save payloads. Its current left-side basic settings render through
`AssemblyTemplateProcedurePane.tsx`. A route without `templateId` is a new template;
`sourceTemplateId` makes that new route a create-from-template flow.

The approved candidate API reads machine names from winner-selected MH/SH production
schedule rows and `ProductionScheduleSeibanMachineNameSupplement`. A catalog repository
owns these database reads, TTL caching, in-flight request sharing, and invalidation.
The filtering service owns normalization, AND matching, de-duplication, sorting, and
limits. The Fastify route only validates input and applies existing `allowView`
authorization.

The approved branch contains three commits ending at immutable SHA
`8b4fc78dc76808855da9d6682a3c57e444e47e78`. Later current behavior is on `main`.
Both histories must be ancestors of the final merge.

## Plan of Work

First commit this ExecPlan. Fetch and verify the approved remote branch, then merge its
immutable head with `--no-ff --no-commit`. Resolve each conflict by retaining current
step/crop/NFC behavior and applying approved V3 presentation and candidate selection to
the current component boundary. Complete the merge only when no conflict markers or
unmerged paths remain.

Restore the shared digit-tenkey, marker-theme, and flow-button modules. Keep
self-inspection exports as compatibility wrappers. Separate editor selection from work
input target by carrying `inputTargetBoltId` through the current marker layer, image
wrapper, full-page viewer, crop viewer, and compact storyboard. Preserve marker IDs and
crop projection. Stop `latestStatusByBolt` from replacing OK/NG with `current` or
`ignored`.

Move the live status message into the 58px work-session header and remove the standalone
fixed-height row. Apply the pure action-presentation resolver with `sessionActive`
included so NFC and completed-session restrictions remain authoritative. Use the
approved compact right pane, two-column action layout, and large history typography.
Compact the current step viewer's base toolbar without removing the storyboard, step
map, navigation, instructions, minimap, or fallback expansion.

Restore the machine-name catalog repository, candidate service, authorized GET route,
client adapter, picker dialog, common digit tenkey, and library terminology. Adapt the
picker trigger to `AssemblyTemplateProcedurePane`. New and create-from-template save
must be disabled and rejected until a candidate is confirmed. Revision payloads,
database fields, and Excel contracts remain unchanged.

Add `KB-402` for the incident and prevention rule. Bring the accepted ADR, preview, and
prior ExecPlan into `main` via the real merge, add a recovery note rather than rewriting
their history, and add only short index links.

## Concrete Steps

Work from the repository root. After committing this file, integrate the approved head:

    git fetch origin feat/kiosk-assembly-work-uiux
    test "$(git rev-parse origin/feat/kiosk-assembly-work-uiux)" = \
      "8b4fc78dc76808855da9d6682a3c57e444e47e78"
    git merge --no-ff --no-commit 8b4fc78dc76808855da9d6682a3c57e444e47e78
    git status --short

After conflict resolution, prove both lineages:

    git merge-base --is-ancestor 8b4fc78dc76808855da9d6682a3c57e444e47e78 HEAD
    git merge-base --is-ancestor 8338957ed3cee1f40bd123b0b2ea3afd0164acf1 HEAD

Use the Codex bundled Node 24 at the front of `PATH`. Run focused tests while editing,
then the final commands:

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/web test
    pnpm lint
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web build
    pnpm exec playwright test \
      e2e/assembly-library-editor-ui.spec.ts \
      e2e/assembly-operator-nfc-gate.spec.ts
    node scripts/docs/audit-docs.mjs --check
    git diff --check

The isolated database run must create uniquely named Postgres container, volume, and
network resources with an EXIT/INT/TERM cleanup trap. It must use a dynamic localhost
port, run every migration into that fresh database, insert only test fixtures, execute
candidate API integration tests and `EXPLAIN (ANALYZE, BUFFERS)`, and prove no labeled
temporary resources remain. Do not use `scripts/test/start-postgres.sh` or any existing
container/database.

Open a PR only after local validation. Wait for required CI, CodeQL, and gitleaks. Merge
to `main`, verify the approved head is an ancestor of `origin/main`, and deploy only
merged `main`:

    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan
    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
    scripts/update-all-clients.sh --status <RUN_ID>
    scripts/deploy/verify-phase12-real.sh

Repeat `--print-plan` after success and require a no-op or explicitly explained zero
mutation result.

## Validation and Acceptance

Unit and component tests must prove the empty status band is absent, live status is
inside the header, action highlighting never bypasses session/NFC guards, history values
and judgments use approved large styles, and ignored records preserve the last valid
state.

Marker tests must prove pending/OK/NG fill and current-target outline simultaneously in
full-page and crop views, with identical IDs and projected positions. Editor selected
markers must retain the editor selection style.

Machine-name tests must prove ASCII digit validation, normalized text comparison, AND
matching, natural sorting, duplicate and unregistered-label exclusion, limit/hasMore,
TTL, concurrent load sharing, invalidation, debounce, latest-response-wins, error/empty
states, focus handling, candidate confirmation, required new/clone selection, and
revision compatibility.

Playwright must exercise 1366x768, 1920x1080, and 900x900 without horizontal overflow,
with at least 40px controls, the approved right pane, a compact sequence toolbar, and
at least 55 percent central canvas width at wide size. Both document-expansion fallback
and explicit crop steps must remain on the new viewer.

Physical acceptance on `raspi4-assembly-01` is read-only. Open existing completed
fallback and explicit crop sessions to inspect the work UI and markers. Open a new
template, exercise candidate search and selection, then leave without saving. Do not
record torque, toggle checks, move areas, complete work, save templates, or deactivate
data.

## Idempotence and Recovery

The source merge is performed once. If conflicts are resolved incorrectly before the
merge commit, inspect and correct individual files; do not discard the worktree or use
a whole-tree checkout. Tests and builds are repeatable.

Temporary Docker cleanup must run on success, failure, INT, and TERM. Never stop or
modify existing Docker resources.

There is no database migration, so application rollback does not require schema
rollback. Production interruption or failed acceptance must be handled through the
standard rolling-release status/cancel/rollback authority; do not kill processes,
delete locks, manually alter fleet state, or deploy the old feature branch.

## Artifacts and Notes

Record concise evidence here as implementation progresses: source/final ancestry,
focused and full test results, Postgres resource names and cleanup proof, SQL plan
summary, PR and CI URLs, merge/release SHA, rolling run ID, Phase12 result, no-op plan,
and physical screen observations.

## Interfaces and Dependencies

The public additive API is:

    GET /api/assembly/machine-name-candidates
      digitQuery?: ASCII digits, max 120
      q?: string, max 120
      limit?: integer 1..100, default 40

    {
      "candidates": ["L300KP", "L300KP-2"],
      "hasMore": false
    }

Use existing `allowView` authorization. Do not change Prisma schema, stored
`modelCode`, template lineage, work-session state, completion conditions, or Excel
formats.

The Web marker boundary adds `inputTargetBoltId?: string | null` separately from
`selectedBoltId`. The header adds `statusMessage?: string | null`. The template
procedure pane receives whether candidate selection is required and a callback to open
the picker; it must not fetch candidate data itself.
