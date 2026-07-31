---
title: Pi5 API image and single-SSD file storage scalability
status: in_progress
scope: API release image footprint and durable local file storage
date: 2026-07-31
source_of_truth: this ExecPlan
related_code:
  - infrastructure/docker/Dockerfile.api
  - apps/api/src/services/file-storage
  - infrastructure/docker/docker-compose.server.yml
related_docs:
  - ../knowledge-base/KB-404-pi5-ghcr-api-image-pull-timeout.md
  - ../decisions/ADR-20260730-bounded-api-runtime-artifact.md
validation: PR1 and PR2 CI, disposable PostgreSQL, local filesystem fault tests, and production rollout evidence
open_items:
  - Complete PR1 and merge it before starting PR2
  - Complete PR2 and request production-scope approval
---

# Reduce the Pi5 API image and make single-SSD file storage safe

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. Maintain it in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The Raspberry Pi 5 currently receives a signed API container image from GitHub
Container Registry. That transfer can time out on the production connection,
because the compressed Linux ARM64 image is 1,262,151,764 bytes. At the same
time, business PDFs and JPEGs are correctly stored outside containers on the
Pi5 SSD, but each feature implements its own direct file writes. After this work
the API artifact is materially smaller, and durable files are committed
atomically, checked with SHA-256, capacity-guarded, and observable without
changing existing URLs or moving existing files.

The work is deliberately split into two pull requests. PR1 changes only the
release image footprint. PR2 starts from `main` after PR1 is merged and changes
only local file storage. Cloud storage, MinIO, S3, a second SSD, OCR service
separation, and physical movement or deletion of existing files are excluded.

## Progress

- [x] (2026-07-31 13:00+09:00) Confirmed clean `main` at
  `c7e4f9f694b4e10815de9a2cf340668a4562f17c`, synchronized with
  `origin/main`.
- [x] (2026-07-31 13:05+09:00) Created branch
  `perf/api-image-footprint`.
- [x] (2026-07-31 13:15+09:00) Re-read repository safety, architecture,
  documentation, test, Git, and ExecPlan rules.
- [x] (2026-07-31 13:25+09:00) Reconfirmed the API runtime boundary, OCI
  budget validator, Playwright availability probe, production dependency
  installation, and backup Ansible usage.
- [x] (2026-07-31 13:37+09:00) Implemented PR1 runtime dependency filtering,
  headless-shell-only Playwright, the real cached availability probe, and
  tighter OCI gates.
- [x] (2026-07-31 13:48+09:00) Built and inspected the exact local ARM64 OCI,
  then ran Ansible, OCR, Prisma, Poppler, Tesseract.js, screenshot, and PDF
  smoke tests in that image.
- [x] (2026-07-31 14:01+09:00) Applied all 157 migrations to a uniquely named
  tmpfs PostgreSQL container, confirmed `migrate status`, and passed all 2,492
  enabled API tests; the run-owned container and temporary files were removed
  by the exit trap.
- [x] (2026-07-31 14:07+09:00) Passed workspace lint, API and Web production
  builds, release-image unit contracts, and the complete local deployment
  contract suite, including its isolated PostgreSQL integration.
- [ ] Commit, push, open, and merge PR1 only after hosted gates pass.
- [ ] Create `feat/local-file-storage-safety` from the merged `main`.
- [ ] Implement PR2 storage port, local adapter, integrity catalog, health and
  capacity guard, scheduler backfill, Compose mounts, and documentation.
- [ ] Validate, commit, push, and open PR2.
- [ ] Present immutable SHA, CI, impact, and print-plan evidence before any
  production deployment.

## Surprises & Discoveries

- Observation: The active production image is large mainly because it contains
  two Chromium variants, Debian's Ansible community collections, Python OCR
  dependencies, and production dependencies for every pnpm workspace.
  Evidence: `/ms-playwright` is about 901 MB unpacked,
  `/usr/lib/python3/dist-packages/ansible_collections` about 499 MB, and
  `/app/node_modules` about 549 MB in the active image.

- Observation: The API uses only headless Playwright launches, but its health
  probe calls `chromium.executablePath()`, which points at full Chromium rather
  than proving that the headless shell can launch.
  Evidence: all API calls use `chromium.launch({ headless: true })`; the probe
  in
  `apps/api/src/services/signage/loan-grid/playwright/playwright-chromium-availability.ts`
  only performs a filesystem access check.

