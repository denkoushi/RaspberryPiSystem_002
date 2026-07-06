---
title: Kiosk Assembly Torque Management MVP
id: plan-kiosk-assembly-torque-management-mvp
status: active
scope: kiosk assembly torque management, seiban start flow, work-in-progress visibility, procedure library, procedure order settings, PDF procedure viewer, assembly template editor, work session
date: 2026-07-06
source_of_truth: this file
related_code: apps/api/src/routes/assembly/index.ts, apps/api/src/routes/kiosk-documents.ts, apps/api/src/routes/kiosk/assembly-procedure-order-auth.ts, apps/api/src/routes/storage/assembly-procedure-images.ts, apps/api/src/services/assembly, apps/web/src/features/assembly, apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx, apps/web/src/pages/kiosk/KioskAssemblyProcedureOrderSettingsPage.tsx, infrastructure/docker/docker-compose.server.yml, infrastructure/ansible/roles/server/tasks/main.yml
related_docs: ../INDEX.md, ../guides/deployment.md
validation: local Docker Postgres, GitHub Actions CI 28642360918 and 28650944516/28650941078, limited deployment run 20260703-183241-22704, user real-device acceptance 2026-07-03, local Docker Postgres 55434 for seiban start flow, focused API/web tests and web full test/build 2026-07-06, PR 956 CI 28782487173, full deployment 20260706-185942-11851, Phase12 45/0/0, procedure order viewer local Docker Postgres 55435, focused API/web tests and web full test/build 2026-07-06, PR 957 CI 28789861728, full deployment 20260706-212700-28308, Phase12 45/0/0, assembly procedure-order smoke
open_items: Bluetooth torque-agent, PDF viewing completion tracking, NFC serial scan, completed work-session history/search enhancements
---

# Kiosk Assembly Torque Management MVP

This Plan is the current source of truth for the assembly torque management MVP, the library/template UI, and the seiban-based kiosk start flow. It is intentionally compact so the next AI can resume without reading the whole conversation.

## Purpose

Add a kiosk workflow for assembly work:

1. Select a production seiban.
2. Show an assembly procedure document.
3. Place numbered tightening points on the procedure image.
4. Record torque values in order.
5. Move to the next numbered point after OK, stop on NG, and keep an auditable record.

This is separate from part measurement and self-inspection. The implementation reuses only safe ideas and generic helpers, while keeping the assembly DB/API/UI in an `assembly` domain.

## Current State

- Latest working branch: `feature/assembly-procedure-order-viewer`.
- Latest deployed implementation branch: `feature/assembly-procedure-order-viewer`.
- Latest deployed runtime commit: `ad6eaa00` (`feat(assembly): add procedure order viewer`).
- Latest deployed PR: `#957`.
- Latest deployed scope on 2026-07-06:
  - Adds machine-name-based PDF procedure viewing-order settings.
  - Adds `/kiosk/assembly/procedure-order-settings` with 2520 shared password verification.
  - Uses existing `KioskDocument` PDF records as the source of truth and stores only assembly viewing order.
  - Adds a configured PDF page-forward viewer to `/kiosk/assembly/work-sessions/:sessionId`.
  - Falls back to the existing single procedure image when no order is configured, no enabled PDF remains, or no page images can be rendered.
- WIP-first UI refinement on 2026-07-07:
  - `/kiosk/assembly` keeps the API, DB, DTO, and start/resume contracts unchanged while making `仕掛中` the primary left pane.
  - New starts move into a fixed-width right pane that preserves seiban candidate search, seiban direct keypad, serial keypad, operator, torque wrench, template registration, and start controls.
  - FHD shows both input keypads and the start action at once. At 1366x768, only the right input area scrolls internally while the start action remains fixed.
  - Static reference preview: `design-previews/kiosk-assembly-home-wip-first-preview.html`.
- Previous deployed scope on 2026-07-06:
  - `/kiosk/assembly` is now the operator start page.
  - Operators search by `FSEIBAN`, choose a candidate, see the resolved machine name, enter serial number with a software keypad, and start or resume work.
  - The same `FSEIBAN + serialNo` with `IN_PROGRESS` resumes the existing session instead of creating a duplicate.
  - The lower section shows in-progress assembly sessions and links directly back to `/kiosk/assembly/work-sessions/:sessionId`.
  - The former library/template management page moved to `/kiosk/assembly/library`.
