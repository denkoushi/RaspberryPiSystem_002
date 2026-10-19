---
id: plan-pi3-signage-artifact-staging
title: Stage one attested Pi3 signage artifact through the production-shaped preflight path
status: in_progress
date: 2026-08-06
source_of_truth: true
scope: Stage 2 acquisition, transfer, target verification, atomic staging, and preflight cleanup only
related_code:
  - scripts/deploy/signage-distribution-artifact.py
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/backends/systemd.py
  - scripts/deploy/rolling_release/terminal_preflight.py
validation:
  - production-shaped filesystem and transport E2E
  - rolling release application and systemd backend contracts
  - one complete deploy-contract run
open_items:
  - merge a clean PR and verify exact-main publication
  - run one approved exact-main Pi3 preflight-only operation
---

# Stage one attested Pi3 signage artifact through the production-shaped preflight path

This ExecPlan is a living document maintained in accordance with
`.agent/PLANS.md`. It is self-contained and records only Stage 2. Stage 3
activation and every production Deploy operation remain forbidden.

## Purpose / Big Picture

Stage 1 publishes one signed immutable OCI image that contains the complete
Pi3 Signage release tar and its external descriptor. Stage 2 proves that the
same acquisition and staging code can fetch that exact image, verify the
registry attestation and all nested digests, transfer the bytes to a Pi3
run-scoped disposable directory, atomically rename the verified directory to
`ready`, and either retain it for a future production caller or remove it with
zero-residue evidence. The public integration uses only the remove-after-proof
mode during `--preflight-only`; no existing Deploy runtime consumes the ready
directory in this stage.

The Stage 1 authority at the start of this plan is source SHA
`e1bcd74d5b114d4a5ee3f54df48b94b1019780c3`, OCI digest
`sha256:fdd8598c9a4b08ec74b917199a47d9262e81a6901176f1e8cbe081f802b553fc`,
artifact tar SHA-256
`a865fe0499fad148eb3fc74799d8d40a9ba9e8a2752aa4d19884019aef7144ce`,
manifest SHA-256
`acdc925b950789b6bece593d7059ab908e100e58a24cadf09786585b4bb7a5ef`,
and payload digest
`c0e796116a089dc586211a039eab88b6dca6970ff7d6959e6d08be14cd04b`.
Stage 2 reuses that format and verifier without changing publication.

## Progress

- [x] (2026-08-06 14:50Z) Confirmed clean local and origin `main` at the Stage
  1 exact SHA, read the repository safety, architecture, test, Git, and
  ExecPlan rules, then created `feat/pi3-signage-artifact-staging`.
- [x] (2026-08-06 15:00Z) Audited the standard preflight route, Pi5 standalone
  execution boundary, terminal SSH transport, Stage 1 verifier, existing GHCR
  credential/verifier installation, and legacy Pi3 source staging path.
- [x] (2026-08-06 15:05Z) Froze the finite Stage 2 mutation boundary, receipt
  schema, structured failure semantics, and public retain=false integration.
- [x] (2026-08-06 15:12Z) Added production-shaped RED E2E and public
  integration contracts, then implemented the single Pi3-only acquire-and-stage
  module and retain=false public preflight boundary.
- [x] (2026-08-06 15:21Z) Made the focused 67 tests green. The only final test
  correction separated the staging root for two intentional cleanup-failure
  cases; it did not change product logic or contracts.
- [x] (2026-08-06 15:23Z) Ran the related 383 contracts successfully.
- [x] (2026-08-06 15:25Z) Invoked the complete local deploy-contract exactly
  once. It stopped at Docker Desktop's containerd metadata database with an
  input/output error after the preceding contracts passed. Classified as a
  local environment failure; it was not retried and produced no product change.
- [ ] Open and merge a normal PR with clean CI, then verify exact-main.
- [ ] Run read-only status/plan and exactly one approved Pi3 preflight-only command.
- [ ] Finish clean without Stage 3, production Deploy, or activeRun mutation.

## Surprises & Discoveries

- Observation: the standard preflight already executes one standalone Python
  source on Pi5 and then reaches only the selected terminals over compressed
  SSH.
  Evidence: `SystemdBackend.preflight_terminals` embeds
  `terminal_preflight.py`; its orchestrator holds the fleet lock and constructs
  the target SSH commands from the canonical target contracts.

- Observation: Pi5 already has the exact registry trust prerequisites needed
  by Stage 2.
  Evidence: the server role installs a pinned ARM64 GitHub CLI, checks
  `--bundle-from-oci`, `--deny-self-hosted-runners`, source digest and source
  ref enforcement, and deploys the release-runner-readable GHCR policy at
  `/etc/raspi-release/artifact-promotion.json`.

