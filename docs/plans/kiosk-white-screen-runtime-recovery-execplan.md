# Prevent intermittent kiosk white screens from stale lazy chunks

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

Some kiosk route components are loaded only when a user navigates to them. If a browser still has an older HTML or JavaScript entry point after a Web deployment, the requested versioned JavaScript file can have disappeared. The current Web server rewrites that missing `/assets/*.js` request to `index.html`, and React has no top-level error boundary, so the result can be a white screen until a manual reload.

After this change, missing assets return a real 404, HTML documents are not cached, route loading is visibly announced, and a recognized lazy-module failure on a kiosk path performs at most one cache-busted reload in a sixty-second window. Any second failure or unrelated render failure stops at a usable recovery screen with a manual reload button. The existing deploy-driven kiosk activation and exact release-SHA acknowledgement remain unchanged.

## Progress

- [x] (2026-07-31 09:58Z) Confirmed a clean `main`, pulled `origin/main`, and created `fix/kiosk-white-screen-recovery`.
- [x] (2026-07-31 09:58Z) Reproduced the current Caddy failure contract with an ephemeral read-only container: a missing `/assets/old-missing-chunk.js` returned HTTP 200 with the `index.html` body; removed the container afterward.
- [x] (2026-07-31 10:11Z) Implemented and unit-tested the bounded kiosk runtime-recovery policy and browser adapter.
- [x] (2026-07-31 10:11Z) Added the application error boundary and visible lazy-route loading state.
- [x] (2026-07-31 10:12Z) Corrected all runtime Caddy SPA/asset matchers and added an isolated HTTP contract test.
- [x] (2026-07-31 10:12Z) Added the production-build browser regression test and durable ADR/index link.
- [x] (2026-07-31 10:17Z) Ran Node 20+, Web, Caddy, Docker, deployment, 157 migrations, ledger SQL, EXPLAIN, and related API validation; all passed and temporary Docker resources were removed.
- [x] (2026-07-31 10:19Z) Reviewed the complete staged diff, documentation links, YAML, shell syntax, executable mode, and whitespace checks.
- [x] (2026-07-31 10:22Z) Committed and pushed the implementation, then opened draft PR #1138 against `main`; production deployment remains unauthorized.
- [ ] Wait for every required GitHub check on PR #1138 to complete successfully and record the final result.

## Surprises & Discoveries

- Observation: The current deployment workflow already has a separate bounded stale-bundle activation protocol in `apps/web/src/features/kiosk/kioskWebActivation.ts`.
  Evidence: It stores `raspi:kiosk-web-activation:v1`, retries only during an exact deploy verification challenge, and has twenty passing focused tests with `KioskLayout`.

- Observation: The white-screen failure path is possible without a React page-specific defect.
  Evidence: `apps/web/src/App.tsx` uses `React.lazy` with `Suspense fallback={null}`, `apps/web/src/main.tsx` has no error boundary, and an ephemeral `caddy:2` run returned the 842-byte HTML entry document for a nonexistent JavaScript asset.

- Observation: `/assets/*` cannot receive a blanket immutable-cache rule in this fix.
  Evidence: `apps/web/public/assets/rigging-inspection.png` is intentionally published under an unhashed stable name.

- Observation: An explicit Caddy `route` scoped to non-API static-site requests preserves the existing proxy handlers and makes the post-rewrite document path available to the cache header matcher.
  Evidence: All four configurations passed `caddy adapt`; the isolated HTTP contract returned HTML 200 plus no-store for a deep link and an empty non-HTML 404 for a missing JavaScript asset.

- Observation: The recovery contract needs a production build with a valid compile-time release SHA; the default development E2E server intentionally lacks that release identity.
  Evidence: A dedicated Playwright configuration builds with a forty-character SHA, aborts the emitted lazy chunk, and observed exactly two document navigations in both the recovered and exhausted cases.

