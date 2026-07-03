---
title: Kiosk Assembly Torque Management MVP
id: plan-kiosk-assembly-torque-management-mvp
status: active
scope: kiosk assembly torque management, procedure library, assembly template editor, work session
date: 2026-07-03
source_of_truth: this file
related_code: apps/api/src/routes/assembly/index.ts, apps/api/src/services/assembly, apps/web/src/features/assembly, apps/web/src/pages/kiosk/KioskAssemblyPage.tsx
related_docs: ../INDEX.md
validation: local Docker Postgres, GitHub Actions CI 28642360918, raspberrypi5 and raspi4-sessaku-01 deployment
open_items: Bluetooth torque-agent, multi-page procedure documents, production workflow acceptance with real products
---

# Kiosk Assembly Torque Management MVP

This Plan is the current source of truth for the assembly torque management MVP and the library/template UI improvement. It is intentionally compact so the next AI can resume without reading the whole conversation.

## Purpose

Add a kiosk workflow for assembly work:

1. Select a product model code.
2. Show an assembly procedure document.
3. Place numbered tightening points on the procedure image.
4. Record torque values in order.
5. Move to the next numbered point after OK, stop on NG, and keep an auditable record.

This is separate from part measurement and self-inspection. The implementation reuses only safe ideas and generic helpers, while keeping the assembly DB/API/UI in an `assembly` domain.

## Current State

- Branch: `feature/assembly-library-template-ui`.
- Implemented commits on top of `main`:
  - `7570531f` - assembly torque management MVP.
  - `ad9e0412` - kiosk tab order expectation update.
  - `4dd8a07e` - API Docker build heap limit.
  - `d8917680` - assembly library/template UI improvement.
- Pushed remote branch: `origin/feature/assembly-library-template-ui`.
- CI: GitHub Actions run `28642360918` succeeded.
- Limited deployment completed on 2026-07-03:
  - `raspberrypi5`: deployed at `d8917680`.
  - `raspi4-sessaku-01`: deployed at `d8917680`.
  - Other clients and Pi3 were not deployed.

## Delivered Scope

### Data Model

Assembly data is stored in dedicated Prisma models:

- `AssemblyProcedureDocument`: one-page procedure image metadata.
- `AssemblyTemplate`: active/versioned template keyed by `modelCode + procedurePattern + version`.
- `AssemblyTemplateArea`: process/area/unit grouping with manual area advancement.
- `AssemblyTemplateBolt`: numbered tightening point with coordinate and torque limits.
- `AssemblyWorkSession`: product/session identity and current position.
- `AssemblyTorqueRecord`: accepted OK, recorded NG, and ignored duplicate inputs.
- `AssemblyAreaRestartLog`: area restart history.

Summary-list indexes were added in migration `20260703150000_assembly_summary_indexes`.

### API

Assembly routes live under `/api/assembly/*`:

- Procedure documents: preview, upload, list, summary, rename, retire.
- Templates: list, summary, detail, create, revise, retire.
- Work sessions: start, detail, record torque, advance area, restart area, complete, cancel, Excel export.

The summary endpoints added for scalable management UI are:

- `GET /api/assembly/procedure-documents/summary`
- `GET /api/assembly/templates/summary`

Procedure document images are served through the assembly storage path, separate from part-measurement drawing storage.

### Web UI

Routes:

- `/kiosk/assembly`: assembly top page with procedure library and template table.
- `/kiosk/assembly/templates/new`: template creation.
- `/kiosk/assembly/templates/:templateId/edit`: template revision editor.
- `/kiosk/assembly/work/start?templateId=...`: work start form.
- `/kiosk/assembly/work-sessions/:sessionId`: torque work session.

The top page now follows the inspection drawing management pattern: table-based procedure library, table-based template list, separate template editor, and separate work screen. The old all-in-one page structure was removed.

DEV preview routes:

- `/dev/kiosk-assembly-library`
- `/dev/kiosk-assembly-template-editor`

## Business Rules Implemented

