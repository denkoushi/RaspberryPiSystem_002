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
  - ../knowledge-base/KB-406-pi4-canary-initial-status-and-runtime-recreate.md
validation: offline behavioral contracts, isolated Docker rehearsal, hosted CI, then read-only exact-main production evidence
open_items:
  - pass review and required hosted CI for the corrections
  - pass a new exact-main ARM64 rehearsal with the fixed 300-second monitor
  - collect fresh post-merge read-only production and failed-run recovery evidence
  - obtain separate approval for production recovery and any later standard release
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
  39-scenario audit matrix and sanitized report. It covers all 25 route stages,
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
- [x] (2026-08-04 20:37+09:00) Pushed the audit branch and opened draft PR
  #1178. Its first hosted native-container rehearsal correctly failed before
  starting an application container because the disposable empty database had
  no Prisma ledger when role separation ran.
- [x] (2026-08-04 20:37+09:00) Corrected only the disposable rehearsal's clean
  database ordering, added an executable ordering contract, replaced the
  Bash-4-only cleanup read, and passed 103 CI contract tests plus the full
  native ARM64 rehearsal with five gateway samples and zero resource residue.
- [x] (2026-08-04 21:55+09:00) Passed hosted review and required CI, merged PR
  #1178 as exact main `43654229dc4c25d9b7162f5e77d3efc7b62f5835`, passed
  the exact ARM64 300-second rehearsal with 149 samples and zero Docker
  residue, and collected the read-only production evidence.
- [x] (2026-08-04 22:23+09:00) Obtained separate release approval and started
  standard run `20260804-122309-7e601d`. Artifact promotion succeeded, but
  candidate prepare stopped fail-closed before traffic switch because the Web
  image generated `/tmp/Caddyfile.slot` while the controller validated the
  obsolete `/srv/Caddyfile.slot` path.
- [x] (2026-08-04 22:49+09:00) Confirmed read-only that blue remained healthy,
  green API was a connected scheduler standby, and the generic scheduler error
  hid a Web validation failure. Added a shared container runtime config
  contract, exact-image Web validation, phase-specific failure reason, and a
  ninth incident mutation. Focused tests pass.
- [x] (2026-08-04, post-failure rerun) Repeated the complete local audit from
  the beginning after adding backward compatibility for the currently active
  old Web image. The deploy contract passed 989 deployment tests, all nine
  incident mutations, real PostgreSQL migrations, 20 deploy-status tests, 43
  Ansible profile tests, playbook checks, and zero audit residue. All 103 CI
  contract tests, document audit, and `git diff --check` passed. Fresh ARM64
  API/Web images then passed the native blue/green rehearsal with both
  generated Caddy files validated, five gateway samples over 10 seconds, and
  zero container, network, or volume residue.
- [x] (2026-08-05 04:26+09:00) Reviewed and merged PR #1179, passed its
  exact-main ARM64 rehearsal and read-only admission, then started separately
  approved standard run `20260804-185819-598324`. Pi5 completed switch,
  300-second monitor, and cleanup, but the Pi4 canary ready claim timed out and
  rollback verification remained fail-closed.
- [x] (2026-08-05 04:55+09:00) Completed read-only failure diagnosis. API logs
  contained 391 successful deploy-status GETs and zero POSTs; Firefox recorded
  one exact cache-busted activation attempt from a password-prompt route; all
  three restored agents matched every sealed field except the raw Docker
  runtime-config digest.
- [x] (2026-08-05 05:10+09:00) Added the initial deploy-status render gate,
  reproducible runtime manifest schema 3 with schema 2 recovery compatibility,
  11-incident mutations, and a real Compose capture/force-recreate/drift/
  restore test. Focused Kiosk, runtime, mutation, and Docker tests pass with
  zero run-labelled residue.
