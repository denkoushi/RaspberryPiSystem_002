---
id: ADR-20260730-bounded-api-runtime-artifact
title: Bound and reuse the Pi5 API runtime artifact before service extraction
status: accepted
date: 2026-07-30
source_of_truth: true
scope: API Docker runtime boundary, exact OCI size budget, and Pi5 promotion timing
related_code:
  - infrastructure/docker/Dockerfile.api
  - scripts/ci/validate_release_image_budget.py
  - scripts/deploy/pi5_artifact_promoter.py
  - .github/workflows/ci.yml
related_docs:
  - ../plans/api-image-runtime-boundary-execplan.md
  - ../plans/pi5-api-image-local-storage-scalability-execplan.md
  - ../knowledge-base/KB-404-pi5-ghcr-api-image-pull-timeout.md
  - ./ADR-20260728-attested-arm64-release-artifact-promotion.md
validation: exact ARM64 OCI manifest, runtime/final Docker smoke, pure contracts, disposable PostgreSQL, and required hosted CI
open_items:
  - production promotion requires separate approval
---

# ADR-20260730: Bound and reuse the Pi5 API runtime artifact before service extraction

## Context

The signed production API artifact contains the normal API plus OCR engines,
ONNX Runtime, Tesseract.js, Playwright Chromium, and PDF tooling. Its exact
Linux ARM64 OCI image is 1,262,151,764 compressed bytes across 26 layers. The
first production pull averaged about 1.32 MB/s and reached only 66.7 percent
under the former 600-second allowance.

Docker does not store another full image for every release. Unchanged
content-addressed layers are shared. The remaining risks are accidentally
invalidating the heavy layers, allowing dependency growth without review, and
choosing a timeout below the observed first-transfer time.

Splitting OCR or Chromium into a running service now would also expand the
trusted release unit. It requires version pairing, internal authentication,
transport, health, Blue/Green ownership, and rollback contracts beyond the
current atomic API/Web release pair.

## Decision

Create an explicit `api-runtime` Docker stage containing production operating
system packages, OCR engines, production Node dependencies, and Chromium.
Application build output, Prisma generation, and release metadata enter only
in the final `api` stage. Static contracts prevent application source or
release identity from moving above that boundary.

Inspect the exact pushed Linux ARM64 OCI manifest in CI. The initial boundary
used 1,400,000,000 total compressed bytes and an 850,000,000-byte largest
layer. The approved 2026-07-31 footprint follow-up replaces those limits with
1,000,000,000 total compressed bytes and a 700,000,000-byte largest layer,
while retaining the forty-layer limit. The validator is pure, bounded, rejects
duplicate or unknown data, and never reads credentials or mutable tags.

The follow-up keeps the same runtime boundary while installing only API
production workspace dependencies, Debian `ansible-core` without recommended
community collections, and Playwright's headless shell without full Chromium.
The one directory-backup task that depended on the non-Core archive module
uses `ansible.builtin.command` with an argument vector to invoke `tar`; fetch,
failure handling, and cleanup remain Core modules. The Playwright health probe
launches and closes the real headless browser once and caches the result.

Give API image pull 1,200 seconds, keep Web image pull at 600 seconds, and bound
the complete promotion at 1,500 seconds. Release-set and ordinary command
limits remain 120 and 300 seconds. Thirty-second progress, exact-digest and
attestation verification, cleanup, local-build fallback for availability, and
fail-closed integrity behavior remain unchanged.

Defer a separately running OCR/Chromium worker. Reconsider it only after the
bounded first pull is proven in production or evidence shows that independent
runtime scaling or fault isolation is required.

## Consequences

A slow initial API pull may occupy up to twenty minutes, but it no longer
performs ten minutes of transfer only to repeat work in the local builder.
Subsequent releases reuse unchanged heavy layers, and any meaningful OCI growth
requires an explicit reviewed budget change.

The exact local ARM64 OCI evidence after the follow-up is 845,913,117
compressed bytes across 26 layers, with a 530,496,867-byte largest layer. This
is a 32.98 percent reduction from the recorded baseline. PR #1135 merged as
`09fe5a9d0fd1e44aa7fcaafb5d34b0e1da7a0b21`, and main CI run `30606390289`
passed the release API image and release-set gates. The separately approved
production pull is still required before claiming the network-timeout issue is
resolved.

At this decision's adoption, no HTTP API, database, migration, Compose runtime
service, Blue/Green pair, terminal order, canary, monitor, or rollback behavior
changed. The monitor's current bound is owned by the deployment guide. Main
merge and production verification remain separately authorized.

## Alternatives Considered

An unlimited timeout was rejected because registry availability must remain
bounded. Increasing the allowance without a size gate was rejected because it
would conceal future growth. Immediate service extraction was rejected because
the observed incident is an initial-transfer problem, while the required
security and rollback contracts for a third runtime do not yet exist.
