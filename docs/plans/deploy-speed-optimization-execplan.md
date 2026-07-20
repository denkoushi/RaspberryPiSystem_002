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
  - manually dispatched hosted CI, Secret scan, and CodeQL on the stacked PR head
  - one user-approved Pi5 and StoneBase timing run
  - the approved Pi5 and StoneBase performance acceptance run
open_items:
  - merge or otherwise resolve the parent deployment-foundation PR before this stacked PR
  - pass hosted checks for the current fleet active-run route preflight
  - obtain a new explicit StoneBase inventory approval and complete the recovery acceptance run
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
- [x] (2026-07-20 10:22Z) Committed and pushed Phase A as `d3b4b850` and opened stacked draft PR #1045 against the deployment-foundation branch so a main-targeted PR would not mix its unrelated parent diff.
- [x] (2026-07-20 10:29Z) Fixed one CI-only unit-test isolation defect as `9c7f2adf`: canary tests now mock the newly added Ansible preflight at their shared external-boundary fixture instead of relying on the local no-match behavior of Ansible.
- [x] (2026-07-20 10:38Z) Manually dispatched hosted CI, Secret scan, and CodeQL because the stacked PR trigger accepts only `base=main`; all three succeeded on `9c7f2adf`, including the complete 732-test deploy contract.
- [x] (2026-07-20 10:57Z) After explicit production-acceptance approval, the exact Pi5 plus StoneBase `--preflight-only` universe passed all 24 route stages as preflight `20260720-105659-6dea6a`; `releaseSubmitted` remained false and FJV was not selected or connected.
- [x] (2026-07-20 11:19Z) Added the separately approved `--limit ... --reverify-selected` contract after the normal no-op plan correctly minimized the deploy-control-only candidate to zero targets. The flag restores only explicitly selected verified hosts to the plan, remains unable to exclude unknown evidence or required Pi5 work, and is durably recorded through bootstrap and run state.
- [x] (2026-07-20 11:24Z) Passed 250 focused tests, all 739 deployment Python tests, and the complete repository-owned deploy contract including safety, route, Ansible, and isolated PostgreSQL integration.
- [x] (2026-07-20 11:33Z) Manually dispatched hosted CI, Secret scan, and CodeQL for immutable head `d837a26e`; all three succeeded. The exact Pi5 plus StoneBase plan and all 24 preflight stages passed, with every FJV terminal excluded as outside the explicit limit.
- [x] (2026-07-20 11:57Z) Ran the approved acceptance as `20260720-113428-ce30b9`. Pi5 completed its unchanged five-minute stability contract. StoneBase forward Ansible completed in 484,866 ms, 589,803 ms or 54.88 percent below the 1,074,669 ms baseline, and its exact SHA ready ACK succeeded.
- [x] (2026-07-20 11:57Z) The first acceptance stopped fail-closed in the consolidated final-evidence bundle, automatically completed manifest-bounded rollback, retained maintenance because consolidated rollback evidence was also unknown, and left fleet evidence unknown. No FJV connection was made.
- [x] (2026-07-20 12:03Z) Re-ran the legacy read-only evidence path against StoneBase: previous SHA `63cfa4688a074bed25779f8df597ff2883ac7933`, all three required systemd units, the status-agent oneshot, authenticated identity, and all three agent endpoints passed. A one-transport, stage-only diagnostic then localized the consolidated failure to its initial Git HEAD probe.
- [x] (2026-07-20 12:10Z) Corrected the consolidated root-owned bundle to use a per-invocation, exact-path `safe.directory` option rather than ambient root Git configuration. The patched candidate bundle passed live read-only StoneBase evidence with the previous SHA and every unchanged proof in one marker.
- [x] (2026-07-20 12:16Z) Passed 86 focused tests, all 739 deployment Python tests, Python compilation, and the complete repository-owned deploy contract including safety, 24 route stages, Ansible, and isolated PostgreSQL integration.
- [x] (2026-07-20 12:18Z) Committed and pushed the root-safe evidence correction as `f4998d19`; manually dispatched hosted CI `29741700246`, CodeQL `29741702197`, and Secret scan `29741704735`, all of which succeeded on that immutable head.
- [x] (2026-07-20 12:29Z) The first post-failure limited plan correctly refused to exclude five other hosts because the interrupted recovery deliberately retained the old fleet `activeRun`. A connection-free full plan showed that this conservative shadow, rather than changed per-host evidence, widened all seven hosts to unknown.
- [x] (2026-07-20 12:33Z) Added read-only recovery shadowing: only when standard status reconciliation proves the retained active run is terminal does `--print-plan` preserve its durable per-host verified/unknown records. A running, unreachable, or unprovable run still widens every host to unknown; execution-side abandonment, recovery, and locking are unchanged.
- [x] (2026-07-20 12:38Z) Passed the focused planner tests, all 741 deployment Python tests, Python compilation, and the complete repository-owned deploy contract after recovery shadowing.
- [x] (2026-07-20 12:40Z) Committed and pushed recovery shadowing as `cf60e1d1`; manually dispatched hosted CI `29743062754`, CodeQL `29743064609`, and Secret scan `29743066487`, all of which succeeded on that immutable head.
- [x] (2026-07-20 12:49Z) The corrected exact plan targeted only StoneBase and excluded Pi5, FJV, and the other four terminals. The subsequent aggregate preflight remained blocked at `pi5.interrupted-run-authority`, because the route probe still recognized only the legacy string active-run schema while fleet state now stores a validated run-summary object.
- [x] (2026-07-20 12:53Z) Updated the read-only route probe to accept both the legacy active-run ID and the current running-summary schema, and to require the referenced run authority's embedded `runId` to match before declaring interrupted recovery readable. Missing, malformed, mismatched, or unreadable authority remains blocked.
- [x] (2026-07-20 12:57Z) Passed 39 focused route/planner tests, all 742 deployment Python tests, Python compilation, and the complete repository-owned deploy contract after current-schema route recovery support.
- [ ] Commit and push the route correction, pass hosted validation, rerun the exact plan and preflight, then present the recovery run for new explicit inventory approval.

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

