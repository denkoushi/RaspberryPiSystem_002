---
id: deploy-release-identity-architecture
title: Migrate deployment planning and evidence to typed release claims
status: offline-implementation-complete-live-rollout-blocked
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
validation: Milestones 1 through 6 complete with 840 deploy Python tests, 19 bounded Web activation tests, full aggregate deploy contracts, sealed runtime supply-chain verification, and approved read-only evidence sha256:f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8
open_items:
  - present canonical Pi5 plus StoneBase-only print-plan and preflight commands for a new exact hardware approval
  - keep Local bootstrap, Local execution, and every hardware mutation blocked until that approval
  - keep FJV and every terminal other than StoneBase excluded
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
flag and was rebased only after the typed-claim SSH path was proven and merged.

The evidence gate, related ADR, and Milestones 1 through 6 offline
implementation are complete. This is not hardware authorization. It must not
be used to retry a deployment, bootstrap a runtime, run Local Ansible,
reverify, or connect to a device until a new exact hardware approval is
granted for the canonical Pi5 plus StoneBase-only gate.

## Progress

- [x] (2026-07-21 03:50Z) Froze Local implementation and production retries after the final ready-ACK failure and successful sealed rollback.
- [x] (2026-07-21 04:05Z) Audited current planning, ACK, browser, terminal, runtime, rollback, and route-contract identity boundaries from `origin/main` at `79ee42ac44e4ffbf33a515df7cc894e910fc8d95`.
- [x] (2026-07-21 04:10Z) Prototyped mutation, activation, and verification target sets plus typed claims in memory without production code or device access.
- [x] (2026-07-21 04:15Z) Recorded the proposed architecture, compatibility rules, rejected local fixes, and current No-Go gate in the related ADR and KB-401.
- [x] (2026-07-21 04:23Z) Passed 747 deploy Python tests, the complete aggregate deploy contract including isolated PostgreSQL ACK tests and Ansible syntax, 13 current Kiosk ACK tests, deploy safety, and the Phase B lifecycle contract without changing production code.
- [x] (2026-07-21 04:38Z) Executed the separately approved Pi5 plus StoneBase read-only manifest with no mutation or FJV contact; normalized evidence digest is `f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8`.
- [x] (2026-07-21 04:38Z) Confirmed that the forward apply did not restart the Kiosk browser and sealed rollback did; accepted the ADR and opened offline implementation only.
- [x] (2026-07-21 05:03Z) Completed Milestone 1: added the closed typed-claim model, additive fleet/run readers, legacy evidence adapter, and golden compatibility fixtures. Passed the focused 50 tests plus lifecycle contract, 770 deploy Python tests, and the complete offline aggregate including shell, safety, Pi5/Signage lifecycle, isolated PostgreSQL ACK, inventory, and Ansible contracts.
- [x] (2026-07-21 05:43Z) Completed Milestone 2 offline: split ordered mutation, activation, and verification targets; moved required claims and activation strategy into registry schema v4; exposed provisional/effective SSH executor state; and added preflight/coordinator gates that prevent disabled activation or verification-only work from reaching mutation.
- [x] (2026-07-21 06:50Z) Completed Milestone 3 offline: added bounded stale-bundle reload, manifest-owned one-time browser activation, deterministic response-loss reconciliation, durable capability proof, and cleanup-before-maintenance-clear while leaving activation execution disabled.
- [x] (2026-07-21 07:37Z) Completed Milestone 4 offline: mapped Kiosk Web and Signage repository ACKs to typed claims, required the complete profile claim set plus independent evidence before promotion, rebound rollback repository claims only to the sealed previous SHA, enabled activation and verification-only execution on the unchanged SSH executor, and passed 808 deploy tests plus the complete aggregate offline gate and 19 focused Web ACK tests.
- [x] (2026-07-21 10:12Z) Completed Milestone 5 offline: ported the minimum sealed StoneBase Local executor behind its exact-scope flag, retained pre-maintenance SSH fallback and post-maintenance rollback-only behavior, and kept Web, repository, artifact, runtime, and independent-health proofs separate.
- [x] (2026-07-21 10:12Z) Completed Milestone 6 offline: made all 30 route stages executable transition contracts, bound planning and preflight to a deterministic receipt, and exercised before-call, after-call, and response-loss boundaries through shared scenarios.
- [x] (2026-07-21 10:12Z) Passed the complete offline acceptance gate: 840 deploy Python tests, 20 isolated PostgreSQL/API tests, 24 recovery tests, safety/lifecycle/shell contracts, 99 Ansible template parses, all playbook syntax/check contracts including the sealed Local playbook, 19 focused Web tests, Web typecheck/lint, and exact runtime artifact/hash checks.
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

