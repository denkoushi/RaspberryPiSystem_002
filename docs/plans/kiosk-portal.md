# Kiosk portal with per-device card visibility

This local implementation plan follows `.agent/PLANS.md`. Status: local implementation; integrationPending. Commit, push, PR, merge and deployment are outside the authorized scope.

## Purpose / Big Picture

Operators can open `/kiosk/portal` and tap a large card for any existing kiosk header screen. The portal can be selected as the device startup page. A gear opens 「この端末に出すカード」 to select cards for this device; new tabs remain visible by default. 「50インチ表示」 switches to six columns of larger cards on a 1920×1080 screen.

## Progress

- [x] 2026-10-17: Inspect rules, clean worktree, current header, configuration, authentication and test patterns.
- [x] 2026-10-17: Implement shared navigation, portal screen, header controls, startup route and additive persistence/API.
- [x] 2026-10-17: Focused tests, type checks, lint and diff checks pass.
- [ ] Browser visual verification: Vite cannot listen on 127.0.0.1:4187 in this sandbox (EPERM).

## Context and Orientation

`packages/shared-types/src/kiosk/kiosk-header-tab-order.ts` defines reorderable screen IDs and completes missing IDs in shared order. `apps/web/src/features/kiosk/kioskHeaderTabs/` owns labels, active-state detection and shared route resolution. The fixed portal tab is outside that order. `KioskLayout.tsx` supplies the portal display preference through the React Router outlet and keeps its header visible at the top; other routes retain their bottom dock.

`apps/api/src/routes/kiosk.ts` registers the device-authenticated settings route. `apps/api/src/services/kiosk/kiosk-config.service.ts` obtains device config, and `apps/web/src/api/domains/kiosk.ts` defines its web response type. Prisma's ClientDevice model stores hidden tab IDs, not a list of visible cards.

## Plan of Work

First add `portal` to shared startup route IDs, labels and paths, then extract a single web route resolver used by header and portal. Preserve the due-management password gate in a shared hook. Add typed grouping and simple SVG icons under `apps/web/src/features/kiosk/portal/`, then route `KioskPortalPage.tsx` under the existing kiosk layout.

Second add `kioskPortalHiddenTabIds String[] @default([])` and migration `20261017100000_add_kiosk_portal_hidden_tab_ids`. Register `PUT /kiosk/portal-cards`, authenticate using `x-client-key`, strictly accept reorderable IDs and deduplicate. Expose `portalHiddenTabIds` in config. The existing query-client pattern updates and invalidates config after saving. The modal uses the existing accessible Dialog; cancel never writes and failures keep the draft open.

Finally validate shared route enumeration, grouping coverage/order, device ownership and config round trip, page navigation and visibility, modal behavior and persistent display preference. Check both display modes in a browser at 1920×1080.

## Concrete Steps

From the worktree root run `pnpm --filter @raspi-system/shared-types build`, `pnpm --filter @raspi-system/api prisma:generate`, and the focused Vitest tests for shared kiosk routes, API portal/initial-route routes and web portal/header/layout. Run `pnpm --filter @raspi-system/web exec tsc --noEmit` and `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit`. Lint changed TypeScript files in each changed package. Do not apply migrations to a database for this task.

## Validation and Acceptance

At 1920×1080, normal mode has five labeled rows with 178×126 cards and large mode has six columns of 262×184 cards, without page scrolling. A card uses the header's label and path, including TAG/PHOTO and due-management authentication. The portal header has no reorderable tab row and retains utility controls. Other screens get the fixed first portal tab. Every current tab occurs in exactly one group; future ungrouped IDs fall into the last group.

API tests must reject unknown IDs, extra fields, and missing/invalid device keys, and verify that only the authenticated device is updated. Empty hidden IDs show all cards. All hidden IDs show the specified empty state. Shared startup enumeration also drives admin ClientsPage and API validation without separate lists.

## Decision Log

- Reuse shared startup paths for eligible tab destinations; only borrow, tag desk and due management need special handling. This avoids duplicating paths and labels.
- Extract the existing due-management navigation hook to preserve its authentication behavior for cards.
- Keep large-mode preference in layout state plus guarded localStorage; use fixed dimensions without document zoom.
- Add violet and rose to the existing inv palette to use the requested colors consistently.

## Surprises & Discoveries

The current header is a hidden bottom dock on all kiosk screens. Portal requires a dedicated visible top header, so KioskLayout applies that change only to the portal route.

## Idempotence and Recovery