- Tightening order is the template order.
- OK input moves to the next bolt.
- NG input records the attempt and stays on the same bolt.
- A value arriving within 1 second after an accepted OK is recorded as ignored duplicate, not accepted as a normal value.
- Area completion waits for a manual next-area action.
- Initial torque input sources are `manual`, `mock`, and `agent`.
- Real Bluetooth communication is not implemented in this branch.
- Units are not converted in v1; the entered value must match the template unit.
- Excel export is a readable quality record, not a full legacy form reproduction.

## Validation Results

Local validation before push:

- `pnpm --filter @raspi-system/api build`: passed.
- Temporary Docker Postgres on port `55433`:
  - `prisma migrate deploy`: passed.
  - `prisma generate`: passed.
  - assembly integration test: passed.
  - `EXPLAIN` with `enable_seqscan=off` confirmed the new summary indexes.
  - temporary container removed after verification.
- `pnpm --filter @raspi-system/web test`: passed.
- `pnpm --filter @raspi-system/web build`: passed.
- Playwright visual checks for the DEV preview pages at 1280px and 2048px: passed.

CI:

- GitHub Actions run `28642360918`: success.
- Jobs passed: lint/build/unit, API DB and infra, Docker security, e2e smoke, full e2e.

Real-device deployment and smoke:

- `raspberrypi5`:
  - Branch `feature/assembly-library-template-ui`, HEAD `d8917680`.
  - API, web, and DB containers running.
  - API health returned `status: ok`.
  - Prisma migrate status: database schema up to date.
  - Assembly summary APIs returned expected JSON.
- `raspi4-sessaku-01`:
  - Branch `feature/assembly-library-template-ui`, HEAD `d8917680`.
  - `kiosk-browser.service`, `status-agent.timer`, and `pcscd` active.
  - `nfc-agent` container running.
  - Kiosk UI reachability check passed.
- Browser smoke against `https://<pi5>/kiosk/assembly` with the configured client key showed `組立`, `手順書`, and `テンプレート` with no console errors.

## Operational Notes

- Do not use broad deploy helpers when the requested rollout is limited to two devices. In this rollout, the safe path was host-limited Ansible.
- Mac to `raspi4-sessaku-01` SSH timed out during deployment. The Pi4 was alive and posting status, and `raspberrypi5` could reach its SSH port.
- The successful workaround was to run the Pi4-limited Ansible deployment from `raspberrypi5`, with only `--limit raspi4-sessaku-01` and a host override to the Pi4 LAN address observed in `ClientStatus`.
- The client key should be taken from inventory or runtime configuration; do not paste it into docs or shell history unnecessarily.

## Key Files

- [Prisma schema](../../apps/api/prisma/schema.prisma)
- [Assembly route registration](../../apps/api/src/routes/assembly/index.ts)
- [Assembly services](../../apps/api/src/services/assembly)
- [Assembly web feature module](../../apps/web/src/features/assembly)
- [Assembly top page](../../apps/web/src/pages/kiosk/KioskAssemblyPage.tsx)
- [Template editor page](../../apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx)
- [Work start page](../../apps/web/src/pages/kiosk/KioskAssemblyWorkStartPage.tsx)
- [Work session page](../../apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx)

## Open Items

- Verify the end-to-end operator flow with real production procedure documents and explicit permission to create production templates.
- Add real Bluetooth integration after confirming the exact Tohnichi output mode and pairing/security behavior for the planned tools.
- Build or deploy the Raspberry Pi side `torque-agent` only after the real device protocol is confirmed.
- Add multi-page procedure document support.
- Decide whether Excel output needs full legacy form reproduction or whether the current quality-record workbook is enough.
- Add richer work-session search/history screens if operators need to find past assembly records from the kiosk.
- Confirm the assembly tab order and visibility with the operator after more templates are present.

## Resume Checklist For Next AI

1. Read this file, `AGENTS.md`, `docs/AI_START_HERE.md`, and the relevant `.cursor/rules`.
2. Confirm the active branch and worktree state with `git status --short --branch`.
3. If changing code, keep assembly independent from part measurement; do not add assembly state to existing part-measurement models.
4. If deploying, explicitly name target hosts and avoid broad rollout commands unless the user asks for all devices.
5. If touching DB logic, use a temporary Postgres container only; do not modify existing production or local persistent DB data for tests.
6. If testing real torque input, treat Bluetooth as a new phase and capture protocol findings before implementation.