- Observation: current planning labels an executor effective before aggregate
  preflight can prove it.
  Evidence: approved `--print-plan` reported Local effective with no fallback,
  while preflight `20260721-043630-dd9ed9` reported SSH effective,
  `candidate-requires-ssh-configuration`, runtime null, and no submission.

- Observation: fleet and run persistence have different schema boundaries.
  Evidence: `fleet_state.py` requires an exact host-key set, while `state.py`
  deliberately permits evolving run payloads. Milestone 1 therefore accepts
  `releaseClaims` as the only optional fleet-host field and validates it only
  inside the existing run `hosts` and `targets` collections.

- Observation: a pre-maintenance interrupted typed run can prove the live
  repository while its browser claim remains unknown.
  Evidence: the recovery path previously promoted legacy host evidence after
  repository observation alone. Milestone 4 now persists the independently
  observed repository claim but leaves the host `unknown`, forcing the next
  locked plan to perform the missing activation or verification work.

- Observation: rollback must invalidate claim observations before it mutates
  the terminal, even when forward verification had already completed.
  Evidence: retaining a verified forward repository claim through an
  unverifiable rollback would let a later planner consume stale proof.
  Milestone 4 clears all required observations before rollback and recreates
  them only after exact rollback ACK and independent health evidence.

- Observation: first-run seed cannot manufacture a Kiosk Web claim from a
  repository and systemd probe.
  Evidence: Signage's required set is fully observable from its repository
  evidence, while Kiosk additionally requires `controlPlaneWeb`. A first-run
  Kiosk therefore remains `unknown` with only its observed baseline repository
  claim until the browser claim is verified.

- Observation: legacy rollback evidence can be verified even when its recorded
  desired SHA differs from the restored current SHA.
  Evidence: the existing fleet test
  `test_verified_terminal_may_record_a_verified_rollback_drift` requires this
  state. The compatibility adapter retains the observed SHA but marks the
  candidate-oriented typed claim `unknown`; it never converts drift into a
  verified expected claim.

- Observation: target separation cannot safely hard-code the current terminal
  profile names in the planner.
  Evidence: the complete Python discovery initially stopped at the existing
  core-independence contract. Registry schema v4 now owns the closed required
  claim kinds and activation strategy ID; the planner consumes only registry
  data and the contract passes.

- Observation: activation gating alone does not make same-SHA no-op safe.
  Evidence: a Signage record with a missing `terminalRepository` claim needs
  verification but neither mutation nor browser activation. Milestone 2 now
  identifies verification-only work and blocks it before mutation until a
  bounded execution stage exists.

- Observation: the CI aggregate wrapper requires workspace-local Node package
  dependencies even when the changed deploy code is Python-only.
  Evidence: the wrapper passed its then-current 780 Python tests and lifecycle
  contracts, then stopped in the isolated PostgreSQL test because `tsc` was
  absent from this fresh worktree. Deploy safety, 24 recovery tests, two inventory
  contracts, all Ansible syntax checks, and the recovery check were rerun
  separately and passed. No dependency install was performed.

- Observation: a capability proof needs the ACK verification ID as well as the
  compiled release SHA.
  Evidence: matching only the old `controlPlaneWeb` observed SHA would allow a
  proof from a different challenge to select steady-state reload. Milestone 3
  binds and compares strategy, release SHA, verification ID, authority, run,
  and timestamp before skipping the one-time migration.

