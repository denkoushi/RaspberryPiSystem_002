---
id: plan-kiosk-sop-popup-viewer
title: Embed the inspection-drawing SOP in kiosk screens
status: in_progress
date: 2026-07-28
source_of_truth: true
scope: Web-only kiosk SOP viewer, production enablement, deployment, and validation
related_docs:
  - ../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md
  - ./kiosk-inspection-drawing-edit-existing-sop.md
  - ../design-previews/kiosk-inspection-drawing-edit-existing-sop.html
related_code:
  - apps/web/src/features/kiosk-sop/
  - apps/web/src/pages/kiosk/KioskInspectionDrawingLibraryPage.tsx
  - apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx
  - infrastructure/ansible/inventory.yml
  - infrastructure/ansible/templates/docker.env.j2
  - infrastructure/docker/docker-compose.server.yml
validation:
  - Web unit tests, lint, and build
  - Playwright kiosk layout and SOP interaction tests
  - disposable Web container smoke test
  - disposable PostgreSQL migration and inspection-drawing regression test
  - deployment contract tests and standard fleet deployment evidence
open_items:
  - Shop-floor copy sign-off before production-default enablement
---

# Embed the inspection-drawing SOP in kiosk screens

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept current while the work
proceeds. Maintain this file in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, a kiosk operator can open a small `取説` button without leaving the
inspection-drawing screen or losing unsaved screen state. The library screen shows page
1 of the existing-edit SOP and an existing-template revision screen shows page 2. New
template creation and the older measurement-sheet editor remain unchanged.

The manual remains a single source file at
`docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html`. Vite reads that
file as a string at build time, and a sandboxed `iframe srcDoc` displays it. Production
builds keep the button disabled unless a deployment profile explicitly enables it.
Local development enables it automatically. On 2026-07-28, the product owner explicitly
directed production enablement and real-device deployment; the Docker/build fallback
remains false while the production inventory now opts in.

## Progress

- [x] (2026-07-28 11:38+09:00) Confirmed clean `main` at
  `1f1fa2489a9b0dcbcd8bc3aa8aa1e8ab4f8b8732` and created
  `feat/kiosk-sop-popup-viewer`.
- [x] (2026-07-28 11:40+09:00) Read the accepted step-rail ADR, the draft existing-edit
  SOP Plan, the canonical HTML, target React screens, Dialog primitive, Vite build,
  Caddy headers, Docker context, and existing Web/E2E tests.
- [x] (2026-07-28 11:52+09:00) Added the reusable kiosk SOP viewer, strict source
  adapter, and production-default-off feature gate.
- [x] (2026-07-28 11:57+09:00) Integrated the library and template-revision screens and
  matching DEV previews; new creation remains unchanged.
- [x] (2026-07-28 12:05+09:00) Added focused unit/component coverage and Playwright
  coverage; Web test, lint, typecheck, build, and 12 browser cases passed.
- [x] (2026-07-28 12:38+09:00) Validated the flag-enabled final Web image and its
  production Caddy smoke path, then validated all 156 migrations, the
  inspection-drawing integration path, and EXPLAIN against a disposable PostgreSQL
  instance. All run-specific Docker resources were removed.
- [x] (2026-07-28 12:56+09:00) Updated generated documentation inventory, committed
  and pushed `cb7e01d5`, opened Draft PR #1110, and confirmed the full required CI
  suite passed.
- [x] (2026-07-28 14:20+09:00) Received explicit direction to enable the production
  flag, deploy, and perform real-device validation. Wired the flag through the
  production inventory, rendered Docker environment, Compose Web build arguments,
  and immutable build-argument seal while preserving a false fallback.
- [x] (2026-07-28 14:22+09:00) Passed the complete local deployment-contract suite:
  100 Jinja templates, 864 fleet/orchestrator cases, 24 inventory cases, the isolated
  deploy-status PostgreSQL migration/API run, Pi5 image and Blue/Green lifecycles,
  rollback safety, and Ansible syntax checks.