- Observation: The isolated Caddy contract's optional Web build must also build the Web workspace dependencies on a clean checkout.
  Evidence: PR #1138's first `deploy-contract` run failed before Caddy startup because `@raspi-system/part-search-core` and `@raspi-system/shelf-layout-core` had no generated declarations. Local validation had inherited those artifacts from earlier tests. The script now owns all three shared-package build prerequisites.

## Decision Log

- Decision: Protect the entire React tree with one dependency-free error boundary, but restrict automatic reload to recognized module-load failures on `/kiosk` paths.
  Rationale: Provider, router, admin, and signage render failures should not leave an empty root, while broad automatic reloads could hide deterministic defects or discard user state.
  Date/Author: 2026-07-31 / Codex, confirmed by user.

- Decision: Permit one automatic reload per pathname and valid compiled release SHA during a sixty-second window, then show the recovery UI.
  Rationale: This recovers the reported transient failure without creating a reload loop. Unknown release identity, corrupt storage, storage failure, time reversal, and invalid or cross-origin URLs fail closed.
  Date/Author: 2026-07-31 / Codex, confirmed by user.

- Decision: Keep runtime recovery independent from deploy-driven kiosk activation.
  Rationale: Deploy activation proves an exact release challenge and may retry three times; ordinary navigation recovery has different evidence, limits, and lifecycle.
  Date/Author: 2026-07-31 / Codex.

- Decision: End implementation at a draft PR with successful CI. Do not deploy to Pi5 or kiosks in this work.
  Rationale: Production deployment requires a separate explicit authorization and must begin with the standard deployment print-plan and a single Firefox kiosk canary.
  Date/Author: 2026-07-31 / Codex, confirmed by user.

## Outcomes & Retrospective

The implementation now prevents the reproduced unsafe server response and contains the corresponding browser failure. The pure policy, storage adapter, Error Boundary, visible loading state, four Caddy variants, isolated HTTP contract, production-build Playwright fault injection, CI wiring, and durable ADR are complete and published in draft PR #1138. Focused tests passed fifty cases, the full Web suite passed 1,628 cases in 326 files, and both Playwright fault scenarios passed.

The complete offline deployment contract passed, including 929 rolling-release tests, blue-green and maintenance recovery, inventory and Ansible syntax validation, 157 migrations on a new isolated Postgres database, migration-ledger SQL, `EXPLAIN (ANALYZE, BUFFERS)`, and twenty deploy-status API tests. Cleanup reported zero run resources, and a separate Docker name scan found no matching container, volume, or network.

The production incident remains probabilistic because no contemporaneous browser trace exists. This change proves and removes one concrete stale-chunk failure path without claiming that every historical white screen had the same cause. Live Pi5 and kiosk behavior remains unverified and unauthorized; the next operational step after merge is a separately approved print-plan and one Firefox kiosk canary.

## Context and Orientation

The browser entry point is `apps/web/src/main.tsx`. It creates the React root and installs React Query, authentication, and browser-routing providers. The route table is `apps/web/src/App.tsx`; several production kiosk pages use `React.lazy`, which asks Vite to generate content-hashed JavaScript chunks under `/assets/`.

The deploy-only stale bundle protocol is `apps/web/src/features/kiosk/kioskWebActivation.ts` and is consumed by `apps/web/src/layouts/KioskLayout.tsx`. It compares a compiled `VITE_RELEASE_SHA` with an API-provided deployment challenge and must not be reused or weakened by this change.

The Web image copies four runtime static-server configurations from `infrastructure/docker`: `Caddyfile`, `Caddyfile.production`, `Caddyfile.local.template`, and `Caddyfile.slot.template`. Their current SPA matcher excludes API, WebSocket, and storage paths but not `/assets/*`. Caddy therefore treats a missing versioned chunk as a client-side route and rewrites it to HTML.

The repository requires Node 20.9 or newer and pnpm 9.15.9. The host shell currently defaults to Node 18.20.8, so authoritative Web validation must select the repository-compatible Node runtime. Deployment contracts are centralized in `scripts/ci/run-deploy-contracts-local.sh`; its Postgres tests use isolated resources and must not point at an existing database.

## Plan of Work