- Observation: the existing core-independence contract also applies to Python
  identifier names, not only string policy branches.
  Evidence: the first complete 794-test discovery rejected profile-specific
  activation constant names in coordinator and planner. Core modules now use
  generic Web-consumer activation names; the profile-specific strategy remains
  in the adapter boundary and the complete discovery passes.

- Observation: an activation transport error is not rollback authority.
  Evidence: the deterministic transient unit may have been accepted before the
  SSH response disappeared. Bounded reconciliation must prove it absent,
  succeeded, or failed before sealed rollback; a running or unreadable unit
  retains maintenance, active recovery ownership, and unknown evidence.

- Observation: the complete aggregate can run in this fresh worktree without
  installing dependencies by temporarily referencing the existing local
  workspace dependency trees for each package that the isolated PostgreSQL
  test builds.
  Evidence: after the first environment-only `tsc` failure, the same aggregate
  passed 794 Python tests, 20 isolated PostgreSQL ACK tests, 99 template parses,
  deploy safety, lifecycle, recovery, inventory, and every Ansible syntax
  check. All temporary references and generated build outputs were removed.

- Observation: a Local Git reset cannot use the SSH apply command result to
  decide whether container images changed.
  Evidence: the sealed Local playbook has its own reset result. Milestone 5
  emits the exact previous HEAD and feeds that result into the unchanged Phase
  B lifecycle selection, so a no-change Local run does not rebuild every
  enabled image.

- Observation: an accepted remote call with a lost response cannot produce a
  typed claim in the pure route model.
  Evidence: Milestone 6 initially advanced the simulated stage before marking
  evidence unknown. The final transition contract preserves the pre-call claim
  set, retains maintenance conservatively, and assigns progress only after the
  named owner reconciles the deterministic effect.

- Observation: version labels alone are insufficient runtime authority.
  Evidence: the pinned aarch64 Python distribution, all nine hash-locked Python
  wheels, and the `community.general` collection were downloaded in a temporary
  local verification area and matched their checked-in SHA-256 values. The
  installer now accepts the exact collection URL and digest, not a domain
  prefix or digest-shaped string.

## Decision Log

- Decision: keep live operation No-Go and prohibit local symptom fixes.
  Rationale: increasing timeout, trusting a desired SHA, or restoring an
  unconditional restart cannot represent the missing browser-consumer state.
  Date/Author: 2026-07-21 / Codex.

- Decision: open the accepted redesign for offline implementation while keeping
  every hardware action blocked.
  Rationale: the approved browser journal and durable state resolve the last
  safety/progress-relevant inconclusive item, but no new activation or migration
  code exists yet.
  Date/Author: 2026-07-21 / Codex.

- Decision: distinguish requested, provisional, and effective executor state.
  Rationale: source/history planning and full runtime/candidate preflight proved
  different executor outcomes for the same fixed candidate. Only the latter may
  be called effective or authorize maintenance.
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

- Decision: use Git SHA identity for `controlPlaneApi`, `controlPlaneWeb`, and
  `terminalRepository`, and sha256-prefixed digest identity for `localArtifact`
  and `runtime`.
  Rationale: the current independent Pi5 and terminal evidence binds immutable
  images and repository state to the release Git SHA, while Local artifact and
  runtime locks are content-digest authorities. This avoids treating image tag
  strings or runtime version labels as durable identities.
  Date/Author: 2026-07-21 / Codex.

- Decision: close authority IDs in code and distinguish ACK-backed authorities
  from direct probes.
  Rationale: Kiosk compiled-Web, Signage ready, and Local runner observations
  require a 32-lowercase-hex verification ID. Pi5 image, terminal repository,
  and Local runtime probes reject a verification ID so one field cannot silently
  acquire two meanings.
  Date/Author: 2026-07-21 / Codex.

- Decision: expose legacy projection as an explicit compatibility adapter and
  do not insert projected claims during a read or legacy write.
  Rationale: byte-for-byte legacy behavior and old active-run recovery must stay
  unchanged in Milestone 1. A Kiosk legacy record projects only
  `terminalRepository`; only a complete verified Pi5 image record projects API
  and Web claims, so no browser claim is manufactured.
  Date/Author: 2026-07-21 / Codex.

