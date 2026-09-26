---
id: explicit-site-scope-execplan
status: in_progress
scope: kiosk client device site assignment, Mac proxy capability, site-scoped data consolidation
date: 2026-09-26
source_of_truth: true
related_code:
  - apps/api/src/lib/location-scope-resolver.ts
  - apps/api/src/routes/kiosk/shared.ts
  - apps/api/src/routes/kiosk/production-schedule/resolve-assignment-location-key.ts
  - apps/api/src/lib/manual-order-device-scope.ts
  - apps/api/prisma/schema.prisma
related_docs:
  - docs/decisions/ADR-20260314-location-scope-boundary-phase1.md
  - docs/decisions/ADR-20260315-location-scope-phase4-db-go-no-go.md
  - docs/decisions/ADR-20260319-manual-order-device-scope-v2.md
  - docs/decisions/ADR-20260323-sitekey-canonical-manual-order-and-global-rank.md
---

# Give every kiosk device an explicit site, safely and in small steps

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be updated whenever work stops or a decision changes. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

A "site" is a physical factory, for example 第2工場. Many shared kiosk screens keep one copy of their data per site: the 製番ボード (grinding planning board) registered production numbers, manual order assignments, the global ranking, load-balancing capacity and calendars, and more. Every device at the same site must therefore see the same site, or operators silently work on different copies of what they believe is shared data.

Today the system never stores a site. It guesses one from the free-text `ClientDevice.location` column by taking the text before the separator " - " (for example `第2工場 - Sessaku-01` becomes `第2工場`), falling back to the whole location, then to the device name, then to `default`. On 2026-09-26 this was observed in production: the Mac browser (location empty, name `Mac`) showed 10 registered production numbers on the 製番ボード while the Raspberry Pi 4 kiosks showed 3, because the Mac was treated as its own site called `Mac`. Devices named `raspi5_serber` and the Android phones with location `factory` are affected the same way. More sites (factories) will be added in the future, so the guess must be replaced by an explicit, administrator-controlled site.

After this plan is complete, an administrator can open 管理画面 > クライアント端末, choose the site of each device from a list of registered sites, and see every device of that site share the same 製番ボード and other site-scoped screens. The Mac keeps its ability to act on behalf of other kiosks ("proxy"), but that ability becomes an explicit per-device setting instead of a side effect of its empty location. Data that was split into accidental sites such as `Mac` is merged into 第2工場 by a reviewed, repeatable procedure.

## Progress