- Observation: the custom Signage predicate can be verified and returned as
  structured JSON using the existing CLI.
  Evidence: a read-only verification of the Stage 1 OCI reference returned one
  statement binding the OCI subject to the expected source, artifact, and
  manifest digests.

- Observation: the one permitted local full deploy-contract invocation reached
  the existing Pi5 Blue/Green lifecycle and then Docker Desktop returned
  `input/output error` for its containerd metadata database.
  Evidence: focused 67 and related 383 contracts were green immediately before
  that invocation; no Stage 2 assertion failed. Hosted clean CI remains the
  acceptance authority, and the local command was not retried or repaired.

- Observation: the pre-commit lint hook could not start repository ESLint
  because the local runtime is Node 18 while the repository requires Node 20.9
  or newer, and workspace ESLint installations are absent.
  Evidence: the hook failed with `Unsupported engine` and `MODULE_NOT_FOUND`
  before linting changed files. This is the previously declared local Node
  environment class, so dependencies were not repaired and hosted CI is the
  lint authority.

- Observation: PR secret scan initially classified a diagnostic label containing
  the words `GHCR token response` as a generic API key; no credential bytes were
  present in the diff.
  Evidence: the finding pointed only to the bounded JSON parser call. Renaming
  that diagnostic label avoids the textual false positive without changing
  registry acquisition, validation, or any Stage 2 contract.

## Decision Log

- Decision: implement a separate Pi3-only standalone module rather than alter
  `terminal_preflight.py`, terminal adapters, coordinator, or playbooks.
  Rationale: Stage 2 is a disposable distribution proof. Keeping it after the
  existing preflight passes preserves kiosk/Pi4/Pi5 behavior and prevents any
  production caller from using retain=true before Stage 3.
  Date/Author: 2026-08-06 / Codex

- Decision: read OCI manifests and blobs directly from GHCR instead of pulling
  the image into Docker.
  Rationale: the public preflight may mutate only run-scoped temporary and Pi3
  staging paths. Direct registry reads avoid persistent Docker image state and
  still resolve and bind the exact OCI digest.
  Date/Author: 2026-08-06 / Codex

- Decision: use one target helper from the same Stage 2 module for prepare,
  verify-and-promote, final verification, and cleanup.
  Rationale: tests and SSH production shape then share path validation, tar and
  manifest verification, atomic rename, and residue accounting. Only the raw
  SSH/SCP transport can be replaced in tests.
  Date/Author: 2026-08-06 / Codex

- Decision: call Stage 2 only after every existing standard preflight probe has
  passed and only when `--preflight-only` selected exactly one Signage target.
  Rationale: existing active-run and recovery authority remains visible and
  blocks before disposable staging; normal release submission and every kiosk
  route remain byte-for-byte outside the new operation.
  Date/Author: 2026-08-06 / Codex

## Outcomes & Retrospective

Implementation and local focused validation are complete. PR, hosted CI,
exact-main verification, and the one physical preflight remain. The expected
final outcome is one exact-main preflight receipt proving attested identity,
target transfer, temporary and ready verification, atomic promotion, cleanup,
and zero residue while the display, services, maintenance state, repository,
fleet state, and Pi4/Pi5 evidence remain unchanged.

## Context and Orientation

`scripts/deploy/signage-distribution-artifact.py` is the Stage 1 authority for
the tar, descriptor, manifest, file digests, and modes. It is pure local
filesystem code and must be embedded unchanged into both the Pi5 acquisition
process and Pi3 target helper.

`scripts/deploy/rolling_release/application.py` implements the operator-facing
standard command. It builds the read-only plan and all existing preflight
probes before it either prints the `--preflight-only` JSON or submits a release
unit. Stage 2 may run only in the former branch and only after the existing
aggregate result passes.

`scripts/deploy/rolling_release/backends/systemd.py` is the sole operator-to-
Pi5 execution adapter. It will embed the new source and the Stage 1 verifier
source, validate the request locally, and run it on Pi5 without creating a
release unit.

The new `scripts/deploy/rolling_release/signage_artifact_stage.py` owns the
complete Stage 2 lifecycle. An artifact reference is the immutable Signage
repository plus candidate tag or digest. A target is the existing canonical
host, address, SSH user, and port record. The fixed staging root is
`/var/tmp/raspisystem-signage-stage`; the only Pi3 paths are
`<root>/<runId>/incoming` and `<root>/<runId>/ready`.

## Plan of Work

First add E2E tests that create a real Stage 1 tar and descriptor, feed a
registry-shaped manifest and verified predicate through the real acquisition
identity verifier, copy the actual bytes into a real temporary target
filesystem, invoke the actual target helper, and inspect residue. The first
run must fail because the Stage 2 module and public integration do not exist.

