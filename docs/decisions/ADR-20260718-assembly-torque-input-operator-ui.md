---
id: ADR-20260718-assembly-torque-input-operator-ui
title: Assembly torque-input operator density and marker outcome feedback
status: accepted
date: 2026-07-18
source_of_truth: true
scope: kiosk assembly work-session right pane and tightening-marker presentation
related_code:
  - apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx
  - apps/web/src/features/assembly/AssemblyProcedureCanvas.tsx
  - apps/web/src/features/assembly/assemblyTemplateDraft.ts
related_docs:
  - ../plans/assembly-torque-wrench-traceability-execplan.md
  - ../design-previews/kiosk-assembly-torque-input-operator-preview.html
  - ./ADR-20260709-assembly-work-session-operator-layout.md
validation: approved interactive preview at 1366x768 and 1920x1080; 15 focused presentation/component/canvas/work-session tests, 297-file/1468-test Web suite, zero-warning Web lint, production build, and four mocked LEGACY/REQUIRED work-session E2E cases pass
open_items:
  - None for this Web-only decision; physical torque-agent/parser acceptance remains governed by the traceability ExecPlan.
---

# ADR-20260718: Assembly torque-input operator density and marker outcome feedback

## Context

The work-session page keeps the procedure canvas large, but its tightening pane still uses full-width default buttons, vertically separated condition fields, and a `text-xs` three-column history list. Operators cannot scan recent values easily.

More importantly, a torque record can be NG while the same bolt remains current. The existing presentation map replaces that NG state with a generic current marker, so the drawing has no durable visual distinction between input waiting and NG retry. The data already exists in the work-session DTO; the defect is entirely in Web presentation.

The page has two compatible workflows. LEGACY templates accept a manual value and source. REQUIRED templates require physical-wrench confirmation and a local agent heartbeat, and must not expose ordinary manual input.

## Decision

- Use one pure assembly presentation selector to combine current cursor and latest torque-record outcome without changing API or persistence contracts.
- Keep each bolt's marker number visible. Pair color with accessible text and a short outcome badge where it adds information: input waiting is a strong focus ring without a `待` text badge; complete uses a check badge; NG retry uses a red `×`; unaccepted input uses a distinct amber `×` plus the `未受付` label. A compact legend explains the mapping inside the procedure view.
- Render the right pane as compact condition, mode-specific entry/readiness, workflow action, and recent-history regions. Main entry controls fit one LEGACY row; workflow controls remain visible but use content width and preserve their existing enabled/disabled behavior.
- Show the three latest history entries at readable size, then scroll older entries in the same list. Existing audit meanings `OK`, `NG`, and `IGNORED` are unchanged.
- Obtain approval for a standalone interactive preview before modifying production React components.

## Consequences

- Both LEGACY and REQUIRED pages gain consistent hierarchy while preserving their separate safety rules.
- Presentation tests must cover a current bolt with an NG record, chronological record selection, and unaccepted agent input.
- The selector is independent of rendering and selects the latest event using `recordedAt`, then `createdAt`, then ID. The canvas, configured sequence, and fallback image use its same display state, without altering check-marker or callout behavior.
- `AssemblyTorqueOperatorPanel` keeps informational layout reusable while the work page retains all existing data-fetching and session-transition side effects.
- This supersedes only the "right pane unchanged" clause in ADR-20260709; its compact work-session header and procedure-area decisions remain unchanged.

## Validation

- Interactive preview: all five selected states at 1366x768 and 1920x1080 with no clipped controls or horizontal overflow.
- After approval: pure selector, component, work-session mock, and two-viewport Playwright coverage.
- Result: 15 focused tests, 297 Web test files / 1468 tests, zero-warning Web lint, a production build, and four Chromium cases (LEGACY/REQUIRED at 1366×768 and 1920×1080) passed. The E2E checks verify no horizontal overflow, content-width workflow controls with 44px minimum height, readable history, current NG persistence, and the absence of normal manual input for REQUIRED.

## Supersedes / Superseded By

- Supersedes: ADR-20260709 decision 5 only.
- Superseded by: none.
