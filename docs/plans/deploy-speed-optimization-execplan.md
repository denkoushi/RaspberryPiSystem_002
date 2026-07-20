---
id: deploy-speed-optimization
title: Shorten rolling releases without weakening terminal safety
status: in-progress
scope: Rolling-release telemetry, Ansible transport latency, and terminal evidence latency
date: 2026-07-20
source_of_truth: docs/plans/deploy-speed-optimization-execplan.md
related_code:
  - scripts/deploy/rolling-release.py
  - scripts/deploy/rolling_release/backends/ansible.py
  - scripts/deploy/rolling_release/coordinator.py
  - scripts/deploy/rolling_release/terminal_adapters.py
  - scripts/deploy/rolling_release/terminal_manifest_capture.py
  - scripts/deploy/rolling_release/terminal_release_evidence.py
  - scripts/deploy/rolling_release/terminal_preflight.py
  - scripts/deploy/rolling_release/telemetry.py
  - infrastructure/ansible/callback_plugins/rolling_release_timing.py
related_docs:
  - ./deployment-foundation-refactor-execplan.md
  - ../guides/deployment.md
validation:
  - isolated Python and deployment safety contract tests
  - one user-approved Pi5 and StoneBase timing run
  - a future separately approved Pi5 and StoneBase performance acceptance run
open_items:
  - review, commit, and push the locally validated Phase A change
  - obtain hosted CI and production performance acceptance for Phase A
supersedes: null
superseded_by: null
---

# Shorten rolling releases without weakening terminal safety

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

The rolling release must become faster while preserving fail-closed planning, per-terminal maintenance display, exact release-SHA ready acknowledgement, durable fleet and run state, and manifest-bounded rollback. FJV terminals are outside the investigation, test, and production target scope. Phase A reduces SSH round trips in the forward terminal Ansible playbook, Generic terminal final evidence, and terminal manifest capture. It does not shorten the sixty-second Kiosk notice, the five-minute Pi5 stability monitor, or any acknowledgement timeout.

An operator can observe the improvement in the existing durable timing fields. A successful acceptance run must still end with matching desired and current SHA, verified evidence, cleared maintenance, committed runtime finalization, successful runtime cleanup, and no rollback. The acceptance comparison uses the `terminal-ansible-apply` phase rather than the whole release because Pi5 work is a separate safety phase.

## Progress

- [x] (2026-07-20 08:34Z) Released timing telemetry to Pi5 and StoneBase only in run `20260720-083350-f92759`; FJV and all other terminals were excluded.
- [x] (2026-07-20 09:08Z) Confirmed the run completed successfully at SHA `63cfa4688a074bed25779f8df597ff2883ac7933`, with exact ready acknowledgement, verified evidence, cleared maintenance, committed cleanup, and no rollback.
- [x] (2026-07-20 09:15Z) Attributed 970,324 ms of 1,071,397 measured terminal Ansible milliseconds to 151 unchanged `ok` results; 128 skipped results consumed only 8,223 ms.
- [x] (2026-07-20 09:18Z) Benchmarked pipelining from Pi5 to StoneBase with non-mutating Ansible modules. `/usr/bin/true` fell from 10,178 ms to 3,576 ms average, and `stat` fell from 9,640 ms to 3,819 ms average. No FJV connection was made.
- [x] (2026-07-20 09:24Z) Implemented Phase A1 with pipelining limited to the forward terminal playbook and an exact pipelining-plus-become preflight before terminal mutation.
- [x] (2026-07-20 09:24Z) Added adapter, coordinator transition, timing, and route-contract regressions; 117 focused tests pass.
- [x] (2026-07-20 09:32Z) Passed 257 related Python tests, the deploy safety shell contract, and the complete repository-owned deploy contract; its full Python discovery passed 717 tests and all aggregate checks completed successfully.
- [x] (2026-07-20 09:45Z) After explicit approval, designed Phase A2 and A3 as transport consolidation only: Generic terminal final evidence uses one candidate-owned zip application, and file/runtime manifest capture uses one candidate-owned zip application while retaining independent authorities.
- [x] (2026-07-20 10:02Z) Added strict marker parsing, candidate-artifact preflight ownership, non-root SSH identity proof followed by one passwordless-sudo re-exec, and fault injection for partial success, response loss, marker disagreement, sealed rollback agent sets, and secret-bearing remote failures.
- [x] (2026-07-20 10:11Z) Passed 97 focused tests, then 732 deployment Python tests, then the complete repository-owned deploy contract including deploy safety, 24-stage route coverage, Ansible syntax, and isolated PostgreSQL integration.
- [ ] Commit and push the Phase A change only after the worktree and validation evidence are reviewed.
- [ ] Obtain separate approval before a production acceptance run; never infer that local implementation approval includes another device deployment.