Then implement strict request, artifact, predicate, path, target result, and
receipt parsers. The registry reader resolves a tag to its digest, verifies the
custom attestation with the existing GitHub CLI, downloads only bounded OCI
metadata and layer blobs, and extracts exactly the two Stage 1 files. It rejects
unexpected subjects, platform ambiguity, whiteouts, unsafe layer paths,
duplicate payload members, and all descriptor or predicate disagreement.

The target helper fails if the fixed root, run directory, incoming directory,
or ready directory is a symlink or unexpected pre-existing path. It receives
the two files into `incoming`, invokes the embedded Stage 1 verifier, atomically
renames the directory to `ready`, then invokes the same verifier again. Cleanup
enumerates only the two files and three directories owned by this run and
returns a non-empty, fully checked receipt.

Finally embed the module through the Systemd backend and call it from the
public application only after a passing existing preflight. Add the stage
result to the single JSON report without replacing existing probes, warnings,
or active-run evidence. A Stage 2 failure makes the preflight non-passing and
prevents release submission.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Run the new RED E2E first:

    python3 -m unittest scripts.deploy.tests.test_signage_artifact_stage

After implementation, run that E2E plus application, Systemd backend,
classifier, workflow, and Stage 1 artifact contracts. Run the repository full
deploy-contract command exactly once after focused suites are green; do not
repeat it for local Node or Docker environment failures.

Create a focused PR, wait for clean hosted CI, merge it normally, and capture
the exact main SHA plus Signage OCI and attestation identities. Only then run
the standard status and print-plan commands read-only. Run one standard Pi3
`--preflight-only` command exactly once and do not retry or issue manual cleanup
if it fails.

## Validation and Acceptance

The production-shaped E2E must prove retain=false performs acquisition,
predicate and nested digest verification, actual byte copy, temporary
verification, atomic promotion, ready verification, cleanup, and zero residue.
The retain=true E2E must leave the exact ready bytes for future Stage 3 without
activating them.

Fault E2E must prove interrupted copy has cleanup evidence and changes no
runtime state; digest, manifest, and attestation changes fail before promotion;
symlink, traversal, and collisions fail closed; promote failure remains
distinct; cleanup failure cannot report success; and Pi4/Pi5 state and events
are byte-for-byte unchanged.

Public integration contracts must prove only selected Signage
`--preflight-only` calls the new boundary with retain=false, normal execution
does not call it, kiosk preflight remains unchanged, existing preflight failure
prevents staging, and the JSON contains both original authority and the full
stage/cleanup receipt.

Acceptance requires focused and related contracts green, one complete
deploy-contract run, clean PR CI, exact-main Signage publication and
attestation, read-only status/plan evidence, and one successful authorized Pi3
preflight with identity match, maintenance off, services and display unchanged,
and staging residue zero.

## Idempotence and Recovery

Every call has a unique run ID and refuses an existing run path, so it cannot
consume another run. Cleanup never recurses through an unverified path or
follows a symlink. A failed copy or verification invokes the same cleanup
function and reports whether cleanup was proven; an unknown receipt remains a
failure. Operators must not retry the approved physical preflight or manually
delete residue. Existing standard recovery authority remains the only owner of
the historical failed active run.

## Artifacts and Notes

The success report has `schemaVersion`, `operation`, `status`, `retain`,
`runId`, `host`, `artifact`, `staging`, `lifecycle`, `cleanupReceipt`, and
`failure`. The artifact section binds reference, exact OCI digest, source SHA,
artifact SHA-256, manifest SHA-256, and payload digest.

The cleanup receipt has `schemaVersion`, `runId`, `host`, `artifactDigest`,
`stagingPath`, `checkedPaths`, `removedPaths`, `residuePaths`, `residue`, and
`status`. A successful receipt requires every expected path to have been
checked, at least one path removed, no residue, and `status` equal to `passed`.

## Interfaces and Dependencies

The new module exposes an interface equivalent to:

    acquire_and_stage(artifact_ref, target, run_id, staging_root, retain,
                      *, registry, attestor, transport, verifier_source) -> dict

Production adapters use direct GHCR HTTP, the installed GitHub CLI, and
compressed SSH/SCP. E2E substitutes only the network registry and SSH byte
transport while executing real file copy, target helper, verifier, promote,
and cleanup logic. The module uses only the Python standard library and the
existing external `gh` executable; it adds no package or service.

Revision note (2026-08-06): Created after the Stage 2 read-only audit and
design freeze, before RED tests or implementation.

Revision note (2026-08-06): Recorded the completed implementation, focused and
related green suites, and the non-retried Docker Desktop environment failure
from the single local full deploy-contract invocation before PR publication.

Revision note (2026-08-06): Recorded the out-of-scope local Node/pre-commit
environment failure before committing the already validated Stage 2 diff.

Revision note (2026-08-06): Recorded and removed the secret scan's one-line
diagnostic-label false positive without changing Stage 2 behavior.