- [ ] Merge PR #1110 after the updated required CI suite passes.
- [ ] Run the standard fleet deployment from `main`, capture its run ID and terminal
  status, then prove the same-SHA plan is a no-op.
- [ ] Complete real-device and production UI verification and record rollback
  coordinates.

## Surprises & Discoveries

- Observation: Production and local TLS Caddy configurations send
  `X-Frame-Options: DENY`.
  Evidence: `infrastructure/docker/Caddyfile.production`,
  `Caddyfile.local.template`, and `Caddyfile.slot.template`.

- Observation: A normal URL-backed iframe would therefore fail, while an `iframe
  srcDoc` still loads under a DENY parent response.
  Evidence: a local Playwright probe loaded and executed a sandboxed srcDoc beneath a
  parent response carrying `X-Frame-Options: DENY`; a second probe confirmed that
  omitting `allow-same-origin` blocks parent DOM access.

- Observation: `.dockerignore` excludes all of `docs`, and `Dockerfile.web` does not
  currently copy the canonical SOP.
  Evidence: `.dockerignore` contains `docs`; the Web build stage copies only workspace
  metadata, packages, and `apps/web`.

- Observation: Vite can transform the canonical file outside `apps/web` through a
  `?raw` import.
  Evidence: a middleware-mode Vite transform returned a 36,061-byte JavaScript module
  containing the canonical doctype.

- Observation: The first `pgvector/pgvector:pg15` pull was lengthy, and the initial
  validation shell used zsh's read-only `status` variable name.
  Evidence: that attempt stopped before migration; its exact container, volume, and
  network were manually removed and verified at zero. A later bash attempt selected a
  non-interactive pnpm dependency check, so the successful run used `CI=true` and a
  non-reserved `health_state` variable.

- Observation: The host's Node.js 18.20.8 is older than the workspace's requested
  Node.js 20.9 minimum.
  Evidence: local Prisma commands emitted an engine warning but passed; the final Web
  Docker build used the repository's Node 20 build stage and also passed.

## Decision Log

- Decision: Use `iframe srcDoc` with `sandbox="allow-scripts"` and no
  `allow-same-origin`.
  Rationale: This preserves HTML/CSS/JavaScript isolation, works with the current DENY
  frame header, and requires no Caddy security relaxation.
  Date/Author: 2026-07-28 / Codex.

- Decision: Keep screen mapping in an inspection-drawing adapter while the viewer
  components stay domain-neutral.
  Rationale: A future SOP can reuse the viewer without adding pathname logic or
  inspection-drawing types to the shared module.
  Date/Author: 2026-07-28 / Codex.

- Decision: Enable in `import.meta.env.DEV` or when
  `VITE_KIOSK_SOP_POPUP_ENABLED=true`; keep the Docker default false.
  Rationale: The manual Plan is still draft and shop-floor copy sign-off is open.
  Date/Author: 2026-07-28 / Codex.

- Decision: Set `web_kiosk_sop_popup_enabled: "true"` only in the production
  inventory while leaving every template and Compose fallback false.
  Rationale: This implements the product owner's explicit production-ON direction
  through the existing auditable release profile without silently changing other
  environments or the image default.
  Date/Author: 2026-07-28 / Product owner and Codex.

- Decision: Do not add an API, database table, or migration.
  Rationale: The source is immutable release content and needs no runtime persistence.
  Date/Author: 2026-07-28 / Codex.

## Outcomes & Retrospective

The implementation and validation are complete on Draft PR #1110. The library opens
only sheet `library`; revision and fixed-count edit previews open only sheet `edit`;
new creation has no launcher. The shared viewer uses the existing Dialog, keeps page
state mounted, restores launcher focus, refuses backdrop dismissal, and validates both
the iframe window and fixed message before child Escape closes it.

Validation completed as follows:

- Web typecheck, lint, and production build passed. The full Vitest run passed 318
  files and 1,574 tests. A production build with no feature-flag override rendered
  zero SOP launchers on the library route.
- The selected Playwright suite passed 12 of 12 cases across the SOP interaction,
  inspection-drawing header layout, and self-inspection layout specs.
