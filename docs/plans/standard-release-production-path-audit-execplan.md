---
id: standard-release-production-path-audit
title: Standard release production-path execution audit
status: in-progress
scope: canonical normal-factory rolling release, isolated rehearsal, and read-only production evidence
date: 2026-08-04
source_of_truth: docs/plans/standard-release-production-path-audit-execplan.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling_release/route_contract.py
  - scripts/deploy/pi5-blue-green.sh
  - scripts/ci/run-deploy-contracts-local.sh
related_docs:
  - ../guides/deployment.md
  - ../runbooks/deploy-status-recovery.md
  - ./production-secrets-and-runtime-execplan.md
validation: offline behavioral contracts, isolated Docker rehearsal, hosted CI, then read-only exact-main production evidence
open_items:
  - pass the PR native-container rehearsal and required review
  - pass the exact-main ARM64 rehearsal with the fixed 300-second monitor
  - collect the post-merge read-only production evidence
  - obtain separate approval before any production release
---

# Audit the complete standard release before another production attempt

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. Maintain this document in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

The normal release has repeatedly found one new integration defect only after
the preceding defect was fixed and a production run reached a later phase.
After this work, the repository will prove the whole standard route before a
production attempt: local planning, Pi5 server configuration, Blue/Green
migration and switching, stability and recovery, Pi4 canary sequencing, Pi3
resource-aware sequencing, and final evidence. A machine-readable report will
show that every required route is covered, which behavioral scenario owns it,
and whether any disposable Docker resource remains.

Production is frozen for the duration of this plan. Production access is
read-only and is not needed to implement or run the local audit. A later
exact-main observation may inspect status, health, configuration shape, and
preflight results, but it may not start a candidate, apply a migration, switch
traffic, or update a terminal.

## Progress

- [x] (2026-08-04 19:15+09:00) Preserved the failed-release evidence and added
  the initial `gateway_image` correction plus a focused executable contract.
- [x] (2026-08-04 20:05+09:00) Froze production retries, selected the complete
  standard-release scope, and renamed the unpushed local branch to
  `audit/standard-release-production-path` without discarding the five WIP
  files.
- [x] (2026-08-04 20:34+09:00) Added and validated the machine-readable
  38-scenario audit matrix and sanitized report. It covers all 25 route stages,
  all 13 Pi5 phases, and all eight registered historical incidents.
- [x] (2026-08-04 20:41+09:00) Added full-public-entrypoint behavioral tests,
  real migration Compose invocation for both slot directions, and isolated
  mutation tests that reintroduce every registered historical incident.
- [x] (2026-08-04 20:48+09:00) Added disposable Compose/container rehearsal,
  non-root/read-only/write-namespace checks, run-specific labels, and cleanup
  enforcement. The local audit report recorded containers, networks, and
  volumes at zero.
- [x] (2026-08-04 20:54+09:00) Wired the fast audit into `deploy-contract`, a
  production-Dockerfile native rehearsal into non-main CI, and the exact ARM64
  digest rehearsal into main release publication. The main guard rejects a
  shortened monitor, skipped pulls, and non-ARM64 images.
- [x] (2026-08-04 21:04+09:00) Passed focused validation, the complete local
  deploy contract (988 Python deployment tests plus shell, real PostgreSQL,
  and Ansible checks), all 102 CI contract tests, document audit, and
  `git diff --check` using the repository-required Node 20 runtime.
- [ ] Push, PR, hosted native-container rehearsal, review, merge, exact-main
  ARM64 rehearsal, read-only production evidence, and release approval remain
  separate gates.

## Surprises & Discoveries

- Observation: the existing route registry assigns a rehearsal test to every
  one of its 25 stages, but the Pi5 release is represented as one coarse stage.
  Evidence: `pi5.blue-green-release` points to a coordinator unit test while
  the shell lifecycle test runs with `PI5_BLUE_GREEN_DRY_RUN=1`.

- Observation: dry-run skips the exact migration Compose execution that failed
  in production.
  Evidence: `migration_apply_and_verify` calls `compose_migration` only when
  `DRY_RUN != 1`; `bash -n` and grep-based wiring checks cannot resolve an
  undefined shell helper.

- Observation: exact release image validation proves contents and Caddy syntax
  but does not start the API with the production read-only filesystem and
  complete storage mounts.
  Evidence: `scripts/ci/validate-release-artifact-docker.sh` checks for
  `dist/main.js` and the Prisma schema without running the API process.

- Observation: the first complete local deploy-contract attempt stopped before
  the audit because the interactive shell selected Node 18 while the repository
  requires Node 20.9 or newer.
  Evidence: `node --version` returned `v18.20.8`; rerunning with
  `/opt/homebrew/opt/node@20/bin` completed every local contract. No repository
  behavior was changed to accommodate the older runtime.

- Observation: a global audit label alone is insufficient for cleanup when
  multiple isolated rehearsals can run independently.
  Evidence: the exact-image harness now applies both the global audit label and
  a UUID-derived run label, removes only exact run resources, and fails if any
  resource with that run label survives.

