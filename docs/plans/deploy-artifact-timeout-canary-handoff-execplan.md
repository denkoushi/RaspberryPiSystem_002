---
id: plan-deploy-artifact-timeout-canary-handoff
title: Bound artifact acquisition and expose canary approval as an operator action
status: completed
date: 2026-07-29
source_of_truth: true
scope: Pi5 artifact-promotion timing, release-status operator handoff, and regression evidence
related_docs:
  - ../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md
  - ../archive/decisions/ADR-20260712-deploy-target-minimization-canary-hold.md
  - ../guides/deployment.md
  - ../runbooks/deploy-status-recovery.md
  - ./deploy-workflow-artifact-promotion-execplan.md
related_code:
  - scripts/deploy/pi5_artifact_promoter.py
  - scripts/deploy/rolling-release.py
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/coordinator.py
validation:
  - focused artifact-promotion and rolling-release tests
  - complete deployment Python and shell contracts
  - disposable PostgreSQL migration, SQL, and cleanup exercise
  - hosted required CI on one Draft pull request
open_items:
  - production deployment and canary approval require separate explicit authorization
---

# Bound artifact acquisition and expose canary approval as an operator action

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. Maintain this document in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

The standard deployment can safely obtain a signed API/Web image pair from
GitHub Container Registry or fall back to building the pair on the Raspberry Pi
5. It can also stop after the first kiosk succeeds until an operator explicitly
approves the remaining kiosks. Production run
`20260729-005614-cea467` showed two observability gaps in those safe behaviors.
The large API image pull shared an opaque 300-second timeout with every small
verification command, and the later canary gate was visible only as nested
state and a remote journal message. The pull used the safe local fallback, but
the canary gate expired after 1,800 seconds because no run-specific approval was
sent.

After this change, each external command has a named, bounded timing policy and
emits a secret-free heartbeat every 30 seconds. Release-set discovery receives
120 seconds, each API or Web image pull receives at most 600 seconds, ordinary
verification commands retain 300 seconds, and all promotion work together
receives at most 900 seconds. Pull availability failures still use the accepted
local builder, while signature and provenance failures still stop.

The public `--status` JSON will also expose one additive `actionRequired`
object while a live canary gate is waiting. It contains the validated run ID,
canary identity, timestamps, remaining seconds, and the exact approval command.
The gate remains a human decision: no prior deployment permission and no code
path automatically approves it. Operators can see the needed action without
reading a systemd journal, and automation can stop polling technical phases and
ask the human before the unchanged 30-minute deadline.

## Progress

- [x] (2026-07-29 11:30+09:00) Confirmed the canonical worktree was clean,
  fast-forwarded `main` to `bc9aba54ff3f496b92abf96605ab91b7f4555fce`,
  and created `fix/deploy-artifact-timeout-canary-handoff`.
- [x] (2026-07-29 11:30+09:00) Read the repository safety, documentation,
  architecture, quality, debugging, Git, ExecPlan, deployment, recovery,
  artifact-promotion, and canary-hold contracts.
- [x] (2026-07-29 11:30+09:00) Reconstructed the failed run from durable state
  and journal evidence without changing production.
- [x] (2026-07-29 11:36+09:00) Added failing regression tests that reproduce
  the opaque shared timeout, missing operator-action projection, and generic
  canary timeout error.
- [x] (2026-07-29 11:42+09:00) Implemented the immutable timing policy,
  monotonic `Popen` runner, secret-free heartbeat, structured timeout result,
  total budget, terminate/kill path, and per-resource bounded cleanup that
  preserves the primary failure.
- [x] (2026-07-29 11:43+09:00) Implemented the pure canary action projection
  and dedicated `CanaryApprovalTimeout` failure code without changing the
  approval authority, timeout, or ordering.
- [x] (2026-07-29 11:47+09:00) Passed 169 focused tests and all 903 deployment
  Python tests. The complete local contract also passed 102 Jinja templates,
  24 inventory cases, Blue/Green and rollback contracts, Ansible syntax,
  156 disposable PostgreSQL migrations, and 20 deploy-status API tests.
- [x] (2026-07-29 11:47+09:00) The disposable PostgreSQL query used
  `ClientDevice_apiKey_key` and completed in 0.011 ms. Its run-labelled
  container, volume, and network returned to zero; unrelated Docker counts
  remained 0 containers, 17 volumes, and 3 networks.