- [x] (2026-09-26) Surveyed every consumer of the location-derived scope keys and every persisted column that stores them; findings are summarized in `Context and Orientation`.
- [x] (2026-09-26) User decisions recorded: more sites will be added; data in accidental sites is merged into 第2工場; proceed one safe step at a time.
- [x] (2026-09-26) Milestone 1 implemented locally on `feat/explicit-site-scope`: migration `20260926090000_add_site_and_client_device_site_scope`, resolver explicit-site precedence, proxy capability wiring in 20 assignment callers, the order/order-split/overview/manual-order/global-rank checks, and tests. Evidence: backfill verified on a disposable database (devices whose scope key resolves to `Mac` got the flag, `第2工場 - Mac` did not); related unit and integration tests 25 files / 229 tests passed; no schema drift on the new objects.
- [x] (2026-09-26) Milestone 1 merged as PR #1499 (merge `7d7958eb`, including the Codex-reported fix that makes the proxy backfill strip the same whitespace as JavaScript `trim()`), and deployed to Pi5 only with run `20260926-020619-92ba1b`: `SubState=exited`, `Result=success`, `ExecMainStatus=0`, recap `ok=263 changed=31 unreachable=0 failed=0 skipped=38 rescued=0`.
- [x] (2026-09-26) Milestone 2 implemented locally on `feat/explicit-site-scope-m2`: `apps/api/src/lib/site-directory.ts`, 22 string-based derivations moved to `resolveSiteKeyForScopeKey`, site device listing and the manual-order overview event query honor explicit sites. Evidence: related unit and integration tests on a disposable PostgreSQL 159 files / 810 tests passed plus 6 new site-directory tests.
- [x] (2026-09-26) Milestone 2 merged as PR #1500 (merge `aad0a9a1`, including the Codex-reported fix that returns registered site keys unchanged so resolution is idempotent) and deployed to Pi5 only with run `20260926-031254-96a991`: `SubState=exited`, `Result=success`, `ExecMainStatus=0`, recap `ok=263 changed=31 unreachable=0 failed=0 skipped=38 rescued=0`.
- [x] (2026-09-26) Milestone 3a implemented on `feat/explicit-site-scope-m3a`: `GET/POST /api/sites` (ADMIN/MANAGER, key without " - ", duplicates 409), `PUT /api/clients/:id` accepts `siteKey` (registered site or null, unknown site 400 `UNKNOWN_SITE`) and `canProxyOtherDevices` and invalidates the site directory, `POST /api/clients` and the heartbeat ignore empty locations (so `scripts/register-clients.sh`, which still sends `"location": ""` for hosts without one, can no longer blank a location), and 管理画面 > クライアント端末 shows and edits 拠点 and 代理操作 plus a 拠点（工場） card. Evidence: clients integration tests 37 passed on a disposable PostgreSQL; web admin tests 19 passed.
- [ ] Follow-up (optional, separate PR because the CI change classifier treats `scripts/register-clients.sh` as an unknown path and runs the full suite): make the script omit an empty location instead of relying on the API.
- [x] (2026-09-26) Milestone 3a merged as PR #1501 (merge `2b0b01d3`), including Codex-reported fixes: a site key may not equal an existing device scope key (409 `SITE_KEY_CONFLICTS_WITH_DEVICE`), and registration, heartbeat location changes and admin renames invalidate the site directory.
- [x] (2026-09-26) Milestone 3b implemented on `feat/explicit-site-scope-m3b`: `GET /api/kiosk/sites` (x-client-key), migration `20260926130000_seed_planned_sites` registers トークプラザ and 第1工場 so the pickers keep their choices, and the five hard-coded lists (manual order, leader order board, load balancing proxy panel, due management, production schedule) use `useKioskSiteKeys`, which falls back to the old fixed list until the server list arrives. Evidence: web kiosk/admin tests 172 files / 942 tests plus 3 hook tests passed; site-scope API integration 8 tests passed on a disposable PostgreSQL.
- [x] (2026-09-26) Milestone 3b merged as PR #1502 (merge `9690bf39`), including Codex-reported fixes (site options refresh every 5 minutes; site display name always equals the key).
- [x] (2026-09-26) Milestone 3a deployed to Pi5 only with run `20260926-042918-059d7a`: `SubState=exited`, `Result=success`, recap `ok=263 changed=31 unreachable=0 failed=0 skipped=38 rescued=0`.
- [x] (2026-09-26) Milestone 4a implemented on `feat/explicit-site-scope-m4a`: read-only report `apps/api/scripts/site-scope-report.mjs` that counts rows per value for the 33 site- or device-scoped columns and classifies each value as a registered site, a registered device scope key (with the device's explicit and guessed site), an unregistered device of a registered site, or unknown. Verified on a disposable PostgreSQL with seeded rows under `Mac` and `raspi5_serber`.
- [x] (2026-09-26) Milestone 4a merged as PR #1503 (merge `c4ea3c87`, including the Codex-reported fix that treats `shared-global-rank` and the `shared` resource category row as valid sentinels) and deployed to Pi5 with run `20260926-054932-9ef264` (`Result=success`, recap `failed=0 rescued=0`). Milestone 3b was deployed before it with run `20260926-051708-d4d3f8` and the user confirmed the Mac pickers still show 第2工場・トークプラザ・第1工場.
- [x] (2026-09-26 15:05 JST) Milestone 4a production run on Pi5 (container `bluegreen-api-blue-1`, read-only). Outside registered sites: 製番ボード state under `Mac` (1 row) and overrides under `Mac` (26; 第2工場 has 56); global ranks under `Mac` (6 seibans, 546 row ranks) and under `第2工場 - kensakuMain` (legacy device-keyed); load-balancing capacity under `shared` (9, the valid shared fallback). All other site-scoped tables were already under 第2工場.
- [x] (2026-09-26) User decisions for Milestone 4b: merge only the 製番ボード; do not merge the `Mac` global ranking (keep its rows); assign every device, including Pi5 (`raspi5_serber`, a server whose key is only used for status and call targets) and `zero2w-tanaban01`, to 第2工場.
- [x] (2026-09-26) Milestone 4b implemented on `feat/explicit-site-scope-m4b`: `apps/api/scripts/site-scope-merge.mjs` (dry run by default; `--apply` writes a backup first and applies in one transaction; `--restore` undoes from the backup). Verified on a disposable PostgreSQL: dry run, apply, idempotent re-run, refusal to overwrite an existing backup, and full restore.
- [x] (2026-09-26) Milestone 4b merged as PR #1504 (merge `d257598f`, including Codex-reported fixes: backup under the writable `/opt/backups` mount, version-guarded restore, and undo of a merge-created target state) and deployed to Pi5 with run `20260926-072631-8a38c1` (`Result=success`, recap `failed=0 rescued=0`).
- [x] (2026-09-26 16:45:17 JST, backup `createdAt` 2026-09-26T07:45:17.892Z) Milestone 4b production. The `--source=Mac` dry run showed 10 seibans to append and 21 overrides to move; the user then clarified that the Mac 製番ボード data must not be merged at all. Ran a devices-only assignment instead (`--source=__devices_only__ --target=第2工場 --assign-devices`, dry run then `--apply --backup=/opt/backups/site-scope-merge-backup-20260926.json`): 0 seibans, 0 overrides, 14 devices set to 第2工場. The read-only report afterwards showed every device with explicit site 第2工場; the Mac board rows (1 state, 26 overrides) remain in the database, unused. The user confirmed on the real kiosks that the Mac now shows the same 製番ボード as the Pi4.
- [ ] Milestone 5: remove the text-guess fallback once every device has an explicit site.

## Surprises & Discoveries

- Observation: the Mac proxy privilege depends on the Mac having an empty location. Evidence: `apps/api/src/routes/kiosk/shared.ts` compares the device scope key to the literal `Mac`, and the scope key of the Mac is its name only because its location is empty. Setting the Mac location to `第2工場 - Mac` would silently remove the privilege, so the capability must become explicit before any location or site is changed.
- Observation: the administrator cannot edit `location` today. `PUT /clients/:id` accepts only name, default mode, initial route, haizen and shelf-layout settings, and the web page shows location read-only. `POST /clients` and `scripts/register-clients.sh` overwrite location from Ansible inventory and send an empty string when the inventory has none, which blanks a manual fix.
- Observation: site derivation from a scope-key string (`resolveSiteKeyFromScopeKey`) is called in about 20 places, including service code that only has a string, not a device. An explicit site stored on the device therefore needs a lookup from device scope key to site, not only a change in the resolver.
- Observation: several services read `ClientDevice` with a narrow `select` (for example `{ id, name, location }` in `findClientDeviceProfileById`) and then resolve a scope. Those reads will not see `siteKey` and must be covered by the Milestone 2 site directory. Until an administrator can assign a site (Milestone 3) this has no effect.
- Observation: the web hard-codes the site list `第2工場`, `トークプラザ`, `第1工場` in several Mac-only pickers (`apps/web/src/features/kiosk/loadBalancing/useProductionScheduleMacDeviceScope.ts`, `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`, `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`).

## Decision Log

- Decision: Keep the device scope key (the per-device key stored in many device-scoped tables such as search state, triage, daily plan, due-management history) exactly as it is. Only the site becomes explicit. Rationale: renaming device scope keys would orphan per-device rows in more than fifteen tables; the reported problem is only about the site. Date/Author: 2026-09-26, Claude.
- Decision: Add a `Site` table and a nullable `ClientDevice.siteKey` that references it, rather than a free-text site column. Rationale: sites will be added in the future, the web needs a server-provided list instead of hard-coded names, and a foreign key prevents typos from creating accidental sites again. Date/Author: 2026-09-26, Claude.
- Decision: Replace the `Mac` string comparison with a per-device boolean `canProxyOtherDevices`, backfilled for the device whose current scope key is `Mac`, before any site or location changes. Rationale: it removes the hidden coupling found above and is behavior-neutral when the backfill is exact. Date/Author: 2026-09-26, Claude.
- Decision: While `ClientDevice.siteKey` is empty, the resolver keeps today's text guess. Rationale: every milestone before Milestone 4 must be deployable without changing any visible behavior, which also makes each one trivially reversible. Date/Author: 2026-09-26, Claude.
- Decision: Merging accidental sites uses deterministic rules, with 第2工場 rows winning on conflict, a dry-run report reviewed by the user before any write, and a pre-merge backup of the affected rows. Rationale: the user chose to merge rather than discard; deterministic rules make the result reproducible and auditable. The concrete per-table rules are finalized in Milestone 4 after the dry-run shows real row counts. Date/Author: 2026-09-26, Claude.
- Decision: Do not merge the Mac 製番ボード (registered seibans and overrides) into 第2工場; only assign devices. Rationale: the user clarified after the dry run that the Mac-only seibans are not wanted in the shared board. The rows are kept, not deleted. Date/Author: 2026-09-26, user.
- Decision: The user offered JEV (the repository's LLM-based judgment component) for decisions. It is not used for the merge because conflict resolution must be deterministic and reviewable; it may be revisited if a merge case needs judgment that rules cannot express. Date/Author: 2026-09-26, Claude.

- Decision: The Milestone 2 site directory is an in-memory map from device scope key to explicit site, loaded when the API starts and refreshed at most every 30 seconds by a request hook, instead of turning every caller into an asynchronous database lookup. Rationale: `ClientDevice` has about fifteen rows, eight of the callers are synchronous helpers inside services, and the codebase already keeps the order-split pilot gate the same way. A failed reload keeps the previous map and does not fail requests; unknown keys keep today's text guess. Milestone 3 must call `invalidateSiteDirectory()` after an administrator changes a device site so the next request reloads immediately. Date/Author: 2026-09-26, Claude.
- Decision: `listRegisteredDeviceScopeKeysForSite` keeps listing only devices that have a location (the Mac, whose location is empty, is still not a proxy target), and the manual-order overview event query keeps its old prefix match and additionally matches the site's listed device keys. Rationale: both keep today's results exactly while an explicit site exists nowhere, and become correct once sites are assigned. Date/Author: 2026-09-26, Claude.

## Outcomes & Retrospective

As of 2026-09-26 Milestones 1 to 4 are in production. Every device has an explicit site (第2工場), so all kiosks, the Mac and the Pi5 share one 製番ボード and the other site-scoped data, and the Mac proxy privilege is an explicit setting. New sites can be added in 管理画面 and assigned per device. The location-text guess still exists but is no longer reached for any registered device; Milestone 5 removes it after a few days of observation.

Lessons: ask about each data set separately and restate the exact rows before a production data change; the numbered question about global rankings was read by the user as being about the 製番ボード seibans, which the dry run exposed before anything was written. Codex review caught real defects in every pull request (backfill whitespace, idempotent site resolution, key-namespace collisions, stale directory after renames, picker refresh, backup location and restore safety).

Open follow-ups: Milestone 5; make `scripts/register-clients.sh` omit an empty location (separate PR); optionally delete the unused Mac 製番ボード rows once the user confirms they are not needed.

## Context and Orientation

The API is a Fastify application in `apps/api`, using Prisma with PostgreSQL. The schema is `apps/api/prisma/schema.prisma` and migrations live in `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`. The web client is a React application in `apps/web`. Production runs the API and web on one Raspberry Pi 5 server; Raspberry Pi 4 kiosks, a Mac and Android phones open the web pages from it.

Every kiosk request carries the header `x-client-key`. The API looks the key up in the `ClientDevice` table (`apps/api/src/services/clients/client-device-auth.service.ts`, `findClientDeviceByApiKey`, which reads all columns). `apps/api/src/lib/location-scope-resolver.ts` turns that row into a scope context with these parts: the device scope key (trimmed `location`, else trimmed `name`, else `default`), the site key (text before " - " in the device scope key, else the whole key), the device name (text after " - "), the infrastructure host (the name) and the credential identity. Route handlers obtain it through `deps.resolveLocationScopeContext(clientDevice)` defined in `apps/api/src/routes/kiosk/shared.ts`.

Tables that store a site key include `ProductionScheduleGrindingPlanningBoardState`, `...Override` and `...DueScope` (the 製番ボード), `ProductionScheduleOrderAssignment`, `ProductionScheduleManualOrderResourceAssignment`, `ProductionScheduleOrderSplitAssignment` and its audit log, the load-balancing tables (`ProductionScheduleResourceCapacityBase`, `...MonthlyCapacity`, `...WorkCalendar`, `...LoadBalanceClass`, `...LoadBalanceTransferRule`), `ProductionScheduleResourceCategoryConfig.location` (normalized to a site key) and the global rank tables when the ranking scope is shared. Many other tables store the device scope key in a column called `location`; this plan does not change those.

The Mac proxy privilege lets the Mac act for a chosen kiosk in manual order, order split, load balancing and due management. It is decided by `canProxyTargetLocation(actorLocation)` and `shouldRequireTargetLocationForActor(actorLocation)` in `apps/api/src/routes/kiosk/shared.ts`, called from `order.ts`, `order-split.ts`, `due-management-manual-order-overview.ts`, `manual-order-resource-assignments.ts`, `manual-order-site-devices.ts`, `due-management-global-rank.ts` and `resolve-assignment-location-key.ts` under `apps/api/src/routes/kiosk/production-schedule/`. Every one of those handlers already has the scope context of the calling device.

## Plan of Work

Milestone 1 adds the new storage and wires the proxy capability without changing behavior. A migration creates `Site` (`key` text primary key, `displayName`, `sortOrder` integer, timestamps), inserts the row `第2工場`, adds `ClientDevice.siteKey` (nullable, foreign key to `Site.key`, `ON UPDATE CASCADE ON DELETE RESTRICT`) and `ClientDevice.canProxyOtherDevices` (boolean, default false), and backfills the capability to true for exactly the devices whose current device scope key equals `Mac`, computed in SQL the same way the resolver does: `COALESCE(NULLIF(btrim(location), ''), NULLIF(btrim(name), ''), 'default') = 'Mac'`. The scope context gains `canProxyOtherDevices`, and the two Mac checks take the scope context instead of a string. `resolveProductionScheduleAssignmentLocationKey` receives the capability as a parameter from its callers. The resolver also gains the rule "explicit `siteKey` wins when present", which changes nothing yet because the column is empty. Acceptance: all existing API tests pass; new resolver tests show that an explicit site wins and that an empty site keeps today's guess; new tests show the proxy decision follows the flag and not the name; after deployment the Mac can still choose a target kiosk in manual order and the kiosks still cannot.

Milestone 2 introduces one site directory, a small module that answers "which site does this device scope key belong to" by looking up the device with that scope key and returning its explicit site, falling back to today's text guess when no device or no explicit site exists. Every call of `resolveSiteKeyFromScopeKey` and the hand-written prefix match in `due-management-manual-order-overview.service.ts` move to it. Because no device has an explicit site yet, results are identical; tests prove it table by table for the listed call sites.

Milestone 3 lets an administrator manage sites and assign them. The admin API gains site list/create endpoints and accepts `siteKey` and `canProxyOtherDevices` in `PUT /clients/:id`; the admin page shows a site selector and a proxy checkbox. `POST /clients`, the heartbeat endpoint and `scripts/register-clients.sh` are changed so they never write `siteKey` or the capability, and so an empty inventory location no longer blanks an existing location. The web site pickers read the server site list instead of the hard-coded names. Nothing changes for users until an administrator assigns a site.

Milestone 3 is delivered as two pull requests to keep each change small: 3a (admin API, admin page, registration fixes) and 3b (web site pickers).

Milestone 4 (as originally planned; see the Decision Log for the devices-only change) merges accidental sites. A script under `scripts/site-scope/` prints, for every site-scoped table, the row counts per site key and the rows that would conflict when a source site is merged into a target site, without writing. The user reviews the report and confirms the mapping (initially `Mac`, `raspi5_serber`, `ラズパイ5`, `factory`, `default` and the seed sites into `第2工場`, only where rows exist). The apply mode backs up the affected rows to a JSON file, then in one transaction per table re-keys source rows whose natural key is free in the target and skips rows that conflict (target wins), with ordered lists such as the 製番ボード registered numbers appended after the target's existing order. The same run assigns the explicit site to every production device. Production execution requires explicit user approval and is recorded in this plan.

The report is run on Pi5 inside the API container, from the repository checkout on Pi5 at `/opt/RaspberryPiSystem_002`:

    docker compose -f infrastructure/docker/docker-compose.server.yml exec -T -w /app/apps/api api node scripts/site-scope-report.mjs > /tmp/site-scope-report.json

It only issues `SELECT` statements. The field `siteScopedValuesOutsideRegisteredSites` lists what the merge in Milestone 4b must handle.

The Milestone 4b operation that was actually approved and run on Pi5 (API container, working directory `/app/apps/api`) assigns devices only. `__devices_only__` is a source key with no data, so no 製番ボード row is merged. Dry run first:

    node scripts/site-scope-merge.mjs --source=__devices_only__ --target=第2工場 --assign-devices

After the user approves the printed plan (0 seibans, 0 overrides, the listed devices), apply it. The API container is read-only except for its mounted directories, so the backup goes to `/opt/backups` (the host's `/opt/backups`); the file must not exist yet:

    node scripts/site-scope-merge.mjs --source=__devices_only__ --target=第2工場 --assign-devices --apply --backup=/opt/backups/site-scope-merge-backup-20260926.json

Do not run the script with `--source=Mac`: that merges the Mac 製番ボード (10 seibans, 21 overrides), which the user explicitly rejected on 2026-09-26.

To undo, restore from that backup. Restore refuses to write anything if the target board or a moved override was edited after the merge, and it deletes a target board state that the merge itself created. The API reloads the site directory within 30 seconds; 製番ボード caches follow the bumped state version.

    node scripts/site-scope-merge.mjs --restore=/opt/backups/site-scope-merge-backup-20260926.json

Milestone 5 removes the text guess. Once telemetry and a database query show that every active device has an explicit site, a device without one is rejected with a clear error on site-scoped screens, and the fallback code and its compatibility reads are removed in a separate pull request.

## Concrete Steps

Work happens in the linked worktree created by `python3 -m scripts.git_lifecycle.cli start --branch feat/explicit-site-scope`. For database tests start a disposable PostgreSQL with `POSTGRES_PORT=55432 bash scripts/test/start-postgres.sh`, create a dedicated database (`docker exec postgres-test-local psql -U postgres -c "CREATE DATABASE site_scope_test"`), then in `apps/api` run `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/site_scope_test pnpm prisma migrate deploy` and the targeted `pnpm exec vitest run <paths>` with `TEST_DATABASE_URL` set to the same URL. Remove the container afterwards with `docker stop postgres-test-local && docker rm postgres-test-local`.

## Validation and Acceptance

Each milestone is a separate pull request with a completed deploy-impact table, green CI, a squash merge, and a Pi5-only standard deployment approved by the user. Milestones 1 to 3 must show no visible change: the 製番ボード counts on the Mac and on a Pi4 stay as before, and the Mac still sees its proxy target selector. Milestone 4 is accepted when, after the approved devices-only assignment, every device has an explicit site in the report and the Mac, Safari and every Pi4 show the same 製番ボード registered numbers. The unused Mac 製番ボード rows are expected to remain under `Mac` in the report (not merged by decision).

## Idempotence and Recovery

Migrations in Milestones 1 and 3 are additive; rolling back the application image leaves unused columns that older code ignores. The Milestone 4 script is safe to re-run: the dry run never writes, and the apply mode skips rows already moved. Its JSON backup allows restoring the original site keys of moved rows if a merge must be reversed.

## Artifacts and Notes

Production device list observed on 2026-09-26 (name, location): `Mac` with empty location (proxy device), `raspi5_serber` with empty location, `AQUOS` and `aquos-sense4-lite` with `factory`, `zero2w-tanaban01` with `棚番エッジ（自宅検証・Zero2W）`, and all Raspberry Pi 4 kiosks and signage devices with `第2工場 - <device>`.

## Interfaces and Dependencies

At the end of Milestone 1, `StandardLocationScopeContext` in `apps/api/src/lib/location-scope-resolver.ts` has a boolean `canProxyOtherDevices`, `ClientDeviceForScopeResolution` accepts optional `siteKey` and `canProxyOtherDevices`, and `canProxyTargetLocation` and `shouldRequireTargetLocationForActor` in `apps/api/src/routes/kiosk/shared.ts` take `Pick<LocationScopeContext, 'canProxyOtherDevices'>`. `resolveProductionScheduleAssignmentLocationKey` takes `actorCanProxyOtherDevices: boolean` in addition to its current parameters.