## Decision Log

- Decision: keep one frozen audit branch and one review series for the current
  gateway fix and all audit work.
  Rationale: merging the narrow fix and retrying production would repeat the
  one-failure-at-a-time process this audit is intended to stop.
  Date/Author: 2026-08-04 / Codex.

- Decision: retain the existing route registry and add a separate data-only
  execution-audit matrix rather than changing the operator protocol.
  Rationale: readiness policy, execution routing, and audit evidence are
  different concerns. The audit must not alter production admission semantics.
  Date/Author: 2026-08-04 / Codex.

- Decision: require behavioral evidence for every mutation or commit route and
  finer-grained evidence for each Pi5 lifecycle phase.
  Rationale: a source grep proves only that text exists; it cannot prove that
  the executable command receives all required environment and state.
  Date/Author: 2026-08-04 / Codex.

- Decision: use run-labelled disposable Docker resources and reject a passing
  rehearsal if any labelled container, network, or volume remains.
  Rationale: production-like tests must be repeatable and cannot leak state
  between runs.
  Date/Author: 2026-08-04 / Codex.

- Decision: allow a shorter monitor and locally built amd64 images only in the
  CI-only non-main rehearsal; hard-reject those options on a main push.
  Rationale: PRs need an affordable production-Dockerfile runtime proof, while
  release publication must prove the exact ARM64 digests and unchanged
  300-second production stability policy.
  Date/Author: 2026-08-04 / Codex.

## Outcomes & Retrospective

The local implementation is complete. The active production blue slot remains
outside this work. The generated local report recorded 38 required scenarios,
38 passed, zero failed, zero uncovered, and zero container, network, or volume
residue. Repository completion still requires the hosted PR rehearsal and
reviewed integration to main, followed by exact-main ARM64 evidence. Production
deployment remains a later, separately approved operation.

## Context and Orientation

The only supported operator entry is `scripts/update-all-clients.sh`. It starts
the Python rolling-release coordinator, whose high-level route is recorded in
`scripts/deploy/rolling_release/route_contract.py`. The coordinator invokes
`scripts/deploy/pi5-blue-green.sh` for Pi5 application preparation, database
migration, traffic switching, monitoring, cleanup, rollback, and interrupted
state reconciliation. The shell entrypoint sources modules from
`scripts/deploy/lib/pi5-blue-green/`.

An audit scenario is one executable example with a named initial state, public
entrypoint, expected transition, failure invariant, and owning test. An
execution level describes how strong its evidence is: `static` parses source,
`behavioral` executes code with recording adapters, `compose` asks Docker
Compose to resolve the production model, and `container` starts disposable
containers. A past-incident mutant is a temporary copy in which one known fix
is removed; the audit must reject that copy, proving that the regression test
would catch the original defect.

The last production run, `20260804-095823-73770f`, failed before migration,
traffic switching, and Pi3 work because the migration Compose wrapper called
an undefined `gateway_image` helper. The active blue API remained healthy and
the candidate was cleaned. The working tree contains that focused correction
and generated documentation inventory updates. They must be preserved.

## Plan of Work

First add `scripts/deploy/production-path-audit.json`. Its version-one records
name the covered route stages and Pi5 phases, initial state, entrypoint,
execution level, expected transition, failure invariant, owning test, and
related incident identifiers. Add a Python validator and runner under
`scripts/deploy/` that rejects duplicate IDs, unknown route stages, invalid
test owners, weak evidence on mutation/commit stages, missing Pi5 phases, and
unknown incident identifiers. It writes a deterministic, secret-free report
containing the source SHA, counts, duration, scenario outcomes, uncovered IDs,
and labelled Docker residue counts.

Next strengthen the Pi5 tests. Execute the real entrypoint with temporary state
and recording Docker/Compose adapters so both active-slot directions reach the
migration wrapper and carry `PI5_GATEWAY_IMAGE`. Add failure scenarios for
migration, candidate readiness, gateway reload, monitor, rollback, cleanup,
and the durable interrupted states. Important assertions must inspect calls and
state transitions rather than source text.

Add a past-incident mutation harness. It copies only the needed source and
configuration into a temporary directory, removes each known correction, and
runs its owning contract. The fault set covers encrypted-Vault planning,
runtime write permissions, Caddy allowlist expansion, Pi3 SSH compression,
backup SSH bind authority, database role separation, derivative storage, and
the migration gateway image. It never edits the checked-out files.

Then add a disposable Docker rehearsal. Use the production API and Web
Dockerfiles, Phase 3 Compose plus its migration override, a temporary
PostgreSQL container, and run-labelled external network and volumes. Prove the
non-root/read-only boundaries, every storage namespace, the separate
application and migrator roles, candidate health, gateway routing, switch,
fixed production stability policy, rollback, cleanup, and resource removal.
The test entrypoint may redirect state and Compose resources to the temporary
run but must not introduce a flag accepted under rolling-release protocol that
shortens or bypasses production safety.

