---
id: deploy-speed-phase-b
title: Deploy speed Phase B and StoneBase local execution PoC
status: frozen-superseded-by-release-identity-redesign
scope: rolling release terminal apply, StoneBase-only local execution preparation
date: 2026-07-21
source_of_truth: docs/plans/deploy-speed-phase-b-execplan.md
related_code:
  - infrastructure/ansible/roles/client/tasks/main.yml
  - infrastructure/ansible/roles/client/tasks/*-agent-lifecycle.yml
  - infrastructure/ansible/roles/client/handlers/main.yml
  - scripts/deploy/rolling_release/
related_docs:
  - docs/guides/deployment.md
  - docs/runbooks/deploy-status-recovery.md
  - docs/plans/deploy-speed-optimization-execplan.md
  - docs/knowledge-base/KB-401-deploy-release-identity-runtime-audit.md
  - docs/decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - docs/plans/deploy-release-identity-architecture-execplan.md
validation: Phase B passed; Local integration frozen after full-route identity audit found a confirmed architecture gap
open_items:
  - keep Local integration, reverify, bootstrap, timeout changes, and production retry frozen
  - continue only through the accepted typed-release-claim architecture ExecPlan
  - require a new exact hardware approval after that plan's offline gate
---

# Optimize unchanged terminal releases and prepare a sealed local execution PoC

This ExecPlan is a living document. Maintain its `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections as work proceeds. It follows `.agent/PLANS.md` in the repository root.

## Purpose / Big Picture

An operator will retain the existing one-terminal-at-a-time rolling release, its sixty-second terminal notice, and its five-minute Pi5 stability monitor, while an unchanged healthy StoneBase terminal avoids unnecessary Docker Compose convergence and systemd restarts. The terminal is still checked after every release, and the coordinator continues to independently verify the exact ready acknowledgement, repository SHA, systemd state, terminal identity, and agent health before it removes maintenance.

This plan also defines a non-live proof of concept for future StoneBase local execution. Pi5 will create and verify a fixed candidate artifact for one terminal, bind its SHA-256 digest and terminal identity before transfer, and the terminal will execute only that sealed content with local Ansible. It is deliberately not an `ansible-pull` design: the terminal must not select a branch, fetch arbitrary Git state, or execute a playbook outside the candidate artifact. The existing coordinator-to-terminal SSH Ansible path remains the default and fallback.

## Progress

- [x] (2026-07-20 22:55Z) Read repository safety rules, deployment guide, recovery runbook, Phase A ExecPlan, terminal route contract, and current `origin/main` at `332baa69377b61bcb23db5c0daced9e1295ba55b`.
- [x] (2026-07-20 22:55Z) Created isolated worktree branch `feat/deploy-speed-phase-b` from that immutable `origin/main`; the source checkout was not modified.
- [x] (2026-07-20 22:55Z) Reconstructed the Phase A timing evidence and located the remaining unconditional terminal mutations.
- [x] (2026-07-20 22:55Z) Recorded this Phase B / local-execution design, tests, fault injections, rollback rules, and acceptance criteria.
- [x] (2026-07-20 23:03Z) Implemented Phase B changed-only Compose and service lifecycle behavior with static-contract regression tests. Healthy no-change agents now skip Compose; changed, uncertain, or unhealthy agents retain the existing build/recreate/reconcile paths.
- [x] (2026-07-20 23:05Z) Passed lifecycle regression, 128 focused adapter/route/coordinator/PoC tests, Ansible syntax check under the read-only config, deployment safety contracts, the aggregate local deployment contract, and complete deploy Python test discovery.
- [x] (2026-07-20 23:03Z) Added a StoneBase-only, non-live candidate artifact/verification harness and five fault-injection tests. It has no coordinator, SSH, fleet-state, or hardware integration.
- [x] (2026-07-20 23:22Z) Ran the approved canonical Pi5 + StoneBase-only `--print-plan` and `--preflight-only`; all three probes passed with zero issues and FJV was explicitly excluded.
- [x] (2026-07-20 23:23Z) Ran the approved canonical serial release `20260720-232311-d2e8c8` for StoneBase only. It completed with exit 0, evidence `verified`, maintenance cleared, committed runtime cleanup, and terminal SHA `73b3dbe4fbacda6cb5cbdfc8f7375201780a4d6c`.
- [x] (2026-07-20 23:29Z) Re-read the durable run state and ran the canonical no-mutation plan. StoneBase is `verified at desired SHA` and target selection is empty; FJV remains `outside explicit --limit`.
- [x] (2026-07-21 04:15Z) Froze Local integration and live retries. The full-route audit confirmed that Kiosk browser Web identity, terminal Git identity, and Local candidate identity are not representable as separate durable claims; detailed evidence is held only in KB-401.
- [x] (2026-07-21 04:38Z) Completed the separately approved read-only evidence gate and accepted the release-identity ADR for offline implementation only. This Local integration plan remains frozen and superseded.

## Surprises & Discoveries

- Observation: Phase A eliminated the dominant Ansible transport cost, but it did not remove all work from a no-change terminal apply.
  Evidence: the accepted Phase A run `20260720-131727-e6e183` measured `terminal-ansible-apply` at 428,523 ms. `roles/common/tasks/main.yml` already computes false build and recreate facts for a documentation-only diff, yet each `*-agent-lifecycle.yml` still calls `docker compose ... up -d --no-build` in its final branch and `roles/client/tasks/main.yml` always includes `restart-client-service.yml` for every configured unit.

- Observation: existing timing data identifies this as a real terminal-side opportunity but not as a replacement for fixed safety delays.
  Evidence: the accepted baseline recorded 970,324 ms of `ok` task time, 92,850 ms of `changed`, and 8,223 ms of `skipped`. Phase A retained the 60-second notice and 5-minute Pi5 monitor; Phase B retains them too. The expected gain is an additional approximately one to three minutes on a healthy unchanged terminal, not a claim about fixed safety windows.

- Observation: current build/recreate classification is already conservative.
  Evidence: `roles/common/tasks/main.yml` uses the exact pre-sync and post-sync Git SHAs, classifies image and runtime paths separately, and treats an unavailable Git diff as `true` for every agent. Configuration templates OR their own `.changed` result into each recreate decision.

- Observation: a local artifact digest cannot safely contain its own archive SHA-256 without a recursive encoding.
  Evidence: the PoC validates an archive SHA-256 supplied by the trusted transfer boundary and stores a separate canonical payload SHA-256 plus per-member hashes inside `manifest.json`. Both are bound to run, candidate SHA, StoneBase identity, status client ID, runtime versions, and sealed-authority digests.

- Observation: the generated one-host inventory must still declare the playbook's fixed `stonebase_local` group.
  Evidence: the first no-mutation local playbook rehearsal skipped with `Could not match supplied host pattern, ignoring: stonebase_local`. The generated inventory now contains that group and its one bound host; the rehearsal then completed `ok=1 changed=0`, and a unit assertion fixes the group shape.

- Observation: the changed Phase B candidate exercised all three agent convergence paths, rather than the intended unchanged skip path, and still materially reduced terminal apply time.
  Evidence: production run `20260720-232311-d2e8c8` changed the lifecycle files themselves, so NFC, barcode, and torque Compose convergence correctly ran. `terminal-ansible-apply` was 241,853 ms, 43.56% below the Phase A 428,523 ms comparison. The total Pi5 release elapsed time was 340,921 ms, including the unchanged 60-second notice.

- Observation: the existing kiosk ready ACK is intentionally controlled by the verified Pi5 Web/control-plane SHA, not by the terminal repository candidate SHA.
  Evidence: the successful run records `expectedReadySha` and `readyReleaseSha` as `7cde783cc44f0883516249ffb11aa00c5c6e21e0`, while `currentSha`, `newSha`, and `runtimeFinalization.verifiedSha` independently equal the terminal candidate `73b3dbe4fbacda6cb5cbdfc8f7375201780a4d6c`. This is the pre-existing `readyAuthority: control-plane` kiosk profile behavior. The local-execution integration must add an explicit terminal-candidate ACK rather than treating this control-plane ACK as that proof.

## Decision Log

- Decision: Limit Phase B's behavior change to terminal release-only mode.
  Rationale: the canonical coordinator always invokes `terminal_release_mode=release-only`; preserving full-provisioning behavior avoids broadening this performance change into first-install or repair workflows.
  Date/Author: 2026-07-20 / Codex.

- Decision: Skip Docker Compose only when all of the following are proved locally: the candidate did not change the image, the candidate and rendered configuration do not require recreation, and the current agent endpoint returns HTTP 200.
  Rationale: an unavailable Git diff, a changed `.env`, or an unhealthy/missing agent must all converge with the existing Compose command. A skipped Compose invocation is therefore never used as proof of health; it merely avoids redundant reconciliation after a positive local proof.
  Date/Author: 2026-07-20 / Codex.

- Decision: Preserve the post-lifecycle readiness retry and coordinator's independent final agent probe for every path, including the Compose-skipped path.
  Rationale: local HTTP success is only a gating proof for avoiding redundant mutation. The final authority remains the existing coordinator evidence and exact ready acknowledgement.
  Date/Author: 2026-07-20 / Codex.

- Decision: Use Ansible `notify` handlers for changed status-agent configuration and systemd unit files, flush them before the existing always-on service health checks, and suppress the legacy unconditional client restart loop only in release-only mode.
  Rationale: handler execution makes mutations visible as `changed` timing events and prevents an unchanged kiosk browser, status-agent service, or status-agent timer from restarting. A changed service/timer unit reloads systemd before the targeted restart. Health checks still test `is-active` and `Result` for every configured unit.
  Date/Author: 2026-07-20 / Codex.

- Decision: Do not add local execution to the default route or execute it on hardware in this milestone.
  Rationale: a local executor adds a new trust boundary. It must first have a sealed artifact protocol, lock semantics, route-contract ownership, and deterministic failure tests. The existing SSH execution remains rollback-safe fallback until a separately approved StoneBase-only acceptance proves the new route.
  Date/Author: 2026-07-20 / Codex.

- Decision: Bind the non-live artifact to SHA-256 digests of already sealed file rollback manifest, runtime manifest, and maintenance-state authority.
  Rationale: the test harness cannot create deployment state, but it can make artifact construction impossible without explicit proof references. Production integration must obtain these digests in the current coordinator order before transfer; a result from an artifact without the same binding cannot be accepted.
  Date/Author: 2026-07-20 / Codex.

- Decision: Freeze this plan's Local integration and all production retry work.
  Rationale: KB-401 confirmed that one `readyAuthority` and one terminal SHA/evidence record cannot distinguish Pi5 Web, running browser Web, terminal Git, Local artifact, and runtime identities. A Local candidate ACK alone cannot close that gap. The replacement architecture and resumption criteria are in the related ADR and ExecPlan.
  Date/Author: 2026-07-21 / Codex.

## Outcomes & Retrospective

Phase B implementation is complete and production-validated on StoneBase. Run `20260720-232311-d2e8c8` completed successfully through the canonical serial route with terminal candidate SHA `73b3dbe4fbacda6cb5cbdfc8f7375201780a4d6c`, verified evidence, maintenance cleared only after evidence, committed runtime finalization/cleanup, and no rollback. `terminal-ansible-apply` was 241,853 ms (43.56% lower than the Phase A 428,523 ms comparison); the full Pi5 release elapsed time was 340,921 ms. The candidate itself changed lifecycle code, so the three Compose convergence tasks correctly reported changes. The healthy no-change measurement was not performed; any future performance measurement belongs to the replacement architecture plan and a new hardware approval.

All three agent lifecycle tasks make Compose conditional on the existing fail-closed image/runtime decision plus a read-only pre-lifecycle HTTP probe. The command reports changed only when the service has no post-command container, receives a new container ID, or was previously not running. The unguarded final readiness retry remains in place. Status-agent configuration and unit changes notify targeted release-only handlers, systemd reload precedes those handlers, the unconditional release-only restart loop is suppressed, and the existing health loop always executes after `flush_handlers`.

The local execution PoC is deliberately only a non-live boundary harness. It creates a no-secret archive with an assertion-only local playbook; validates archive and payload digests, exact member set, candidate SHA, host/status identity, pinned runtime, three sealed-authority digests, staged files, and an exclusive lock; then calls exactly `ansible-playbook -c local` in tests through an injectable process boundary. It does not transfer an artifact, change an actual checkout, run a release playbook, update fleet/run state, enter maintenance, wait for ready ACK, or perform rollback. Those remain open integration milestones. Apart from the separately approved canonical Pi5 + StoneBase Phase B validation recorded above, this worktree did not contact or change other terminals; FJV was never a connection target.

This plan is now frozen rather than complete. Phase B's changed-only lifecycle remains accepted, but immediate Local coordinator integration and the healthy no-change reverify are superseded by `docs/plans/deploy-release-identity-architecture-execplan.md`. KB-401 is the only detailed source for the later failure sequence and No-Go decision.

## Context and Orientation

`scripts/update-all-clients.sh` is the only production entry point. It transfers control to an immutable Pi5 release unit, and `scripts/deploy/rolling_release/coordinator.py` owns durable fleet/run state, terminal ordering, maintenance, ready acknowledgement, evidence promotion, and manifest-bounded rollback. `scripts/deploy/rolling_release/backends/ansible.py` executes the already-decided SSH Ansible terminal playbook. `scripts/deploy/rolling_release/route_contract.py` lists every cross-machine stage, its preflight proof, failure policy, recovery owner, and fault rehearsal.

The terminal profile playbook imports the `common` role first. That role captures the old checkout SHA, resets to the exact candidate SHA, derives changed file paths, and sets `*_agent_image_build_needed` plus `*_agent_runtime_recreate_needed`. The client role renders private agent environment files, executes lifecycle tasks for NFC, barcode, and torque agents, and currently restarts `services_to_restart` even when no managed file changed. The kiosk role already restarts `kiosk-browser.service` only when its own launch script, unit, or browser configuration changed.

The sealed rollback manifest is captured before terminal maintenance and before the terminal playbook. The runtime manifest is a separate sealed authority. If a forward operation fails or a response is lost, the coordinator must keep terminal evidence unknown and use only these pre-existing sealed manifests for rollback. No new Phase B code may create a second rollback mechanism, mutate fleet JSON manually, or clear maintenance before the existing evidence/finalization path succeeds.

Phase A production evidence is the performance baseline. Run `20260720-083350-f92759` took 1,074,669 ms for StoneBase `terminal-ansible-apply`. Run `20260720-131727-e6e183` took 428,523 ms for the same phase and 14,098 ms for final terminal evidence. These runs did not connect to FJV. The raw artifacts are on Pi5 at `/opt/RaspberryPiSystem_002/logs/deploy/release-runs/` and are not read by this local implementation without approval.

## Plan of Work

### Milestone 1: Changed-only Phase B terminal lifecycle

Add a read-only pre-lifecycle HTTP probe for each enabled client agent in `infrastructure/ansible/roles/client/tasks/nfc-agent-lifecycle.yml`, `barcode-agent-lifecycle.yml`, and `torque-agent-lifecycle.yml`. It must be `changed_when: false`, must never convert a failed endpoint into success, and must not print credentials. Define a `*_compose_converge_needed` fact that is true if the existing fail-closed image decision is true, the existing recreate decision is true, or that pre-lifecycle probe is not HTTP 200.

Guard the existing Compose command with that fact. Capture the container identifier and running state before and after the command and print only a boolean change marker. Set `changed_when` from that marker so the timing callback represents a container replacement or a transition to running, rather than treating every successful shell command as a change. The command selection remains build, forced recreate, or `--no-build`; no build/recreate decision becomes less conservative. Keep the current readiness retry unguarded so every path verifies a healthy endpoint after the conditional operation.

For systemd, configure status-agent configuration, its service unit, and its timer unit to notify role handlers. The handlers reload systemd before restarting the specific changed unit. Call `meta: flush_handlers` immediately before the existing all-unit health loop. In `release-only` mode, do not run the legacy loop that restarts every configured service. Retain that loop for full provisioning unless a focused regression proves an equivalent first-provisioning guarantee. Continue testing every configured service/timer after handlers are flushed; oneshot `status-agent.service` must still require `Result=success` rather than `is-active`.

Do not let the legacy NFC/barcode handlers cause a second Compose operation after the lifecycle task has performed the selected convergence. Remove those notifications or otherwise prove a single lifecycle mutation per agent. Keep handler behavior that is unrelated to release-only execution unchanged.

### Milestone 2: Make the contracts executable

Extend `scripts/deploy/tests/test-client-agent-lifecycle-selection.py`, or split small Python tests out of it, to prove all three lifecycle files have the pre-probe, three-way convergence condition, correct build/recreate/no-build branches, accurate change marker, skipped no-change branch, and unconditional final readiness. Add fixtures for: documentation-only candidate with healthy agent (no Compose); changed agent source (build); changed template (forced recreate); unavailable Git diff (build/recreate); and unhealthy agent (Compose attempted despite no Git/config change).

Add static tests for status-agent handler notification, handler order (reload before restart), release-only suppression of the unconditional loop, and unconditional post-handler health checks. Preserve existing checks that configuration changes are release-reachable and that no lifecycle task sends a secret to telemetry. Run the route and safety contracts to ensure that no new unowned terminal mutation is introduced.

### Milestone 3: StoneBase sealed local execution PoC, non-live

The implemented non-live harness is a closed data model, separate from the existing SSH adapter, for a `stonebase-local-ansible-poc` mode and exact StoneBase hostname. It generates a no-secret archive with an assertion-only candidate playbook, generated one-host inventory, fixed Ansible configuration, and strict manifest. The trusted future transfer boundary supplies the archive SHA-256 separately; the manifest holds a non-recursive payload SHA-256 and per-member hashes, schema version, run ID, candidate SHA, hostname, authenticated status client ID, profile ID, allowed playbook path, Ansible core version, collection lock versions, and file/runtime/maintenance authority digests. It contains no Vault plaintext, `.env`, private key, or deployment secret. Production work will replace the assertion playbook only after explicit coordinator flag, route-contract, and approval work is complete.

Pi5 must verify the artifact digest before one transfer to the bound terminal. The terminal local runner must atomically acquire a lock or run in a transient systemd unit; reject duplicate run IDs, malformed manifests, a mismatched local hostname, any extra artifact member, any SHA mismatch, a non-pinned Ansible/collection runtime, a playbook outside the sealed artifact, or an absent active maintenance record. It runs `ansible-playbook -c local` with the artifact's fixed inventory and playbook only. It returns a bounded, signed-or-digest-bound result marker; raw stdout, stderr, secrets, or arbitrary host-controlled paths must not be trusted as success evidence.

The coordinator records local-run submission separately from success. After a result, timeout, disconnect, or response loss it independently repeats the current exact ready sequence: expected candidate ready ACK, terminal Git SHA, systemd units and oneshot result, authenticated identity, and stable agent health. Only that independent proof may promote evidence and clear maintenance. Any failure, timeout, partial local run, invalid response, or lost response remains evidence `unknown`; rollback is only the existing manifest-bounded rollback. The SSH Ansible executor remains available as the explicit fallback.

Add a route-contract stage for artifact sealing/transfer/local execution with preflight proof, fail-closed policy, coordinator recovery owner, and before/after fault rehearsal. Add isolated tests for digest mismatch, host identity mismatch, duplicate invocation, candidate SHA mismatch, collection version mismatch, extra playbook, failed local Ansible, timeout, response loss after possible local completion, malformed marker, and rollback refusal without a sealed manifest. These tests use temporary directories and mocked subprocesses only; they must not SSH to Pi5 or StoneBase.

## Concrete Steps

Work only in the isolated worktree:

    cd /Users/tsudatakashi/Documents/Codex/2026-07-21/deploy-phase-b-local-execution/work/RaspberryPiSystem_002-phase-b
    git status --short --branch

Run the focused Phase B tests while implementing:

    python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py
    python3 -m unittest scripts.deploy.tests.test_ansible_adapter scripts.deploy.tests.test_route_contract scripts.deploy.tests.test_fleet_coordinator_transitions

Run the full local deployment contract before claiming local acceptance:

    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    scripts/ci/run-deploy-contracts-local.sh

Expected behavior for a synthetic unchanged healthy agent is that its conditional Compose task is `skipped`, its final readiness task succeeds, and no unrelated systemd restart handler runs. Expected behavior for an unhealthy agent or unavailable Git-diff classification is that the appropriate existing Compose branch runs and failure remains fatal if readiness cannot be restored.

Do not run `scripts/update-all-clients.sh`, `--print-plan`, `--preflight-only`, direct SSH, or any Ansible command against an inventory host during local work. If live validation is proposed later, first present the exact immutable candidate SHA and hosted checks, the canonical `--print-plan` target list, and the fact that only Pi5 plus `raspi4-kensaku-stonebase01` would be contacted. Wait for explicit user approval. `raspi4-fjv60-80` is excluded from planning, preflight, connection, and release unless the user supplies a new explicit instruction.

## Validation and Acceptance

Phase B local acceptance requires Python compilation, lifecycle selection regressions, adapter/route/coordinator unit tests, the deployment safety contract, and the aggregate local deployment contract to pass. The test suite must demonstrate each failure path listed in Milestone 2 and must demonstrate that no-change service health checks and agent readiness still execute.

Phase B StoneBase production acceptance completed in approved run `20260720-232311-d2e8c8`: the terminal candidate SHA was independently verified, evidence is verified, maintenance was cleared by the coordinator, runtime finalization is committed, and no rollback was required. The 60-second notice remained in force. The existing kiosk ready ACK proved the control-plane SHA, so exact terminal candidate SHA proof came from independent post-apply observation and runtime finalization; local-execution integration must add its own candidate-SHA ready-ACK authority before it can satisfy that stronger contract.

The local execution PoC acceptance is initially non-live. Its harness must show that a valid sealed artifact reaches a mocked `ansible-playbook -c local` command exactly once and that every invalid or ambiguous artifact/result is rejected without a success result. Future coordinator integration must map each rejection to evidence `unknown` and choose only manifest-bounded rollback. Hardware acceptance requires an additional explicit approval and the same Pi5 + StoneBase scope.

Local validation completed on this worktree:

    python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py
    PASS: client agent lifecycle command selection

    python3 -m unittest -v scripts.deploy.tests.test_ansible_adapter scripts.deploy.tests.test_route_contract scripts.deploy.tests.test_fleet_coordinator_transitions scripts.deploy.tests.test_local_execution_poc
    Ran 128 tests ... OK

    ANSIBLE_CONFIG=infrastructure/ansible/ansible-readonly.cfg ansible-playbook --syntax-check infrastructure/ansible/playbooks/deploy-terminal-profile.yml -i infrastructure/ansible/inventory.yml
    playbook: infrastructure/ansible/playbooks/deploy-terminal-profile.yml

    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    deploy safety contract tests passed

    scripts/ci/run-deploy-contracts-local.sh
    [deploy-contract] parse all Ansible Jinja templates
    [deploy-contract] shell and deployment lifecycle contracts
    PASS: pi5 image deployment lifecycle

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    exit status 0

    # temporary local artifact only; no inventory host connection
    ANSIBLE_CONFIG=<temporary>/stage/ansible.cfg ansible-playbook -c local -i <temporary>/stage/inventory.yml <temporary>/stage/playbooks/stonebase-local-poc.yml
    raspi4-kensaku-stonebase01 : ok=1 changed=0 unreachable=0 failed=0 skipped=0

## Idempotence and Recovery

The pre-lifecycle health probes and final readiness checks are read-only and repeatable. Conditional Compose convergence is repeatable: when a prior attempt has brought a container to a healthy state, the next unchanged run skips it; when it is unhealthy, the normal convergence branch is attempted again. A systemd handler is run once per play when one or more notifying configuration tasks changed, and health is checked after it.

If any Phase B change fails, the coordinator's existing failure path keeps evidence unknown and executes only its previously sealed rollback manifest. Do not manually edit fleet state, run records, rollback/runtime manifests, locks, maintenance records, Git checkout, service state, or container state. Use the documented canonical cancel/status interfaces for a live run.

For the local execution PoC, replaying the same terminal/run pair must be rejected or return a verified idempotent terminal record without starting another local Ansible process. A missing response is never a success. The coordinator re-observes the terminal; if it cannot prove the exact state, rollback is bounded by the manifest captured before maintenance.

## Artifacts and Notes

The worktree branch starts at:

    332baa69377b61bcb23db5c0daced9e1295ba55b  origin/main

Phase A performance evidence retained for comparison:

    baseline run: 20260720-083350-f92759
    baseline terminal-ansible-apply: 1,074,669 ms
    Phase A run: 20260720-131727-e6e183
    Phase A terminal-ansible-apply: 428,523 ms
    Phase A final terminal evidence: 14,098 ms
    Phase A reduction: 60.13 percent

Local Notes JA: FJV端末 `raspi4-fjv60-80` は2026-07-21時点で Tailscale Offline、最終 Seen は2026-07-17 13:11 JSTである。本計画は明示的な新指示まで接続・配布・preflightの対象に含めない。

## Interfaces and Dependencies

Phase B adds only repository-owned Ansible facts and tasks. Every agent lifecycle exposes a boolean named `<agent>_compose_converge_needed`, calculated from `<agent>_image_build_needed`, `<agent>_runtime_recreate_needed`, and its read-only pre-lifecycle health result. Its conditional Compose task registers `<agent>_agent_up_result` and derives Ansible change state from a secret-free `true` or `false` marker. The final readiness register names remain `nfc_agent_status_check`, `barcode_agent_status_check`, and `torque_agent_status_check` for compatibility with diagnostics and regression tests.

The non-live interface in `scripts/deploy/rolling_release/local_execution_poc.py` is `CandidateBinding`, `build_candidate_artifact(...)`, `inspect_candidate_artifact(...)`, `stage_candidate_artifact(...)`, and `run_staged_candidate(...)`. `CandidateBinding` carries explicit run ID, candidate SHA, host, status client ID, pinned Ansible/collection versions, and the three sealed-authority digests. Its process call is injectable and deliberately has no remote transport. Production integration must replace it with narrow backend interfaces such as `prepare_local_terminal_candidate(...)`, `transfer_local_terminal_candidate(...)`, and `run_local_terminal_candidate(...)`; it must validate the same fields before any subprocess call. Route-contract metadata is the only location that enumerates that future external boundary, and the coordinator remains the only owner of state transition, maintenance clearing, verification promotion, and rollback choice.

Revision note (2026-07-20 23:08Z): Rehearsed the assertion-only candidate artifact through local Ansible. Corrected and regression-tested its generated fixed host group after the first rehearsal revealed that no target group had been declared. It remains intentionally detached from coordinator, transport, and all real hardware operations.

Revision note (2026-07-21 04:15Z): Froze Local integration and live validation after the release-identity audit confirmed a planner/state/activation contract gap. Linked the single incident source, ADR, and replacement implementation ExecPlan without duplicating their detailed evidence.

Revision note (2026-07-21 04:38Z): Marked this plan superseded after the approved evidence confirmed the stale-browser incident. Offline work continues only through the typed-claim architecture plan; live Local execution remains blocked.
