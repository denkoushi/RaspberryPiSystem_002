---
id: pi3-staged-source-transfer
title: Seal Pi3 release source on Pi5 and transfer it over the existing SSH Ansible route
status: in-progress
scope: low-resource Pi3 terminal source transport, rollback ownership, and release contracts
date: 2026-08-05
source_of_truth: docs/plans/pi3-staged-source-transfer-execplan.md
related_code:
  - scripts/deploy/rolling_release/coordinator.py
  - scripts/deploy/rolling_release/backends/ansible.py
  - scripts/deploy/rolling_release/route_contract.py
  - infrastructure/ansible/playbooks/deploy-signage-staged.yml
  - infrastructure/ansible/roles/signage/tasks/release-preparation.yml
related_docs:
  - docs/guides/deployment.md
  - docs/plans/standard-release-production-path-audit-execplan.md
  - docs/plans/deploy-speed-phase-b-execplan.md
  - docs/knowledge-base/KB-401-deploy-release-identity-runtime-audit.md
validation: isolated reproduction, focused boundary and rollback audit, and Ansible safety contracts passed; clean hosted full CI pending
open_items:
  - conditionally approved production retry remains gated on exact-main plan and preflight
  - main integration and exact-main verification remain pending
---

# Seal Pi3 release source on Pi5 and transfer it over the existing SSH Ansible route

