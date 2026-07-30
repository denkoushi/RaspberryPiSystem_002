---
id: plan-api-image-runtime-boundary
status: in_progress
scope: bounded Pi5 API artifact growth and completion of the first large GHCR pull
date: 2026-07-30
source_of_truth: this document
related_code:
  - infrastructure/docker/Dockerfile.api
  - scripts/deploy/pi5_artifact_promoter.py
  - scripts/ci/build_release_image.py
  - .github/workflows/ci.yml
related_docs:
  - ../knowledge-base/KB-404-pi5-ghcr-api-image-pull-timeout.md
  - ./artifact-pull-progress-diagnostics-execplan.md
validation:
  - focused Python contracts
  - production API Docker build and OCI manifest budget
  - disposable PostgreSQL deploy contracts
open_items:
  - publish one Draft PR and pass required CI
  - merge and production deployment require separate approval
---

# Bound the API runtime image before introducing new worker services

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. This document follows `.agent/PLANS.md`.

## Purpose / Big Picture

The first signed API artifact pull on the production Pi5 observed a compressed
total of 1,189,680,246 bytes. It downloaded 793,117,215 bytes in 600 seconds
and then safely selected the existing local builder. The transfer was still in
the downloading phase and had not begun extraction. At the observed average of
about 1.32 MB/s, a complete first pull needs roughly fifteen minutes.

The image does not add another 1.2 GB for every source release. Docker stores
content-addressed filesystem layers, and the current Dockerfile places release
metadata after all filesystem changes. Unchanged OCR, Chromium, and production
dependency layers are shared. The Blue/Green coordinator also removes retired
run-owned tags after proving that no container or rollback slot references
them.

This change makes that scaling property explicit and fail-closed. The heavy,
source-independent runtime becomes a named Docker build stage. Application
source enters only after that boundary. CI rejects an API OCI manifest whose
compressed size, largest layer, or layer count exceeds a reviewed allowance.
The API pull receives enough time to finish once over the measured production
link, while the existing progress evidence, signature checks, local fallback,
Blue/Green switch, five-minute observation, and rollback remain unchanged.

This is not a microservice split. Extracting OCR or Chromium into a separately
running service would add internal authentication, transport, health,
version-pairing, Blue/Green ownership, and rollback state. That work remains a
later decision if the bounded runtime still grows or workload isolation becomes
necessary.

## Progress

- [x] (2026-07-30) Confirmed clean current `main`, created
  `perf/api-image-runtime-boundary`, and recorded the implementation boundary
  before code changes.
- [x] (2026-07-30) Traced the heavy runtime dependencies and consumers. The
  API image contains NDLOCR-Lite/RapidOCR/ONNX, Tesseract.js, Playwright
  Chromium, PDF tooling, and the normal Fastify application. OCR already uses
  Port/Adapter boundaries, while Chromium is shared by signage rasterization
  and kiosk HTML-to-PDF.
- [x] (2026-07-30) Confirmed that the release set, promoter, candidate evidence,
  Blue/Green state, and rollback currently seal one API/Web pair. Adding a new
  running worker now would require a new versioned release and rollback
  contract rather than a local Dockerfile edit.
- [x] (2026-07-30) Added failing contracts for the named runtime boundary, OCI manifest
  budget, and distinct API/Web pull timing.
- [x] (2026-07-30) Implemented the Docker boundary, size-budget validator, CI gate, and timing
  policy without changing integrity or fallback decisions.
- [x] (2026-07-30) Passed 35 focused contracts, 55 CI contracts, all 926
  Deploy Python contracts, an exact production OCI manifest check, and real
  runtime/final Docker builds and smoke checks.
- [x] (2026-07-30) The common Deploy runner passed its real maintenance
  container, all 156 disposable PostgreSQL migrations, current migration
  status, zero migration anomalies, deploy-status API 20 tests,
  `ClientDevice.apiKey` index scan, rollback, inventory, and Ansible syntax
  checks. Documentation inventory and whitespace checks are current.
- [ ] Publish one commit with one push and one Draft PR. Do not merge or deploy.

## Surprises & Discoveries

- Observation: the largest filesystem instruction is intentionally stable but
  currently combines operating-system packages, OCR engines, and browser
  libraries in one large layer.
  Evidence: `infrastructure/docker/Dockerfile.api` installs the apt packages,
  NDLOCR-Lite, RapidOCR, and ONNX in one `RUN`; Chromium and production Node
  dependencies are later stable layers. The application build artifacts are
  copied only after those dependencies.

- Observation: a historical release-metadata placement once invalidated the
  heavy layers, but the current Dockerfile has already corrected that defect.
  Evidence: both OCI labels are now after the final filesystem instruction,
  and hosted Docker security rebuilds the image with different provenance
  values and requires identical `RootFS.Layers`.