- Decision: enable typed target planning while keeping activation execution
  and verification-only execution disabled by repository constants.
  Rationale: `--print-plan` and preflight must expose missing consumer work,
  but Milestone 2 has no device activation or verification-only executor. Both
  cases therefore fail before Pi5 or terminal mutation instead of falling
  through to a false no-op success.
  Date/Author: 2026-07-21 / Codex.

- Decision: put terminal required claims and activation strategy IDs in strict
  registry schema v4 while retaining legacy `readyAuthority`.
  Rationale: core planning remains profile-independent, commands cannot enter
  registry data, and existing SSH ACK behavior stays readable until Milestone
  4 migrates finalization.
  Date/Author: 2026-07-21 / Codex.

- Decision: bound steady-state Web activation to three same-origin reloads,
  sixty seconds, and a two-second retry interval, keyed by run ID,
  verification ID, desired Web SHA, and attempt.
  Rationale: stale caches need a progress path, while malformed storage,
  backwards time, changed challenges, and persistent stale content must not
  create an unbounded loop or an ACK from a desired value.
  Date/Author: 2026-07-21 / Codex.

- Decision: implement the old-bundle migration as one deterministic transient
  unit authorized by the sealed runtime manifest and acknowledged maintenance.
  Rationale: the old bundle cannot self-reload. The operation restarts only the
  allowlisted browser service, is not an Ansible/configuration change, and can
  be reconciled by exact run/host identity after response loss.
  Date/Author: 2026-07-21 / Codex.

- Decision: persist activation capability only after an exact ready ACK and
  retain the ACK verification ID in the proof; update the proof after a
  verified rollback ACK as well.
  Rationale: forward Pi5 plus terminal rollback can still load the new browser
  bundle. The next run may use steady reload only when its typed Web claim and
  the exact capability proof agree.
  Date/Author: 2026-07-21 / Codex.

- Decision: keep `ACTIVATION_EXECUTION_ENABLED` false after Milestone 3.
  Rationale: Milestone 4 still owns typed Kiosk/Signage claim finalization.
  Shipping the activation mechanism does not authorize the canonical route to
  execute it before the full claim set can commit atomically.
  Date/Author: 2026-07-21 / Codex.

- Decision: enable activation and verification-only execution after Milestone
  4 while retaining `ssh-ansible` as requested, provisional, and effective
  executor.
  Rationale: the coordinator now validates the exact profile-required claim
  set, binds each ACK to one claim kind, retains independent systemd, identity,
  Docker, and authenticated health evidence, and refuses final promotion if
  any claim is missing or stale. This supersedes only the Milestone 3 temporary
  execution-disable decision; it does not enable Local Ansible.
  Date/Author: 2026-07-21 / Codex.

- Decision: permit a rollback terminal repository claim to differ from legacy
  `desiredSha` only when it is exactly observed at the sealed `previousSha`.
  Rationale: forward Pi5 Web may remain current while terminal Git returns to
  its bounded previous release. Accepting any other verified drift would turn
  an arbitrary observed SHA into rollback authority.
  Date/Author: 2026-07-21 / Codex.

- Decision: keep host evidence unknown when interrupted recovery has only a
  partial typed claim set.
  Rationale: repository liveness must not stand in for a browser ACK. The
  observed repository claim remains durable for planning, but only a later
  complete verification can promote the host.
  Date/Author: 2026-07-21 / Codex.

- Decision: enable Local only through
  `--stonebase-local-ansible-poc` with exact Pi5 plus StoneBase scope, while
  leaving `ssh-ansible` as the unchanged default and fallback.
  Rationale: eligibility can be proved before notice and maintenance; after
  maintenance begins, switching forward executors would create unsealed
  authority, so only quiescence reconciliation and manifest-bounded rollback
  remain legal.
  Date/Author: 2026-07-21 / Codex.