- [x] (2026-07-29 11:48+09:00) Finalized the source plan and publication
  package for one intentional commit and push. The Draft PR, required-CI
  result, and review state are external publication evidence and will not
  trigger a source-only follow-up commit.

## Surprises & Discoveries

- Observation: the production run did not stop at artifact acquisition.
  Evidence: the journal recorded artifact promotion unavailable at
  `2026-07-29T01:04:14Z`, local candidate preparation succeeded at
  `01:08:14Z`, traffic switched at `01:08:36Z`, and the five-minute stability
  monitor plus Pi5 cleanup succeeded before terminal work.

- Observation: the actual terminal failure was the deliberate canary gate.
  Evidence: StoneBase completed browser activation, independent evidence,
  maintenance clearing, and runtime cleanup. The other five kiosks remained
  pending. The gate opened at `01:15:28Z` and the run failed at `01:45:29Z`
  with `canary hold timed out after 1800s waiting for operator approval`.

- Observation: the 604,412 ms candidate phase combined two different paths.
  Evidence: signed artifact discovery and the API pull consumed about 365
  seconds before fallback; the accepted local candidate build then consumed
  about 240 seconds. Treating the full phase as a local-build duration would
  misdiagnose the delay.

- Observation: timeout detail is currently discarded at the command boundary.
  Evidence: `_run_command` applies `timeout=300` to every subprocess.
  `_require_success` maps `subprocess.TimeoutExpired` to the generic
  `<label> is unavailable`, and the durable result therefore contains only
  `api image is unavailable`.

- Observation: the durable canary record already contains the safe inputs for
  an operator action.
  Evidence: a waiting `canaryHold` contains its state, canary, profile, opening
  timestamp, and expiry, while the validated public lookup already knows the
  run ID. No new database or control-plane authority is required.

## Decision Log

- Decision: preserve the run-specific human canary approval and its 1,800
  second deadline.
  Rationale: pre-issued or automatic approval would remove the shop-floor
  verification boundary accepted by the canary-hold ADR. The defect is the
  missing operator handoff, not the existence of the gate.
  Date/Author: 2026-07-29 / Product owner and Codex.

- Decision: use one immutable `PromotionTimingPolicy` and explicit command
  execution metadata instead of recognizing feature names from shell strings.
  Rationale: timeout ownership belongs to the artifact adapter. Explicit stage
  labels and limits keep the subprocess runner reusable and make secret-free
  logs deterministic.
  Date/Author: 2026-07-29 / Product owner and Codex.

- Decision: allow 120 seconds for the small release set, 600 seconds for each
  large image pull, 300 seconds for ordinary commands, 900 seconds for the
  complete promotion, and 30 seconds between heartbeats.
  Rationale: the current API pull crossed 300 seconds, while a total 15-minute
  budget prevents an unavailable registry from waiting longer than the
  measured cold local-builder baseline. The overall deadline always constrains
  the per-command limit.
  Date/Author: 2026-07-29 / Product owner and Codex.

- Decision: timeout and transport failures during a permitted availability
  stage retain local fallback, but attestation and provenance failures retain
  terminal integrity behavior.
  Rationale: registry availability is optional; discovered invalid content is
  not. A longer pull budget must not widen the trust boundary.
  Date/Author: 2026-07-29 / Codex.

- Decision: derive `actionRequired` in the local status application rather than
  storing a second action record.
  Rationale: the lock-protected canary hold remains the sole authority. A pure
  projection avoids drift and is absent automatically after approval, expiry,
  cancellation, or completion.
  Date/Author: 2026-07-29 / Codex.

- Decision: represent canary expiry with a dedicated domain exception and
  stable `failureCode: canary-approval-timeout`.
  Rationale: parsing an English error message is fragile. The existing human
  `failure` string remains backward compatible while automation gains a stable
  reason.
  Date/Author: 2026-07-29 / Codex.

## Outcomes & Retrospective

The implementation is locally complete. Large pulls no longer inherit the
small-command 300-second limit: explicit execution metadata selects 120, 600,
or 300 seconds while one budget caps the complete promotion at 900 seconds.
The real runner reports start, heartbeat, success, failed completion, and
timeout without serializing argv, stdin, or environment. Timeout and
interruption walk every cleanup target independently, so one cleanup failure
cannot hide the original result or prevent later cleanup attempts.

`--status` now derives one run-scoped `actionRequired` object from the
authoritative live canary hold. It disappears after approval, expiry,
cancellation, or terminal completion. Approval still requires a separate
operator command, the deadline remains 1,800 seconds, and later terminals do
not run after expiry. The durable failure also has the stable code
`canary-approval-timeout`.