## Surprises & Discoveries

- Observation: The historical `ok=161 changed=8 skipped=128` recap does not mean skipped tasks dominate elapsed time.
  Evidence: The notification callback recorded 970,324 ms for unchanged `ok`, 92,850 ms for `changed`, and 8,223 ms for `skipped`. Two successful dynamic task includes appear in the recap but do not emit runner-result timing events; callback duration still covers 99.70 percent of the terminal apply phase.

- Observation: The earlier approximately twenty-two-minute StoneBase deployment is comparable to the terminal portion, not to the new whole run that includes Pi5 safety work.
  Evidence: The accepted timing run took 33 minutes 28 seconds overall, of which 12 minutes 2 seconds were Pi5 configuration, release, stability, and evidence, while StoneBase consumed 21 minutes 25 seconds.

- Observation: Existing SSH multiplexing does not remove the dominant per-module cost.
  Evidence: The active SSH plugin default already uses `ControlMaster=auto` and `ControlPersist=60s`, but pipelining still reduced isolated command and stat module wall time by about 60 to 65 percent.

- Observation: Enabling pipelining for rollback is unnecessary to capture the main gain and would widen the safety surface.
  Evidence: The 17 minute 55 second forward playbook is the dominant terminal phase. Evidence and manifest capture now use narrow one-call bundles without pipelining, while manifest-owned cleanup and rollback retain their previously accepted transport.

- Observation: Evidence and manifest latency can be reduced without merging their safety authorities.
  Evidence: StoneBase final evidence previously needed one Git HEAD call, three systemd active calls, one oneshot result call, one identity script, and up to three agent scripts. The new Generic evidence bundle performs the same proofs in one remote script call. Manifest capture previously needed remote identity, file manifest, and runtime manifest calls; the new bundle performs them in one remote call but returns and validates two separate manifests, roots, digests, and restore references.

- Observation: A single transport makes partial completion and lost responses more important, not less.
  Evidence: Tests force file capture to succeed before runtime capture fails, retry the same idempotent authorities, drop the response after possible remote completion, disagree duplicated callback markers, and inject secret-bearing stderr. None can synthesize success or copy raw remote output into controller errors.

## Decision Log

- Decision: Scope Phase A1 pipelining to `backends.ansible.playbook` and its exact preflight, not to `ansible.cfg` or the whole release process.
  Rationale: This captures the dominant forward-playbook opportunity while leaving manual Ansible, manifest capture, evidence, cleanup, and rollback behavior unchanged.
  Date/Author: 2026-07-20 / User and Codex.

- Decision: Execute the pipelining and privilege-escalation preflight after the selected terminal is durably marked unknown but before repository baseline, manifest capture, notice, maintenance, checkout, or service changes.
  Rationale: A transport failure must not leave stale verified fleet evidence, and it must stop before any terminal mutation or rollback authority is needed.
  Date/Author: 2026-07-20 / Codex.

- Decision: Keep the sixty-second Kiosk notice and five-minute Pi5 stability monitor unchanged.
  Rationale: They are operator and runtime safety controls, not accidental latency.
  Date/Author: 2026-07-20 / User and Codex.

