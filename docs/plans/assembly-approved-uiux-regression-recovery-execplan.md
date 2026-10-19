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
- [x] (2026-07-27) Committed this initial ExecPlan as `97336561` before integration.
- [x] (2026-07-27) Merged approved branch head `8b4fc78d` with history and resolved every conflict
  while preserving the current crop/NFC/step-viewer behavior.
- [x] (2026-07-27) Restored the approved work-screen layout, marker semantics, shared kiosk themes,
  machine-name picker, candidate API, and catalog repository.
- [x] (2026-07-27) Added regression tests for both the recovered V3 behavior and the later step/crop
  behavior.
- [x] (2026-07-27) Validated the API against an isolated temporary Postgres, including SQL plans,
  and remove every temporary Docker resource.
- [x] (2026-07-27) Passed focused and full Web/API tests, lint, shared/API/Web builds,
  target Playwright at all three viewports, and whitespace checks.
- [x] (2026-07-27) Regenerated the document inventory and passed the final documentation
  audit and `git diff --check`.
- [x] (2026-07-27) Opened PR #1100, passed required CI, CodeQL, and gitleaks on the
  immutable repaired head, and merged it to `main` as `9032cfb5`.
- [x] (2026-07-27) Deployed merged `main` with rolling run
  `20260727-061614-3974c2`; verified every release identity, maintenance clearing,
  Phase12 `47/0/0`, no rollback, and a post-release plan with zero work.
- [x] (2026-07-27) Completed read-only acceptance on `raspi4-assembly-01`, restored
  the normal Assembly home screen, and removed all temporary verification files.

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
- Observation: The current work viewer passed page-filtered markers to the central
  full/crop canvas but its virtual storyboard cards were still text-only.
  Evidence: `AssemblyWorkStepStoryboard` rendered no image or marker layer. Recovery
  now renders only virtual visible thumbnails and reprojects the current source page's
  markers into every matching full/crop card.
- Observation: Running `tsc -b` directly against the API's development tsconfig emits
  generated JavaScript and hits existing `rootDir` diagnostics for seed/scripts.
  Evidence: the supported `pnpm --filter @raspi-system/api build` uses
  `tsconfig.build.json` and passes. The accidental generated files were removed or
  restored before continuing.
- Observation: Once the work storyboard correctly rendered crop thumbnails, the crop
  E2E locator matched both the thumbnail and the central viewer.
  Evidence: The test now scopes its assertions to the explicit
  `assembly-work-step-canvas` boundary; this preserves thumbnail coverage instead of
  suppressing the second valid projection.
- Observation: The first production submission was prevented before any mutation by
  the aggregate readiness gate because the external Playwright CDN TLS probe timed
  out. A fresh standard submission passed the same gate without an override.
  Evidence: the stopped attempt allocated run `20260727-061443-2655e2` but was never
  submitted; successful run `20260727-061614-3974c2` completed with exit code zero.
- Observation: A Firefox screen capture through X11 returned a black image because the
  kiosk desktop is composed by `labwc` on Wayland and Firefox runs through rootless
  Xwayland.
  Evidence: `grim` against `wayland-0` produced the actual 1920x1080 device image;
  `xrandr` showed the connected 1920x1080 HDMI display and both kiosk-browser and
  LightDM remained active.
- Observation: The disabled crop acceptance session remains suitable for read-only
  display validation even though normal summaries intentionally exclude invalidated
  work units.
  Evidence: read-only SQL found session `ea4101fc-1e0b-42b1-b4a0-af1f358c4939` with
  one `FULL_PAGE` and one `CROP` step; its procedure-sequence API reported
  `template_steps` without requiring any data restoration.

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
- Decision: Storyboard thumbnails display markers only for rows that share the current
  viewer document and page, then apply each row's own crop projection.
  Rationale: Work-page marker inputs are intentionally filtered to the active source
  page. This renders shared full/crop views correctly without fabricating document
  ownership or loading all markers into the viewer.
  Date/Author: 2026-07-27 / Codex.

## Outcomes & Retrospective

The approved V3 lineage and the later step/crop lineage are now both part of production
`main`. PR #1100 merged the repaired head `0d208bd0` as release SHA `9032cfb5`; approved
head `8b4fc78d` and the repaired merge are both ancestors of `origin/main`.

Local evidence:

- Web: 313 test files and 1,545 tests passed.
- API: 468 test files passed, 2 skipped; 2,467 tests passed, 7 skipped, against a fresh
  isolated database. The focused Assembly route suite also passed 31/31.