- Latest CI/deployment:
  - Procedure order viewer PR CI `28789861728`, push CI `28789859917`, CodeQL `28789861725`, and Secret scan `28789861781` succeeded. The initial `security-docker` failure was a runner disk-space failure during Trivy scan; rerun succeeded.
  - Procedure order viewer full deployment run `20260706-212700-28308` completed on all 7 hosts with `failed=0 / unreachable=0`.
  - Phase12 real-device verification passed: `PASS 45 / WARN 0 / FAIL 0`.
  - Assembly smoke after deployment: `/kiosk/assembly`, `/kiosk/assembly/library`, `/kiosk/assembly/procedure-order-settings`, seiban candidates API, WIP summary API, procedure-order get API, and 2520 password verify API passed.
  - Previous seiban start flow PR CI `28782487173`, push CI `28782461329`, CodeQL `28782487159`, Secret scan `28782487220`, full deployment `20260706-185942-11851`, and Phase12 `45/0/0` also succeeded.

Earlier delivered branch: `feature/assembly-library-template-ui`.

- Earlier implemented commits on top of `main`:
  - `7570531f` - assembly torque management MVP.
  - `ad9e0412` - kiosk tab order expectation update.
  - `4dd8a07e` - API Docker build heap limit.
  - `d8917680` - assembly library/template UI improvement.
  - `25fa7362` - compact handoff source-of-truth update.
  - `ce4df543` - persistent assembly procedure image storage and unused-document delete.
  - `3e8e3129` - rate limit the assembly procedure image storage route.
- Earlier pushed remote branch: `origin/feature/assembly-library-template-ui`.
- Earlier PR: `#951`.
- Earlier CI: GitHub Actions runs `28642360918`, `28650944516`, and `28650941078` succeeded.
- Earlier limited deployment completed on 2026-07-03 with run `20260703-183241-22704`:
  - `raspberrypi5`: deployed at `3e8e3129`.
  - `raspi4-sessaku-01`: deployed at `3e8e3129`.
  - Other clients and Pi3 were not deployed.
- User real-device verification was reported OK after the deployment.

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
- `AssemblyProcedureOrderSet`: one normalized machine-name key per viewing-order setting.
- `AssemblyProcedureOrderItem`: ordered references to existing `KioskDocument` PDF documents, with optional display labels such as `X軸` or `X軸-1`.

Summary-list indexes were added in migration `20260703150000_assembly_summary_indexes`.
The seiban start flow adds migration `20260706170000_assembly_seiban_start_flow` with a normal lookup index on `AssemblyWorkSession(productNo, serialNo, status, updatedAt)`. It intentionally does not add a partial unique constraint because existing data can contain duplicates and the first phase only needs deterministic resume behavior.

The procedure order viewer adds migration `20260706193000_assembly_procedure_order_viewer` with `AssemblyProcedureOrderSet(machineNameKey)` unique lookup and `AssemblyProcedureOrderItem(setId, sortOrder)` ordering indexes. `AssemblyProcedureOrderItem.kioskDocumentId` references `KioskDocument(id)` with `ON DELETE RESTRICT`; the document delete route also returns HTTP 409 before deleting PDF/page files when a document is used by assembly viewing order.

### API

Assembly routes live under `/api/assembly/*`:

- Procedure documents: preview, upload, list, summary, rename, delete-if-unused.
- Templates: list, summary, detail, create, revise, retire.
- Work sessions: start, detail, record torque, advance area, restart area, complete, cancel, Excel export.

The summary endpoints added for scalable management UI are:

- `GET /api/assembly/procedure-documents/summary`
- `GET /api/assembly/templates/summary`

The seiban start flow adds:

- `GET /api/assembly/seiban-candidates?prefix=...`
  - Normalizes input to half-width uppercase.
  - Searches by `CsvDashboardRow.rowData.FSEIBAN` prefix, using production-schedule winner filtering.
  - Resolves machine name from rows whose `FHINCD` starts with `MH` or `SH`, falling back to the existing supplement table, then `機種名未登録`.
  - Returns the matching active assembly template when `AssemblyTemplate.modelCode` matches the normalized machine name.
- `GET /api/assembly/work-sessions/summary?status=in_progress&limit=...`
  - Returns product seiban, serial number, machine name, template name, current area/bolt, start/update timestamps, and progress for the kiosk WIP list.
- `POST /api/kiosk/assembly/procedure-order-settings/verify-access-password`
  - Reuses the existing shared 2520 due-management password verification.
- `GET /api/assembly/procedure-orders?machineName=...`
  - Returns the configured viewing order for the normalized machine name.
- `PUT /api/assembly/procedure-orders`
  - Requires `accessPassword`, validates active `KioskDocument` IDs, saves up to 50 ordered items, and normalizes the machine name to half-width uppercase.