- Decision: After separate explicit approval, include evidence and manifest transport consolidation in Phase A, with independent design and fault tests.
  Rationale: The check contents, SHA and identity bindings, stable agent probes, separate manifest roots and digests, durable state order, and rollback ownership remain unchanged. Only the number of Ansible script transports changes. Strict candidate-owned bundles and fail-closed marker validation make that boundary executable.
  Date/Author: 2026-07-20 / User and Codex.

- Decision: Start manifest capture as the resolved SSH account and re-exec the same transferred archive once through `/usr/bin/sudo -n /usr/bin/python3`.
  Rationale: The prior identity authority came from a non-root remote call. Preserving that proof before elevation avoids replacing live account identity with inventory assumptions while still reducing three remote transports to one.
  Date/Author: 2026-07-20 / Codex.

## Outcomes & Retrospective

Phase A local implementation now has narrow transport boundaries and executable failure contracts. If the optimized Ansible plus `become` path fails, the run records the target as unknown and stops before baseline, manifest, notice, maintenance, playbook, or rollback. Manifest and evidence bundles accept only canonical, agreeing, exact-schema results and hide untrusted remote output. The complete local deploy contract passes with 732 Python tests. Production performance and device acceptance remain intentionally unclaimed until hosted checks and a separately approved StoneBase run complete.

## Context and Orientation

`scripts/deploy/rolling-release.py` is the compatibility facade executed by the immutable transient release unit on Pi5. `scripts/deploy/rolling_release/coordinator.py` owns ordering, durable state transitions, terminal maintenance, exact ready acknowledgement, and rollback policy. `scripts/deploy/rolling_release/backends/ansible.py` turns already-decided actions into Ansible commands. `scripts/deploy/rolling_release/route_contract.py` assigns every external boundary a preflight proof, failure policy, recovery owner, and executable rehearsal.

Ansible pipelining sends many Python modules through the SSH standard-input stream instead of staging and invoking a temporary module file through additional SSH operations. It does not make multiple terminals concurrent and does not bypass Ansible modules, `sudo`, or task condition evaluation. The evidence and manifest bundles do not enable pipelining; each merely packages existing candidate-owned helpers into one Ansible script transport.

The timing callback at `infrastructure/ansible/callback_plugins/rolling_release_timing.py` writes only run, scope, host, play, task, outcome, timestamps, and duration. It does not record arguments, results, variables, stdout, stderr, or secrets. `scripts/deploy/rolling_release/telemetry.py` aggregates those events into the durable run summary.

## Plan of Work

Phase A1 defines one private environment builder in `scripts/deploy/rolling_release/backends/ansible.py`. It forces both supported Ansible pipelining environment names to true for the forward terminal executor. The same environment is used by a new ad-hoc `/usr/bin/true` command with `become`; successful completion proves the exact SSH, Python, and sudo transport before any terminal mutation.

The facade exposes that preflight to the coordinator. The coordinator first marks the terminal unknown, saves that transition, measures the new preflight phase, and then continues to repository baseline and sealed manifest capture. A preflight exception follows the existing top-level failed-run path and never enters manifest-owned rollback because no terminal mutation has begun.

The route contract receives a distinct read stage so future changes cannot silently move or remove this safety boundary. Unit tests fix the command and environment contract, reject malformed hosts without execution, and inject a preflight failure to prove no baseline, manifest, status command, maintenance, playbook, signage prestage, or rollback occurs.

Phase A2 composes exact Git HEAD, systemd active/oneshot, status identity, and existing stable agent proofs inside `terminal_release_evidence.py`. `ansible-inventory --host` remains a local controller process that selects the forward inventory agent set or sealed rollback agent set without transporting secrets. One remote zip application contains the exact candidate identity and agent-health helper sources, emits one canonical marker, and is revalidated field-for-field by the backend and adapter.

Phase A3 composes the existing idempotent `rollback-manifest.py` and `terminal-runtime-manifest.py` capture functions inside `terminal_manifest_capture.py`. The archive starts without Ansible become, proves the live SSH user and `/home/<user>`, then elevates the same archive once. File and runtime results remain separate and are validated against their original expected paths, destination set, repository HEAD, counts, rollback tags, and SHA-256 digests. Cleanup and rollback continue to use their previous transports and sealed references.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on branch `chore/deploy-speed-telemetry`.

