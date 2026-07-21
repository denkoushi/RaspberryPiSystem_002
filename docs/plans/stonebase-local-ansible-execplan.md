---
id: stonebase-local-ansible
title: StoneBase sealed local Ansible executor
status: hardware-preflight-approved
scope: opt-in StoneBase terminal apply executor below the rolling-release safety adapter
date: 2026-07-21
source_of_truth: docs/plans/stonebase-local-ansible-execplan.md
related_code:
  - scripts/deploy/rolling_release/local_execution.py
  - scripts/deploy/rolling_release/backends/local_ansible.py
  - scripts/deploy/stonebase-local-ansible-runner.py
  - infrastructure/ansible/playbooks/deploy-stonebase-local.yml
related_docs:
  - docs/guides/deployment.md
  - docs/plans/deploy-speed-phase-b-execplan.md
  - docs/runbooks/deploy-status-recovery.md
validation: post-merge 760 deploy Python tests and aggregate deploy contracts passed, including safety, isolated PostgreSQL/API, inventories, and Ansible syntax; no hardware execution performed
open_items:
  - publish the rebased candidate branch
  - run the approved canonical Pi5 plus StoneBase print-plan and preflight
  - bootstrap the runner through an approved SSH executor run before the first local reverify run
---

# Execute a sealed StoneBase candidate with local Ansible