- `GET /api/assembly/work-sessions/:id/procedure-sequence`
  - Resolves the work session `targetUnit` to a configured PDF viewing sequence, renders/uses page image URLs, or returns fallback metadata for the existing single-image procedure document.

Procedure document images are served through the assembly storage path, separate from part-measurement drawing storage.
The API image route has request rate limiting. In server Docker, the path is backed by persistent storage at `/opt/RaspberryPiSystem_002/storage/assembly-procedure-images`.

### Web UI

Routes:

- `/kiosk/assembly`: operator start page with seiban search, machine-name display, serial software keypad, start/resume action, management links, and in-progress sessions.
- `/kiosk/assembly/library`: management page with procedure library and template table.
- `/kiosk/assembly/procedure-order-settings`: 2520-authenticated PDF viewing-order settings page for each machine name.
- `/kiosk/assembly/templates/new`: template creation.
- `/kiosk/assembly/templates/:templateId/edit`: template revision editor.
- `/kiosk/assembly/work/start?templateId=...`: work start form.
- `/kiosk/assembly/work-sessions/:sessionId`: torque work session.

The management page follows the inspection drawing management pattern: table-based procedure library, table-based template list, separate template editor, and separate work screen. The operator top page keeps the work-start path short and leaves the vertical screen space for search, serial entry, and WIP visibility.

Procedure documents use a `削除` action instead of a `無効化` action. The delete action is disabled when any template references the document. If unused, the API deletes both the DB row and the stored image file.

The procedure order settings page does not upload PDFs. Operators/admins search existing enabled `KioskDocument` records, add them to a machine-name order, move them up/down, edit labels, remove items, and save. The work-session screen uses the configured sequence when available, with separate previous/next page and previous/next document controls. Tightening input, area advancement, restart, completion, history, and Excel export remain unchanged.

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
- Kiosk start uses `AssemblyWorkSession.productNo` as the production seiban.
- Kiosk start sends `targetUnit` as the resolved machine name. The UI wording prefers `機種名`.
- `serialNo` is operator-entered with a software keypad. The first phase allows digits and uppercase alphabet, with no business length limit beyond the DB field maximum.
- If `nameplateNo` is not sent, the API stores `serialNo` in `nameplateNo` to satisfy the existing non-null column while hiding nameplate number from the new operator flow.
- If an in-progress session already exists for the same seiban and serial number, start returns that existing session.
- If the machine name is `機種名未登録` or no active template matches the machine name, the kiosk shows the unregistered/template-missing state and links to the management page instead of forcing a start.
- Procedure viewing order is keyed only by normalized machine name, not by seiban, serial number, or procedure pattern.
- Viewing order changes require the shared 2520 password both at the kiosk settings entry point and at the save API.
- Existing `KioskDocument` PDF records are the source of truth. Assembly stores ordering and labels only.
- Referenced `KioskDocument` rows cannot be deleted; the API returns HTTP 409 while the document is used by an assembly procedure order.
- Viewing order does not gate torque progress. If no valid configured PDF sequence is available, the work screen keeps showing the existing single procedure image and torque work continues.

## Validation Results

Local validation before push:

- WIP-first UI refinement on 2026-07-07:
  - `pnpm --filter @raspi-system/web test -- KioskAssemblyHomePage.test.tsx assemblyRoutes.test.ts`: passed, 2 files / 9 tests.
  - `pnpm --filter @raspi-system/web test`: passed, 258 files / 1287 tests.
  - `pnpm --filter @raspi-system/web lint`: passed.
  - `pnpm --filter @raspi-system/web build`: passed.
  - `git diff --check`: passed.
  - Playwright visual check with mocked assembly API: passed at 1920x1080 and 1366x768. The 1920 viewport shows both keypads, torque wrench, and start action; the 1366 viewport keeps the WIP pane wider than the start pane and keeps the start action visible while the right input pane scrolls internally.
  - Docker/Postgres validation was not run because this change only touches Web layout and tests, with no API, DB, Prisma, DTO, or migration changes.
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

Local validation for seiban start flow before push:

- Temporary Docker Postgres on port `55434`:
  - `prisma migrate deploy`: passed.
  - `prisma generate`: passed.
  - assembly integration tests for seiban candidates, session resume, and WIP summary: passed.
  - `EXPLAIN` confirmed the production-schedule winner lookup index for seiban candidates and `AssemblyWorkSession_idx_product_serial_status` for the WIP summary query.
  - temporary container removed after verification.
- `pnpm --filter @raspi-system/api build`: passed.
- Focused web tests for `KioskAssemblyHomePage` and assembly routes: passed.
- `pnpm --filter @raspi-system/web build`: passed.
- Full web test suite: passed.
- `git diff --check`: passed.