This ExecPlan is a living document. Maintain its `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections as work proceeds. It follows `.agent/PLANS.md` in the repository root.

## Purpose / Big Picture

The low-resource Pi3 must not depend on a fresh external Git HTTPS transfer after it has entered maintenance. The existing coordinator, terminal profile, SSH Ansible execution, immutable candidate SHA, ready evidence, and sealed rollback authority remain unchanged. Pi5 will instead construct a minimal Git bundle from its already verified exact candidate checkout, bind that bundle to the run, host, previous SHA, candidate SHA, and SHA-256 digest, and transfer it through the existing compressed SSH Ansible route. The Pi3 will validate and apply that staged bundle before resetting to the immutable candidate SHA; it will not select a branch or fetch release source from a remote network.

This is not a resurrection of the frozen StoneBase local executor. Ansible still executes remotely from Pi5, the coordinator remains the sole release authority, the profile-selected signage playbook remains inside that executor, and the existing sealed manifest remains the only rollback authority. Pi5, all six Pi4 terminals, and the restored Pi3 production state are not modified by this work.

## Progress

- [x] (2026-08-05 13:27+09:00) Confirmed read-only that production run `20260805-025206-87ff4c` ended terminally: Pi5 and all six Pi4 targets remained successful, Pi3 rolled back to `c32287db7b0f044cec4691f4a791513d7073e52e`, required display and agent services/timers were restored, and maintenance was cleared by the coordinator.
- [x] (2026-08-05 14:20+09:00) Fixed the exact failure evidence: `deploy-staged.yml` imported the common role, whose repository mutation ran `git fetch --no-tags origin <candidate>` on Pi3. Three attempts ended with Git HTTPS HTTP/2 stream cancellation, short body, unexpected disconnect, early EOF, and invalid `index-pack` before any candidate reset.
- [x] (2026-08-05 14:35+09:00) Traced the production authority and history. Pi5 already owns coordinator execution and compressed terminal SSH probing, but the Pi3 source bytes bypass that channel and originate from GitHub. A former StoneBase-only local artifact path was reverted and later frozen by KB-401; it is not an applicable fallback.
- [x] (2026-08-05 14:45+09:00) Classified the incident as a transient external transport interruption exposing a structural release weakness: a low-resource terminal in maintenance depends on an unsealed external Git transfer. More retries or HTTP settings would leave that authority mismatch intact.
- [x] (2026-08-05 15:40+09:00) Reproduced exact-main bundle creation and local import from an old-SHA checkout that did not contain the candidate object. The bundle required exactly the old SHA, remained usable with an unreachable external origin, and reset cleanly to exact main.
- [x] (2026-08-05 15:45+09:00) Measured the exact bundle at 3,430,416 bytes. Controller creation took about 0.99 seconds and about 67 MiB maximum RSS; terminal preflight/promote/verify used about 24 MiB maximum RSS, consume used about 33.5 MiB, and imported Git objects grew by about 5.3 MiB.
- [x] (2026-08-05 15:52+09:00) Proved corrupted staging fails before HEAD, status, index, service, or display state changes; run-scoped cleanup is repeat-safe and leaves zero residue. A network-disabled, one-CPU, 120-MiB Linux container also completed without OOM or residue. This is a constrained emulation, not physical Pi3 authorization.
- [x] (2026-08-05 16:20+09:00) Implemented Pi3-only staged source creation and compressed Ansible transfer, with a typed digest-bound reference, strict read-only signage baseline, pre-maintenance capacity/verification gate, atomic promotion, and manifest-owned paths.
- [x] (2026-08-05 16:25+09:00) Replaced only the Pi3 common-role remote fetch boundary with exact local-bundle validation and import; the Pi4 path remains unchanged. Fixed the first review draft so the Pi3 staged-source assertion runs before the legacy remote-fetch task.
- [x] (2026-08-05 16:32+09:00) Added route ownership, before/after stage fault tests, residue/idempotency tests, a 64-MiB fail-closed artifact ceiling, and an execution contract that forbids remote protocols during consume.
- [x] (2026-08-05 20:05+09:00) Re-evaluated release impact after exact-main planning exposed that the Pi3-only branch lived in the global common role. Restored `roles/common/tasks/main.yml` byte-for-byte to the deployed baseline and moved the sealed source boundary to a registry-selected signage playbook and signage-owned release preparation. Worktree classification is now `deploy-control + signage-role + neutral`, with no `global`, `unknown`, or kiosk profile impact.
- [x] (2026-08-05 20:25+09:00) Passed 104 focused profile, bundle, preflight, adapter, and classification tests plus the recursive Ansible deployment safety contract. The dedicated playbook preserves the existing signage tasks, handlers, and GUI restoration sequence; only repository preparation is replaced.
- [x] (2026-08-05 20:40+09:00) Stopped repeated local full audits and completed the requested lightweight toolchain preflight: Node `v24.14.0`, project pnpm `9.15.9`, `CI=true`, frozen-lockfile override parity, and pyenv Ansible shims matched; Git and lockfile digests remained stable; Docker residual was zero.
- [ ] Run the full deployment audit once in the official GitHub deploy-contract job. Local full-audit evidence is invalid because an earlier bundled-pnpm attempt reduced the ignored `node_modules` tree; it will not be repaired or reused for acceptance.
- [x] (2026-08-05 14:42+09:00) Passed focused Pi3 bundle/adapter/coordinator/route tests, Ansible template parsing for 104 templates, lifecycle and deployment safety contracts, Python compilation, documentation audit, and diff inspection.
- [x] (2026-08-05 14:50+09:00) Passed the complete local deploy-contract source: 1,002 Python tests, 40/40 required production-path scenarios, 26 route stages, 13 Pi5 phases, 12/12 past-incident probes, 157 disposable PostgreSQL migrations, application/migrator role separation, all Ansible syntax checks, and zero run-labelled container/network/volume residue.
- [ ] Publish a focused follow-up PR and classify all hosted CI results before proposing any merge gate.

## Surprises & Discoveries

- Observation: SSH compression was proved only for terminal preflight, not for release source transport.
  Evidence: `terminal_preflight.py` supplies `Compression=yes`, while `roles/common/tasks/main.yml` independently invokes Git HTTPS on the terminal. The past-incident mutation named `pi3-ssh-compression` therefore cannot prove compression of candidate source bytes.

- Observation: the failed run's rollback authority was already sufficient for an unknown result after repository transport failure.
  Evidence: the coordinator captured repository and runtime manifests before maintenance, retained the previous SHA, rolled the Pi3 back, verified the restored release claim and services, and cleared maintenance only after that proof.

- Observation: the immediate error is consistent with an external transient, but retrying the same transport cannot prove structural safety.
  Evidence: all three attempts failed while receiving one Git object body over HTTP/2, before `cat-file` and reset. Even a later successful attempt would still let GitHub and the Pi3's outbound connection participate in release-byte availability while the terminal is in maintenance.

- Observation: a prior Git-bundle implementation does not authorize reuse of its executor.
  Evidence: the StoneBase-only Local route added a second execution and identity boundary, was reverted, and is explicitly frozen in `deploy-speed-phase-b-execplan.md` after KB-401. This plan reuses only the Git bundle format while retaining the single SSH Ansible executor.

- Observation: the first integration draft put the Pi3 staged-source assertion after the existing fetch task and called a no-op source-stage boundary for Pi4 terminals.
  Evidence: diff review showed the undefined-variable branch could execute `git fetch origin` before the assertion, and every mutating adapter entered `terminal-source-stage`. The assertion now precedes fetch and the coordinator gates staging with the signage adapter's Pi3-only contract.

- Observation: the fixed 64-MiB ceiling is deliberately capacity policy, not an estimate of current use.
  Evidence: the exact failed-run-to-main delta is 3,430,416 bytes, so the ceiling is about 18.7 times the observed artifact. The Pi3 preflight requires the artifact's two-copy allowance plus a fixed 64-MiB free-space margin. A future larger candidate must fail closed and receive a separate review rather than silently raise the bound.

- Observation: runtime `when` guards do not narrow release impact when Pi3 code is stored in the common role.
  Evidence: the exact-main standard plan correctly classified `infrastructure/ansible/roles/common/tasks/main.yml` as `global` and selected every Pi4, even though the new tasks were signage-guarded. Restoring that file to the deployed baseline and placing the boundary under `roles/signage/` removes the global path without weakening the classifier.

- Observation: local Node and pnpm must be selected independently.
  Evidence: the shell defaulted to Node 18, while the Codex bundle supplied Node 24 and a newer pnpm that did not honor this repository's pnpm 9 override contract. The newer pnpm began recreating the ignored `node_modules` directory before failing. The clean GitHub job uses the repository-declared pnpm 9.15.9, Node 20, `CI=true`, and `pnpm install --frozen-lockfile`.

## Decision Log

- Decision: Treat the external HTTP/2 cancellation as the trigger and direct terminal Git fetch as the root design weakness.
  Rationale: the error may not recur, but the release contract must remain safe and available without asking a low-resource terminal in maintenance to download its candidate from an external authority.
  Date/Author: 2026-08-05 / Codex.

- Decision: Preserve the current coordinator, terminal profile, remote Ansible playbook, immutable SHA evidence, and sealed rollback manifest.
  Rationale: the incident does not justify a new local executor, a new ready authority, manual Git recovery, or a separate rollback mechanism.
  Date/Author: 2026-08-05 / Codex.

- Decision: Make staged source Pi3-only and retain the existing Pi4 fetch path in this change.
  Rationale: the observed weakness is specific to the low-resource Pi3 boundary. Keeping Pi4 behavior unchanged limits the trust-boundary and regression surface while the new transport receives production-path evidence.
  Date/Author: 2026-08-05 / Codex.

- Decision: Create an incremental Git bundle on Pi5, transfer it with explicit SSH compression, and require exact local validation of run, host, previous SHA, candidate SHA, bundle heads, prerequisites, and SHA-256 before mutation.
  Rationale: Pi5 already has the exact candidate checkout and is the production coordinator. A digest-bound bundle removes external transfer from the Pi3 mutation window without weakening immutable SHA or history checks.
  Date/Author: 2026-08-05 / Codex.

- Decision: Complete bundle creation, compressed transfer, capacity checks, digest validation, and remote `git bundle verify` after the rollback manifest is sealed but before notice or maintenance; remove it on forward success.
  Rationale: a staging failure must not change the Pi3 display, services, or repository. The existing manifest can represent the initially absent run-scoped temporary and final paths and remains the sole rollback authority if a transport response is ambiguous.
  Date/Author: 2026-08-05 / Codex.

- Decision: Do not change retry counts, force an HTTP version, or add an alternate public/operator path.
  Rationale: those changes can mask the trigger but do not correct candidate-source authority.
  Date/Author: 2026-08-05 / Codex.

- Decision: Use the existing profile playbook selector for a dedicated signage release playbook and keep the common role identical to the deployed baseline.
  Rationale: the common role is correctly global because every Pi4 and Pi3 imports it. A signage-owned preparation file preserves the local-bundle and rollback contracts while leaving the Pi4 executor and fetch behavior unchanged; no content-sensitive classifier exception or `--limit` bypass is needed.
  Date/Author: 2026-08-05 / Codex.

- Decision: Do not repair or reuse the locally altered dependency tree for the release-blocking full audit; use the official clean GitHub deploy-contract job once.
  Rationale: focused Python, YAML, and Ansible safety evidence is valid, but a full audit after an unintended dependency-tree recreation would mix toolchain recovery with product validation. Clean checkout plus the repository's frozen install is the authoritative reproducible path.
  Date/Author: 2026-08-05 / Codex.

- Decision: Require only the effective file owner and mode `0600`, not a matching primary group name.
  Rationale: mode `0600` grants no group access, while assuming that the SSH account has an identically named group is unnecessary transport coupling. The Ansible copy remains become-owned, fixed-path, and bound to the resolved inventory user.
  Date/Author: 2026-08-05 / Codex.

## Outcomes & Retrospective

The Pi3-only route stages and consumes a digest-bound local bundle before and during the existing maintenance boundary, while Pi4 retains its former executor and common-role fetch path. The first merged version incorrectly placed the Pi3 branch in the global common role; the follow-up boundary separation is locally focused-test complete and awaits the required aggregate contracts, PR, hosted CI, merge, exact-main verification, and conditionally approved standard production retry. No production mutation, retry, SSH write, service operation, manual Git command, or new run occurred during the separation work.

## Context and Orientation

`scripts/update-all-clients.sh` is the only public production entry point. The immutable Pi5 release unit runs `scripts/deploy/rolling_release/coordinator.py`, which owns terminal ordering, maintenance, evidence, and rollback. The signage profile in `scripts/deploy/terminal-profile-registry.json` selects `infrastructure/ansible/playbooks/deploy-signage-staged.yml`; the kiosk profile continues to select `deploy-staged.yml` and the common role. The signage playbook imports `roles/signage/tasks/release-preparation.yml`, which requires and consumes the coordinator-sealed local source without a remote-fetch fallback.

The coordinator's order is important: it prepares the repository baseline, captures a sealed manifest, delivers notice, enters maintenance, invokes the terminal playbook, waits for typed ready evidence, and finalizes or rolls back. Staged source must fit inside that existing ordering. A source file may not be transferred before its rollback path is sealed, and no success may be inferred from transfer or playbook exit alone.

`scripts/deploy/rolling_release/route_contract.py` is the machine-readable ownership ledger for every cross-machine boundary. Any new staging call must be registered there with a proof, failure policy, recovery owner, and a real before/after fault rehearsal. `scripts/deploy/tests/test_route_contract.py` fails closed when a runtime or adapter call is not owned.

## Plan of Work

First, build an isolated contract around incremental Git bundles. In temporary repositories, create a previous checkout and candidate commit, construct a bundle that contains the candidate delta while declaring the previous history as prerequisites, and prove that a repository at the bound previous SHA can verify and fetch the exact candidate. Reject a wrong previous SHA, absent prerequisite, unexpected bundle head, candidate mismatch, digest mismatch, symlink/non-regular file, unexpected host/run binding, corruption, and an oversized or unbounded artifact. Include divergent-history coverage and choose fail-closed behavior based on the actual Git bundle prerequisite contract rather than assuming ancestry.

Second, add a narrow Pi3 staging boundary to the current runtime/adapter path. For signage, repository baseline observation is strictly read-only and never performs the legacy docs repair. After that baseline and the rollback manifest are sealed, but before notice or maintenance, the Pi5-side code validates the exact local candidate checkout, creates the bundle in a private temporary directory, verifies it locally, calculates SHA-256, and checks both controller and Pi3 capacity against a fixed artifact-size ceiling and required free-space margin. It sends the bundle to a deterministic run-scoped Pi3 temporary path through the existing Ansible inventory with explicit `Compression=yes`, verifies the received bytes and Git prerequisites, and atomically renames them to the final path. The transfer returns a typed, secret-free reference only after the remote file is regular, owned by the resolved SSH user with mode `0600`, digest-correct, and bound to the expected run, host, previous SHA, and candidate SHA. Generic Pi4 adapters do not expose this staging operation and keep their current behavior.

Third, include both deterministic temporary and final staged paths in the signage rollback path set before manifest capture. Stage before notice and maintenance. If creation, capacity checking, transfer, or verification fails, reconcile the exact run-bound paths, remove any staging residue, and stop without touching the display, services, or repository. Pass the validated reference as fixed Ansible extra variables only after staging succeeds. The registry-selected signage playbook validates the file and digest, runs `git bundle verify`, requires exactly the intended candidate head and available prerequisites, imports from the local bundle, rechecks the unchanged previous checkout and clean tree, resets to the exact candidate, proves the clean final SHA, and removes the bundle. The common role remains unchanged for Pi4 and full provisioning. The staged Pi3 branch is contractually forbidden from invoking `origin`, GitHub, or any other external remote after maintenance begins. A failure during import/reset remains fatal and routes through the existing sealed rollback; forward success also proves no run bundle remains.

Fourth, extend the route contract and coordinator rehearsals. Inject failure immediately before and after bundle creation, capacity checking, transfer, atomic promotion, remote verification, playbook consumption, source removal, and ambiguous response loss. Prove that pre-maintenance staging failure leaves display, service, and repository state byte-for-byte/logically unchanged; no repository mutation occurs without a valid staged reference; an import/reset failure keeps evidence unknown until rollback; the sealed manifest removes residue; maintenance follows existing rules; and a later plan cannot consume a prior run's bundle. Prove the Pi4 route is unchanged and the Pi3 path cannot invoke the Git remote while in maintenance.

Finally, run the focused bundle, Ansible adapter, coordinator transition, terminal profile, common-role, route, rollback, and low-resource tests. Then run the deployment safety and aggregate deploy-contract suites required by the changed deployment files, followed by documentation audit and a full diff review. Publish only the focused files on an `agent/` branch as one draft follow-up PR. Do not merge, run exact-main release verification, or retry production without the subsequent gate and explicit approval.

## Concrete Steps

Work only in this local checkout and branch:

    cd /Users/tsudatakashi/RaspberryPiSystem_002
    git status --short --branch

Run isolated bundle experiments and focused tests without inventory hosts or network access. Expected evidence is that valid Pi3 source bytes come only from a digest-bound local bundle, every binding or corruption mutation fails before reset, and the existing Pi4 test fixtures still call their former remote-fetch path.

On a clean dependency tree, the repository-selected deployment contract is:

    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    CI=true scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs

For this follow-up, run the full command through the official GitHub deploy-contract job because the current local ignored dependency tree is no longer an admissible input. Do not repair it as part of this task. Do not run `scripts/update-all-clients.sh`, SSH to a production host, invoke Ansible with a production inventory, clear maintenance, restart a service, or create a production run until the PR, main integration, exact-main, and standard production preflight gates pass.

## Validation and Acceptance

Acceptance requires all of the following:

1. Isolated tests reproduce the current direct-fetch exposure and prove that the staged Pi3 path has no Git remote dependency.
2. Bundle digest, exact candidate head, prerequisite/previous SHA, run, host, file type, ownership/mode, capacity margin, and size ceiling are all fail-closed.
3. Pi3 source transfer uses explicit SSH compression, temporary-plus-atomic-final run-scoped paths, and the existing rollback manifest; all staging validation finishes before maintenance.
4. Before/after and response-loss rehearsals prove a staging failure changes no display/service/repository state, one rollback authority owns later failures, unknown evidence handling is retained, and source residue is zero.
5. Pi4 behavior, terminal ready claims, immutable final SHA, and coordinator sequencing remain unchanged.
6. Focused tests, documentation audit, and diff inspection pass locally, while the official clean hosted deploy-contract performs the one release-blocking full audit.
7. The follow-up PR's required CI passes on one fixed head. Main integration, exact-main verification, and the conditionally approved production retry remain separately gated.

## Idempotence and Recovery

The typed binding includes both run and host, while deterministic temporary and final paths include the run ID and may never be reused across runs. Repeating staging for the same binding is allowed only when the existing remote bytes and digest match exactly; otherwise it fails closed. Bundle creation uses a private controller temporary directory; transfer lands at a remote temporary path and promotes by atomic rename only after capacity, type, mode, digest, and bundle verification. A pre-maintenance staging error reconciles and removes only these manifest-owned run paths, leaving display, services, and repository unchanged. A successful playbook removes the bundle, while any failure after repository mutation invokes only the already sealed manifest rollback, which restores the repository and removes the initially absent staged paths. Reconcile and rollback must be safe to repeat and must not contact GitHub to restore the previous release.

If local validation fails, keep the branch unpushed until the cause is classified. If hosted CI fails, inspect logs and artifacts before changing implementation. Never use a production retry to discover the next defect.

## Artifacts and Notes

The durable incident evidence is summarized here without secrets or raw production logs. A new KB entry will be added when the implemented transport and regression evidence are final, so the KB records the proven fix rather than a speculative design. Generated reports must exclude credentials, Vault material, raw SSH output, and complete journals.

## Interfaces and Dependencies

The implementation exposes one typed staged-source reference containing schema version, run ID, inventory host, previous SHA, candidate SHA, remote path, byte length, and SHA-256. The terminal adapter/runtime gains one staging boundary used only by the signage profile. The existing profile registry selects a signage-owned Ansible playbook, which receives fixed extra variables derived from that validated reference. This does not add a new executor or authority: the same coordinator invokes the same Ansible backend and owns the same manifest rollback. No new operator flag, external service, package dependency, or production credential is introduced.

## Revision Note

Updated on 2026-08-05 to record the common-role impact correction, the dedicated signage playbook boundary, focused validation, and the decision to obtain the full audit only from the official clean GitHub CI environment after the local ignored dependency tree became inadmissible.
