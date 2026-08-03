# Decompose KioskAssemblyTemplateEditorPage into enforced feature boundaries

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: kiosk-assembly-template-editor-boundaries-execplan
- status: completed
- scope: the kiosk assembly template editor page, focused feature modules, tests, and Web ESLint enforcement
- started: 2026-08-03
- branch: `refactor/kiosk-assembly-template-editor-boundaries`
- baseline_sha: `4f2f8f85430e58cd59cdbe002d3fc1c709390ac6`

## Purpose / Big Picture

The assembly template editor works and is well tested, but its route page owns data loading, 27 state values, editing commands, save validation, and the entire view in 1,840 lines. This change keeps every user-visible and persisted behavior stable while giving data loading, procedure editing, marker editing, save construction, controller composition, and rendering explicit feature boundaries. The route page becomes a thin adapter. Target-specific ESLint rules prevent those responsibilities from accumulating there again.

## Progress

- [x] (2026-08-03 11:06+09:00) Confirmed clean synchronized `main` at `4f2f8f85430e58cd59cdbe002d3fc1c709390ac6` and created the local feature branch.
- [x] (2026-08-03 11:06+09:00) Established the Node 20 baseline: focused page test 1 file/9 tests and full Web suite 331 files/1,666 tests passed.
- [x] (2026-08-03 11:32+09:00) Added two page characterizations and three pure save-contract tests without removing or skipping an existing test.
- [x] (2026-08-03 11:34+09:00) Extracted save construction, cancellation-safe data loading, procedure draft ownership, and marker draft ownership.
- [x] (2026-08-03 11:34+09:00) Split auth, header, left pane, canvas toolbar/body, inspector, dialogs, and screen composition; reduced the public route page to one line and its feature route adapter to 39 lines.
- [x] (2026-08-03 11:35+09:00) Added target-specific ESLint line and dependency boundaries. Full repository lint passed with zero warnings.
- [x] (2026-08-03 11:43+09:00) Completed the guided-create validator: 157 migrations, API and Web full suites, persistence/index checks, lint, build, and all 16 Chromium E2E scenarios passed.
- [x] (2026-08-03 11:43+09:00) Verified Docker cleanup. Counts returned exactly to 0 containers, 17 volumes, and 3 networks; task-label residue was zero.
- [x] (2026-08-03 11:51+09:00) Pushed the approved feature branch and opened draft PR #1160 against `main`; no merge or deployment was performed.

## Surprises & Discoveries

- Observation: The full Web baseline emits a known jsdom CORS preflight 405 diagnostic but completes successfully with all 1,666 tests passing.
  Evidence: The baseline process exited 0 after 331 files passed.

- Observation: Existing assembly feature modules already own draft serialization, readiness evaluation, projection, and initial data loading.
  Evidence: `assemblyTemplateDraft.ts`, `assemblyTemplateReadiness.ts`, `assemblyProcedureStepDraft.ts`, and `loadAssemblyTemplateEditorData.ts` are imported by the page.

- Observation: The current browser contract suite contains 16 scenarios rather than the 15 estimated during planning.
  Evidence: `assembly-library-editor-ui.spec.ts` passed 16/16 scenarios across 1366x768, 1920x1080, and 900x900 coverage.

## Decision Log

- Decision: Move existing state transitions mechanically instead of introducing a new global store or state-machine library.
  Rationale: This keeps the refactor behavior-preserving and avoids combining architecture work with a state-model redesign.
  Date/Author: 2026-08-03 / Codex

- Decision: Preserve current DOM hierarchy, labels, test ids, focus behavior, query parsing, payloads, and navigation.
  Rationale: Existing kiosk E2E tests depend on both workflow behavior and constrained viewport geometry.
  Date/Author: 2026-08-03 / Codex

## Outcomes & Retrospective

The behavior-preserving decomposition is complete. The former 1,840-line page is now a one-line compatibility export over a 39-line router adapter. State and commands are split between a 461-line controller, a 484-line marker hook, a 343-line procedure hook, and a 141-line data hook. All view files are below 220 function lines and 400 physical lines. The router is confined to the route adapter; views have no router, API-client, or pages dependency.

The final Web suite increased from 331 files/1,666 tests to 332 files/1,671 tests. The exact delta is the one new save-contract file with three tests and two new page characterizations. No existing test was removed or skipped. The isolated validator passed 479 API files/2,515 tests with the existing two files and seven tests skipped, 332 Web files/1,671 tests, all builds and lint, persistence/index checks with 20,100 fixtures, and 16 Chromium E2E scenarios. Docker resources returned to the exact starting counts with zero labelled residue.

Local implementation commits are `aa36e68a` (`test(web): lock assembly editor behavior`) and `c19c5a85` (`refactor(web): split assembly template editor`). The architecture guard and completion record are held in the final local implementation commit. Draft PR #1160 contains the approved branch. Merge and deployment remain out of scope and require separate approval.

## Context and Orientation

The route page is `apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx`. Its public compatibility boundary is the named `KioskAssemblyTemplateEditorPage` export used by the two lazy kiosk routes. Feature code belongs below `apps/web/src/features/assembly/template-editor/`. Existing assembly serializers, reducers, readiness rules, projections, and UI components remain the source of truth and must be reused rather than copied.

## Plan of Work

First add characterization around save payloads, failure ordering, authentication, navigation, dirty guarding, and stale async results. Extract a pure save-command builder and a cancellation-safe data hook. Move procedure and marker state transitions into focused hooks without redesign. Move rendering into auth, header, workspace, inspector, and dialog views that receive named state and commands, not raw setters. Compose the feature in a controller and leave the page responsible only for router inputs and success navigation. Finally add narrowly scoped size and import restrictions.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002` with `PATH=/opt/homebrew/opt/node@20/bin:$PATH`. After each cohesive extraction run the focused page and new module tests. At milestones run Web lint and build. The final command is `scripts/test/validate-assembly-template-guided-create.sh`, followed by docs audit and `git diff --check`. Inspect Docker resources before and after the validator and remove only uniquely labelled disposable resources owned by it.

## Validation and Acceptance

The route export and URLs, API calls and payloads, error strings, local storage and query behavior, inactive-template read-only behavior, clone/revision distinction, focus movements, and DOM geometry remain unchanged. The route page is at most 180 lines and does not import the API client. New controller/hooks are at most 500 lines and new views at most 400 lines. No new cycle or dependency from feature code to pages is introduced. No existing test is removed or skipped.

## Idempotence and Recovery

Each extraction is committed only after its focused tests pass, so a faulty boundary can be reverted independently. No schema, migration, API, production data, or deployment resource is touched. The final validator owns uniquely named local Docker resources and its cleanup must return the resource delta to zero.

## Artifacts and Notes

Baseline at `4f2f8f85430e58cd59cdbe002d3fc1c709390ac6`:

    Node.js: v20.20.2
    Editor page: 1,840 physical lines
    Focused page test: 1 file, 9 tests passed
    Full Web suite: 331 files, 1,666 tests passed

Final local verification:

    Public route page: 1 physical line
    Feature route adapter: 39 physical lines
    Largest controller/hook: 484 physical lines
    Largest view: 176 physical lines
    Focused editor/save tests: 2 files, 14 tests passed
    Full Web suite: 332 files, 1,671 tests passed
    Full API suite: 479 files, 2,515 tests passed; 2 files/7 tests skipped
    Chromium E2E: 16 passed
    PostgreSQL migrations: 157
    Capability fixtures: 20,100; expected index selected
    Web/API lint and build: passed
    Docker before/after: 0 containers, 17 volumes, 3 networks
    Task-labelled Docker residue: 0
