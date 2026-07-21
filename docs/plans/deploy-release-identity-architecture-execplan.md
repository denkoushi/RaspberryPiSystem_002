---
id: deploy-release-identity-architecture
title: Migrate deployment planning and evidence to typed release claims
status: blocked-pending-readonly-evidence-and-adr-acceptance
scope: rolling release planner, fleet and run state, Kiosk activation, SSH and Local executors, route contracts
date: 2026-07-21
source_of_truth: docs/plans/deploy-release-identity-architecture-execplan.md
related_code:
  - scripts/deploy/rolling_release/
  - scripts/deploy/terminal-profile-registry.json
  - apps/web/src/layouts/KioskLayout.tsx
related_docs:
  - docs/knowledge-base/KB-401-deploy-release-identity-runtime-audit.md
  - docs/decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - docs/plans/deploy-release-identity-readonly-evidence-manifest.md
  - docs/plans/deploy-speed-phase-b-execplan.md
validation: offline source audit, pure typed-claim prototype, 747 deploy Python tests, aggregate deploy contracts, and 13 current Kiosk ACK tests
open_items:
  - obtain separate approval and execute the bounded read-only evidence manifest
  - accept or revise the ADR after the incident-specific evidence is classified
  - keep production implementation and all hardware rollout blocked until the Go gate opens
---

# Migrate deployment planning and evidence to typed release claims

This ExecPlan is a living document. Maintain its `Progress`,
`Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`
sections whenever work resumes. It follows `.agent/PLANS.md` in the repository
root.

## Purpose / Big Picture

After this work, an operator can deploy a Pi5 Web change without changing a
terminal repository while the coordinator still activates and verifies the Web
bundle actually running in each selected Kiosk browser. A terminal Git release,
a Pi5 Web release, a sealed Local artifact, and a pinned Local runtime become
separate, typed facts. The coordinator cannot call a host verified until every
fact required by that host and executor is independently observed.

The existing one-terminal-at-a-time order, sixty-second terminal notice,
five-minute Pi5 stability monitor, fail-closed behavior, sealed manifest
rollback, and Phase B changed-only service/container lifecycle remain. The
default executor remains SSH Ansible. Local Ansible stays behind its StoneBase
flag and is not rebased until the typed-claim SSH path is proven.

This plan is currently blocked. It must not be used to change production code,
retry a deployment, bootstrap a runtime, run Local Ansible, or connect to a
device until the read-only evidence gate completes and
`docs/decisions/ADR-20260721-deploy-release-identity-and-activation.md` is
accepted.

## Progress

- [x] (2026-07-21 08:30Z) Froze Local implementation and production retries after the final ready-ACK failure and successful sealed rollback.
- [x] (2026-07-21 04:05Z) Audited current planning, ACK, browser, terminal, runtime, rollback, and route-contract identity boundaries from `origin/main` at `79ee42ac44e4ffbf33a515df7cc894e910fc8d95`.
- [x] (2026-07-21 04:10Z) Prototyped mutation, activation, and verification target sets plus typed claims in memory without production code or device access.
- [x] (2026-07-21 04:15Z) Recorded the proposed architecture, compatibility rules, rejected local fixes, and current No-Go gate in the related ADR and KB-401.
- [x] (2026-07-21 04:23Z) Passed 747 deploy Python tests, the complete aggregate deploy contract including isolated PostgreSQL ACK tests and Ansible syntax, 13 current Kiosk ACK tests, deploy safety, and the Phase B lifecycle contract without changing production code.
- [ ] Obtain separate approval and collect only the evidence allowed by `docs/plans/deploy-release-identity-readonly-evidence-manifest.md`.
- [ ] Resolve the incident-specific browser timeline as CONFIRMED, REJECTED, or INCONCLUSIVE and change the ADR status only if the Go conditions are satisfied.
- [ ] Milestone 1: add typed claim models and dual-read state without changing live behavior.
- [ ] Milestone 2: split planner targets and make the planned work observable without enabling new activation.
- [ ] Milestone 3: add bounded Kiosk Web activation and the one-time old-bundle migration.
- [ ] Milestone 4: migrate SSH Kiosk and Signage verification/finalization to typed claims.
- [ ] Milestone 5: rebase the StoneBase Local executor behind its explicit flag.
- [ ] Milestone 6: replace route metadata coverage with executable transitions and shared fault scenarios.
- [ ] Obtain a new explicit approval for a Pi5 plus StoneBase-only canary; keep FJV and every other terminal excluded.