Local validation for procedure order viewer before PR:

- Temporary Docker Postgres `pgvector/pgvector:pg15` on port `55435`:
  - `prisma migrate deploy`: passed, including `20260706193000_assembly_procedure_order_viewer`.
  - `prisma generate`: passed.
  - `pnpm --filter @raspi-system/api test -- assembly.integration.test.ts`: passed, 7 tests.
  - `EXPLAIN` confirmed `AssemblyProcedureOrderSet_machineNameKey_key` for machine-name lookup.
  - `EXPLAIN` confirmed `AssemblyProcedureOrderItem_idx_set_sort` for ordered item lookup.
  - temporary container `raspi-assembly-procedure-order-pg` removed after verification.
- `pnpm --filter @raspi-system/api exec prisma generate`: passed.
- `pnpm --filter @raspi-system/api build`: passed.
- Focused web tests for `KioskAssemblyProcedureOrderSettingsPage`, `KioskAssemblyWorkSessionPage`, `KioskAssemblyHomePage`, and assembly routes: passed.
- `pnpm --filter @raspi-system/web test`: passed, 258 files / 1283 tests.
- `pnpm --filter @raspi-system/web build`: passed.
- `git diff --check`: passed.
- API integration tests were added for password verification, procedure order save/get, work-session sequence fallback/configured resolution, and `KioskDocument` delete 409 protection.

CI:

- GitHub Actions run `28642360918`: success.
- Jobs passed: lint/build/unit, API DB and infra, Docker security, e2e smoke, full e2e.
- Follow-up CI after persistent storage/delete and CodeQL rate-limit fix:
  - Secret scan run `28650944481`: success.
  - CodeQL run `28650944450`: success.
  - CI runs `28650944516` and `28650941078`: success.
  - PR checks passed: lint/build/unit, API DB and infra, Docker security, e2e smoke, full e2e, CodeQL, gitleaks.
- Seiban start flow CI:
  - PR CI run `28782487173`: success.
  - Push CI run `28782461329`: success.
  - CodeQL run `28782487159`: success.
  - Secret scan run `28782487220`: success.
- Procedure order viewer CI:
  - PR CI run `28789861728`: success.
  - Push CI run `28789859917`: success.
  - CodeQL run `28789861725`: success.
  - Secret scan run `28789861781`: success.
  - `security-docker` initially failed on runner disk space during Trivy DB extraction; failed jobs were rerun and the final PR check set passed.

Real-device deployment and smoke:

- Procedure order viewer full deployment on 2026-07-06:
  - Branch `feature/assembly-procedure-order-viewer`, runtime HEAD `ad6eaa00`.
  - Run `20260706-212700-28308`; remote log `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-20260706-212700-28308.log`.
  - All 7 hosts completed with `failed=0 / unreachable=0`; summary success check was true.
  - `raspberrypi5`: Docker compose restart, Prisma migrate/status, and API health recovery passed.
  - Pi4 kiosks: repo sync, `kiosk-browser.service`, `status-agent.service`, `status-agent.timer`, and kiosk UI reachability passed on all five Pi4 hosts.
  - `raspberrypi3`: lightdm restored and `signage-lite.service is active`.
  - `./scripts/deploy/verify-phase12-real.sh`: `PASS 45 / WARN 0 / FAIL 0`.
  - Assembly smoke: `/kiosk/assembly`, `/kiosk/assembly/library`, `/kiosk/assembly/procedure-order-settings`, `GET /api/assembly/seiban-candidates`, `GET /api/assembly/work-sessions/summary`, `GET /api/assembly/procedure-orders`, and `POST /api/kiosk/assembly/procedure-order-settings/verify-access-password` returned expected success responses with client-key authentication.

- Seiban start flow full deployment on 2026-07-06:
  - Branch `feature/assembly-seiban-start-flow`, HEAD `b2ddbbd9`.
  - Run `20260706-185942-11851`; remote log `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-20260706-185942-11851.log`.
  - All 7 hosts completed with `failed=0 / unreachable=0`.
  - `raspberrypi5`: Docker compose rebuild/restart, Prisma migrate/status, and API health recovery passed.
  - Pi4 kiosks: repo sync, `kiosk-browser.service`, `status-agent.service`, `status-agent.timer`, and kiosk UI reachability passed on all five Pi4 hosts.
  - `raspberrypi3`: lightdm restored and `signage-lite.service is active`.
  - `./scripts/deploy/verify-phase12-real.sh`: `PASS 45 / WARN 0 / FAIL 0`.
  - Assembly smoke: `/kiosk/assembly`, `/kiosk/assembly/library`, `GET /api/assembly/seiban-candidates`, and `GET /api/assembly/work-sessions/summary` returned HTTP 200 with client-key authentication.