- Observation: Safe target minimization intentionally turns deploy-control-only acceptance into a no-op when all selected hosts are already verified.
  Evidence: The first approved acceptance plan for `e340593d56878b46ccf89f987180735bc06a4958` selected Pi5 and StoneBase but returned zero targets because both were verified at the previous accepted deployment-control baseline and no server or kiosk application component changed. `--full-fleet` cannot be combined with `--limit` and would violate the explicit FJV exclusion.

- Observation: The first consolidated evidence run depended accidentally on root's ambient Git trust configuration.
  Evidence: The bundle deliberately supplied only `PATH` to subprocesses and ran under Ansible become for systemd and Docker proof. Its initial `git rev-parse` therefore could not use the terminal's root-home `safe.directory` setting and stopped both forward and rollback evidence before any later proof. The legacy individual evidence path passed every proof, a stage-only bundled diagnostic identified `git`, and a candidate bundle with an exact per-invocation safe-directory option passed all unchanged proofs.

- Observation: A terminal failed run retained as the fleet `activeRun` makes the old read-only planner intentionally forget every per-host record, even after the systemd unit and durable run state are terminal.
  Evidence: The limited recovery plan refused Pi5 plus StoneBase because five hosts outside the limit appeared unknown; the connection-free full plan warned that `20260720-113428-ce30b9` was active and synthesized missing records for all seven hosts. Standard status already reconciled that run as durably failed and its unit as non-active, while the persisted fleet records still distinguish the touched StoneBase host from untouched verified hosts.

- Observation: The route preflight's interrupted-run recovery check lagged the authoritative fleet-state schema.
  Evidence: It accepted an `activeRun` string and looked up that run's JSON authority, while fleet-state v2 persists `activeRun` as a running summary object containing `runId`, desired SHA, inventory, and start time. The exact recovery preflight therefore blocked with `pi5.interrupted-run-authority` even though the authority file was present and readable.

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

- Decision: Add `--reverify-selected` as an explicit, plan-visible companion to `--limit` rather than weakening minimization, editing fleet state, adding an artificial application change, or using full-fleet execution.
  Rationale: Performance acceptance needs one real forward release through the new transport even when impact classification is a no-op. The new mode targets only the exact selected verified hosts, leaves unknown hosts and required Pi5 exclusion checks authoritative, and does not alter notification, stability, acknowledgement, maintenance, or rollback behavior.
  Date/Author: 2026-07-20 / User and Codex.

- Decision: Make the consolidated evidence Git probe trust only `/opt/RaspberryPiSystem_002` for that single read-only invocation, without writing global or repository Git configuration.
  Rationale: The other consolidated proofs require root, while the checkout is owned by the terminal account. `git -c safe.directory=<exact repository>` removes dependence on ambient root configuration, matches the existing deployment checkout contract, and neither broadens trust to other paths nor mutates terminal configuration.
  Date/Author: 2026-07-20 / Codex.

- Decision: Let `--print-plan` shadow a retained fleet active run as inactive only after the canonical status reconciler proves its durable run and systemd unit are terminal.
  Rationale: This makes the preview match the coordinator's existing lock-owned `abandon_active_run` transition and exposes the exact recovery host before approval. It never writes fleet state, never promotes unknown evidence, and keeps the prior all-host fail-closed shadow for running, unreachable, malformed, or otherwise unproven runs.
  Date/Author: 2026-07-20 / Codex.

- Decision: Preserve legacy route-preflight compatibility while strictly recognizing the current active-run summary and binding it to the same run ID inside the referenced authority file.
  Rationale: Coordinator recovery already owns full schema and manifest validation after acquiring the fleet lease. The pre-submission route gate must prove that an authority exists for the exact retained run without rejecting the current schema; a run-ID mismatch or malformed summary cannot be allowed through.
  Date/Author: 2026-07-20 / Codex.

## Outcomes & Retrospective

Phase A demonstrated the principal speed gain: StoneBase forward Ansible fell from 1,074,669 ms to 484,866 ms while notice, Pi5 stability, maintenance, exact ready ACK, durable state, and rollback policy remained intact. The first acceptance is not a safety acceptance: consolidated evidence failed before Git HEAD proof, rollback ran, and maintenance correctly remained visible because rollback evidence could not be promoted. Read-only legacy evidence subsequently proved the restored previous SHA and runtime healthy. The candidate correction now passes the exact one-transport evidence path live, but final recovery acceptance remains intentionally unclaimed until the corrected immutable head passes all checks and a separately approved standard run ends verified with maintenance cleared.

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

Revision note (2026-07-20 12:53Z): Recorded successful hosted validation for recovery planning, the exact StoneBase-only plan, and the current-schema mismatch found by aggregate preflight. Added strict current/legacy active-run authority recognition while keeping unreadable or mismatched recovery blocked.