## Surprises & Discoveries

- Observation: `apps/web/` is correctly classified as Pi5-only mutation, but a
  Kiosk browser is an unmodeled downstream consumer.
  Evidence: the existing classifier and planner tests intentionally return zero
  terminal targets for a Web-only change, while `KioskLayout.tsx` sends readiness
  from the compiled browser SHA.

- Observation: the stale-bundle rejection is a sound safety check with no
  corresponding progress transition.
  Evidence: the Web test rejects an ACK from an old compile-time SHA, but the
  current page has no bounded reload or cache-bust path when a newer challenge
  appears.

- Observation: Phase B did not create the identity gap; it removed a service
  restart that had sometimes hidden it.
  Evidence: release-only mode now restarts changed services only, while the
  planner and fleet schema already lacked browser-consumer identity.

- Observation: the Local candidate ACK is useful but narrower than host
  evidence.
  Evidence: it binds a candidate and artifact to the terminal runner, but it
  does not prove browser Web, systemd, authenticated identity, or agent health.

- Observation: a route stage can have a rehearsal test name without its
  semantic transition being exercised.
  Evidence: current route tests validate stage registrations and method
  existence, not stage-specific preconditions, postconditions, progress, and
  response-loss reconciliation.

## Decision Log

- Decision: keep the current state as No-Go and prohibit local symptom fixes.
  Rationale: increasing timeout, trusting a desired SHA, or restoring an
  unconditional restart cannot represent the missing browser-consumer state.
  Date/Author: 2026-07-21 / Codex.

- Decision: preserve the immutable Local comparison ref
  `93d8bef4a31d52d0adcb18abfc1731f0e78d335c` and begin architecture work from
  current `origin/main` only after the gate opens.
  Rationale: this separates incident evidence and architecture changes from the
  experimental implementation and avoids rewriting its history.
  Date/Author: 2026-07-21 / Codex.

- Decision: split targets into `mutationTargets`, `activationTargets`, and
  `verificationTargets`.
  Rationale: a host can consume an artifact without owning the repository files
  that produced it.
  Date/Author: 2026-07-21 / Codex.

- Decision: make release proof a set of typed claims and derive legacy host
  evidence from required claims during migration.
  Rationale: identical-looking SHA fields currently mean Pi5 Web, terminal Git,
  or Local candidate depending on the caller.
  Date/Author: 2026-07-21 / Codex.

- Decision: implement steady-state browser activation separately from a
  manifest-owned first migration for already deployed old bundles.
  Rationale: an old bundle cannot execute code it does not contain, and a
  one-time service activation is not a configuration change.
  Date/Author: 2026-07-21 / Codex.

- Decision: migrate additively and keep old run records immutable.
  Rationale: interrupted recovery must continue using the schema, authority,
  and sealed manifests that existed when the run began.
  Date/Author: 2026-07-21 / Codex.

## Outcomes & Retrospective

The investigation phase produced a coherent state model and rejected the
near-term cycle of per-failure patches. The prototype can express Web-only,
terminal-only SSH, Local, no-op, response-loss, and forward-Pi5/terminal-
rollback states without sharing one SHA meaning. That is a feasibility result,
not production acceptance.

Implementation has not started. The incident-specific browser process timeline
is still not observed under the new approval boundary, so the correct outcome
at this stopping point is a documented No-Go with the current safe production
state left untouched.

## Context and Orientation

The standard entry point is `scripts/update-all-clients.sh`. Python modules in
`scripts/deploy/rolling_release/` create a plan, submit a coordinator unit to
Pi5, persist fleet and run state, serialize terminal work, and own rollback.
`scripts/deploy/terminal-profile-registry.json` maps changed paths to Pi5 or
terminal profiles and selects the existing ready authority. The Kiosk browser
in `apps/web/src/layouts/KioskLayout.tsx` observes a ready challenge and sends
the SHA compiled into its JavaScript bundle.