- [x] (2026-08-05 05:36+09:00) Repeated the complete local audit from the
  beginning. The deploy contract passed 991 deployment tests, all 11 incident
  mutations, the real Compose recreation test, all 157 PostgreSQL migrations,
  deploy-status API contracts, 43 Ansible profile tests, playbook checks, and
  zero run-labelled Docker residue. All 103 CI contract tests, document audit,
  and `git diff --check` also passed.
- [x] (2026-08-05 06:13+09:00) Published draft PR #1180 as three reviewable
  commits. Hosted `docker-security (api)` then failed closed on newly published
  `CVE-2026-18446` because the root override still pinned production dependency
  `fast-uri` 3.1.4. Updated the single override and lockfile to patched 3.1.5;
  frozen install, API build, all 103 CI contracts, and CI-equivalent Trivy scan
  now pass with zero HIGH or CRITICAL findings in tracked lockfiles.
- [x] (2026-08-05 06:22+09:00) Repeated the complete deploy contract after the
  dependency correction. All 991 deployment tests, 11 incident mutations, real
  Compose recreation, 157 migrations, 20 deploy-status API tests, 43 Ansible
  contracts, playbook checks, and run-resource cleanup passed again.
- [x] (2026-08-05 06:54+09:00) The next hosted run exposed two test-evidence
  boundaries after the initial deploy-status gate: runtime-recovery E2E had no
  non-maintenance status fixture, and the Kiosk SOP generator treated the
  fail-closed placeholder as the routed page. Added the explicit E2E authority
  and fixture-specific routed-DOM readiness. Runtime-recovery passed 2/2; the
  generated SOP is current and all 18 production-bundle browser tests pass.
- [x] (2026-08-05 07:00+09:00) Repeated the complete deploy contract after the
  browser-harness corrections. All 991 deployment tests, 11 incident
  mutations, the real Compose recreation test, all 157 PostgreSQL migrations,
  20 deploy-status API tests, 43 Ansible profile tests, playbook checks, and
  zero run-labelled Docker residue passed again.
- [x] (2026-08-05 07:02+09:00) Repeated all 103 CI contract tests and the
  document audit after the browser-harness corrections; both passed, and the
  final local diff remains free of whitespace errors.
- [x] (2026-08-05 07:48+09:00) Reproduced the remaining hosted `kiosk-sop`
  failure as CPU-dependent Chromium glyph rasterization. Pinned subpixel font
  positioning off, bumped the generator contract to 1.2.0, and obtained
  byte-identical complete artifact trees from three concurrent generations.
  All five capture contracts, generated-current validation, and all 18
  production-bundle browser tests pass.
- [x] (2026-08-05 07:59+09:00) Completed the requested urgent read-only Pi4
  fleet observation. All six hosts were reachable through Pi5, on the prior
  SHA, with the kiosk browser and status timer active and Pi5 API health 200.
  Only StoneBase retained maintenance owned by failed run
  `20260804-185819-598324`; the other five reported no maintenance. No
  production state was changed.
- [x] (2026-08-05 08:06+09:00) Repeated the complete deploy contract from the
  beginning after the deterministic SOP capture correction. All 991 deployment
  tests, 11 incident mutations, real Compose recreation, 157 migrations, 20
  deploy-status API tests, 43 Ansible profile tests, playbook checks, and
  run-resource cleanup passed; labelled container, network, and volume residue
  remained zero.
- [x] (2026-08-05 08:06+09:00) Repeated all 103 CI contract tests and the
  document audit after the final evidence update; both passed. Reviewed the
  generated manifest, capture-runtime boundary, contract, KB, and ExecPlan
  diff, with no whitespace errors.
- [ ] Complete final local diff review, hosted review and required CI,
  exact-main evidence, and fresh read-only production evidence. Production and
  failed-run recovery remain frozen behind a separate approval.

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

- Observation: the production role bootstrap intentionally operates on an
  already migrated database and therefore revokes application access from the
  existing `_prisma_migrations` table; the new disposable harness initially
  invoked it against an empty database.
  Evidence: hosted PR job 91974674212 stopped at line 103 of
  `postgres-role-bootstrap.sql` with `relation public._prisma_migrations does
  not exist`, while cleanup still reported all three resource counts at zero.