- Observation: `ansible-core` does not provide the archive action used by the
  directory-backup playbook.
  Evidence: the exact runtime returned `couldn't resolve module/action
  'ansible.builtin.archive'`. Replacing that one action with
  `ansible.builtin.command` and an argument-vector `tar` invocation allowed
  syntax-check and a real localhost archive/fetch smoke to pass without
  community collections.

- Observation: Filtering pnpm by the API dependency closure reduced the
  production install from 850 packages to 320 packages.
  Evidence: the exact Docker build logged `Scope: 4 of 5 workspace projects`
  and `+320`; runtime resolution confirmed `react-dom` and `recharts` were
  absent.

- Observation: Business media is already bind-backed outside containers, so
  this work requires no physical migration.
  Evidence: production Compose maps host paths below
  `/opt/RaspberryPiSystem_002/storage` to `/app/storage/*`.

- Observation: The monthly cleanup is a Docker build-cache cleanup, not a
  business-file cleanup.
  Evidence: `storage-maintenance.timer` runs daily and
  `scripts/server/storage-maintenance.sh` invokes
  `docker builder prune -a --force` only on day 1.

- Observation: Running the full API suite without an explicit test database
  produces broad Prisma connection failures because the test bootstrap
  defaults to `localhost:5432`.
  Evidence: the diagnostic run failed 53 files with `Can't reach database
  server`; the same suite passed 473 files and 2,492 tests after applying all
  migrations to the isolated disposable database.

## Decision Log

- Decision: Use two sequential PRs and merge PR1 before branching PR2.
  Rationale: A release-image rollback and a storage-behavior rollback must stay
  independent.
  Date/Author: 2026-07-31 / Codex and user.

- Decision: Keep OCR libraries in-process in PR1.
  Rationale: Removing or separating them changes production behavior and was
  not authorized; adequate savings are available from duplicate Chromium,
  Ansible collections, and Web-only Node dependencies.
  Date/Author: 2026-07-31 / Codex and user.

- Decision: Keep existing business files in place and add sidecar integrity
  metadata instead of a generic database table.
  Rationale: A filesystem catalog avoids coupling unrelated domains, survives
  a future mount replacement, and requires no production data migration.
  Date/Author: 2026-07-31 / Codex and user.

- Decision: Implement directory archiving with Core's `command.argv` and
  `tar`, not by adding the large community collection back.
  Rationale: Argument-vector execution preserves paths containing spaces,
  avoids shell parsing, and retains the existing archive/fetch/cleanup
  behavior with Ansible Core only.
  Date/Author: 2026-07-31 / Codex.

- Decision: Preserve the day-1 Docker build-cache prune unchanged.
  Rationale: It is already scoped to unused build cache and is independent of
  business-file retention.
  Date/Author: 2026-07-31 / Codex and user.

## Outcomes & Retrospective

PR1 implementation and local artifact validation are complete. The exact
local ARM64 OCI is 845,913,117 compressed bytes across 26 layers, its largest
layer is 530,496,867 bytes, and the reduction from baseline is 32.98 percent.
The runtime retained and exercised every scoped capability. Prisma validation,
generation, all 157 migrations, current status, all 2,492 enabled API tests,
workspace lint, API and Web builds, and deployment contracts pass locally.
Hosted CI and PR integration remain. No production system, database, business
file, or existing Docker resource has been changed by this work.

## Context and Orientation

`infrastructure/docker/Dockerfile.api` builds the API. Its named
`api-runtime` stage contains OS, Python OCR, Node production dependencies, and
Playwright; application source is copied only afterward so ordinary releases
reuse the heavy layers. `.github/workflows/ci.yml` builds an exact Linux ARM64
image and `scripts/ci/validate_release_image_budget.py` reads its raw OCI
manifest. An OCI manifest is registry metadata listing compressed filesystem
layers and their exact byte sizes.

The API uses Playwright from the signage rasterizer and kiosk document
HTML-to-PDF adapter. Both obtain a shared headless browser from
`apps/api/src/services/signage/loan-grid/playwright/playwright-browser-pool.ts`.
The startup and `/api/system/health` availability check is in the adjacent
`playwright-chromium-availability.ts`.