Local validation passed with no inventory connection and no existing Docker
mutation. The aggregate runner applied all 156 migrations only to its unique
loopback PostgreSQL instance, found the ledger current, exercised the indexed
API-key query, passed 20 API integration tests, and removed its container,
volume, and network. There is no HTTP API, Prisma, migration, notification,
stability, ordering, rollback, or terminal-code change.

Production connection, deployment, and canary approval remain outside this
change. Hosted required-CI evidence belongs in the Draft PR so obtaining that
evidence does not require a second source-only commit.

## Context and Orientation

`scripts/deploy/pi5_artifact_promoter.py` is a narrow adapter executed before
the accepted Pi5 local builder. It verifies one signed release-set image,
extracts strict JSON identifying the API and Web digests, verifies each image
attestation, pulls by digest, checks Linux ARM64 provenance labels, and retags
the pair to run-scoped candidate names. Its injected `CommandRunner` makes
network and Docker behavior testable. It cannot run migrations, change a
Blue/Green slot, switch traffic, or touch terminals.

The promoter currently calls `subprocess.run(..., timeout=300)` for every
command. `_require_success` decides whether a failed command is an availability
failure or an integrity failure. `pi5-image-deploy.sh` invokes the local builder
only for the promoter's exit status 75 (`unavailable`); exit status 78
(`integrity-failure`) terminates the deployment.

`scripts/deploy/rolling-release.py` contains the remote facade used by the
coordinator. After a canary succeeds it writes a waiting `canaryHold`, opens the
lock-protected deploy-status gate, and polls it every five seconds. The pure
coordinator in `scripts/deploy/rolling_release/coordinator.py` stops before the
remaining terminals until that gate is approved. Its generic failure path
persists the exception string but currently has no stable failure code.

The local operator application in
`scripts/deploy/rolling_release/application.py` reads the durable run state,
the cooperative cancellation record, and systemd unit state. Its
`reconcile_status` call returns public JSON for `scripts/update-all-clients.sh
--status RUN_ID`. This is the correct boundary for an additive, derived
operator action because it does not write deployment state.

## Plan of Work

First add failing promoter tests. Introduce an execution record containing only
a safe stage label, timeout, and heartbeat interval. Test the fixed timing
policy, clamping by the 900-second total budget, start/heartbeat/success log
events, bounded termination and kill of a timed-out child, structured timeout
details, pull fallback, integrity failure, SIGTERM propagation, and cleanup of
partially pulled or promoted images. Use a tiny local child process or injected
clock/process adapter; never wait for production-scale timeout values.

Then refactor the promoter. `PromotionTimingPolicy` will own the five fixed
durations. A budget object created at `promote` entry will derive the effective
timeout for each command. The real runner will use `subprocess.Popen`,
`communicate` in heartbeat-sized intervals, a monotonic deadline, and
terminate-then-kill cleanup if the child remains alive. Its log function emits
only `stage`, state, and integer elapsed/limit values. A timeout-specific
exception carries structured fields to `PromotionUnavailable`; `main` writes
those fields to the existing mode-0600 result JSON. Cleanup commands receive a
bounded cleanup execution policy that is not blocked by an exhausted promotion
budget.

Next add pure status tests and a canary timeout regression. A helper in the
local application will derive `actionRequired` only when the reconciled run is
active, its phase is `waiting-approval`, its latest `canaryHold` is
`waiting-verification`, and its expiry is still in the future. The helper uses
the caller-validated run ID, clamps remaining seconds to a positive integer,
and never trusts a command from remote state. Approved, expired, cancelled,
terminal, malformed, and zero-remaining inputs produce no action.

Add `CanaryApprovalTimeout` in the rolling-release domain errors module.
`wait_for_canary_approval` raises it on either authoritative expiry path. The
coordinator persists the unchanged message plus
`failureCode: canary-approval-timeout`; every unrelated failure omits that
field. Existing tests must continue proving that only the canary ran, remaining
terminals stayed pending, maintenance was cleared, and no automatic rollback
or approval occurred.

Finally update the deployment guide with the new status handoff and bounded
artifact timing, link this ExecPlan from the thin AI and document indexes, and
refresh generated inventories. Run the complete local deployment contract
once. It creates a uniquely labelled PostgreSQL container, volume, and network
on a random loopback port, applies every migration, checks the ledger, runs the
existing indexed SQL `EXPLAIN (ANALYZE, BUFFERS)`, and deletes only those
resources on both success and representative failure.