This ExecPlan is a living document. Maintain `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` whenever implementation or acceptance changes. This document follows `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

The rolling release can opt in to one faster terminal apply path for `raspi4-kensaku-stonebase01`. Pi5 creates one digest-sealed artifact for an immutable candidate Git SHA, transfers those bytes once, and asks a root-owned StoneBase runner to execute one fixed `ansible-playbook -c local` command. The operator still uses `scripts/update-all-clients.sh`; terminals remain serial; the sixty-second notice, per-terminal maintenance, sealed rollback manifests, candidate ready acknowledgement, independent final evidence, and maintenance-clear ordering remain coordinator owned.

This is not `ansible-pull`. StoneBase cannot choose a branch, fetch from a network Git remote, select an inventory, or select a playbook. The existing SSH Ansible executor remains the default. The local executor is requested only by `--stonebase-local-ansible-poc` with the exact `--limit raspberrypi5:raspi4-kensaku-stonebase01`. A candidate that changes secret/configuration paths, is not a descendant of the terminal SHA, or finds an unready runner/runtime falls back to SSH before manifest capture, notice, or maintenance. No fallback is permitted after maintenance starts.

## Progress

- [x] (2026-07-21 00:05Z) Created isolated branch `feat/stonebase-local-ansible-poc` without modifying the source checkout. Because PR #1046 was still open, the branch was stacked on its immutable head `c98c30dddd3778e3ed871aa8bee6b98fe215b20e`; `origin/main` remained `332baa69377b61bcb23db5c0daced9e1295ba55b`.
- [x] (2026-07-21 00:14Z) Added the explicit CLI/bootstrap/state executor contract and exact Pi5 plus StoneBase scope. Default plans retain `ssh-ansible`; FJV and every non-StoneBase terminal are outside the local executor's operational recovery, evidence-seeding, preflight, and apply host set.
- [x] (2026-07-21 00:25Z) Implemented pre-maintenance eligibility using the complete commit history from the observed terminal SHA to the candidate, a public inventory allow-list, installed runner identity/configuration checks, the pinned runtime, and disk bounds.
- [x] (2026-07-21 00:34Z) Implemented the incremental Git bundle, candidate-version fixed Ansible payload, generated no-secret inventory, runtime lock, per-member hashes, canonical payload digest, and binding to run, host, previous/candidate SHAs, status client ID, deterministic unit, and three sealed authority digests.
- [x] (2026-07-21 00:43Z) Implemented the root-owned receiver/runner, exact-length single transfer, durable replay receipt, transient systemd unit, global execution lock, fixed local Ansible command, bounded result, reconciliation, cleanup locks, and response-loss hold behavior.
- [x] (2026-07-21 00:49Z) Implemented candidate-SHA ready acknowledgement inside the runner. The runner revalidates artifact and successful result, and the credential-local ready probe independently checks terminal HEAD before sending candidate SHA plus verification challenge. Pi5 still performs the normal independent Git, identity, systemd, Docker-agent, and authenticated health evidence.
- [x] (2026-07-21 00:54Z) Split transfer acceptance from unit waiting so durable run state records `pending`, `accepted`, or `uncertain` at the correct boundary. A running or unknown unit prevents rollback; only a proved-quiescent unit reaches manifest-bounded rollback.
- [x] (2026-07-21 00:56Z) Verified the aarch64 Python 3.11 hash lock resolves exactly nine binary wheels for ansible-core 2.19.4 and its dependencies. Focused local runner, candidate ACK, coordinator, route, and legacy transition tests pass without hardware access.
- [x] (2026-07-21 01:17Z) Passed complete deploy Python discovery (760 tests), the aggregate local deploy contract including isolated PostgreSQL/API integration, deployment safety contracts, both standard and local Ansible syntax checks, JSON validation, Python compilation, and `git diff --check`.
- [x] (2026-07-21 01:37Z) Marked PR #1046 ready and merged its fixed head `c98c30dddd3778e3ed871aa8bee6b98fe215b20e` into `main` as `79ee42ac44e4ffbf33a515df7cc894e910fc8d95`, then rebased this branch without conflicts. The rebased Local executor commit is `4a41dd6c` before this living-plan update.
- [x] (2026-07-21 01:43Z) Reran complete deploy Python discovery on merged Phase B main: 760 tests passed in 53.726 seconds. The aggregate deploy contract also passed, including template parsing, lifecycle/safety contracts, a second 760-test discovery, isolated PostgreSQL/API integration with 20 tests, inventories, and Ansible syntax.
- [x] (2026-07-21 01:37Z) Obtained explicit approval for the canonical Pi5 plus StoneBase `--print-plan` and `--preflight-only`. Neither command has run yet; post-merge validation and candidate publication remain prerequisites.
- [ ] In a later approved maintenance window, perform an SSH executor bootstrap run first, then a separate `--reverify-selected --stonebase-local-ansible-poc` run. Record exact run state, evidence, rollback authority, and timings here.

## Surprises & Discoveries

- Observation: the local candidate cannot safely include the SHA-256 of its own archive inside that archive because doing so is recursive.
  Evidence: `binding-manifest.json` seals a canonical payload digest and every non-manifest member hash. The separately computed archive SHA-256 is bound in Pi5 run state, the one-transfer receiver arguments, the durable terminal receipt, the bounded result, and candidate ACK.

- Observation: a successful receiver response and a successful local Ansible result are different durable states.
  Evidence: transfer and wait were split. Coordinator state is saved as `accepted` immediately after the receiver returns the exact run/digest/unit tuple, before polling the deterministic unit. A missing transfer response is `uncertain`; neither state is treated as deployment success.

- Observation: candidate ready acknowledgement cannot reuse the existing kiosk control-plane SHA authority.
  Evidence: the local executor uses candidate SHA as `desiredReleaseSha` and invokes the installed terminal ready probe from the runner. The default SSH executor still uses the profile adapter's existing `readyAuthority: control-plane` behavior unchanged.

- Observation: runner/runtime readiness alone is insufficient for a secret-free local release.
  Evidence: preflight also verifies the existing root-owned status-agent identity configuration and every enabled agent's user-owned mode-0600 `.env` without returning their contents. Missing or unsafe configuration produces a maintenance-free SSH fallback.

- Observation: excluding FJV only at target planning is insufficient because interrupted recovery and evidence seeding normally inspect the full inventory.
  Evidence: when the local flag is set, the coordinator constructs its operational host set from the exact resolved Pi5 plus StoneBase selection before recovery and seeding. A hermetic response-loss test includes `raspi4-fjv60-80` in inventory and asserts that no event references it.

## Decision Log

- Decision: Keep the safety adapter as owner of manifest, notice, maintenance, rollback, independent observation, display finalization, and maintenance clearing; add an executor below that boundary.
  Rationale: only terminal apply transport changes. Existing SSH and local execution therefore share the same durable recovery authority and cannot diverge on when maintenance may clear.
  Date/Author: 2026-07-21 / Codex.

- Decision: Treat only agent source/Docker changes and neutral documentation as first-version local-eligible history.
  Rationale: the local playbook reuses existing secret files and does not render configuration. Any Ansible/configuration/status-agent change requires the established SSH path that can safely reconstruct those files.
  Date/Author: 2026-07-21 / Codex.

- Decision: Redact changed-path detail when a secret-like history path causes fallback.
  Rationale: durable state needs the stable fallback reason, not secret-path metadata. The artifact, result, journal, and telemetry must not reproduce secret information.
  Date/Author: 2026-07-21 / Codex.

- Decision: Use an incremental bundle `HEAD ^previousSHA`; omit the bundle only for an exact same-SHA reverify.
  Rationale: StoneBase already possesses the prerequisite history. This avoids full-history transfer, prevents network fetch, and makes a missing prerequisite fail locally before reset.
  Date/Author: 2026-07-21 / Codex.

- Decision: Retain a durable terminal receipt after residue cleanup.
  Rationale: deleting artifact/result/staging is safe only if replay remains impossible. The root-owned receipt is a small tombstone that prevents a second candidate transfer for the same run ID.
  Date/Author: 2026-07-21 / Codex.

- Decision: Bootstrap runner files and the active runtime symlink through an ordinary SSH Ansible run and include those destinations in the existing rollback manifest.
  Rationale: local execution cannot safely install its own authority. The installer may fail without failing the SSH release; later local eligibility then falls back until the exact runtime is ready.
  Date/Author: 2026-07-21 / Codex.

- Decision: Defer all hardware commands despite the user's implementation approval.
  Rationale: the task explicitly separates non-live implementation from live preflight/deployment and requires a new target-specific approval. No direct SSH, canonical preflight, maintenance, or release command has been run for this PoC.
  Date/Author: 2026-07-21 / Codex.

## Outcomes & Retrospective

The non-live implementation now connects the sealed local executor to the real coordinator rather than the earlier assertion-only harness. Default SSH behavior remains the default executor. Local eligibility is resolved before the first terminal-owned safety authority is captured, while the artifact itself is created only after file/runtime manifests are sealed and maintenance acknowledgement is proved. The forward order is fixed as manifest capture, notice, maintenance, acknowledgement, artifact seal, one transfer, deterministic local unit, candidate ACK, independent evidence, residue cleanup, and maintenance clear.

Ambiguous execution remains deliberately slow and conservative. If the receiver response is lost or the unit is running/unknown, fleet evidence stays unknown, maintenance remains active, and rollback is not started in parallel. Once systemd proves the unit stopped, any invalid/missing result, ACK mismatch, evidence failure, or cleanup failure uses only the already sealed rollback manifests. No candidate artifact contains Vault, inventory/group/host vars, `.env`, key, token, or password path members.

Hardware acceptance and timing remain open. Phase B is now merged and this branch is rebased onto that immutable merge; post-merge validation and publication must still complete before the approved read-only hardware gate runs.

Local acceptance is complete. The final test pass contains 760 deployment Python tests, 11 dedicated integrated-local tests, deployment safety and route contracts, standard/local Ansible syntax, and the full aggregate contract including the isolated deploy-status PostgreSQL/API tests. The safety audit required the bootstrap copy tasks to use seven literal manifest-backed paths and required the local Git reset exception to prove bundle verification, no `origin` transport, and clean tracked/index state. This tightened the implementation instead of bypassing the contract.

## Context and Orientation

The public deployment entry point is `scripts/update-all-clients.sh`. Local operator code in `scripts/deploy/rolling_release/application.py` performs aggregate read-only preflight and starts an immutable Pi5 systemd unit. The remote process in `scripts/deploy/rolling-release.py` supplies concrete backends. `scripts/deploy/rolling_release/coordinator.py` owns durable run/fleet transitions and iterates terminals serially. A terminal adapter in `terminal_adapters.py` owns each profile's maintenance, manifest rollback, ready protocol, and evidence. `terminal_executors.py` now selects either the unchanged SSH Ansible apply or the StoneBase local apply beneath that adapter.

`scripts/deploy/rolling_release/local_execution.py` is Pi5's no-secret selection and artifact model. `scripts/deploy/rolling_release/backends/local_ansible.py` performs bounded control SSH and the one stdin artifact transfer. `scripts/deploy/stonebase-local-ansible-runner.py` is installed root-owned on StoneBase and is the only program allowed to receive bytes or invoke local Ansible. `infrastructure/ansible/playbooks/deploy-stonebase-local.yml` and `roles/client/tasks/local-release.yml` are copied from the candidate Git tree into the sealed artifact. They verify/reset from the incremental bundle without network, reuse existing agent environments, run only enabled agent lifecycle tasks, and always verify required systemd units.

A sealed manifest means the existing rollback helper wrote an immutable, digest-checked record before terminal mutation. Evidence `unknown` means the coordinator cannot prove a safe live outcome; it is not permission to infer success or manually edit state. Quiesced means systemd and the runner lock prove no local Ansible process is still mutating the terminal. Fallback means selecting the existing SSH executor before maintenance; after maintenance, the only reverse path is sealed rollback.

## Plan of Work

The CLI and bootstrap carry the explicit local flag and reject every limit except exactly Pi5 plus StoneBase. Planning and target state persist requested/effective executor and fallback reason. Under the local flag, only the two selected hosts enter interrupted recovery and evidence seeding, so FJV is parsed only as excluded inventory metadata and is never connected or probed.

Before manifest capture, the coordinator reads StoneBase's clean exact HEAD through the existing adapter and asks the local backend to select an executor. Selection proves descendant history, rejects any secret or configuration path touched by any commit in the range, reconstructs a fixed public inventory contract, calls the installed runner's identity/config/runtime/disk preflight, and otherwise returns a stable SSH fallback reason. A fallback then executes the unchanged SSH pipelining preflight before any terminal mutation.

The existing adapter seals file and runtime manifests, delivers the notice, enters maintenance, and waits for ACK. Only then does Pi5 derive the maintenance authority digest and build the candidate artifact. The manifest binds run ID, StoneBase hostname, status client ID, previous/candidate SHA, deterministic unit name, playbook, fixed runtime, rollback/runtime/maintenance authority digests, member hashes, and payload digest. The external artifact SHA-256 is persisted before transfer.

The receiver reads exactly the sealed byte count, validates archive digest and binding, atomically installs it, writes a durable replay receipt, and submits `raspi-local-ansible-<run>.service`. The transient unit sends output to `/dev/null`. Its worker obtains a global lock, revalidates runtime and active maintenance, extracts only the validated members into a run-owned staging directory, and executes exactly the fixed local command. Its result contains only bounded identifiers, state, timestamps, and return code.

After a successful result, a new verification challenge causes the runner to revalidate artifact/result and invoke the installed credential-local ready probe for candidate SHA. Pi5 waits for the exact ACK and independently calls the existing adapter evidence path. Residue cleanup must acquire both submission and execution locks and succeed before maintenance is cleared. Every failure after maintenance reconciles the unit first; an unproved quiescence holds maintenance, while a proved stop enters the existing rollback path.

## Concrete Steps

All local work occurs in the isolated worktree:

    cd /Users/tsudatakashi/Documents/Codex/2026-07-21/deploy-phase-b-local-execution/work/RaspberryPiSystem_002-local-ansible
    git status --short --branch

Run focused local tests without inventory connections:

    PYTHONPATH=scripts/deploy:. python3 -m unittest -v \
      scripts.deploy.tests.test_stonebase_local_execution \
      scripts.deploy.tests.test_terminal_ready_probe \
      scripts.deploy.tests.test_fleet_coordinator_transitions \
      scripts.deploy.tests.test_route_contract

Run complete acceptance from the repository root:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    scripts/ci/run-deploy-contracts-local.sh
    python3 -m json.tool scripts/deploy/terminal-profile-registry.json >/dev/null
    git diff --check

The hash lock can be rehearsed without StoneBase by downloading for CPython 3.11 aarch64 with `pip download --only-binary=:all: --require-hashes` and the two manylinux aarch64 platform tags. Expect exactly ansible-core, Jinja2, PyYAML, cryptography, packaging, resolvelib, MarkupSafe, cffi, and pycparser.

Phase B merge and rebase are complete. Rerun all commands above against immutable `origin/main` `79ee42ac44e4ffbf33a515df7cc894e910fc8d95`, then publish the exact validated candidate branch before invoking the canonical read-only hardware gate. Do not open a PR unless explicitly requested.

For the approved read-only hardware gate, confirm the final published branch SHA and then run these exact canonical commands:

    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml \
      --limit 'raspberrypi5:raspi4-kensaku-stonebase01' \
      --stonebase-local-ansible-poc --print-plan

    scripts/update-all-clients.sh feat/stonebase-local-ansible-poc infrastructure/ansible/inventory.yml \
      --limit 'raspberrypi5:raspi4-kensaku-stonebase01' \
      --stonebase-local-ansible-poc --preflight-only

The approval was granted on 2026-07-21, but neither command may run until post-merge validation and branch publication succeed. Never add `raspi4-fjv60-80`, use direct SSH, edit fleet/run/manifest/maintenance files, or invoke the local playbook by hand.

## Validation and Acceptance

Artifact acceptance requires a valid incremental bundle prerequisite and rejection of a non-descendant, digest mismatch, member mismatch, duplicate/extra member, symlink, archive/staging size overflow, host/SHA/runtime mismatch, secret history path, secret-like inventory key, and tampered candidate. No archive member may be inventory source, group/host vars, Vault, `.env`, key, token, password, or credential path.

Runner acceptance requires exact-length one-time receipt, a durable replay tombstone, fixed root/hostname, configuration and runtime preflight, deterministic systemd name, single global execution lock, exact command, timeout/nonzero handling, no stdout/stderr persistence, bounded result validation, candidate HEAD proof before ACK, and locked cleanup. An absent unit is quiesced only after the submission lock proves the receiver has stopped.

Coordinator acceptance requires unchanged default SSH tests; StoneBase-only flag rejection outside the exact limit; pre-maintenance fallback; durable requested/effective/fallback, authority/artifact/unit/submission/result/reconciliation state; and fault tests around manifest, maintenance ACK, artifact, transfer, unit, ACK, evidence, rollback, and cleanup. Unit running or unknown must keep evidence unknown and maintenance active. All successful paths must exhibit this order:

    manifest seal -> maintenance ACK -> artifact seal -> one transfer -> local unit
    -> candidate ACK -> independent evidence -> residue cleanup -> maintenance clear

Non-live acceptance completes only when full test discovery, deployment safety contracts, aggregate deploy contracts, Ansible syntax, JSON validation, and diff checks all pass. Hardware acceptance is separate: `--print-plan` and `--preflight-only` must name only Pi5 and StoneBase, exclude FJV, show the requested/effective executor and pinned runtime or a stable pre-maintenance fallback, and submit no release. A later mutation run requires another explicit approval, an SSH bootstrap run, then a separate local reverify run with verified evidence and cleared maintenance.

## Idempotence and Recovery

Selection, artifact inspection, runner preflight, reconciliation, and candidate evidence are read-only and repeatable. Artifact creation refuses an existing destination. The receiver refuses every repeated run ID even after terminal residue cleanup because the receipt remains. The global execution lock prevents overlapping local candidates even with different run IDs.

If Pi5 loses the receiver response, state becomes `uncertain` and the deterministic unit is reconciled. If acceptance was persisted, state remains `accepted` while the unit is polled. A running/unknown unit blocks rollback. A stopped unit with a failed, missing, corrupt, or mismatched result enters only the existing manifest rollback. Rollback ACK and evidence use the adapter's prior authority, not the candidate local executor. Cleanup failure keeps evidence unknown and maintenance active.

Never repair a live run by deleting receipts, locks, unit state, artifacts, manifests, fleet state, run state, or maintenance entries. Use canonical status/cancel and allow the next coordinator to reconcile the same sealed authority. A versioned runtime directory is inert; only the `active` symlink and installed runner files are rollback destinations.

## Artifacts and Notes

Current branch topology after Phase B merge and rebase:

    origin/main                       79ee42ac44e4ffbf33a515df7cc894e910fc8d95
    Phase B PR #1046 head             c98c30dddd3778e3ed871aa8bee6b98fe215b20e
    rebased Local executor commit     4a41dd6c (before this living-plan update)

Focused evidence at 2026-07-21 00:56Z:

    99 focused runner/ready/coordinator/route/systemd tests ... OK
    68 focused local/coordinator/route tests after transfer-state split ... OK
    9 StoneBase local execution tests after runner preflight addition ... OK
    aarch64 CPython 3.11 --require-hashes download ... 9 wheels resolved

Final local evidence at 2026-07-21 01:17Z:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    Ran 760 tests in 50.890s ... OK

    scripts/ci/run-deploy-contracts-local.sh
    [deploy-contract] all checks passed

    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    deploy safety contract tests passed

    standard and sealed-local ansible-playbook --syntax-check ... passed
    JSON validation, Python compilation, git diff --check ... passed

Local Notes JA: `raspi4-fjv60-80` は明示的な新指示がない限り、接続・配布・preflight・中断復旧probeの対象外である。この実装中にPi5、StoneBase、FJV、その他の端末へ接続していない。

## Interfaces and Dependencies

The public CLI adds `--stonebase-local-ansible-poc`. Executor IDs are `ssh-ansible` and `stonebase-local-ansible-poc`. Each run target persists `requestedExecutor`, `effectiveExecutor`, `fallbackReason`, `artifactSha256`, `payloadSha256`, previous/candidate SHA, rollback/runtime/maintenance authority digests, `localUnitName`, `submissionState`, bounded `localResult`, `localReconciliation`, and cleanup result.

`TerminalExecutor.prepare(...)` creates no artifact for SSH and a sealed artifact for local execution. `apply(...)` performs the unchanged SSH playbook or the one local transfer. `await_completion(...)` is a no-op for SSH and reconciles the local unit to a validated result. `prove_ready(...)` delegates to the adapter for SSH and to the runner's candidate proof for local. `reconcile(...)` and `cleanup_residue(...)` are local-only recovery boundaries.

The fixed runtime is Python 3.11, ansible-core 2.19.4, and community.general 11.4.1. Python packages are installed with aarch64 wheel hashes from `requirements-aarch64-py311.lock`; the collection tarball has a fixed SHA-256 in `runtime-lock.json`. Artifact and staging maximums are 128 MiB and 256 MiB. Local execution timeout is fifteen minutes. The route contract owns `terminal.artifact-seal`, `terminal.single-transfer`, `terminal.local-unit`, `terminal.candidate-ready-ack`, and `terminal.local-residue-cleanup`.

Revision note (2026-07-21 01:43Z): Completed post-merge local acceptance without hardware access. Branch publication, the approved Pi5 plus StoneBase print-plan, and the approved preflight remain sequential pending work.