A mutation target owns a file, image, service, or container that must change.
An activation target already consumes an artifact and must acquire its selected
version even when its files do not change. A verification target must produce
one or more independent observations before the run may commit.

A release claim is a typed expected-versus-observed identity record. The first
claim kinds are `controlPlaneApi`, `controlPlaneWeb`, `terminalRepository`,
`localArtifact`, and `runtime`. A desired value is not an observation. An ACK is
valid only for its declared claim kind, exact verification ID, and exact
identity. Host evidence is `verified` only when every required claim is
verified and the existing independent service/agent evidence succeeds.

KB-401 is the single detailed incident and audit source. The ADR is the design
decision. This ExecPlan is the future implementation recipe. Do not copy the
incident timeline into this file.

## Plan of Work

### Milestone 1: typed claims and dual-read state, no behavior change

Create a closed claim model in a new module under
`scripts/deploy/rolling_release/`. Define enums or validated constants for
claim kinds, identity domains, authorities, and `unknown|verified` state. Add
strict constructors that reject unknown keys, invalid SHAs/digests, missing
verification IDs for ACK-backed observations, timestamps without UTC, and an
observed identity that does not equal the expected identity when state is
verified.

Extend fleet and run schema readers additively. New records may contain a
bounded `releaseClaims` object, but existing fields remain required and keep
their current semantics. A compatibility adapter can project independently
verified legacy terminal Git and Pi5 image evidence into their matching claim;
it must never infer a Kiosk browser claim from Pi5 Web state. Old active runs
stay on the legacy path through finalization and rollback. Add golden fixtures
for every supported old schema and corrupt mixed-schema records.

Acceptance for this milestone is byte-for-byte unchanged plans and legacy run
behavior, plus round-trip tests for the new schema. Do not add browser reloads,
new targets, or Local behavior here.

### Milestone 2: explicit target sets and dry-run visibility

Refactor the planner to return ordered mutation, activation, and verification
targets. Preserve the existing terminal registry order and process each host at
most once. The union determines serial terminal work; per-host action flags
determine whether it needs Git/Ansible mutation, browser activation, and which
claims it must verify.

Update `--print-plan`, preflight reports, and durable planned state so an
operator sees each target set, required claim, and reason. Initially keep the
new activation operation disabled behind a repository-owned architecture flag,
so the stage can be tested without reaching a device. A Web-only fixture must
show Pi5 mutation, Kiosk activation/verification, and zero terminal Git/Ansible
mutation. A same-SHA no-op is permitted only if all required consumer claims
are already verified and current.

### Milestone 3: bounded Kiosk Web activation

Add steady-state challenge handling to the Kiosk Web client. When a valid Web
claim challenge expects a different compile-time SHA, keep the maintenance UI
visible and perform a same-origin navigation with a cache-busting token bound
to run ID, verification ID, and desired Web SHA. Store only bounded retry
metadata. Stop after a fixed attempt count or deadline and do not ACK until the
newly loaded bundle compares its own compiled SHA exactly.

Add browser tests that cross an actual reload boundary: stale bundle to current
bundle, cache still stale, retry exhaustion, malformed challenge, changed
verification ID, and successful exact ACK. The server must not accept the
challenge value as browser evidence.

Already deployed bundles lack this code. Add one activation strategy ID,
`kiosk-web-activation-v1`, to the coordinator/adapter boundary. It may stop or
restart only `kiosk-browser.service`, only inside acknowledged maintenance, and
only after the runtime manifest containing that unit has been sealed. Its
deterministic operation state is reconciled after response loss before ready or
rollback. Persist capability proof so a migrated browser uses steady-state
reload later. Do not report this as an Ansible or configuration change.

### Milestone 4: SSH and Signage typed finalization

Map the Kiosk browser ACK to `controlPlaneWeb` and terminal Git observation to
`terminalRepository`. Map the existing Signage terminal-ready probe only to
`terminalRepository`. Preserve independent identity, systemd, Docker, and
authenticated agent health checks. Promote host evidence only from the full
required claim set and existing health proof.