- A flag-enabled `Dockerfile.web` image included the canonical SOP title and launcher
  accessibility label. Its loopback Caddy container passed both 1280×800 and 1536×864
  production-route smoke cases. The temporary container and image were removed, with
  zero matching resources remaining.
- Disposable PostgreSQL run `kiosk-sop-pg-20260728123758-81812` applied all 156
  migrations, reported schema up to date, and found zero unfinished or rolled-back
  migration rows. The selected inspection-drawing integration test passed 1 test with
  71 filtered out.
- The digit-search join EXPLAIN returned 2 rows, used the existing
  `PartMeasurementTemplate_templateScope_fhincd_resourceCd_isActiv` and visual-template
  primary-key indexes, and completed in 0.067 ms on the small test fixture. Cleanup
  counts were container 0, volume 0, and network 0.
- Draft PR #1110 passed change classification, required CI, API, Web, E2E, database
  infrastructure, deploy contract, repository policy, workspace quality, CodeQL,
  gitleaks, and both API/Web Docker security checks.

Formal shop-floor copy sign-off remains open in the source SOP Plan. Production
enablement is nevertheless now in scope because the product owner explicitly directed
it on 2026-07-28. The image-level fallback remains false; only the reviewed production
inventory opts in. Final deployment and real-device evidence will be appended here
before this ExecPlan returns to `completed`.

## Context and Orientation

`KioskInspectionDrawingLibraryPage.tsx` owns the inspection-drawing library. Its first
child is a fixed 60-pixel title band containing the title and digit tenkey.

`KioskInspectionDrawingCreatePage.tsx` serves both
`/kiosk/part-measurement/inspection/create` and
`/kiosk/part-measurement/inspection/templates/:templateId/edit`. It already derives
`isEditing` from the route parameter and composes
`InspectionDrawingCreateCompactHeader` with `InspectionDrawingCreateToolbar`.

`Dialog.tsx` supplies portal rendering, scroll locking, focus trapping, Escape closing,
and focus restoration. The SOP viewer will compose it rather than duplicate those
behaviors.

The canonical HTML contains two `<article class="sheet">` elements with
`data-sheet="library"` and `data-sheet="edit"`. Its inline script places bottom-right
badges and shows only one leader when a step item receives hover or focus. The embed
adapter adds later CSS that hides the print toolbar and non-selected sheet and fits the
selected 1280×720 sheet inside the iframe.

## Plan of Work

Create `apps/web/src/features/kiosk-sop/` with a small view type, a pure srcDoc builder,
button, dialog, launcher, feature gate, and exports. The dialog uses the existing
primitive, starts focus on a visible close button, disables backdrop dismissal, and
renders an iframe filling the remaining viewport height. A fixed child-to-parent
message closes from Escape inside the iframe only when both message data and
`event.source` match.

Create an inspection-drawing SOP adapter next to the inspection-drawing feature. It
imports the canonical HTML through `?raw`, builds `library` and `templateEdit` views,
and exports a frozen `INSPECTION_DRAWING_SOP_BY_SCREEN` map.

Add the launcher to the library title bar. Add an optional `supplementalAction` slot to
the create toolbar and pass the edit view only when `isEditing` is true. Update the DEV
scenario model with an explicit `isEditing`; both `revise` and `fixed_count` are edit
previews, while `create_new` is not.

Expose the feature gate in the Vite environment contract, `.env.example`, and Web
Docker build arguments. Replace the broad Docker docs exclusion with a narrow pattern
that re-includes only the canonical SOP, and copy only that file in `Dockerfile.web`.

Add focused unit tests for source selection, security attributes, close semantics,
focus restoration, mapping, library integration, and the toolbar slot. Add a
Playwright spec that exercises both sheets, offline opening, leader visibility, touch
sizes, and layout regressions.

## Concrete Steps

Run all commands from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Focused Web validation:

    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build
    git diff --check

Start Vite locally and run:

    pnpm exec playwright test \
      e2e/inspection-drawing-sop-popup.spec.ts \
      e2e/inspection-drawing-create-header-layout.spec.ts \
      e2e/self-inspection-table-layout.spec.ts \
      --workers=1