Durable files are implemented by static helpers below `apps/api/src/lib`,
including photo, PDF, part-measurement drawing, assembly procedure,
measuring-instrument genre, pallet illustration, and CSV dashboard storage.
These helpers currently create feature directories and call Node filesystem
functions directly. Production Compose exposes separate bind-backed named
volumes under `/app/storage`. Generated PDF pages and signage renders are
caches; the other listed namespaces are durable business data.

The existing scheduler startup obtains a PostgreSQL advisory lock before
starting recurring work. An advisory lock is a database-owned mutex identified
by a numeric key. PR2 will use that same leader boundary so candidate and
standby API instances do not scan the same files.

## Plan of Work

Milestone 1 produces PR1. Tighten the OCI policy to 1,000,000,000 total
compressed bytes, 700,000,000 bytes for the largest layer, and 40 layers. Add
contracts proving that the runtime installs `ansible-core` without recommended
community collections, installs only API production workspace dependencies,
and installs `chromium-headless-shell` without full Chromium. Replace the
synchronous path check with one cached asynchronous probe that launches and
closes a headless browser; startup and health await it. Preserve the named
runtime boundary and every release signing, digest, promotion, Blue/Green, and
fallback contract. Build the production image and prove that its exact OCI
manifest is at least 20 percent smaller than the 1,262,151,764-byte baseline.
Do not remove OCR capability to satisfy the budget.

Milestone 2 starts only after PR1 is merged. Add
`apps/api/src/services/file-storage` with a `DurableFileStorePort`,
`LocalDurableFileStore`, `FileStorageIntegrityCatalog`, and
`FileStorageHealthService`. Durable namespaces are photos, thumbnails, PDFs,
part-measurement drawings, assembly procedure images, measuring-instrument
genre images, pallet-machine illustrations, and CSV dashboards. Existing
helpers and HTTP URLs remain stable and delegate to the adapter.

The local adapter rejects absolute paths, NUL, `..`, and symlink escapes. It
writes a same-directory exclusive temporary file, flushes it, reads it back,
checks SHA-256, renames it atomically, and flushes the parent directory.
Failure removes only the run-owned temporary file. Multi-file photo writes
stage all files before committing them. Generated caches use the atomic writer
but do not receive integrity manifests.

Integrity records live below
`.integrity/v1/objects/<first-two-hex>/<sha256-of-storage-key>.json` and contain
the version, storage key, content SHA-256, byte size, and timestamps. New
durable writes always update the record atomically. Existing files without
records warn during bootstrap. A record mismatch never repairs data and raises
`FILE_STORAGE_INTEGRITY_MISMATCH`.

The existing scheduler leader performs an incremental, concurrency-one
backfill with a 2 GiB per-run byte budget and progress in
`.integrity/v1/state.json`. It never changes source bytes, names, locations, or
timestamps. A complete zero-mismatch scan records completion and makes records
mandatory for all durable namespaces. Candidate and standby instances do no
work.

Use `FILE_STORAGE_ROOT=/app/storage` as the canonical container root. Retain
legacy directory settings as validated compatibility aliases. Add the missing
CSV dashboard bind. Startup performs a bounded create, flush, read, hash, and
delete probe plus `statfs`; production startup fails if durable storage is
unavailable. Before writes, reserve the greater of 5 GiB or 5 percent of the
filesystem. Map capacity exhaustion to HTTP 507
`FILE_STORAGE_CAPACITY_EXHAUSTED`, unavailable storage to HTTP 503
`FILE_STORAGE_UNAVAILABLE`, and integrity mismatch to HTTP 503
`FILE_STORAGE_INTEGRITY_MISMATCH`. Add a redacted `checks.fileStorage` object
to `/api/system/health`.

Document the single-disk decision in a new ADR, operational verification and
recovery in a runbook, PR1 measurements in KB-404, and add only thin index
links. Do not claim that integrity metadata is a backup.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

For PR1, run focused unit and contract tests, then build the exact production
target locally:

    pnpm --filter @raspi-system/api test -- playwright-chromium-availability
    python3 -m unittest scripts.ci.tests.test_release_image_budget
    python3 -m unittest scripts.ci.tests.test_release_image_workflow
    docker buildx build --platform linux/arm64 \
      --file infrastructure/docker/Dockerfile.api \
      --target api --output type=oci,dest=<unique-temp-path> .

Inspect the generated OCI manifest with
`scripts/ci/validate_release_image_budget.py`. Temporary artifacts use unique
names and are deleted after evidence is captured.