- Observation: before this change, the pull timeout was shared by API and Web
  even though only the API artifact approaches one gigabyte.
  Evidence: the former
  `PromotionTimingPolicy.image_pull_timeout_seconds=600` was passed to both
  `api-image-pull` and `web-image-pull`; the measured API transfer had reached
  only 66.7 percent when that allowance expired.

- Observation: immediate process separation would expand the trusted release
  unit.
  Evidence: release-set schema version 1 contains exactly API and Web, the
  candidate state seals two image IDs, and both Blue/Green slots validate and
  roll back that pair atomically.

- Observation: merely naming the old first stage `api-runtime` did not create
  a reusable boundary.
  Evidence: the runtime target still copied manifests from a completed stage
  that also compiled application source. Splitting a dependency-only
  `workspace` stage from the `build` stage reduced the runtime-target build
  context to 668 bytes and removed application compilation from that target.

- Observation: the exact production Linux ARM64 child manifest is larger than
  the Docker progress target observed during the timed-out pull.
  Evidence: the immutable OCI manifest contains 26 layers totaling
  1,262,151,764 compressed bytes; Docker reported 1,189,680,246 bytes for the
  active transfer. CI therefore budgets the authoritative manifest, not the
  progress denominator.

## Decision Log

- Decision: introduce a named immutable API runtime build stage before creating
  any new network worker.
  Rationale: this makes source/dependency ownership testable, preserves the
  current public API and rollback pair, and creates the future boundary for a
  separately prefetched base or worker without changing production behavior.
  Date/Author: 2026-07-30 / Codex.

- Decision: use separate API and Web pull allowances: API 1,200 seconds, Web
  600 seconds, and a 1,500-second promotion budget.
  Rationale: the measured first API pull needs about fifteen minutes at the
  observed rate. Twenty minutes allows bounded variation; twenty-five minutes
  leaves time for the small release set, attestations, Web image, and
  inspection. The existing fallback still handles unavailability, while
  integrity mismatch still stops.
  Date/Author: 2026-07-30 / Codex.

- Decision: enforce an OCI compressed-size budget in CI rather than assuming
  layer reuse will remain correct.
  Rationale: a reviewed absolute ceiling makes future dependency growth
  visible at the PR that introduces it. The validator must consume the exact
  pushed manifest, not local uncompressed `docker history`.
  Date/Author: 2026-07-30 / Codex.

- Decision: defer OCR/Chromium service extraction.
  Rationale: the first production problem is an incomplete initial transfer,
  not demonstrated runtime contention or independent failure demand. A service
  split is justified only after the bounded image and completed first pull are
  measured, because it changes health, security, release-set, and rollback
  contracts.
  Date/Author: 2026-07-30 / Codex.

## Outcomes & Retrospective

The runtime and growth boundaries are implemented. A dependency-only
`workspace` feeds both the TypeScript build and `api-runtime`; application
artifacts, Prisma generation, and release labels occur only after the runtime
boundary. A real final image retained compiled API code, NDLOCR-Lite,
RapidOCR, Tesseract.js, Playwright Chromium, Prisma Client, and the expected
runtime paths.

The exact production Linux ARM64 child manifest passed the new validator with
26 layers, 1,262,151,764 total compressed bytes, and a 749,486,673-byte largest
layer. The `api-runtime` image's nineteen RootFS layers were the exact prefix
of the final image's twenty-eight RootFS layers. Focused contracts, all CI
unit contracts, and all Deploy Python contracts passed. The common runner also
applied all 156 migrations to a disposable PostgreSQL instance, reported a
current migration status with no anomalies, used
`ClientDevice_apiKey_key` in 0.013 ms under
`EXPLAIN (ANALYZE, BUFFERS)`, passed 20 deploy-status API tests and all
Ansible/rollback checks, and removed its run-owned container, volume, and
network. Hosted CI, publication, and production acceptance remain.

## Context and Orientation

`infrastructure/docker/Dockerfile.api` builds the API. Its first stage compiles
TypeScript and shared packages. Its final stage installs operating-system,
Python OCR, production Node, and Chromium dependencies before copying the
compiled application. Release OCI labels intentionally occur at the end.

`.github/workflows/ci.yml` calls
`scripts/ci/build_release_image.py` to publish the exact ARM64 API digest.
After the build, CI pulls and scans that digest. The new size gate belongs
between the exact digest creation and security scan so it evaluates the
artifact that production will receive.

`scripts/deploy/pi5_artifact_promoter.py` verifies the signed release set,
attestations, source SHA, configuration hash, architecture, and image digests.
It records Docker Engine byte progress every thirty seconds. Availability
failures select the existing local builder; integrity failures stop before
traffic switching. Only timing values and the choice of API versus Web
allowance change here.