- `raspberrypi5`:
  - Branch `feature/assembly-library-template-ui`, HEAD `3e8e3129`.
  - API, web, and DB containers running.
  - API health returned `status: ok`.
  - Prisma migrate status: database schema up to date.
  - Assembly summary APIs returned expected JSON.
  - Assembly procedure image storage directory exists.
- `raspi4-sessaku-01`:
  - Branch `feature/assembly-library-template-ui`, HEAD `3e8e3129`.
  - `kiosk-browser.service`, `status-agent.timer`, and `pcscd` active.
  - `nfc-agent` container running.
  - Kiosk UI reachability check passed.
- Browser smoke against `https://<pi5>/kiosk/assembly` with the configured client key showed `組立`, `手順書`, and `テンプレート` with no console errors.
- Follow-up UI smoke confirmed the procedure library shows `削除`, does not show `無効含む`, and has no console errors.
- Follow-up API/device check created a temporary procedure image, fetched it with HTTP 200, deleted it with HTTP 204, then confirmed both metadata and image returned HTTP 404 and the host file was gone.

## Operational Notes

- Do not use broad deploy helpers when the requested rollout is limited to two devices. In this rollout, the safe path was host-limited Ansible.
- Mac to `raspi4-sessaku-01` SSH timed out during deployment. The Pi4 was alive and posting status, and `raspberrypi5` could reach its SSH port.
- The successful workaround was to run the Pi4-limited Ansible deployment from `raspberrypi5`, with only `--limit raspi4-sessaku-01` and a host override to the Pi4 LAN address observed in `ClientStatus`.
- The client key should be taken from inventory or runtime configuration; do not paste it into docs or shell history unnecessarily.
- A pre-fix procedure document could show `画像の読み込みに失敗しました` because the assembly procedure image path was not backed by persistent server storage. The prevention is the dedicated Docker volume, host directory, and Ansible directory creation noted above.
- The one pre-existing broken procedure document observed during verification was intentionally not deleted by the agent. It can be removed by the operator from the `削除` button if it is unused.

## Key Files

- [Prisma schema](../../apps/api/prisma/schema.prisma)
- [Assembly route registration](../../apps/api/src/routes/assembly/index.ts)
- [Assembly procedure image route](../../apps/api/src/routes/storage/assembly-procedure-images.ts)
- [Assembly services](../../apps/api/src/services/assembly)
- [Assembly web feature module](../../apps/web/src/features/assembly)
- [Assembly procedure library UI](../../apps/web/src/features/assembly/AssemblyProcedureLibrarySection.tsx)
- [Assembly PDF sequence viewer](../../apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx)
- [Assembly operator top page](../../apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx)
- [Assembly procedure order settings page](../../apps/web/src/pages/kiosk/KioskAssemblyProcedureOrderSettingsPage.tsx)
- [Assembly management page](../../apps/web/src/pages/kiosk/KioskAssemblyPage.tsx)
- [Template editor page](../../apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx)
- [Work start page](../../apps/web/src/pages/kiosk/KioskAssemblyWorkStartPage.tsx)
- [Work session page](../../apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx)

## Open Items

- Add real Bluetooth integration after confirming the exact Tohnichi output mode and pairing/security behavior for the planned tools.
- Build or deploy the Raspberry Pi side `torque-agent` only after the real device protocol is confirmed.
- Add page-viewed/completion audit if procedure viewing itself must become a quality gate.
- Add NFC serial scan if/when serial identification moves from software keypad to tag scanning.
- Decide whether Excel output needs full legacy form reproduction or whether the current quality-record workbook is enough.
- Add richer completed/cancelled work-session search and history screens if operators need to find past assembly records from the kiosk.
- Confirm the assembly tab order and visibility with the operator after more templates are present.
- Continue operator acceptance after more real procedure documents and templates are registered.

## Resume Checklist For Next AI

1. Read this file, `AGENTS.md`, `docs/AI_START_HERE.md`, and the relevant `.cursor/rules`.
2. Confirm the active branch and worktree state with `git status --short --branch`.
3. If changing code, keep assembly independent from part measurement; do not add assembly state to existing part-measurement models.
4. If deploying, explicitly name target hosts and avoid broad rollout commands unless the user asks for all devices.
5. If touching DB logic, use a temporary Postgres container only; do not modify existing production or local persistent DB data for tests.
6. If testing real torque input, treat Bluetooth as a new phase and capture protocol findings before implementation.