- Decision: bind a Local artifact to the previous and candidate SHA, terminal
  and status identity, runtime and rollback authorities, maintenance ACK, all
  member hashes, and one deterministic systemd unit.
  Rationale: a single transfer is safe only when the coordinator and runner can
  independently reject replay, prerequisite loss, substitution, extra members,
  unsafe paths, runtime drift, and result identity drift without reading a
  secret value.
  Date/Author: 2026-07-21 / Codex.

- Decision: make route transitions and the plan receipt executable shared
  contracts rather than metadata coverage.
  Rationale: target-set membership, required verification, produced claims,
  response loss, rollback eligibility, and recovery ownership must be rejected
  by the same model used by planner, preflight, and fault tests.
  Date/Author: 2026-07-21 / Codex.

## Outcomes & Retrospective

The investigation phase produced a coherent state model and rejected the
near-term cycle of per-failure patches. The prototype can express Web-only,
terminal-only SSH, Local, no-op, response-loss, and forward-Pi5/terminal-
rollback states without sharing one SHA meaning. That is a feasibility result,
not production acceptance.

Milestone 1 is complete offline on `feat/deploy-release-claims`. It adds a
strict model and dual-read boundary without routing any production decision
through the new claims. Golden legacy records read without field insertion,
mixed records round-trip their claims, corrupt mixed identities fail closed,
and a typed record produces the same legacy planner decision. Complete
aggregate validation passed. At that milestone, Milestones 4 through 6 and the
separate future hardware gate remained open. Live rollout remains No-Go and
the current safe production state is untouched.

Milestone 2 is complete offline on the same branch. Public and durable plans
now contain ordered `mutationTargets`, `activationTargets`,
`verificationTargets`, one de-duplicated terminal work order, detailed claim
requirements, and requested/provisional/effective executor state. A Web-only
fixture produces Pi5 mutation plus Kiosk activation/verification with no
terminal mutation; terminal-only SSH preserves the current Web claim; and a
same-SHA plan is empty only when every required claim is current. Canonical
preflight uses a provisional read-only plan snapshot and promotes only the SSH
executor after aggregate probes pass. Disabled activation and verification-
only work are blocked in both preflight and the coordinator before mutation.
No activation command, ACK change, timeout change, Local executor, or device
operation was added. Live rollout and the hardware gate remain No-Go; Milestone
4 was the next implementation step at that milestone.

Milestone 3 is complete offline on the same branch. A stale Kiosk bundle now
keeps maintenance visible and performs only bounded, same-origin,
challenge-bound cache-busted reloads; only a newly compiled exact SHA can send
the existing ready ACK. The first transition from an old bundle uses a
manifest-owned deterministic transient unit that restarts only the sealed
browser service after maintenance ACK. Coordinator and adapter logic reconcile
response loss before rollback, keep maintenance on an unresolved unit, clean
the unit before maintenance clear, and persist a verification-ID-bound
capability for later steady-state reload. Web-only activation skips terminal
Ansible, while the existing SSH mutation path remains unchanged. The production
activation execution flag remains false until typed finalization in Milestone
4. No device was contacted and live rollout remains No-Go.

Milestone 4 is complete offline on the same branch. Kiosk ready ACK now proves
only `controlPlaneWeb`, its terminal HEAD probe proves only
`terminalRepository`, and Signage ready ACK proves only
`terminalRepository`; existing identity, systemd Result/is-active, Docker
agent, authenticated endpoint, and display-finalization checks remain
independent. The coordinator promotes Pi5 or terminal evidence only after the
exact required claim set is verified. Before rollback it invalidates all
forward observations, and after rollback it rebinds terminal repository proof
only to the sealed previous SHA while preserving the forward Web identity.
Interrupted pre-maintenance recovery with an incomplete claim set remains
unknown and must re-enter canonical planning. Activation and verification-only
execution are now enabled, but the requested/provisional/effective executor is
still `ssh-ansible`; Local execution remains Milestone 5 work on a later fresh
branch. Validation passed 808 deploy Python tests, 19 focused Kiosk Web tests,
20 isolated PostgreSQL/API tests, 24 recovery tests, 99 Ansible template
parses, shell/lifecycle/safety contracts, both inventories, and all Ansible
syntax/check-mode contracts. No device was contacted, no preflight or deploy
was run, and live rollout remains No-Go.