`scripts/deploy/pi5-image-deploy.sh` and `scripts/deploy/pi5-blue-green.sh`
remain the authorities for candidate validation, inactive-slot preparation,
traffic switching, five-minute monitoring, rollback, and retired-tag cleanup.

## Plan of Work

First add pure tests that require `PromotionTimingPolicy` to expose separate
API and Web values and preserve the total budget. Extend promoter tests so the
API pull receives 1,200 seconds and the Web pull remains at 600 seconds, using
injected clocks and fake pullers rather than real waits.

Create `scripts/ci/validate_release_image_budget.py`. It will parse an OCI image
manifest from standard input with duplicate-key detection, bounded input size,
exact digest/media/size validation, and no network or Docker access. For the
API policy, reject compressed totals above 1,400,000,000 bytes, any single
layer above 850,000,000 bytes, or more than forty layers. These limits provide
about eleven percent headroom over the authoritative
1,262,151,764-byte manifest and its 749,486,673-byte largest layer. The script
prints only bounded counts and sizes.

Refactor `Dockerfile.api` so a named `api-runtime` stage ends after production
dependencies, Chromium, stable directories, and cache cleanup. A final `api`
stage inherits it, copies only application/shared-package artifacts and
scripts, regenerates Prisma, and then applies release labels. Add a static
contract test that rejects application source copies, release labels, or
release SHA inside `api-runtime`.

Wire the exact-digest manifest into the CI validator after the ARM64 API build.
The command must inspect the immutable digest and pipe only its raw manifest to
the pure validator. Add workflow tests for exact-digest use and fail-closed
ordering.

Update KB-404 with the confirmed size/rate evidence and this bounded response.
Record the scaling decision in a small ADR, and link both from the thin
document indexes. Do not copy the complete incident narrative into the ADR or
index.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Run focused contracts first:

    python3 -m unittest scripts/deploy/tests/test_pi5_artifact_promoter.py
    python3 -m unittest scripts/ci/tests/test_release_image_budget.py
    python3 -m unittest scripts/ci/tests/test_release_image_workflow.py

Build the production API image and validate its exact local OCI manifest or an
equivalent Buildx-produced manifest against the same pure budget. Rebuild with
different provenance labels and prove filesystem layers remain identical.

Run all deployment contracts with the repository's Node 22/pnpm 9-compatible
environment:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

The common runner may create only its unique loopback PostgreSQL container,
volume, and network. It must apply every migration, report current migration
status, query migration anomalies, run the `ClientDevice.apiKey`
`EXPLAIN (ANALYZE, BUFFERS)`, pass deploy/readiness/rollback/Ansible contracts,
and remove all run-owned resources on success, failure, INT, and TERM. Existing
containers, volumes, networks, databases, and BuildKit cache are not modified.

After all checks pass, stage only files named by this plan, make one
conventional commit, push once, and create one Draft PR targeting `main`.

## Validation and Acceptance

The runtime-boundary test must fail if application source, scripts, Prisma
generation, or release metadata moves above the named boundary. The final API
image must still contain NDLOCR-Lite, RapidOCR, Tesseract.js, Chromium,
compiled API code, Prisma client, and the existing storage paths.

The manifest-budget tests must cover valid multi-layer manifests, oversize
total, oversize single layer, excess layer count, duplicate keys, non-integer
and boolean sizes, negative sizes, malformed digest, unknown fields, oversized
input, and an index/list instead of a single ARM64 image manifest.

Promoter tests must prove API 1,200 seconds, Web 600 seconds, total 1,500
seconds, thirty-second heartbeat, structured timeout evidence, cleanup, local
fallback for availability, and fail-closed integrity mismatch.

No public HTTP API, database schema, migration, API/Web application behavior,
Compose runtime service, notification, canary, terminal order, five-minute
monitor, or rollback behavior changes.

Production acceptance is separate. A future explicitly approved Pi5-changing
release must finish the exact signed API pull as `promoted`, or retain bounded
progress and use the existing safe fallback. A same-SHA plan must remain a
no-op. That production run is not authorized by this plan.

## Idempotence and Recovery

Pure tests have no external effects. Docker validation uses only unique tags
and removes only those tags/containers; it never prunes shared BuildKit cache.
The PostgreSQL runner already traps EXIT, INT, and TERM and verifies zero
run-owned resources.

If the API pull still fails within 1,200 seconds, the current local builder
fallback remains authoritative. Reverting this change restores the old timing
values and Dockerfile layout without a database or public-contract migration.
No running service depends on the named build-stage label.

## Artifacts and Notes

The OCI size validator accepts only the raw single-platform manifest containing
`schemaVersion`, `mediaType`, `config`, and `layers`. A successful result is a
short line such as:

    release image budget ok: layers=26 totalBytes=1262151764 largestLayerBytes=749486673

It must not print registry credentials, URLs, image tags, or arbitrary manifest
annotations.