First add a pure policy module under `apps/web/src/features/kiosk` that recognizes only known Vite, Firefox, and Chromium dynamic-module failure messages. Its input includes the unknown error, pathname, absolute current URL and origin, optional compiled SHA, current time, and the raw session-storage value. Its output either refuses recovery with a typed reason or supplies the cache-busted same-origin URL and serialized one-attempt record. It does no browser I/O.

Add a thin browser adapter beside that policy. The adapter reads and writes only `raspi:web-runtime-recovery:v1`, obtains the release SHA through `readProductionBuildConfig`, calls the policy, persists the attempt before returning a reload decision, and reports storage failures without navigating. It uses a distinct `__raspi_web_runtime_recovery` query parameter and does not import deploy status or acknowledgement logic.

Add `AppErrorBoundary` under `apps/web/src/components`. Place it outside all providers in `main.tsx`. Its injected runtime controller makes the browser adapter testable. On the first eligible kiosk module failure it shows a short recovery-in-progress state and calls `location.replace`; all stopped or unrelated failures show a standalone Japanese recovery screen with a large manual reload button. Never render exception text or stack data. Replace the null `Suspense` fallback in `App.tsx` with a full-page, accessible loading status.

Update the four runtime Caddy configurations so `/assets/*` is never rewritten. Use an explicit `route` block for the static portion: rewrite eligible non-file SPA routes to `/index.html`, add `Cache-Control: no-store, no-cache, must-revalidate` when the post-rewrite path is `/index.html` or the direct path is `/`, then invoke `file_server`. Preserve proxy, readiness, TLS, access restriction, and security-header behavior.

Add `scripts/deploy/tests/test-web-static-routing.sh`. It builds or accepts an existing Web distribution, starts a uniquely named and labelled `caddy:2` container with the site and HTTP configuration mounted read-only, and uses a trap to remove the container. It asserts a deep link is HTML 200 with no-store, a real hashed JavaScript asset is JavaScript 200, and a missing JavaScript asset is non-HTML 404. Invoke it from the shared deploy-contract runner so local and CI contract lists cannot drift.

Add focused Vitest coverage for every policy branch and Error Boundary behavior. Add a Playwright regression that opens `/kiosk/part-measurement/inspection`, aborts its lazy JavaScript chunk once, and proves exactly one reload followed by nonempty usable content; a persistent failure must stop at the recovery UI rather than loop. Record the durable behavior and non-goals in a new ADR and add a thin discovery link to `docs/AI_START_HERE.md`.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

The branch was created with:

    git checkout main
    git pull --ff-only origin main
    test -z "$(git status --porcelain)"
    git checkout -b fix/kiosk-white-screen-recovery

After implementing each milestone, run focused tests first:

    pnpm --filter @raspi-system/web exec vitest run <new-policy-test> <new-boundary-test> apps/web/src/features/kiosk/kioskWebActivation.test.ts apps/web/src/layouts/KioskLayout.test.tsx
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build
    bash scripts/deploy/tests/test-web-static-routing.sh
    bash scripts/deploy/tests/test-pi5-blue-green.sh

Then run the production-like browser test and complete suites using Node 20.9 or newer and an isolated E2E database as required by the existing E2E harness. Finally run:

    pnpm --filter @raspi-system/web test
    bash scripts/ci/run-deploy-contracts-local.sh
    git diff --check
    git status --short

Inspect Docker by the unique labels used by these test runs and expect no matching container, volume, or network after each suite.

## Validation and Acceptance

Policy tests must prove Chromium `Failed to fetch dynamically imported module`, Firefox `error loading dynamically imported module`, and an HTML module MIME mismatch are eligible, while arbitrary render, fetch, and event errors are not. The first eligible kiosk failure with a valid full SHA and empty storage returns one same-origin URL that preserves pathname, existing query, and hash. The same pathname and SHA within sixty seconds, unknown SHA, corrupt storage, failed persistence, time reversal, and cross-origin input do not navigate.

Component tests must prove that an eligible decision calls the injected `replace` once, a stopped decision exposes the manual button, the button calls the injected reload once, and neither the exception message nor stack is present in the DOM. Existing deploy-activation tests must remain unchanged and passing.