Milestone 5 is complete offline on `feat/stonebase-local-ansible-m5`, created
from current main after the accepted Milestone 4 merge. The default SSH path
remains byte-compatible and Local requires the explicit flag plus exact Pi5
and StoneBase scope. Before maintenance, complete history, secret/config path,
incremental-bundle prerequisite, runner, pinned runtime, existing configuration,
and disk proofs either select Local or persist an exact SSH fallback reason.
After maintenance, one digest-sealed artifact is transferred once and executed
by a root-owned deterministic transient unit under an exclusive lock. Its
bounded result and candidate ACK prove only `localArtifact`; terminal HEAD,
runtime, Kiosk Web, systemd, identity, Docker agents, and authenticated health
remain independent proofs. Response loss retains unknown evidence until unit
quiescence is reconciled, and all failures use only the presealed rollback
manifest. The Local playbook reuses existing secret files without reading or
regenerating them and preserves Phase B changed-only lifecycle selection.

Milestone 6 is complete offline on the same branch. All 30 route stages now
declare durable phase preconditions and effects, required and produced claims,
operation class, timeout, response-loss reconciliation, rollback eligibility,
failure policy, and recovery owner. Planner and aggregate preflight consume a
deterministic stage receipt and reject mismatched typed target membership,
mutation or activation without verification, and Local scope escape. Six
shared scenarios cover normal, no-op, stale browser, Local, forward-Pi5 plus
terminal rollback, and operator cancel paths at before-call, after-call, and
response-loss boundaries. Response loss never grants a produced claim.

The complete offline gate passed after both milestones: 840 deploy Python
tests, 20 isolated PostgreSQL/API tests, 24 recovery tests, deploy safety,
Pi5/Signage/client lifecycle and shell contracts, 99 parsed Ansible templates,
all inventory and playbook syntax/check contracts, 19 focused Web tests,
Web typecheck/lint, and independent verification of every pinned runtime
artifact hash. No device was contacted, no production preflight or deployment
was run, and live rollout remains blocked pending a new exact approval.

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

At this milestone, split executor output into requested, provisional, and
effective fields. `--print-plan` cannot call a source-only choice effective.
Aggregate preflight promotes the choice only after candidate history, runtime,
runner, and secret-reuse eligibility all pass; otherwise it records the exact
SSH fallback before notice or maintenance.

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

Milestones 5 and 6 were implemented in a fresh worktree from merged PR #1047:

    base: b2c7277a5f8bde1ecbbb99030b538e581dff466a
    branch: feat/stonebase-local-ansible-m5

Before editing, repeat the focused baseline:

    python3 -m unittest -v \
      scripts.deploy.tests.test_classify_deploy_impact \
      scripts.deploy.tests.test_terminal_profile_registry \
      scripts.deploy.tests.test_route_contract \
      scripts.deploy.tests.test_terminal_adapters
    python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py

The old-schema, corrupt-state, interrupted-recovery, rollback, reload-boundary,
Local runner, runtime installer, and route fault fixtures were run before the
complete aggregate gate.

The complete offline gate used these canonical commands before proposing any
hardware work:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    scripts/ci/run-deploy-contracts-local.sh

Do not run `scripts/update-all-clients.sh`, SSH, inventory Ansible, bootstrap,
Local execution, or `--reverify-selected` during offline implementation. The
completed read-only evidence commands remain bounded by their separate
manifest and do not authorize another hardware observation.

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
    approved normalized evidence: f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8
    browser forward restart: absent
    browser rollback restart: 2026-07-21T03:46:02Z–03:46:03Z

Milestone 1 validation:

    focused baseline: 50 tests PASS
    client lifecycle selection: PASS
    deploy Python discovery: 770 tests PASS
    Ansible Jinja templates: 99 parsed
    deploy safety, Pi5 Blue/Green, Signage maintenance: PASS
    isolated PostgreSQL deploy-status API: 20 tests PASS
    recovery contract: 24 tests PASS
    inventory and all Ansible syntax checks: PASS
    aggregate result: all checks passed