For PR2, start a uniquely named `pgvector/pgvector:pg15` container with an
automatically assigned loopback port and tmpfs data directory. Never connect to
an existing database or container. Apply all migrations, run `migrate status`,
then execute storage and route tests serially. A shell trap removes the
run-owned container, volume, and network, and postflight listing proves no
resource with the run prefix remains.

Before each commit run:

    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/api build
    git diff --check

Push only the named feature branch and create one PR per milestone. Production
deployment is not run until the immutable SHA, CI result, affected scopes, and
the standard orchestrator print-plan are presented for the required production
approval.

## Validation and Acceptance

PR1 is accepted when the exact ARM64 OCI image has at most 40 layers, at most
1,000,000,000 compressed bytes total, no layer over 700,000,000 bytes, and is
at least 20 percent smaller than the baseline. The image must not contain full
Chromium, Ansible community collections, React DOM, or Recharts. It must run
the backup playbook with builtin modules, launch headless Playwright, render a
screenshot and PDF, run Prisma, Poppler, NDLOCR, RapidOCR, and TesseractJS, and
pass all release contracts.

PR2 is accepted when existing routes return the same URLs and bytes, durable
writes survive injected partial failures without corrupting old content,
unsafe paths and symlink escapes fail, and low capacity returns the specified
typed 507. A known checksum mismatch returns the specified typed 503 and is not
repaired. A repeatable backfill leaves source bytes and mtimes unchanged,
resumes from state, runs only on the scheduler leader, and reaches zero missing
records and zero mismatches for the test fixture. Compose config shows every
durable namespace on the existing host root, including CSV dashboards.

The full API and Web lint/build suites, relevant storage integration tests,
all current Prisma migrations on the disposable database, deployment
contracts, documentation checks, and `git diff --check` must pass.

Production acceptance for PR1 additionally requires the signed, exact promoted
API artifact to reach Pi5 inside the existing 1,200-second pull budget. A local
build fallback remains a safe recovery path but does not satisfy this
performance acceptance. Production acceptance for PR2 requires a healthy
redacted file-storage check, unchanged existing routes, completed backfill,
zero missing records, zero mismatches, and unchanged original files.

## Idempotence and Recovery

Both PRs are additive or replace runtime packaging without data migration.
PR1 rolls back by selecting the previous signed API image. PR2 sidecar files
are ignored by the previous API, so code rollback requires no deletion. No
down migration exists. Backfill is cursor-based and safe to retry; it creates a
missing manifest only after hashing the source and never overwrites a mismatch.
Temporary files and disposable Docker resources are owned by a unique run and
cleaned without pruning shared resources.

The monthly `docker builder prune -a --force` remains unchanged and never
targets the bind-mounted storage root. No implementation command moves or
deletes production business files.

## Artifacts and Notes

Initial production measurements:

    Pi5 filesystem: 917G total, 195G used, 685G available (23% used)
    Durable/generated storage: 1,541 files, approximately 163M
    API OCI baseline: 1,262,151,764 compressed bytes, 26 layers
    Largest compressed API layer: 749,486,673 bytes

Expected PR1 gate output has this form:

    release image budget ok: layers=<n> totalBytes=<n<=1000000000> largestLayerBytes=<n<=700000000>

## Interfaces and Dependencies

PR1 preserves the current public API. The availability function becomes:

    probePlaywrightChromiumAvailability(): Promise<PlaywrightChromiumAvailability>

It caches both an in-flight probe and its result, launches with
`chromium.launch({ headless: true })`, closes the probe browser, and returns no
unbounded exception detail from the health endpoint.

PR2 defines a filesystem-independent durable store boundary. Its operations
accept an enumerated namespace, a validated relative key, bytes, and an
explicit create-or-replace mode. It returns immutable metadata containing the
storage key, SHA-256, and byte size. Storage-specific Node filesystem calls
remain inside the local adapter and integrity catalog. Routes and feature
helpers depend on the port, not the concrete adapter.

Revision note (2026-07-31): Created the combined two-PR ExecPlan after
reconfirming the clean production baseline and approved single-SSD constraints.

Revision note (2026-07-31 13:50+09:00): Recorded the completed PR1
implementation, exact OCI evidence, the Ansible Core archive discovery and
safe replacement, and the remaining hosted integration work.