- Observation: macOS ships Bash 3.2, where `mapfile` is unavailable, so a
  successful local cleanup emitted an error before collecting any additional
  run-labelled containers.
  Evidence: the first corrected local ARM64 rehearsal passed but printed
  `mapfile: command not found`; the portable read loop removed that error and
  the repeat rehearsal again reported zero containers, networks, and volumes.

- Observation: the exact-image rehearsal proved both Web slots served traffic
  but did not execute the controller's post-start Caddy validation command.
  Evidence: production green Web served `/tmp/Caddyfile.slot`, green API
  reported `ready=true` and `standby`, while
  `slot_web_validate` alone requested the removed
  `/srv/Caddyfile.slot`. The existing image test checked only the Dockerfile
  side of the boundary.

- Observation: a cache-busted kiosk navigation is not sufficient activation
  evidence when the fresh document can mount a blocking child route before
  its first deploy-status response.
  Evidence: Firefox stored one exact activation attempt on the self-inspection
  approval route, the API recorded 391 successful deploy-status GETs and zero
  POSTs, and that route opens a synchronous password prompt on first mount.

- Observation: raw Docker inspect data is not reproducible runtime evidence
  across a Compose or Engine update.
  Evidence: all three canary agents matched image, environment, security,
  mounts, restart, running state, and Compose identity after rollback, while
  only `runtimeConfigSha256` differed. Recreated Compose 5.1.1 containers had
  generated labels and daemon defaults absent from the older baseline.

- Observation: hosted vulnerability data can invalidate an otherwise unchanged
  production dependency override after the complete local deployment audit has
  passed.
  Evidence: PR #1180's first `docker-security (api)` run detected
  `CVE-2026-18446` in explicitly pinned `fast-uri` 3.1.4. The corrected 3.1.5
  lockfile is clean under a freshly updated local Trivy database.

- Observation: test harnesses that isolate application APIs must model the
  initial deployment authority now that routed kiosk content is fail-closed.
  Evidence: runtime-recovery correctly stayed on maintenance when its catch-all
  fixture returned 503 for deploy status, and the SOP generator's generic
  heading wait could observe the maintenance heading before the routed DOM.

- Observation: selecting a Linux amd64 Playwright image on an arm64 Mac does
  not make Chromium's glyph antialiasing byte-identical to native GitHub amd64.
  Evidence: the remaining hosted diff was visually identical and localized to
  a handful of antialias pixels in the drawing marker digit `1`; disabling font
  subpixel positioning then made all artifacts from three concurrent runs
  byte-identical to the committed set.

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

- Decision: initialize only the disposable empty database with the bootstrap
  superuser, then transfer ownership with the unchanged production role SQL
  and run both `migrate deploy` and `migrate status` as `raspi_migrator`.
  Rationale: this matches the existing real PostgreSQL role-boundary contract,
  proves the separated migration authority, and does not weaken or reorder any
  production deployment command.
  Date/Author: 2026-08-04 / Codex.

- Decision: make `SLOT_CADDY_CONFIG_FILE` an image-published runtime contract
  and have the controller validate the path from the running container.
  Rationale: runtime startup and post-start validation must not independently
  own a writable path. The controller retains `/srv/Caddyfile.slot` only when
  the active pre-contract image has no published variable, so the first old to
  new switch remains possible. The exact-image rehearsal requires the new
  contract for blue and green.
  Date/Author: 2026-08-04 / Codex.

- Decision: retain the failed run and green candidate as durable recovery
  evidence until a later approved standard run reconciles it.
  Rationale: direct Docker cleanup or an internal Blue/Green command would
  bypass the coordinator-owned `prepare-failed` recovery boundary.
  Date/Author: 2026-08-04 / Codex.