- Database: all 156 migrations deployed fresh and reported up to date. A 20,000-row
  production-schedule fixture used `csv_dashboard_row_winner_lookup_global_idx`; a
  21,000-row supplement fixture used `PSSeibanMachNmSup_unique_src_fsb`.
- Isolation: run token `assembly-uiux-1785131567-6829` used localhost port `59488`;
  its container, volume, network, and scratch files were removed with labeled residue
  count zero.
- UI: all 23 target Playwright cases passed across 1366x768, 1920x1080, and 900x900
  after the central-view locator was scoped explicitly. Shared types, lint, API build,
  Web build, and `git diff --check` also passed.

Required CI run `30241450183` passed on its second attempt after the first attempt's
Docker Hub image pull timeout; the rerun used the same source SHA. CodeQL run
`30241450161` and gitleaks run `30241450169` passed.

Standard rolling run `20260727-061614-3974c2` updated the Pi5 server, six kiosks, and
one signage terminal. The canary completed with `failed=0` and `unreachable=0` before
the remaining kiosk rollout was approved. Every host reported release identity
`9032cfb5544b2658a225ab0c8d7969b00ee07d6e` as verified, every maintenance-clear phase
succeeded, the run ended with exit code zero, and no rollback occurred. Phase12 passed
`47 / 0 / 0`. A second `--print-plan` returned empty mutation, activation, verification,
and target-host arrays with no warnings.

Read-only device acceptance used completed fallback session
`ad45bd93-e48d-4cdb-8a75-75340e140ee1` and disabled crop evidence session
`ea4101fc-1e0b-42b1-b4a0-af1f358c4939`. The fallback screen showed the new sequence
viewer, no empty 56px band, the approved compact right pane, two-column actions, and
large monospaced OK history. The crop session showed full and crop steps, shared
circle/check/arrow markers, the sky current-target outline without replacing marker
state, projected storyboard thumbnails, and the crop minimap.

The new-template screen showed `機種名`, `未選択`, and candidate selection rather than
the old `型番/FHINCD` free-text input. The physical digit keypad entered `30`, auxiliary
text `A` applied the AND filter, candidate `A30P4SY` was selected, and the draft field
updated. Save was not invoked. A final production SQL read confirmed that no new
template row was created; the newest template remained the prior crop evidence from
`2026-07-27 02:15:01.97Z`. The kiosk browser was restarted to its normal Assembly home,
and temporary `xdotool` packages were only extracted under a uniquely named `/tmp`
directory, then removed from both Pi4 and Pi5 with absence checks.

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

- Merge conflicts were resolved file-by-file; no unmerged paths or conflict markers
  remain. Focused API catalog tests passed 5/5. Focused Web work/editor/viewer tests
  passed 34/34 before the storyboard-thumbnail follow-up.
- Supported production builds pass for both API and Web with bundled Node 24.
- Isolated database token `assembly-uiux-1785130932-3967` used dynamic localhost port
  `58814`. All 156 migrations deployed and status reported up to date. Assembly API
  integration passed 31/31 tests. With 20,000 schedule rows, the winner subplan used
  `csv_dashboard_row_winner_lookup_global_idx` and completed in about 253ms; the
  supplement lookup used `PSSeibanMachNmSup_unique_src_fsb` and completed in about
  0.16ms. Container, volume, network, and scratch data were removed; label residue was
  zero.
- PR: `https://github.com/denkoushi/RaspberryPiSystem_002/pull/1100`. Repaired merge:
  `0d208bd00ec0d7754bf374d59869c66a811fb0d5`. Production `main`:
  `9032cfb5544b2658a225ab0c8d7969b00ee07d6e`.
- CI: required run `30241450183` attempt 2 succeeded; CodeQL `30241450161` and gitleaks
  `30241450169` succeeded. Approved head `8b4fc78d` is an ancestor of production
  `main`.
- Release: rolling run `20260727-061614-3974c2` completed with exit code zero. Pi5,
  six kiosks, and Pi3 all reported the desired release identity as verified.
  Maintenance clear succeeded for every terminal; rollback is null.
- Production validation: Phase12 `PASS 47 / WARN 0 / FAIL 0`. The post-release plan had
  no mutation, activation, verification, or target hosts and no warnings.
- Physical acceptance: fallback and explicit crop screens passed on
  `raspi4-assembly-01`; the V3 right pane, compact header/viewer, shared marker state,
  current outline, thumbnails, minimap, and machine-name picker were visible. No torque,
  check, area, completion, template-save, or deactivation write was performed.

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