Build the final Web Dockerfile with
`VITE_KIOSK_SOP_POPUP_ENABLED=true`, run a uniquely named temporary container on a
loopback random port, and run the production-library SOP smoke test. Delete that
container and validation image afterward.

For database regression, create a unique `pgvector/pgvector:pg15` container, named
volume, and named network. Bind a random PostgreSQL port to `127.0.0.1`, register an
EXIT/INT/TERM cleanup trap before migration, and point `DATABASE_URL` only at it. Run:

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec prisma migrate deploy
    pnpm --filter @raspi-system/api exec prisma migrate status
    pnpm --filter @raspi-system/api test -- \
      src/routes/__tests__/part-measurement.integration.test.ts \
      -t "creates visual template with PNG"

Use `psql` inside the disposable container to assert that `_prisma_migrations` has no
unfinished or rolled-back rows and run `EXPLAIN (ANALYZE, BUFFERS)` for the
inspection-drawing template/visual digit-search join. Remove the container, volume,
and network and prove no resource matching the run ID remains.

Finally update this document, run the document audit, commit intended files, and push
the existing Draft PR. After required CI passes, mark it ready and merge it to `main`.
From a clean, current `main`, run the standard fleet orchestrator first with
`--print-plan`, execute the approved inventory deployment, follow its run ID to a
terminal state, and verify that the same-SHA plan is a no-op. Do not use direct SSH,
individual playbooks, or internal phase scripts.

## Validation and Acceptance

The feature passes when the library opens only the `library` sheet and a template
revision opens only the `edit` sheet; new creation and the old measurement-sheet route
have no launcher. Opening and closing never navigates or clears current screen state.

The iframe must have only `allow-scripts`, make no external request, prevent parent DOM
access, close through validated Escape messaging, and remain usable after the browser
is set offline. Step leaders are invisible initially and exactly one is visible while
a step has hover or focus.

At 1280×800 and 1536×864, the library title band remains 60 pixels with no horizontal
overflow, the revision header remains within two visual rows, and visible action
targets are at least 44 pixels high.

The Docker validation must prove the canonical title is present in the final
release-bundled assets and that the Caddy-served application can open the srcDoc modal.
Database validation must complete only against the disposable database and leave no
temporary Docker resource behind.

## Idempotence and Recovery

The source adapter is pure and the feature is additive. Re-running builds and tests is
safe. If source validation fails, correct the canonical marker or adapter; do not copy
the HTML into `apps/web`.

Docker resource names include a unique run ID. Cleanup commands must target only exact
validated names. Never run repository helpers that own a shared fixed Postgres
container, and never connect tests to an existing database.

Before commit, inspect `git status -sb` and `git diff`. Stage explicit in-scope paths.
The branch can be deleted without affecting `main`; production remains unchanged
unless a future release explicitly enables the build flag.

## Artifacts and Notes

The only manual content source remains:

    docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html

The implementation source of truth is this ExecPlan. Generated test reports, Docker
images, databases, screenshots, and logs are validation artifacts and must not be
committed.

## Interfaces and Dependencies

The shared module exposes:

    type KioskSopView = Readonly<{
      id: string;
      title: string;
      contextLabel: string;
      sheetId: string;
      srcDoc: string;
    }>;

    function buildKioskSopSrcDoc(sourceHtml: string, sheetId: string): string;

    function KioskSopDialog(props: {
      isOpen: boolean;
      onClose: () => void;
      view: KioskSopView;
    }): JSX.Element | null;

`InspectionDrawingCreateToolbar` gains only:

    supplementalAction?: ReactNode;

There are no new runtime packages. React, the existing Dialog and Button primitives,
Vite raw imports, and the existing canonical HTML supply the complete implementation.

Revision note 2026-07-28: Created the implementation ExecPlan after repository and
delivery-path analysis, then recorded the completed Web, browser, final-image, and
disposable-database evidence. Draft PR #1110 and the full required CI suite completed
successfully. The feature remains production-default disabled because the operator
copy is still draft.