Milestone 3 validation:

    bounded Web activation and Kiosk layout: 19 tests PASS
    focused activation, adapter, coordinator, route, and profile contracts: 121 tests PASS
    deploy Python discovery: 794 tests PASS
    Web TypeScript no-emit typecheck and targeted ESLint: PASS
    Ansible Jinja templates: 99 parsed
    isolated PostgreSQL deploy-status API: 20 tests PASS
    deploy safety, Pi5 Blue/Green, Signage maintenance: PASS
    recovery contract: 24 tests PASS
    inventory and all Ansible syntax checks: PASS
    aggregate result: all checks passed
    temporary dependency references and generated outputs: removed

Milestones 5 and 6 validation:

    focused Local, runtime, route, planner, and application tests: PASS
    route transition stages: 30 with normal/before/after/response-loss coverage
    shared route scenarios: 6 PASS
    deploy Python discovery: 840 tests PASS
    client lifecycle and Phase B changed-only selection: PASS
    bounded Web activation and Kiosk layout: 19 tests PASS
    Web TypeScript build and targeted ESLint: PASS
    pinned Python aarch64 distribution: SHA-256 MATCH
    nine hash-locked aarch64 Python packages: download verification PASS
    pinned community.general 11.4.1: SHA-256 MATCH
    Ansible Jinja templates: 99 parsed
    isolated PostgreSQL deploy-status API: 20 tests PASS
    deploy safety, Pi5 Blue/Green, Signage maintenance: PASS
    recovery contract: 24 tests PASS
    inventory and every Ansible syntax/check contract: PASS
    aggregate result: all checks passed
    hardware contact, preflight, bootstrap, reverify, deploy: NOT RUN

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

Executor selection exposes `requestedExecutor`, `provisionalExecutor`, and
`effectiveExecutor`. Planning may write only the first two unless it executes
the complete read-only eligibility proof. Aggregate preflight is the sole
normal transition to effective and binds its proof receipt and fallback reason
before notice or maintenance.

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

Revision note (2026-07-21 04:38Z): Recorded the approved evidence receipt and
confirmed stale-browser timeline, accepted offline implementation Go, retained
live rollout No-Go, and added the provisional executor state exposed by the
plan/preflight difference.

Revision note (2026-07-21 05:03Z): Completed Milestone 1 with closed claim and
authority validation, additive fleet/run dual-read support, explicit legacy
projection that never infers a Kiosk browser claim, golden compatibility
fixtures, and the complete offline aggregate. No planner, executor, ACK,
restart, timeout, or hardware behavior was changed.

Revision note (2026-07-21 05:43Z): Completed Milestone 2 with registry-owned
claim requirements, three explicit target sets, provisional/effective SSH
executor reporting, and fail-closed disabled-stage gates. Recorded 781 passing
deploy Python tests, deploy safety, recovery, inventory, and Ansible syntax
results. The monolithic aggregate wrapper remains an environment-only No-Go
because this fresh worktree has no Node package dependencies for its unrelated
isolated PostgreSQL step; no hardware gate was opened.

Revision note (2026-07-21 06:50Z): Completed Milestone 3 with bounded
challenge-keyed browser reload, manifest-owned deterministic old-bundle
activation, response-loss reconciliation, verification-ID-bound capability
state, rollback capability refresh, and cleanup-before-maintenance-clear.
Recorded 794 passing deploy Python tests, 19 Web tests, Web typecheck/lint, and
the complete offline aggregate. Activation execution remains disabled; no
hardware gate was opened.

Revision note (2026-07-21 10:12Z): Completed Milestones 5 and 6 with the
StoneBase-only sealed Local executor, exact runtime supply-chain locks,
single-transfer deterministic-unit execution, distinct typed proofs,
pre-maintenance SSH fallback, post-maintenance rollback-only recovery, and an
executable route/receipt/fault contract. Recorded the complete 840-test
offline aggregate and retained the separate live canary approval gate. No
device was contacted.
