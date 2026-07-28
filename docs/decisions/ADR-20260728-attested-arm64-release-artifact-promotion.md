---
id: ADR-20260728-attested-arm64-release-artifact-promotion
title: Attested ARM64 API/Web release artifact promotion
status: accepted
date: 2026-07-28
source_of_truth: true
scope: CI publication and Pi5 acquisition of one immutable API/Web release pair
related_code:
  - .github/workflows/ci.yml
  - scripts/deploy/release_build_contract.py
  - scripts/deploy/release_artifact_contract.py
  - scripts/deploy/pi5_artifact_promoter.py
  - scripts/deploy/pi5-image-deploy.sh
related_docs:
  - ../plans/deploy-workflow-artifact-promotion-execplan.md
  - ../plans/deploy-workflow-safe-shortening-execplan.md
  - ../guides/ci-branch-protection.md
  - ../guides/deployment.md
validation: pure contract tests, workflow policy tests, deployment contracts, isolated ARM64 Docker exercise, and required hosted CI
open_items:
  - deployment and real-device timing require separate explicit approval
---

# ADR-20260728: Attested ARM64 API/Web release artifact promotion

## Status

Accepted for implementation. Production enablement, merge, and device access
require a separate explicit approval.

## Context

Phase 1 retained the safe Pi5 candidate build. In the measured production run,
that build occupied about fifteen minutes after the exact main SHA and
production build inputs were already known. CI also built images, but its
x86-64, load-only images used dummy provenance and could not safely become a
production candidate.

The existing release contract treats API and Web as one candidate pair. It
also requires exact source and configuration identity before Blue/Green
preparation, followed by health checks, traffic switch, a five-minute stability
monitor, and rollback evidence.

## Decision

For a change that can affect the production API/Web image, the exact main-push
CI may build API and Web in parallel on native Linux ARM64 runners. A pure,
allowlisted build contract supplies the same non-secret Docker arguments used
by the Pi5 builder. Each image is pushed and scanned by immutable digest.

After `ci-required`, `codeql`, and `gitleaks` succeed for the exact source SHA,
CI publishes and attests one release-set OCI image. Its strict schema binds:

- the trusted repository, main ref, source SHA, and workflow;
- the complete build-configuration hash;
- Linux ARM64;
- the exact allowlisted API and Web repositories and digests; and
- the producing workflow run and attempt.

Pi5 promotion is an opt-in adapter before the accepted local builder. It uses a
run-scoped Docker authentication directory, verifies GitHub attestations and
the release-set schema, pulls each image by digest, verifies platform and OCI
labels, and retags the pair to existing run-scoped candidate names. It cannot
run migrations, prepare a slot, switch traffic, deploy terminals, or decide
rollback.

A release set that is absent or unreachable permits the unchanged local build.
Disabled promotion also uses the local build. Once signed content is
discovered, a signature, source, configuration, platform, repository, digest,
schema, or label mismatch is terminal and never falls back.

The shared server default remains disabled. An explicitly approved production
host may opt in without changing other server inventories. Public OCI pulls
need no registry login. GitHub CLI still requires a nonempty `GH_TOKEN` before
it will execute `--bundle-from-oci`, even though that mode verifies the public
OCI bundle without an API credential. The verifier therefore runs with an
isolated temporary config and an inert fixed token when no real token is
configured. A real optional read-only credential remains supported for private
packages and is passed only through stdin or a child-process environment. It
is stored in a root-owned mode-0640 policy readable only by the trusted release
runner group, and is excluded from state, command arguments, and logs.

The verifier and registry are deliberately not new fleet-readiness gates.
Making registry reachability mandatory would remove the local builder's
availability fallback. When promotion is enabled, Ansible installs an
immutable upstream ARM64 GitHub CLI package pinned by version and published
SHA-256, then proves that every required attestation-policy option is present
before candidate preparation. Runtime registry transport absence is recorded
as unavailable and uses the accepted local path. Package checksum or
capability mismatches stop during configuration convergence; discovered
artifact integrity failures still stop.

## Consequences

Image creation moves ahead of an explicitly approved deployment and can overlap
main CI. The deployment retains one API/Web identity and all existing
migration, load, health, Caddy, Blue/Green, notice, canary, serialization,
stability, rollback, and same-SHA contracts.

The publication jobs have package and attestation write authority only on an
exact `push main`. Pull requests keep the existing non-publishing Docker
security jobs. Unknown paths and unsafe diff conditions continue to select the
full suite and a release pair.

Production may remain on the Phase 1 local builder indefinitely by leaving the
opt-in false. Disabling promotion is the recovery action for availability
problems; integrity failures require investigation rather than bypass.

## Alternatives Considered

Cross-building on x86 runners was rejected because native ARM64 removes
emulation ambiguity. Promoting independently tagged API or Web images was
rejected because it breaks pair identity. Mutable tags without attestations
were rejected because they do not bind bytes to source and configuration.
Removing the local builder was rejected because it would make GHCR a new
single point of failure.