## Concrete Steps

Work from:

    /Users/tsudatakashi/RaspberryPiSystem_002

Use branch:

    fix/deploy-artifact-timeout-canary-handoff

Run focused tests while implementing:

    python3 -m unittest scripts/deploy/tests/test_pi5_artifact_promoter.py
    python3 -m unittest scripts/deploy/tests/test_release_status_reconciliation.py
    python3 -m unittest scripts/deploy/tests/test_rolling_release.py

Before publication run exactly one complete local deployment contract:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Inspect the full diff and stage only the files named by this ExecPlan. Commit
once, push once, and open one Draft PR to `main`. Do not merge or deploy.

## Validation and Acceptance

The promoter tests must demonstrate that no real test waits 120, 300, 600, or
900 seconds. A synthetic slow pull emits at least one heartbeat, is stopped at
its effective deadline, records `reasonCode`, `stage`, `elapsedSeconds`, and
`timeoutSeconds`, removes run-owned temporary resources, and returns exit 75.
A synthetic attestation or provenance failure returns exit 78 and cannot reach
the local fallback. No result or log contains the test token, command line, or
environment.

The status tests must demonstrate that a live waiting gate returns exactly one
`actionRequired` object with an approval command built from the validated run
ID. The field must be absent before the gate, after approval, at or after
expiry, during cancellation, and for every terminal state. Canary expiry must
persist `failureCode: canary-approval-timeout`, leave later terminals pending,
and preserve the successful canary.

The complete deployment contracts must pass without contacting an inventory
host. Disposable PostgreSQL migrations must be current, unfinished and
rolled-back migration counts must be zero, the existing API-key query must use
its index, and all run-labelled container, volume, and network counts must
return to zero. Existing unrelated Docker resources and BuildKit caches must
not be pruned or changed.

## Idempotence and Recovery

All timing and projection logic is deterministic and additive. Re-running unit
or deployment-contract tests is safe. The aggregate runner owns and traps only
its unique Docker resources. It must not reuse an existing database, volume,
network, or container.

A promotion availability failure still selects the already accepted local
builder. Disabling artifact promotion through its existing Ansible variable
restores the Phase 1 acquisition behavior. Integrity failure still stops before
candidate preparation. A canary timeout still fails closed with the canary
retained and remaining terminals untouched; recovery is a new standard run
after `--print-plan`, never state editing or a phase script.

If implementation is interrupted before commit, `git status` and this
`Progress` section identify every intended file. Do not reset unrelated work.
If a test leaves a labelled resource, resolve the exact run label, remove only
that resource through the runner's cleanup path, and prove the label count is
zero. Never run Docker prune.

## Artifacts and Notes

The production evidence motivating this work is:

    run: 20260729-005614-cea467
    source SHA: bc9aba54ff3f496b92abf96605ab91b7f4555fce
    artifact result: unavailable / api image is unavailable
    candidate phase: 604,412 ms
    Pi5 traffic switch: success
    Pi5 stability monitor: 301,614 ms / success
    StoneBase activation and cleanup: success
    remaining kiosks: pending
    terminal result: failed / canary approval timeout after 1,800 seconds

These numbers are evidence, not CI performance thresholds.

## Interfaces and Dependencies

In `scripts/deploy/pi5_artifact_promoter.py`, add immutable timing and execution
types. The fixed timing authority exposes release-set pull, image pull,
ordinary command, total, heartbeat, and cleanup durations. The command runner
receives explicit execution metadata and returns the existing `CommandResult`.
Timeout availability errors expose:

    reasonCode
    stage
    elapsedSeconds
    timeoutSeconds

The existing `status`, `reason`, and exit-code contract remains compatible.

In `scripts/deploy/rolling_release/application.py`, add a pure operator-action
projection used by `observe`. While waiting, the public status gains:

    actionRequired.type = "canary-approval"
    actionRequired.runId
    actionRequired.canary
    actionRequired.openedAt
    actionRequired.expiresAt
    actionRequired.remainingSeconds
    actionRequired.command

No database, HTTP API, DTO, Prisma schema, migration, terminal code, notification
duration, stability period, approval authority, or rollback interface changes.

Revision note (2026-07-29): Created after diagnosis of the first production run
on the corrected CI/Pi5 build contract. It fixes observability and bounded
acquisition without changing deployment safety or authorizing another run.
