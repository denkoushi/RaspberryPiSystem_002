---
id: KB-405
title: Pi5 slot Web runtime configuration path drift
status: active
scope: standard Pi5 Blue/Green candidate preparation
date: 2026-08-04
source_of_truth: true
related_code:
  - infrastructure/docker/Dockerfile.web
  - scripts/deploy/lib/pi5-blue-green/runtime.sh
  - scripts/ci/rehearse-release-runtime.sh
related_docs:
  - ../plans/standard-release-production-path-audit-execplan.md
  - ../guides/deployment.md
  - ../runbooks/deploy-status-recovery.md
validation: behavioral controller contract, historical-fault mutation, exact-image isolated runtime rehearsal, and full deploy contracts
open_items:
  - pass the complete local audit from the beginning
  - pass review and required hosted CI
  - pass the exact-main ARM64 300-second rehearsal
  - obtain separate approval before a new standard production run
---

# KB-405: Pi5 slot Web runtime configuration path drift

## Context

Separately approved standard release run `20260804-122309-7e601d` used the
canonical `scripts/update-all-clients.sh` entrypoint for exact main SHA
`43654229dc4c25d9b7162f5e77d3efc7b62f5835`. Signed API and Web artifacts
were promoted successfully. The API pull completed 769,613,809 compressed
bytes in 502 seconds with no unknown Docker status, and both post-build load
and migration checks passed.

Candidate preparation then stopped fail-closed. Traffic remained on blue and
all Pi4 and Pi3 targets remained pending. The Pi5 state recorded migration as
`applied`, so the incident must not be described as a pre-migration failure.
The green API and Web containers remained as run-owned candidate residue for
the next standard run to reconcile. They must not be removed with direct
Docker or internal deployment commands.

## Symptoms Or Trigger

The release journal contained:

    Error: reading config from file: open /srv/Caddyfile.slot: no such file or directory
    Blue/Green candidate preparation failed: candidate green is not a healthy scheduler standby

Read-only observation after the failure showed:

- active slot and gateway still blue;
- public `/api/system/health` returned `status=ok`;
- green API internal readiness returned HTTP 200, `ready=true`,
  scheduler `standby`, and database connection `connected`;
- green Web was serving Caddy from `/tmp/Caddyfile.slot`.

The scheduler wording was therefore a generic outer error, not the failed
contract.

## Investigation

Three hypotheses were checked without mutating production.

- Scheduler election failed: rejected by the green API readiness response.
- The Web image failed to render or start: rejected by its running Caddy log,
  which showed `/tmp/Caddyfile.slot` adapted and served.
- The controller validated a path different from the image runtime path:
  confirmed by source and the exact production log.

The Web image became non-root and read-only in commit `de6030e9`. That change
moved generated slot configuration from the read-only `/srv` tree to the
writable `/tmp/Caddyfile.slot`. The Blue/Green controller retained
`caddy validate --config /srv/Caddyfile.slot`.

The isolated exact-image rehearsal started both Web slots and exercised
gateway traffic, but it never invoked the controller's slot configuration
validation boundary. A source-only image test asserted that `/tmp` was used,
while no contract connected that path to the controller. Consequently each
side passed independently and the cross-boundary drift reached production.

## Root Cause

The generated Web slot configuration path had two independent owners:
`Dockerfile.web` for runtime startup and `runtime.sh` for candidate
validation. The production audit did not execute the exact validation command
against the exact Web image.

## Fix

The Web image now publishes `SLOT_CADDY_CONFIG_FILE=/tmp/Caddyfile.slot` and
uses that variable for rendering and startup. The Blue/Green controller reads
the same container environment, requires the selected file to exist, and
validates it. An active image created before this contract has no variable, so
the controller retains `/srv/Caddyfile.slot` only as a backward-compatible
fallback for the old side of the first switch. New exact images must expose
the variable and are checked as such by the isolated rehearsal.

Candidate startup now preserves a phase-specific reason for Compose startup,
runtime configuration, API scheduler readiness, or Web configuration
validation. A Web validation failure is no longer reported as scheduler
failure.

## Prevention

- The shell lifecycle test executes `slot_web_validate` with a
  container-provided runtime path, also exercises the old active-image
  fallback, and fails when the controller ignores the new path.
- The historical-incident mutation suite registers
  `slot-web-runtime-config` and proves the old path is rejected in an
  isolated copy.
- The exact-image rehearsal validates the generated slot configuration inside
  both running Web containers before gateway switching.
- The audit matrix counts this as a required production incident and associates
  it with disposable candidate preparation.

## Validation

The regression test failed against the original controller and passed after
the shared runtime contract was introduced. Focused shell lifecycle, runtime
boundary, rehearsal-contract, nine-incident mutation, and audit-matrix
validation pass locally. The complete deploy contract also passes, including
989 deployment tests, real PostgreSQL migrations, Ansible checks, and zero
audit residue. Fresh locally built ARM64 API/Web images pass the isolated
blue/green rehearsal with both generated Caddy files validated, five gateway
samples over 10 seconds, and zero container, network, or volume residue.
Hosted review, exact-main 300-second rehearsal, and fresh read-only production
admission remain required.

## Open Items

Production stays frozen. Do not recover the candidate manually and do not
restart the failed run. After the correction is reviewed, merged, and proven
by the exact-main ARM64 rehearsal, perform read-only production evidence
collection and request separate approval for a new run from the standard
entrypoint.