Teach interrupted recovery and rollback to restore terminal repository claims
from sealed manifests while preserving the forward Pi5 Web claim. Add fixtures
for Pi5 forward plus terminal rollback, rollback response loss, missing browser
claim, and a legacy Signage run. Keep the default executor identifier and SSH
commands unchanged.

### Milestone 5: rebase StoneBase Local execution

Only after the typed SSH path is accepted, create a new branch from the then
current main and port the minimum Local executor changes from immutable ref
`93d8bef4a31d52d0adcb18abfc1731f0e78d335c`. Do not merge the old branch as a
unit. Preserve its StoneBase-only flag, secret-free eligibility, incremental
artifact, pinned runtime, single transfer, deterministic unit, exclusive lock,
bounded result, and response-loss reconciliation.

The Local candidate ACK verifies `localArtifact`; exact terminal HEAD verifies
`terminalRepository`; runtime preflight verifies `runtime`; Kiosk readiness
verifies `controlPlaneWeb`. No Local result or ACK may satisfy another claim.
Runtime/config candidates still fall back to SSH before maintenance. Once
maintenance begins, the only failure path is quiescence reconciliation followed
by existing manifest-bounded rollback.

### Milestone 6: executable route transitions and fault matrix

Replace the current metadata-only route coverage with closed transition
definitions consumed by planner validation, preflight, and tests. Every stage
must declare required durable phase and claims, operation class, produced
claims, timeout, response-loss reconciliation, rollback eligibility, failure
policy, and recovery owner. Scenario IDs must execute before-call, after-call,
and response-loss boundaries rather than only naming a test method.

The shared matrix must cover source and inventory, Pi5 begin/switch/stability,
manifest seal, notice, maintenance, SSH apply, Local submit/unit, browser
activation, each typed ACK, independent evidence, cleanup, commit, rollback,
cancel, and interrupted recovery.

### Milestone 7: approved canary and performance proof

After all offline and hosted checks pass, present the exact candidate SHA,
target sets, claim requirements, migration capability state, fault-test result,
and rollback conditions. Request a new approval for Pi5 and StoneBase only.
Never include `raspi4-fjv60-80` or another terminal in connection, planning,
preflight, status, or deployment.

Use canonical `--print-plan` and `--preflight-only` before any mutation. The
first live run performs only the manifest-owned old-bundle activation migration
if required, then proves typed claims. Local bootstrap and Local execution are
separate later runs with separate approvals. Measure Pi5 fixed delay, terminal
notice, activation, mutation, ACK, independent evidence, and cleanup separately.

## Concrete Steps

When the Go gate opens, create a fresh worktree from the latest remote main:

    git fetch origin main
    git worktree add ../RaspberryPiSystem_002-release-claims -b feat/deploy-release-claims origin/main
    cd ../RaspberryPiSystem_002-release-claims
    git status --short --branch

Before editing, repeat the focused baseline:

    python3 -m unittest -v \
      scripts.deploy.tests.test_classify_deploy_impact \
      scripts.deploy.tests.test_terminal_profile_registry \
      scripts.deploy.tests.test_route_contract \
      scripts.deploy.tests.test_terminal_adapters
    python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py

Implement one milestone per reviewable commit. After every state-schema change,
run the old-schema, corrupt-state, interrupted-recovery, and rollback fixtures
before moving to target selection or browser activation. After Web changes, run
the exact Kiosk ready test command recorded in `apps/web/package.json`; include
reload-boundary tests, not only mocked function calls.

Run the complete offline gate before proposing hardware work:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    scripts/ci/run-deploy-contracts-local.sh

Do not run `scripts/update-all-clients.sh`, SSH, inventory Ansible, bootstrap,
Local execution, or `--reverify-selected` while this plan is blocked. The
read-only evidence commands belong only to the separate approval manifest.

## Validation and Acceptance

Offline acceptance requires all existing tests to remain green and new tests
to demonstrate observable behavior in every critical scenario:

- A Web-only diff mutates Pi5, activates/verifies an in-scope Kiosk, and does
  not run terminal Git or Ansible.
- Pi5 plus terminal mutation with unchanged systemd configuration keeps Phase B
  changed-only behavior and still acquires the Web bundle.
- Terminal-only SSH keeps Pi5 Web unchanged and verifies terminal Git
  separately.