Migration is additive and defaults existing devices to all cards visible. Prisma client generation changes only local generated dependencies. No database migration, production access or git mutation is authorized. Revert only task changes if needed; no existing WIP was present when work began.

## Interfaces and Dependencies

`resolveKioskHeaderTabPath(tabId, defaultMode?)` is the shared web path resolver. `KIOSK_PORTAL_GROUPS` uses `KioskReorderableHeaderTabId` for grouping. `PUT /kiosk/portal-cards` accepts `{ hiddenTabIds: string[] }` and returns `{ ok: true, portalHiddenTabIds: string[] }`. Existing React Router, React Query, Fastify, Zod and Prisma dependencies suffice.

## Outcomes & Retrospective

Local implementation and automated checks are complete. Focused tests pass: web 124 unique tests in 10 files, API 47 in 2 files, shared-types 27 in 1 file (198 total). The initial portal API table test expanded arrays into individual parameters; wrapping cases in objects fixed the test input without changing API validation. Type checks and changed-file lint pass. Local validation took approximately five minutes, within the 45-minute DB-change budget.

Prisma initially failed trying to touch its read-only global engine cache. Changing XDG_CACHE_HOME did not relocate the macOS cache. Using installed query/schema engine paths generated the client successfully without changing schema targets or dependencies. Web typecheck initially needed existing part-search-core and shelf-layout-core packages built; after those builds it passed.

Visual browser verification remains unperformed because the dev server is prohibited from opening a listening port in this sandbox. The fixed-size normal card region is 1450×694px (seven-card widest row plus its group label); large mode is 1652×784px (six columns, four rows), plus 48px content padding and 73px header height, all below 1920×1080. This dimensional check is not a browser screenshot claim.

No existing WIP was present. All 36 changed files below belong to this task. No generated web sources, infrastructure, secrets or environment files were changed. Commit, push, branch/stash operations, database migration application, main CI, integration and deployment were not performed.

## Validation Evidence

Successful commands (test paths are relative to their filtered package):

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/shared-types test src/kiosk/kiosk-initial-route.test.ts src/kiosk/kiosk-header-tab-order.test.ts
    pnpm --filter @raspi-system/part-search-core --filter @raspi-system/shelf-layout-core build
    PRISMA_QUERY_ENGINE_LIBRARY="$PWD/node_modules/.pnpm/@prisma+engines@5.22.0/node_modules/@prisma/engines/libquery_engine-darwin-arm64.dylib.node" PRISMA_SCHEMA_ENGINE_BINARY="$PWD/node_modules/.pnpm/@prisma+engines@5.22.0/node_modules/@prisma/engines/schema-engine-darwin-arm64" pnpm --filter @raspi-system/api prisma:generate
    pnpm --filter @raspi-system/web exec tsc --noEmit
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    pnpm --filter @raspi-system/api test src/routes/kiosk/initial-route.test.ts src/routes/kiosk/portal-cards.test.ts
    pnpm --filter @raspi-system/web test src/features/kiosk/portal/kioskPortalGroups.test.ts src/features/kiosk/kioskHeaderTabs/ src/pages/kiosk/KioskPortalPage.test.tsx src/components/kiosk/KioskHeader.test.tsx src/components/kiosk/KioskHeader.due-management.test.tsx src/components/kiosk/KioskInitialRouteButton.test.tsx src/layouts/KioskLayout.test.tsx
    pnpm --filter @raspi-system/web test src/api/hooks/kiosk-portal.test.tsx src/components/kiosk/KioskHeader.test.tsx
    git diff --check

The shared-types command matched one file; no file named kiosk-header-tab-order.test.ts exists. The API initial-route tests passed on the initial run; only portal-cards.test.ts was rerun after fixing its table inputs. After adding portal header/start-page/layout cases, their three web files were rerun and all 47 cases passed. The final hook/header run passed 9 cases. Successful unchanged suites were not repeated.

Lint ran with `pnpm exec eslint <changed TypeScript paths>` from apps/api and packages/shared-types. Web ran `pnpm exec eslint --fix <changed src TypeScript paths>` to correct import ordering, followed by lint of the added hook test and edited header files. Tailwind config is outside web's typed ESLint project, so it was checked with `pnpm --filter @raspi-system/web exec eslint --parser-options '{"project":null}' tailwind.config.ts`. All final lint commands passed. Full suites and database integration were not needed for this additive change; the API boundary tests inject Fastify requests using mocked Prisma and test the actual config route/service.

## Changed Files

