# Business Hermes signage live data

Status: complete for local validation. Scope: local implementation and validation only, 2026-09-16.

## Purpose / Big Picture

An operator asks business Hermes for a screen, reviews the actual business data in the preview, and approves it. The saved screen must continue showing current data without asking Hermes to write a new screen for each value change. Existing schedule time windows and stop/resume remain authoritative.

## Progress

- [x] Stop the delegated task and preserve inherited work outside the repository.
- [x] Identify the missing persistence, data lookup, and periodic rendering connections.
- [x] Connect source references and one official A2UI renderer to the existing schedule.
- [x] Verify actual data changes, approval, schedule preservation, and browser output locally.

## Surprises & Discoveries

The inherited A2UI implementation registered a static PDF and discarded its definition. The existing 30-second signage scheduler can perform live updates. The measuring-instruments visualization reports equipment usage, not product measurement values; use the existing PartMeasurementSheet service for product measurement sheets and the self-inspection detail reader for self-inspections.

## Decision Log

2026-09-16: Store A2UI messages and bounded source references in the existing FULL layout JSON. Render a JPEG through the existing signage renderer and scheduler. Remove the new static-PDF-only application path: it duplicates storage and cannot update business values. No new database table, monitoring service, or polling framework.

2026-09-16: Reuse saved visualization dashboards, PartMeasurementSheetService, published work-instruction readers, and the existing self-inspection session-detail reader. A binding identifies a source and a JSON field, so layouts do not need domain-specific code. References cannot execute SQL, scripts, or arbitrary network requests. Business and Private infrastructure remain separate.

## Context and Orientation