- Decision: treat undefined initial kiosk deploy status as fail-closed and do
  not mount routed business content until the first status response exists.
  Rationale: deployment authority must be established before child effects;
  otherwise a synchronous prompt can prevent both maintenance display and the
  exact-SHA ready claim.
  Date/Author: 2026-08-05 / Codex.

- Decision: version the reproducible runtime contract as manifest schema 3 and
  retain a bounded schema 2 recovery reader that still compares every
  separately sealed field.
  Rationale: new captures must reject functional drift without hashing
  Compose implementation metadata. The already-failed production manifest
  cannot be rewritten, so coordinator-owned recovery needs explicit backward
  compatibility rather than a manual state or service repair.
  Date/Author: 2026-08-05 / Codex.

- Decision: launch the SOP capture browser with
  `--disable-font-subpixel-positioning`, record generator version 1.2.0, and
  retain exact byte-for-byte generated-artifact validation.
  Rationale: the output must be reproducible across native and emulated amd64;
  tolerating image differences would weaken the fail-closed generated-content
  contract instead of removing the environmental input.
  Date/Author: 2026-08-05 / Codex.

## Outcomes & Retrospective

The first audit series and the slot Web correction completed review, main
integration, exact-main ARM64 evidence, and read-only production admission.
The next separately approved run proved the entire Pi5 route, including the
fixed 300-second monitor, but exposed two later Pi4 canary boundaries. A fresh
kiosk document could mount a blocking business route before learning deploy
status, and rollback compared a recreated container with non-reproducible raw
Docker metadata. Both failures remained fail-closed: later terminals were not
started and the canary retained maintenance and recovery authority.

The registry now contains 11 incidents. The complete local audit has repeated
successfully from the beginning: 991 deployment tests, all incident mutants,
real Compose recreation, all 157 migrations, deploy-status API contracts, 43
Ansible contracts, 103 CI contracts, documentation audit, and diff checks all
pass, with zero run-labelled Docker residue. This is not audit completion.
Hosted review, required CI, exact-main ARM64 rehearsal, and fresh read-only
production evidence still remain. Recovery of failed run
`20260804-185819-598324` and any later release remain separate approval gates.

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

The earlier production run `20260804-095823-73770f` found the undefined
`gateway_image` helper and motivated this audit. After PR #1178 and exact-main
evidence passed, standard run `20260804-122309-7e601d` reached a later
candidate boundary. It promoted both signed images and recorded migration as
applied, then failed because the Web image rendered `/tmp/Caddyfile.slot` and
the controller validated `/srv/Caddyfile.slot`. Traffic stayed on blue, all
terminals stayed pending, and the green candidate was preserved until the next
approved standard run reconciled it. The incident source of truth is
`docs/knowledge-base/KB-405-pi5-slot-web-runtime-config-drift.md`.

Standard run `20260804-185819-598324` reconciled that residue and completed the
Pi5 switch, monitor, and cleanup, then failed at its first Pi4 canary. The
canary file baseline was restored, but maintenance and recovery authority are
retained because ready activation and runtime rollback verification did not
complete. `docs/knowledge-base/KB-406-pi4-canary-initial-status-and-runtime-recreate.md`
contains the read-only evidence and the two current corrections.

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

The `slot-web-runtime-config` mutant must fail when the controller is changed
back to `/srv/Caddyfile.slot`. Both exact Web containers must expose a
non-empty `SLOT_CADDY_CONFIG_FILE`, contain that generated file, and pass
`caddy validate` against it before gateway switching.

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

Revision note 2026-08-04: Reopened the audit after approved exact-main run
`20260804-122309-7e601d` exposed a Web image/controller runtime path drift
that the first isolated rehearsal did not execute across the real boundary.

Revision note 2026-08-05: Recorded the native-amd64 SOP rasterization finding,
its deterministic capture contract, and the read-only six-host Pi4 fleet
snapshot while retaining failed-run maintenance and the production freeze.
