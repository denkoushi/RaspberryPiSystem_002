---
id: self-inspection-autosave-callout-template-lock
title: Self-inspection autosave, inspection-drawing callout, template create lock
status: deployed_pending_ui_validation
date: 2026-07-10
source_of_truth: true
related_docs:
  - ../design-previews/kiosk-inspection-drawing-callout-pointer-preview.html
  - ../design-previews/kiosk-self-inspection-autosave-callout-preview.html
  - ../knowledge-base/KB-320-kiosk-part-measurement.md
  - ../guides/deployment.md#self-inspection-autosave-callout-template-lock-2026-07-10
related_code:
  - apps/web/src/features/part-measurement/inspection-drawing/
  - apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx
  - apps/api/src/services/part-measurement/
open_items:
  - Physical kiosk UI validation (NFC gate, draft reload, confirm, callout tips, create lock)
  - Merge PR #968 to main after UI OK
---

# Self-inspection autosave / callout / template create lock

## Decisions (confirmed)

- Phased implementation with one branch per phase
- Autosave: `SelfInspectionLotEntry` `DRAFT` | `CONFIRMED`; partial draft API; confirm uses full validation
- NFC gate: session-start employee NFC before measurement; confirm keeps per-entry registration (copy first employee to later entries)
- Callout: optional tip ratios on template items; canvas-led; right pane one status row; half-height nudge; name label+select inline
- Template create: API already 409; strengthen UI to disable create when active THREE_KEY exists

## Branches

1. `feat/inspection-drawing-callout-density` — Phase 1
2. `feat/self-inspection-nfc-autosave-confirm` — Phase 2 (from main after Phase 1)
3. `feat/inspection-template-create-lock-ui` — Phase 3

## Phase 1 — Callout + density

- Add nullable `calloutTipXRatio` / `calloutTipYRatio` on `PartMeasurementTemplateItem`
- Canvas SVG callout layer; toolbar「指差し」mode
- Settings: callout status row; name inline; nudge half height
- Print layout shares tip drawing
- Docker temp Postgres: migrate, EXPLAIN, integration; cleanup

## Phase 2 — NFC + autosave + confirm

- Entry `persistenceStatus` DRAFT/CONFIRMED; backfill CONFIRMED
- Separate draft upsert API; confirm = existing full validation path
- Complete / WIP / record-approval count CONFIRMED only
- Session NFC overlay; debounce autosave;「入力を保存」= confirm
- Docker temp Postgres validation + cleanup

## Phase 3 — Create lock UI

- Disable「新規」when active THREE_KEY exists; steer to revise
- Keep「雛形として新規」for different keys
- No destructive API change

## Previews

- [Callout (1280×17rem)](../design-previews/kiosk-inspection-drawing-callout-pointer-preview.html)
- [Overview autosave/NFC](../design-previews/kiosk-self-inspection-autosave-callout-preview.html)

## Out of scope

- Production deploy / Pi ops without explicit request
- Mandatory callouts on every marker
- Blocking visual-template-only create