Work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--business-hermes-signage-authorization`. `apps/api/src/services/assembly/business-hermes-mcp.service.ts` prepares proposals; the consultation service owns authenticated approval. `services/signage/signage-a2ui.ts` validates messages. `signage.renderer.ts` is called by the existing render scheduler and saves the client JPEG. `apps/web/src/components/hermes/HermesA2uiPreview.tsx` renders the same official A2UI messages for preview and the print page. The management editor must preserve this definition when changing schedule fields.

## Plan of Work

First add bounded data bindings and resolve them through existing readers for preview and periodic rendering. Then save the original layout and references on approval, connect FULL layouts with A2UI to the renderer, and use the existing JPEG display path. Update Hermes' business-only prompt contract to discover source IDs and use bindings. Keep inherited canvas functionality intact.

## Concrete Steps

Run focused Vitest files from apps/api and apps/web using `pnpm exec vitest run <file>`. Run API TypeScript build and web TypeScript checking after changes. Use the local business-only setup for one real conversation and browser rendering check. Do not deploy, commit, push, or modify either Pi. Lifecycle audit is read-only; before/after evidence stays in the supervisor workspace.

## Validation and Acceptance

Changing data behind a saved binding must change the next rendered frame without changing the saved layout or invoking Hermes. A failed read/render must retain the previous delivered frame. Approval must save the exact proposed source references, and time/stop changes must preserve them. Inspect a 1920 by 1080 output with actual text, chart and published photo. Report separately any unavailable live environment; mocked tests do not establish real Hermes connectivity.

## Idempotence and Recovery

The worktree contains protected prior changes. The supervisor workspace has `work/conversation-connection-baseline` and `work/takeover-baseline`; compare those when reviewing this continuation. Never reset the whole worktree. Local evidence and temporary processes must not touch production data.

## Artifacts and Notes

Local PostgreSQL evidence is in the supervisor workspace at outputs/takeover-local. Copied product measurement results and a published photo were resolved through the actual readers. The existing SignageRenderer changed the delivered JPEG after a value changed from 1 to 2, retained the previous JPEG when a value became unavailable, and preserved the saved bindings. Stop and 08:00–17:00 changes preserved the display definition. These checks used an isolated local database and its own target client.

Focused checks passed: API signage/consultation/MCP tests (91 tests in the final four affected files), business route authorization tests (6), web preview/editor tests (39), and API TypeScript build. The two inherited Web TypeScript implicit-any errors in AssemblyProcedureLibrarySection.tsx:277 and LoadBalancingOverviewResourceChart.tsx:106 are fixed with explicit callback types. No broad test infrastructure was added.

The real conversation exposed a JWT/client-key precedence defect, an underspecified A2UI tool schema, source lookup errors being reported as MCP transport failures, and a tool budget too short for source discovery. These were corrected at their existing boundaries. The application now reads the successful configuration tool result directly; the model no longer has to duplicate the full proposal JSON in its final answer. Image bytes stay in the application preview/rendering path.

## Interfaces and Dependencies

Use official `@a2ui/react` and `@a2ui/web_core`, existing Playwright, `DataSourceFactory`, `PartMeasurementSheetService`, `WorkInstructionReadService`, and `fetchSelfInspectionSessionDetailsByScheduleRowIds`. The source resolver reads current values; the browser renderer only draws resolved messages. Stored bindings identify a known source and select a bounded field.

## Outcomes & Retrospective

The official Mac Hermes container reached inference through the existing Business Pi5 bridge. Its configuration tool generated a measurement/photo screen, the actual browser displayed the resolved values and published photo, and the local MANAGER approval saved the schedule. The stored bindings matched the preview proposal. The existing SignageRenderer selected that schedule and produced the actual 1920×1080 delivered JPEG; the output was inspected visually. Evidence: outputs/takeover-local/conversation-evidence.json and approved-screen.jpg in the supervisor workspace.

Local acceptance is satisfied. Data updates use the existing periodic rendering cadence, not immediate event push. Per-content reappearance frequency (for example every ten minutes) is not added. Actual Pi3 delivery, Pi5 rendering load, and production Chromium/web-origin settings remain unverified because deployment is outside this authorization. Main integration and deployment have not been performed. Business and Private resources remain separate.

Official component schemas now validate the same properties the browser accepts, replacing reliance on envelope-only validation. The final response consumes the trusted successful configuration tool result directly, avoiding another model-generated copy of the layout. The preview and output contain business information only.

Revision: completed takeover with local live-data, real Hermes conversation, approval and scheduled JPEG evidence; no new monitoring or validation framework.

## Deployment-readiness follow-up (2026-09-18)

The Web type-check blockers inherited by this worktree are fixed with explicit
React and Recharts callback types. The standard Business Pi5 environment now
renders `BUSINESS_HERMES_WEB_BASE_URL=https://gateway` through the existing
Ansible inventory and API/Compose environment templates. The A2UI renderer
accepts the gateway's existing local certificate only for the internal
`gateway` hostname; other configured HTTPS origins retain certificate
validation. Its request route remains origin-allowlisted. The localhost:4173
value remains only as a local-development fallback when the deployment
variable is absent.

### A2UI rollback guard

An A2UI schedule is stored as `layoutConfig.layout=FULL` with an empty
`slots` array and an `a2ui` definition. A release that predates A2UI cannot
interpret that shape. Before activating such an older release, an authorized
ADMIN or MANAGER must use the current release to either stop the affected
schedule or change it back to an existing legacy `FULL`/`SPLIT` slot definition,
then wait for the normal signage render and confirm the legacy JPEG is being
served. Only after every active A2UI schedule in the rollback scope satisfies
that condition may the canonical standard release rollback be started. If no
legacy definition is available or the compatible JPEG cannot be confirmed, do
not activate the old release; keep the current release and treat the rollback
as blocked pending a reviewed data conversion. Do not edit schedule JSON or
the production database manually.

### Current-main overlap review

This worktree remains at `055166d4`, 22 commits behind `origin/main` at
`b8758deb`; no merge or rebase was performed. `origin/main` changed the same
Hermes UI files (`HermesChatPanel.tsx`, `HermesFloatingChat.tsx`,
`hermes-floating-chat.css`, and `HermesChatPanel.test.tsx`) for knowledge-mode
controls, while this WIP changes those files for consultation and A2UI
approval. The current WIP tests and Web build pass, but that does not claim
the knowledge-mode changes from latest main are integrated. A reviewed merge
or rebase is still required before integration, and remains outside this
unapproved task.