Run the focused tests after every code edit:

    python3 -m unittest \
      scripts.deploy.tests.test_ansible_adapter \
      scripts.deploy.tests.test_route_contract \
      scripts.deploy.tests.test_fleet_coordinator_transitions

Run the deployment safety contract and the repository-owned aggregate before committing:

    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    scripts/ci/run-deploy-contracts-local.sh

Do not run `scripts/update-all-clients.sh` during local Phase A validation. A production acceptance starts only after the branch is immutable, required hosted checks pass, a read-only plan excludes every FJV terminal, and the user explicitly approves that exact plan.

## Validation and Acceptance

Local acceptance requires Python compilation, focused unit tests, route-contract validation, the shell deploy safety contract, and the aggregate local deployment contract to pass. The pipelining failure regression must show the terminal fleet record becomes unknown while the run has no repository baseline, rollback manifest, maintenance start, status command, playbook, or rollback event. Bundle regressions must prove exact schemas, identical duplicate callbacks only, separate manifest authorities, idempotent retry after partial capture, fail-closed response loss, sealed rollback agent selection, and non-disclosure of untrusted remote output.

Production acceptance later uses the canonical rolling-release entry point and limits scope to Pi5 plus `raspi4-kensaku-stonebase01`. FJV hosts must appear only as excluded plan entries and must never receive a connection. The run must complete successfully with exact SHA ready acknowledgement, verified terminal evidence, cleared maintenance, committed runtime cleanup, and no rollback. Compare `terminal-ansible-apply` against 1,074,669 ms from run `20260720-083350-f92759`; do not claim a gain from changes to fixed notice or Pi5 monitor durations.

## Idempotence and Recovery

The preflight command is `/usr/bin/true` under Ansible `become` and is safe to repeat. Pipelining changes transport only for the forward terminal playbook. If the preflight fails, rerunning after correcting SSH or sudo configuration starts from durable unknown evidence and still performs no terminal mutation before the check. Both manifest helper captures are already idempotent for the same run, host, destinations, and runtime contract, so a response-loss retry reopens the same authorities rather than creating a new rollback scope. If the later playbook fails, the existing sealed-manifest rollback remains the sole recovery owner and uses its prior transport behavior.

No fleet file, run record, lock, maintenance state, or rollback manifest may be edited or deleted by hand. Production cancellation uses only the documented cooperative cancel command.

## Artifacts and Notes

Accepted baseline run:

    runId: 20260720-083350-f92759
    releaseSha: 63cfa4688a074bed25779f8df597ff2883ac7933
    wall: 2,008,164 ms
    terminal-ansible-apply: 1,074,669 ms
    recap: ok=161 changed=8 skipped=128 failed=0 unreachable=0

The raw and aggregate timing artifacts remain on Pi5 under `/opt/RaspberryPiSystem_002/logs/deploy/release-runs/` with the run ID above. Raw timing data is mode 0600.

## Interfaces and Dependencies

`scripts.deploy.rolling_release.backends.ansible.preflight_terminal_ansible_pipelining(inventory, host, *, runtime)` executes the exact candidate transport preflight and returns only on success. `capture_terminal_manifest(...)` returns the same sealed file/runtime reference shape through one remote transport. `probe_terminal_release_evidence(...)` returns the Generic adapter's existing SHA, systemd, identity, and agent evidence shape through one remote transport. `scripts/deploy/rolling-release.py` exposes these interfaces to the coordinator runtime. The coordinator records phase name `terminal-ansible-pipelining-preflight` and checkpoint `after-terminal-ansible-pipelining-preflight:<host>`.

No new third-party dependency is introduced. The implementation uses the existing Ansible CLI, inventory, SSH connection plugin, Python interpreter, and passwordless `sudo` contract.

Revision note (2026-07-20 10:11Z): Extended the approved A1 pipelining plan with separately approved A2 evidence and A3 manifest transport consolidation, their failure semantics, and the completed 732-test aggregate validation. Hosted and production performance gates remain open.