- StoneBase Local has four distinct proofs: Web, terminal repository, artifact,
  and runtime.
- Missing or incompatible Local runtime falls back before notice/maintenance.
- Submit, unit, activation, ACK, independent evidence, cleanup, and rollback
  response loss retain unknown evidence until their deterministic owner is
  reconciled.
- Terminal rollback can restore the previous terminal SHA while preserving the
  forward verified Pi5 Web/browser claim.
- Signage remains terminal-authoritative.
- Same-SHA no-op is rejected when any required consumer claim is missing or
  stale.
- An old Kiosk bundle can complete the one-time activation migration, and a
  new bundle uses bounded reload without an unrelated configuration restart.

Every route transition must have a precondition, postcondition, proof owner,
timeout, response-loss outcome, rollback condition, and executable fault
scenario. A count of passing tests is not sufficient if any listed scenario is
unmapped.

Hardware acceptance requires a separately approved Pi5 plus StoneBase canary,
zero FJV contact, exact typed claims verified in durable state, maintenance
cleared only after cleanup, and a rehearsed sealed rollback. A safety- or
progress-relevant INCONCLUSIVE result closes the gate and forbids retry.

## Idempotence and Recovery

Schema introduction is additive and repeatable. Rewriting a new-schema record
must preserve unknown claims and must not manufacture observations. Legacy
records remain readable; legacy active runs never change execution model in
place. Each migration commit can be reverted before a live flag is enabled
without rewriting deployed records.

Browser reload attempts are bounded and keyed by the exact challenge, so a page
reload cannot create an unbounded loop. The old-bundle activation operation is
deterministic and reconciled before another activation or rollback. Terminal
rollback continues to use only manifests sealed before maintenance. Local
rollback continues to wait until its deterministic unit is known quiescent.

Never recover by editing fleet/run JSON, maintenance state, Git checkouts,
systemd units, runtime symlinks, or manifests manually. Use canonical status,
cancel, and sealed recovery paths. If a new claim cannot be independently
observed, retain maintenance and evidence unknown.

## Artifacts and Notes

Audit baseline:

    origin/main: 79ee42ac44e4ffbf33a515df7cc894e910fc8d95
    immutable Local comparison ref: 93d8bef4a31d52d0adcb18abfc1731f0e78d335c
    focused audit tests: 50 passed
    lifecycle contract: PASS
    typed-claim prototype: six normal/no-op/rollback scenarios PASS
    Local response-loss prototype: maintenance retained

The prototype was pure in-memory code and was not added to production. Its role
was to prove that target and identity separation can represent the required
states before any implementation resumes.

Local Notes JA: `raspi4-fjv60-80` は明示的な新指示がない限り、接続・
preflight・status・配布の全対象から除外する。初回canaryはPi5と
`raspi4-kensaku-stonebase01`だけを別承認で扱う。

## Interfaces and Dependencies

Define a closed claim model equivalent to:

    ReleaseClaim(
        kind,
        expected_identity,
        observed_identity,
        authority,
        verification_id,
        state,
        observed_at,
        last_run_id,
    )

Define one planned host work item with ordered action flags and required claim
kinds. The planner output exposes `mutationTargets`, `activationTargets`, and
`verificationTargets`. The coordinator consumes one combined terminal order
and never starts two terminal operations concurrently.

The registry may name only closed claim kinds and activation strategy IDs. It
must not contain shell commands. The compatibility adapter reads legacy
`readyAuthority` and legacy fleet fields for one version, while new writes use
typed claims. Python standard-library validation remains sufficient; do not add
a new serialization dependency solely for these records.

The Web client uses its existing authenticated ready/status channel. It may add
bounded activation-attempt metadata, but it must not persist tokens, inventory,
Ansible variables, or credentials. The Local runtime and collection pins stay
at the versions and hashes sealed by the candidate implementation; any change
to those pins is a separate reviewed dependency update.

Revision note (2026-07-21 04:23Z): Created this blocked implementation plan from
the full-route identity audit. It replaces immediate Local integration with an
additive typed-claim and activation migration and records the separate evidence
and hardware approval gates. Recorded the complete current offline contract
baseline after validation.