- [apps/api/prisma/migrations/20261017100000_add_kiosk_portal_hidden_tab_ids/migration.sql](../../apps/api/prisma/migrations/20261017100000_add_kiosk_portal_hidden_tab_ids/migration.sql)
- [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- [apps/api/src/routes/kiosk.ts](../../apps/api/src/routes/kiosk.ts)
- [apps/api/src/routes/kiosk/config.ts](../../apps/api/src/routes/kiosk/config.ts)
- [apps/api/src/routes/kiosk/portal-cards.test.ts](../../apps/api/src/routes/kiosk/portal-cards.test.ts)
- [apps/api/src/routes/kiosk/portal-cards.ts](../../apps/api/src/routes/kiosk/portal-cards.ts)
- [apps/api/src/services/kiosk/kiosk-config.service.ts](../../apps/api/src/services/kiosk/kiosk-config.service.ts)
- [apps/web/src/App.tsx](../../apps/web/src/App.tsx)
- [apps/web/src/api/domains/kiosk.ts](../../apps/web/src/api/domains/kiosk.ts)
- [apps/web/src/api/hooks/kiosk-portal.test.tsx](../../apps/web/src/api/hooks/kiosk-portal.test.tsx)
- [apps/web/src/api/hooks/kiosk.ts](../../apps/web/src/api/hooks/kiosk.ts)
- [apps/web/src/components/kiosk/KioskClientStatusChip.tsx](../../apps/web/src/components/kiosk/KioskClientStatusChip.tsx)
- [apps/web/src/components/kiosk/KioskHeader.test.tsx](../../apps/web/src/components/kiosk/KioskHeader.test.tsx)
- [apps/web/src/components/kiosk/KioskHeader.tsx](../../apps/web/src/components/kiosk/KioskHeader.tsx)
- [apps/web/src/components/kiosk/KioskInitialRouteButton.test.tsx](../../apps/web/src/components/kiosk/KioskInitialRouteButton.test.tsx)
- [apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer.test.tsx](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer.test.tsx)
- [apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer.tsx](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer.tsx)
- [apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabActivity.test.ts](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabActivity.test.ts)
- [apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabActivity.ts](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabActivity.ts)
- [apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabRoutes.test.ts](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabRoutes.test.ts)
- [apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabRoutes.ts](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderTabRoutes.ts)
- [apps/web/src/features/kiosk/kioskHeaderTabs/useKioskDueManagementNavigation.ts](../../apps/web/src/features/kiosk/kioskHeaderTabs/useKioskDueManagementNavigation.ts)
- [apps/web/src/features/kiosk/portal/KioskPortalControls.tsx](../../apps/web/src/features/kiosk/portal/KioskPortalControls.tsx)
- [apps/web/src/features/kiosk/portal/KioskPortalIcon.tsx](../../apps/web/src/features/kiosk/portal/KioskPortalIcon.tsx)
- [apps/web/src/features/kiosk/portal/kioskPortalGroups.test.ts](../../apps/web/src/features/kiosk/portal/kioskPortalGroups.test.ts)
- [apps/web/src/features/kiosk/portal/kioskPortalGroups.ts](../../apps/web/src/features/kiosk/portal/kioskPortalGroups.ts)
- [apps/web/src/features/kiosk/portal/useKioskPortalLargeScreen.ts](../../apps/web/src/features/kiosk/portal/useKioskPortalLargeScreen.ts)
- [apps/web/src/layouts/KioskLayout.test.tsx](../../apps/web/src/layouts/KioskLayout.test.tsx)
- [apps/web/src/layouts/KioskLayout.tsx](../../apps/web/src/layouts/KioskLayout.tsx)
- [apps/web/src/pages/kiosk/KioskPortalPage.test.tsx](../../apps/web/src/pages/kiosk/KioskPortalPage.test.tsx)
- [apps/web/src/pages/kiosk/KioskPortalPage.tsx](../../apps/web/src/pages/kiosk/KioskPortalPage.tsx)
- [apps/web/tailwind.config.ts](../../apps/web/tailwind.config.ts)
- [docs/INDEX.md](../../docs/INDEX.md)
- [docs/plans/kiosk-portal.md](../../docs/plans/kiosk-portal.md)
- [packages/shared-types/src/kiosk/kiosk-initial-route.test.ts](../../packages/shared-types/src/kiosk/kiosk-initial-route.test.ts)
- [packages/shared-types/src/kiosk/kiosk-initial-route.ts](../../packages/shared-types/src/kiosk/kiosk-initial-route.ts)

Updated 2026-10-17: recorded final local validation, environmental limits and exact changed-file inventory.
