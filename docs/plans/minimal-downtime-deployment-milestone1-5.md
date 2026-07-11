# Milestone 1.5: Maintenance acknowledgement gate

This ExecPlan is a living document maintained under `.agent/PLANS.md`.

## Purpose / Big Picture

A kiosk deployment starts only after every targeted kiosk has displayed maintenance state and acknowledged the matching deployment run. Operators can use an explicit emergency override, but the default is to stop safely.

## Progress

- [x] (2026-07-11) Extended deploy-status response with runId, phase, and startedAt.
- [x] (2026-07-11) Added authenticated run-scoped ACK endpoint and atomic persistence.
- [x] (2026-07-11) Added kiosk ACK submission and adaptive 8s/2s polling.
- [x] (2026-07-11) Added 30-second ACK gate and explicit emergency override to the deployment wrapper.
- [ ] Add contract and failure-path tests, then publish a draft PR.
- [ ] Complete one-host canary acceptance before rollout.

## Surprises & Discoveries

- Observation: ACK persistence must preserve the host file owner, for the same reason discovered in Milestone 1 cleanup.
  Evidence: the config directory is shared into the API container while the deployment wrapper writes as the Pi5 deployment user.

## Decision Log

- Decision: store ACKs in deploy-status v2 under `acknowledgements[runId][statusClientId]`.
  Rationale: the deploy wrapper can verify readiness without adding a database migration.
  Date/Author: 2026-07-11 / Codex.
- Decision: wait 30 seconds and poll every 5 seconds; fail closed unless `--force-without-maintenance-ack` is explicit.
  Rationale: this matches the approved plan and prevents invisible maintenance deployments.
  Date/Author: 2026-07-11 / Codex.

## Outcomes & Retrospective

Implementation is in progress and has not been deployed.

## Context and Orientation

The API route is `apps/api/src/routes/system/deploy-status.ts`, the kiosk integration is in `apps/web/src/layouts/KioskLayout.tsx`, and the deployment gate is in `scripts/update-all-clients.sh`.

## Plan of Work

Finish contract tests for response metadata, valid ACK, invalid client, missing runId, and run mismatch. Add script-level tests for complete, missing, and overridden ACK states. Validate API/Web builds and shell syntax before publication.

## Concrete Steps

Run API and Web builds, targeted tests, `bash -n scripts/update-all-clients.sh`, and `git diff --check` from the repository root.

## Validation and Acceptance

One selected kiosk must show maintenance and ACK its run before Ansible begins. An absent ACK must prevent Ansible execution after 30 seconds. Non-target kiosks must remain usable.

## Idempotence and Recovery

ACK writes are keyed by run and client and are safe to repeat. Run-scoped cleanup removes maintenance targets; later cleanup will also prune the matching acknowledgement map.

## Artifacts and Notes

No production deployment is authorized until CI and canary acceptance.

## Interfaces and Dependencies

GET returns optional `runId`, `phase`, and `startedAt`. POST `/api/system/deploy-status/ack` accepts `{ runId: string }` with `x-client-key` and returns `{ acknowledged: true, runId }`.