Finally extend change classification and `.github/workflows/ci.yml`. Pull
requests that affect deployment execution, Compose, Dockerfiles, API startup or
storage, Ansible server configuration, or migrations run the fast audit and an
isolated native-container rehearsal. Main release image jobs feed their exact
ARM64 digests into the same rehearsal; a release set cannot become deployable
until that job passes the fixed 300-second monitor. Upload the sanitized report
as CI evidence.

## Concrete Steps

Run all commands from the repository root
`/Users/tsudatakashi/RaspberryPiSystem_002`.

Validate the matrix and write a report:

    python3 scripts/deploy/production_path_audit.py validate
    python3 scripts/deploy/production_path_audit.py run \
      --output logs/deploy/production-path-audit-report.json

The successful report must contain `failed: 0`, `uncovered: 0`, and zero
container, network, and volume residue.

Run the focused tests before the complete suite:

    python3 -m unittest scripts.deploy.tests.test_production_path_audit -v
    python3 -m unittest scripts.deploy.tests.test_production_path_audit_execution -v
    python3 -m unittest scripts.deploy.tests.test_production_path_incidents -v
    python3 -m unittest scripts.deploy.tests.test_pi5_blue_green_structure -v
    bash scripts/deploy/tests/test-pi5-blue-green.sh
    python3 -m unittest scripts.ci.tests.test_release_runtime_rehearsal -v

Run the canonical complete validation:

    PATH="/opt/homebrew/opt/node@20/bin:$PATH" \
      bash scripts/ci/run-deploy-contracts-local.sh
    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py' -v
    node scripts/docs/audit-docs.mjs
    git diff --check

Do not run `scripts/update-all-clients.sh` in mutation mode during this plan.
After merge and exact-main hosted success, the only permitted production steps
inside this audit are `--print-plan`, two read-only preflight scopes matching
the Pi5-plus-Pi3 and Pi5-plus-Pi4 transport topology, `--status`, and read-only
health/configuration observations.

## Validation and Acceptance

The matrix validator must report every route stage and every required Pi5
phase covered. Deleting any required scenario, assigning a static-only test to
a mutation stage, or naming a nonexistent test must make validation fail.

The known-good audit must pass. Each incident mutant must fail at its named
boundary before any later mutation, while the unmodified copy passes. Both
blue-active and green-active migration calls must resolve the correct gateway
image. A migration failure must leave the active slot and gateway unchanged; a
post-switch health failure must produce verified rollback evidence; repeated
cleanup and reconcile calls must normalize state without deleting persistent
data.

The container rehearsal must start the API under the production non-root,
read-only filesystem with every required writable namespace, use the
application role for normal requests, use the migrator only in the ephemeral
migration command, and reject application-role DDL. It must route API and Web
health through the gateway and remove every run-labelled resource on success
or failure.

The complete local contract, hosted required checks, and exact-main ARM64
rehearsal must all pass. Any uncovered required scenario, release-blocking
finding, secret-bearing report field, or Docker residue keeps the audit open
and production frozen.

## Idempotence and Recovery

All audit commands use temporary directories and run-specific Docker names and
labels. Re-running them replaces only the requested report and creates a fresh
disposable run. Cleanup targets exact labelled resources, never a wildcard or
the default Compose project. A failed cleanup is itself a failed audit and its
exact resource names remain in the sanitized report for manual inspection.

The production worktree, fleet state, Blue/Green state, systemd units, database,
and terminals are never recovery targets for local tests. If a later read-only
production observation finds an active run or malformed recovery authority,
stop and prepare a separate recovery action under
`docs/runbooks/deploy-status-recovery.md`; do not edit state or invoke an
internal deployment command.

## Artifacts and Notes

Expected report summary:

    {
      "schemaVersion": 1,
      "summary": {
        "required": 25,
        "failed": 0,
        "uncovered": 0,
        "resourceResidue": {"containers": 0, "networks": 0, "volumes": 0}
      }
    }

The exact scenario count may exceed 25 because the single high-level Pi5 route
has multiple internal phases and failure states. The acceptance invariant is
zero uncovered required IDs, not a fixed total count.

## Interfaces and Dependencies

`scripts/deploy/production-path-audit.json` is internal data with
`schemaVersion: 1`. `scripts/deploy/production_path_audit.py` exposes
`validate` and `run --output PATH`. Its report is an internal CI artifact, not
an operator API or admission receipt. It uses the Python standard library and
the existing route-contract module.

The Docker rehearsal requires Docker Engine and Docker Compose. It uses the
repository's existing PostgreSQL and production image dependencies and does not
add a runtime library. Production CLI arguments, state schema, readiness policy,
and the fixed 300-second stability policy remain unchanged.

Revision note 2026-08-04: Created the frozen production-path audit after three
successively later candidate failures demonstrated that existing dry-run and
static contracts did not execute every release phase.