The Caddy contract passes only when `/kiosk/part-measurement/inspection` returns HTML 200 and no-store, an emitted hashed script returns JavaScript 200, and `/assets/old-missing-chunk.js` returns 404 with no HTML body. The container must be absent after both successful and failing runs.

The browser regression passes only when `#root` does not remain empty, the transient lazy-chunk failure produces one cache-busted reload and then the target screen, and a persistent failure produces one reload followed by the recovery screen without a third document navigation.

The complete Web suite, lint, production build, Caddy validation, blue-green tests, isolated Postgres migration ledger checks, related SQL, and EXPLAIN checks must all exit zero before commit. No external API, shared public type, database schema, or migration may change.

## Idempotence and Recovery

Source edits and test commands are repeatable. Docker test scripts must use `mktemp`, run-specific names and labels, read-only mounts, and `trap` cleanup. They must never stop, remove, or connect to containers they did not create. The isolated Postgres deployment contract owns and removes its resources; do not reuse a running database or named production volume.

If a Web test fails, keep the branch and worktree intact and correct only files in this plan. If Caddy validation fails, use `caddy adapt` or the ephemeral test container to inspect generated configuration without touching host or production configuration. Do not stash, reset, deploy, or modify an existing container to recover.

## Artifacts and Notes

Baseline focused validation before edits passed two Vitest files and twenty tests. A baseline Web production build also completed, though the host Node 18 warning means it is not authoritative. Homebrew Node 20.20.2 was then installed keg-only and selected only through command-local `PATH` for authoritative validation.

The confirming pre-fix HTTP evidence was:

    GET /kiosk/assembly/work-sessions/example -> 200 text/html, 842 bytes
    GET /assets/old-missing-chunk.js           -> 200 text/html, 842 bytes

The temporary reproduction container was removed and no repository changes resulted from the baseline build.

Final validation evidence was:

    focused Vitest:       5 files, 50 tests passed
    complete Web Vitest:  326 files, 1628 tests passed
    recovery Playwright:  2 tests passed against a production build
    Caddy HTTP contract:  PASS, missing asset returned non-HTML 404
    Caddy validation:     all four runtime variants valid
    blue-green lifecycle: PASS
    deploy contracts:     PASS, including 929 rolling-release tests
    isolated Postgres:    157 migrations, ledger SQL, EXPLAIN, 20 API tests
    Docker cleanup:       matching containers=0, volumes=0, networks=0

## Interfaces and Dependencies

The pure recovery module must export a classifier, a decision function, the sixty-second window constant, and discriminated decision types. The browser adapter must expose a controller with `decide(error)`, `replace(href)`, and `reload()` operations so the Error Boundary can receive a fake implementation in tests. Storage and navigation remain browser-native; no new package is added.

The Error Boundary is a React class because React 18 requires class lifecycle methods to catch descendant render errors. Its fallback must depend only on React and CSS/Tailwind classes already bundled by the application, not on Router, React Query, authentication, or API state.

The deployment HTTP test depends only on Bash, Docker, curl, and the existing `caddy:2` image. Any Postgres dependency is confined to the existing isolated deployment-contract scripts.

Revision note (2026-07-31 09:58Z): Created the living plan from the approved implementation plan and recorded the pre-change repository and Caddy evidence.

Revision note (2026-07-31 10:17Z): Recorded the completed implementation, production-build browser proof, full Web and deployment validation, isolated database evidence, and verified Docker cleanup before final review and publication.

Revision note (2026-07-31 10:19Z): Recorded successful validation of every runtime Caddy variant and completion of the staged diff review; only GitHub publication remains.

Revision note (2026-07-31 10:22Z): Recorded commit `8855e566`, the pushed feature branch, and draft PR #1138. GitHub checks are now the only incomplete implementation gate.

Revision note (2026-07-31 10:28Z): Recorded and corrected the clean-CI build prerequisite discovered by the first PR deploy-contract run; full revalidation and replacement checks remain pending.
