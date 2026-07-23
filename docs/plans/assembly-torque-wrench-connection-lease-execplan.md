---
title: Assembly Torque Wrench Connection Lease
id: plan-assembly-torque-wrench-connection-lease
status: release_a_terminal_completion_notice_fix_in_progress
scope: Pi5-owned physical torque-wrench lease, torque-agent fencing, exact external Bluetooth controller guard, and two-terminal pilot
date: 2026-07-22
source_of_truth: this document
related_code: apps/api/prisma/schema.prisma, apps/api/src/services/torque-wrenches, clients/torque-agent, infrastructure/ansible/roles/client, apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx
related_docs: ../decisions/ADR-20260722-assembly-torque-wrench-connection-lease.md, ../runbooks/assembly-torque-agent.md, ./assembly-torque-wrench-traceability-execplan.md
validation: Release A and the rapid-click confirmation interlock at exact SHA d10fdafb are deployed and verified on Pi5 and both pilot terminals; the locally corrected final-bolt BROWSER_DISARMED notice passes nine focused tests, all 297 Web files and 1471 tests, Web lint and production build, document audit, and diff checks
open_items: publish and deploy the final-bolt notice correction after separate approval, reproduce the unexplained HID disappearance that lost memory 033, complete separate-floor input acceptance, make the cross-work-ID confirmation-reuse product decision, and activate enforcement only after separate approval
---

# Add a Fleet-Wide Connection Lease for the Shared Torque Wrench

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while the work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Operators must be able to carry the physical CEM20N3X10D-BTLA torque wrench to another Raspberry Pi terminal and use it there without two terminals accepting or competing for the same wrench. After this change, Pi5 is the authority for one physical wrench, one client device, and one assembly work session. A kiosk explicitly starts use, renews an eight-second lease, releases it when finished, or confirms that the physical wrench is present before taking over an abandoned lease. The dedicated external Bluetooth adapter is powered only while the local terminal owns a valid lease.

The first production pilot is limited to `raspi4-kensaku-stonebase01` and `raspi4-assembly-01`. This implementation work does not authorize a deployment, a pairing operation, a commit, a push, or a pull request.

## Progress

- [x] (2026-07-22) Confirmed the existing local browser binding, exclusive evdev grab, durable SQLite outbox, assembly row locking, part-measurement edit lock, client identity, and exact external-controller preparation boundaries.
- [x] (2026-07-22) Chose Pi5/PostgreSQL coordination rather than direct Pi-to-Pi messaging, explicit operator start, physical-presence takeover, and Runbook-owned pairing.
- [x] (2026-07-22 16:47 JST) Added the expand-only schema, central lease service/routes, event fencing, and a real-PostgreSQL two-client integration test. The focused API test passes.
- [x] (2026-07-22 16:49 JST) Added the torque-agent explicit lease state machine, local API, durable event lease snapshots, HID cancellation, fail-closed renewal behavior, and focused tests. Ruff and 43 pytest tests pass.
- [x] (2026-07-22 18:00 JST) Completed the host guard, exact-controller idempotent helper, one-second deadline reconciliation, four-second command bound, Ansible/Compose wiring, rollback ownership, and tests proving the unrelated internal Bluetooth rfkill remains unchanged.
- [x] (2026-07-22 17:55 JST) Completed the kiosk explicit start/release, owner display, two-step takeover, Bluetooth-wait/ready/communication states, and seven focused UI tests.
- [x] (2026-07-22 18:14 JST) Updated the ADR, Runbook, global/AI indexes, two-terminal physical acceptance checklist, and document inventory.
- [x] (2026-07-22 18:14 JST) Completed focused and full local validation without contacting production hosts.
- [x] (2026-07-22 16:50 JST) Reached a safe local pause point requested for 17:00: no deployment, pairing, commit, push, or production-host contact was performed. Remaining guard/UI contract coverage and full validation are recorded below.
- [x] (2026-07-22 19:22 JST) Published Draft PR #1068 and passed exact-head CI at `811138b1`. The first approved Release A aggregate preflight stopped before release-unit submission on two candidate Bluetooth contract mismatches and Assembly-01's not-yet-installed torque-agent. Scoped contract corrections and the complete local deploy-contract suite now pass; a new exact-head CI and release retry remain pending.
- [x] (2026-07-22 20:02 JST) Passed exact-head CI at `ef7f3c4a`, then ran approved Release A `20260722-103023-77ca0e`. Pi5 and StoneBase converged and verified. Assembly-01 rejected a successful external-controller oneshot because systemd 257 reported the completed unit's cleared `ExecMainCode=0`; the standard release restored its repository and runtime to `5f7d041c`, verified kiosk/NFC health, and cleared maintenance.
- [x] (2026-07-22 20:02 JST) Corrected the oneshot result contract to accept only numeric code 0 or CLD_EXITED 1 alongside `Result=success` and `ExecMainStatus=0`, while retaining the subsequent exact-controller powered-OFF proof. Focused tests, deployment safety contracts, Ansible syntax, and the complete local deploy-contract suite pass. New exact-head CI and the Assembly-01 retry remain pending.
- [x] (2026-07-22 20:17 JST) Passed exact-head CI at `c68691f2`. Its approved retry stopped before unit submission because the read-only candidate helper probe still required the guard-owned external adapter to be powered. Changed the probe to accept the exact soft-blocked/OFF controller, retain three bounded management reads when unblocked, and never change power. Focused and safety tests pass, and executing the rendered candidate probe read-only on both pilot terminals returns success. New exact-head CI and retry remain pending.
- [x] (2026-07-22 20:49 JST) Passed exact-head CI at `e4760ec3` and completed approved rolling release `20260722-113236-970014`. StoneBase and Assembly-01 both converged to the exact terminal SHA with verified release evidence; Pi5 remained verified at server SHA `ef7f3c4a`. Pairing and enforcement were not performed.
- [x] (2026-07-22 21:07 JST) Audited every Release A failure gate before making another change. Pi5 has zero enforced profiles and zero live connection leases; both pilot adapters are OFF, torque-agent reports `ok=true` and expected `ready=false`, and both NFC readers are healthy. Classified the missing deterministic post-reboot guard start as one availability blocker, not a present safety violation, and grouped its udev/preflight/tests/docs correction into one candidate.
- [x] (2026-07-22) Passed exact-head CI at `38c7df98`, completed approved rolling release `20260722-122724-477f6e`, and rebooted StoneBase then Assembly-01. Both exact external adapters remained OFF without a lease, each guard started from the exact USB event, torque-agent returned `ok=true` and expected `ready=false`, and NFC/internal Bluetooth remained healthy.
- [x] (2026-07-23) Paired the approved wrench with Assembly-01's exact UB500 Plus and verified that the wrench retained both host bonds. StoneBase-to-Assembly-01 and Assembly-01-to-StoneBase normal release/start transfers both reached `入力待機中`, accepted a real torque event, released the lease, and powered the owner adapter OFF.
- [x] (2026-07-23 09:35 JST) Completed the independent fail-closed physical checks before changing code. Pi5 loss powered Assembly-01's external adapter OFF in 5.688 seconds and 3.332 seconds; agent stop powered it OFF in 7.676 seconds; neither a sustained communication recovery nor agent restart reacquired automatically. Page departure released ownership, exact USB removal left NFC healthy, and exact USB replug initialized OFF and retained the saved wrench bond.
- [x] (2026-07-23 09:44 JST) Reproduced the physical takeover blocker without repeated production retries. Pi5 correctly returned `TORQUE_WRENCH_LEASE_HELD` and the remote owner, but torque-agent converted every no-lease `lastError` to `communication_lost`; the kiosk also retained an old acquisition message after later heartbeat state changes. Added focused regressions and a local correction that separates transport loss from business rejection and derives the connection notice from each latest heartbeat. Agent core 29 tests, Ruff, focused Web 8 tests, and Web ESLint pass.
- [x] (2026-07-23 09:51 JST) Completed the correction's aggregate local validation: torque-agent 45 tests and Ruff, Web 297 files/1470 tests and production build, root lint, document audit, `git diff --check`, all 821 deploy-contract tests, disposable-PostgreSQL migration replay, deploy-status integration, and all Ansible syntax checks pass. API, database schema, guard, Bluetooth helper, NFC, and public API contracts are unchanged.
- [x] (2026-07-23 10:35 JST) Classified the first correction CI result as two newly disclosed dependency-security blockers rather than torque regressions. Updated `fast-uri` to 3.1.4, Sharp to 0.35.3 with the required Node 20.9 baseline, and the Caddy build's effective gRPC replacement to 1.82.1. Local source scanning now reports zero tracked HIGH/CRITICAL findings; full API validation, production builds, and the complete deploy-contract suite pass, with exact-head CI remaining the authoritative current-database image scan.
- [x] (2026-07-23 12:09 JST) Passed exact-head CI at `f64c4da2` and completed standard rolling release `20260723-022706-9b18a5` through Pi5, StoneBase canary approval, and Assembly-01. All three hosts reported the exact SHA with verified evidence; the same-SHA post-release print-plan returned `targets=[]` and `warnings=[]`.
- [x] (2026-07-23 12:53 JST) Physically took generation 10 over from StoneBase to Assembly-01 as generation 11. Continuous controller sampling recorded StoneBase ON/Assembly OFF, then both OFF for seven seconds, then StoneBase OFF/Assembly ON with no overlap; the old agent was fenced and the new agent reached `ready=true`. The operator did not deliberately activate the final confirmation button, so the two-stage UI was rejected despite the safe transport result. Both adapters were returned OFF and generation 11 was released with `OPERATOR_RELEASE`.
- [x] (2026-07-23 12:59 JST) Reproduced the confirmation defect as the absence of any temporal or separate-control interlock after replacing the first button in place. Added a 1.2-second disabled interval, a separately disabled physical-presence checkbox, a differently positioned final action, cancellation, and a regression that proves rapid activation cannot call `/lease/takeover`.
- [x] (2026-07-23 13:07 JST) Completed the correction's aggregate local validation: the focused kiosk suite (8 tests), Web full suite (297 files/1470 tests), Web lint and production build, root lint, document audit, `git diff --check`, all 821 deploy-contract tests, disposable-PostgreSQL deploy-status integration (20 tests), Ansible contracts (24 tests), and all Ansible syntax checks pass.
- [x] (2026-07-23 13:48 JST) Passed exact-head CI at `d10fdafb`, completed standard rolling release `20260723-041748-4329b4`, and deliberately verified the two-stage takeover in both directions. Controller observation showed no simultaneous ON state, the new owner reached HID readiness, and the old owner was fenced and powered OFF.
- [x] (2026-07-23 14:56 JST) Distinguished two physical-test symptoms. Memory 033 was absent from PostgreSQL after the approved HID path disappeared with `ENODEV`; its initiating HCI cause remains unknown and no reconnect implementation was made. Memories 034 and 035 were then accepted under passive HCI capture. The final accepted bolt deliberately released generation 17 with `BROWSER_DISARMED`, but the kiosk rendered that expected release as a yellow connection-start failure and inserted a top-level banner that shifted the layout. Added a focused failing regression and suppressed only that expected notice. All nine focused tests, 297 Web files and 1471 tests, Web lint and production build, document audit, and diff checks pass.
- [ ] Reproduce the memory-033 HID disappearance under passive HCI capture before changing reconnect behavior. Publish, deploy, and physically verify the final-bolt notice correction only after the corresponding separate approvals.

## Surprises & Discoveries

- Observation: The current `torque-agent` loopback heartbeat proves only that the local HTTP process answered; it does not prove a fleet lease, Bluetooth power, HID presence, or exclusive grab.
  Evidence: `KioskAssemblyWorkSessionPage.tsx` marks `agentConnected=true` on any successful `/heartbeat`, while `torque_agent/main.py` returns only `ok` and `bound`.

- Observation: The current external-controller unit powers the configured UB500-class controller on during provisioning and leaves it powered.
  Evidence: `torque-bluetooth-adapter.sh.j2` unblocks exact rfkill and calls bounded `btmgmt power on`, but has no runtime owner or power-off path.

- Observation: A container-only controller switch cannot fail closed after an abrupt container crash.
  Evidence: the torque container is privileged, but Docker health does not power the host controller off. A separate host systemd guard must own the final timeout.

- Observation: The migration gate accepts new tables and nullable built-in columns on existing tables, but rejects triggers and contract constraints on existing populated tables.
  Evidence: `scripts/deploy/validate-expand-only-migrations.py` implements an explicit allow-list.

- Observation: A taken-over lease may deliberately have `connectAfter` later than its first eight-second expiry when the old owner was just renewed. The new owner must continue renewing while waiting, and only the guard/HID activation waits.
  Evidence: the focused API test verifies generation fencing immediately and a future `connectAfter`; `ConnectionLeaseManager` renews during `handoff_wait` without writing an ON intent early.

- Observation: A business rejection must remain HTTP 200 so an old durable event cannot block the SQLite outbox head.
  Evidence: the real-PostgreSQL focused test receives `CONNECTION_LEASE_REQUIRED` and `CONNECTION_LEASE_FENCED` as retained rejected records with status 200, while a delayed event for the still-current generation is accepted.

- Observation: Replacing the first takeover button in place with an immediately active final button is not a reliable two-stage physical confirmation on a kiosk. A repeated pointer/touch input can target the newly rendered action before the operator deliberately confirms it.
  Evidence: the first production takeover safely fenced and delayed Bluetooth power, but the database recorded `TAKEN_OVER` at the first interaction while the operator reported never deliberately pressing the final action. The original Web test proved only two scripted clicks and had no delay, checkbox, or rapid-click rejection assertion.

- Observation: A current lease row must not prevent ordinary deletion of its owner session or client device, while transition history must remain independent.
  Evidence: the first full API run exposed restrictive current-row foreign keys through 35 existing cleanup failures. Changing only the current row's owner FKs to `ON DELETE CASCADE`, recreating the disposable database, and rerunning the failed suites produced 46/46 passing tests; the history table retains scalar snapshots and no parent FK.

- Observation: Aggregate preflight treated a legitimate guard restart as a competing controller start and required live health from an optional agent that the candidate was about to install for the first time.
  Evidence: release attempt `20260722-095832-3740fa` was rejected before unit submission. Assembly-01 was clean at `5f7d041c`, its torque `.env` marker was absent, and existing NFC/host prerequisites passed. Reading the actual candidate assets reproduced the overly broad `state: restarted` match, which the previous synthetic fixture did not cover.

- Observation: systemd 257 may clear `ExecMainCode` to 0 after a successful `Type=oneshot` unit without `RemainAfterExit` becomes inactive, even though `Result=success`, `ExecMainStatus=0`, and the unit journal all prove successful execution.
  Evidence: Assembly-01's controller unit journal recorded “Deactivated successfully” and “Finished”, but the `ExecMainCode=1` assertion alone failed. The standard rollback restored the old SHA and runtime and verified the terminal before clearing maintenance.

- Observation: After Release A introduces the guard, an aggregate preflight that requires the external adapter to be powered contradicts the fail-closed steady state and blocks all later releases.
  Evidence: preflight `20260722-111504-08a9c4` rejected both pilot terminals before unit submission with `torque.candidate-helper-probe`; both exact adapters were intentionally soft-blocked/OFF. The corrected rendered probe succeeds read-only on both terminals without making a management call while soft-blocked.

- Observation: `systemctl is-enabled` is not a safety result by itself. The deployed guard is active and both exact controllers are OFF, but release-only intentionally does not change persistent unit enablement; without another boot activation path the next boot remains fail closed but cannot later honor a valid lease.
  Evidence: both pilot units are active/disabled at `e4760ec3`; their exact adapters report `powered=false`, no enforcement or live lease exists, and the installed exact-controller udev rule starts only the OFF initialization oneshot.

- Observation: `ConnectionLeaseManager.snapshot()` treated every `lastError` without a local lease as a transport failure, including the expected `TORQUE_WRENCH_LEASE_HELD` business rejection that carried a valid `owned_by_other` status and owner snapshot.
  Evidence: the physical destination returned `state=communication_lost`, `lastError=TORQUE_WRENCH_LEASE_HELD`, and the StoneBase owner details. The focused regression fails before the correction with `communication_lost != owned_by_other`.

- Observation: the kiosk's general `message` state captured the acquisition response once but heartbeat updated only `agentStatus`, so a later communication loss or agent restart left the yellow acquisition-success text visible beside the correct no-lease white status.
  Evidence: the physical screen showed `接続権を取得しました。Bluetooth接続を待っています。` after the agent had already returned `ready=false`, `leaseOwned=false`, and `communication_lost`. The focused Web regression reproduces the stale text.

- Observation: an exact-head rerun may expose newly published dependency advisories even when the feature correction and its earlier local validation are unchanged.
  Evidence: the first correction CI reported fixed-version HIGH findings in `fast-uri`, Sharp, and Caddy's embedded gRPC module. Updating the three dependency boundaries together removed the tracked source findings and preserved all feature and deployment contracts.

- Observation: after the final accepted bolt clears `currentBoltId`, the kiosk intentionally sends an unarmed heartbeat and torque-agent releases the lease with `BROWSER_DISARMED`; treating every `lastError` as an acquisition failure turns this expected safety transition into a yellow top-level error banner and causes a visible layout shift.
  Evidence: generation 17 stored memory 035 as accepted at 14:46:15 JST, released with `BROWSER_DISARMED` at 14:46:16, and then powered the exact external adapter OFF by a local-host HCI disconnect. The focused Web regression reproduced the erroneous `トルクレンチ接続を開始できませんでした: BROWSER_DISARMED` banner from the same state.

- Observation: the earlier missing memory 033 and the later final-bolt notice are separate failures.
  Evidence: memory 033 never reached the local outbox, audit store, or PostgreSQL after the stable HID path returned `ENODEV` and was recreated about six seconds later. Memories 034 and 035 traversed HID, agent, and PostgreSQL under passive capture without an unexpected controller disconnect. The first event predates HCI capture, so its initiating disconnect reason is unknown.

## Decision Log

- Decision: Use one current lease row per `TorqueWrenchProfile`, serialized by a PostgreSQL row lock, plus append-only transition history.
  Rationale: the physical wrench is already represented by a profile, and a single row provides an unambiguous fleet-wide owner without a process-local mutex.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Use an eight-second server and local lease with a two-second renewal cadence; the host guard polls every second.
  Rationale: these values retain the existing browser binding behavior and bound disconnect time to nine seconds.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Require an explicit acquisition request identifier generated by the kiosk action, and never reacquire automatically after fencing.
  Rationale: an old open page must not steal the wrench back from the terminal that performed a physical-presence takeover.
  Date/Author: 2026-07-22 / Codex.

- Decision: Keep pairing outside the kiosk and automate only saved-bond connection exclusivity.
  Rationale: pairing has additional BlueZ privilege, discovery, timeout, and wrong-device risks; the user selected Runbook-owned pairing.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Separate Release A capability deployment from the irreversible per-profile enforcement activation.
  Rationale: the rollback baseline must already understand leases before the existing wrench is made lease-required.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Pre-apply live health remains mandatory for installed optional agents, identified by their deployment-owned `.env` marker; a newly introduced optional agent is instead required by unchanged post-apply release evidence.
  Rationale: this preserves the healthy outgoing runtime when one exists without making the first release of a complete candidate agent impossible. Candidate source, host prerequisites, final container identity, and final endpoint health remain fail-closed.
  Date/Author: 2026-07-22 / Codex.

- Decision: Treat `Result=success`, `ExecMainStatus=0`, and numeric `ExecMainCode` 0 or 1 as a successful bounded controller oneshot, then require the independent exact-controller powered-OFF status check after the guard starts.
  Rationale: code 0 is the valid cleared state observed on systemd 257 and code 1 is retained CLD_EXITED on other supported versions. The independent hardware-state assertion remains the fail-closed safety invariant.
  Date/Author: 2026-07-22 / Codex.

- Decision: Make the candidate helper probe power-neutral: exact soft-blocked/OFF identity is healthy; an unblocked controller must answer three bounded management reads, but it need not be powered.
  Rationale: release preflight must validate the safe guard-owned steady state without temporarily creating a Bluetooth connection window.
  Date/Author: 2026-07-22 / Codex.

- Decision: Classify Release A gates by observable outcome: safety blocker, availability blocker, or expected/warning. Do not reject a release from an incidental systemd representation, expected no-lease `ready=false`, first-install absence, or negative-test log text when the owning contract succeeds.
  Rationale: the rollout exposed three checks that described one implementation state rather than the fail-closed product invariant. Gate ownership and failure consequences must be explicit before correction.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Start the guard from the same exact VID/PID udev event that requests controller OFF initialization, while retaining provisioning-only persistent enablement and release-only rollback restrictions.
  Rationale: boot and USB replug then establish both OFF-first convergence and the runtime lease owner without making persistent systemd enablement release-reachable.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Track Pi5 transport loss independently from the last API error in torque-agent, and preserve the API-provided public lease state for reachable business rejections.
  Rationale: `TORQUE_WRENCH_LEASE_HELD` is the required path into the two-step takeover UI, while timeouts and network errors must still fail closed as `communication_lost`.
  Date/Author: 2026-07-23 / Codex with user approval.

- Decision: Keep lease-operation notices separate from general assembly messages and refresh them from every loopback heartbeat response.
  Rationale: the visible notice must describe the current lease state after asynchronous communication loss, fencing, readiness, or release instead of preserving a past button result.
  Date/Author: 2026-07-23 / Codex with user approval.

- Decision: Suppress only `BROWSER_DISARMED` in the kiosk connection-notice mapper, while retaining the agent's fail-closed release and database audit reason unchanged.
  Rationale: final-bolt disarming is expected and must not create an acquisition-error banner or layout shift; other lease and transport errors must remain visible.
  Date/Author: 2026-07-23 / Codex with user approval.

- Decision: Do not change HID retry timing or reconnect behavior from the memory-033 incident.
  Rationale: the failure boundary is known, but the initiating HCI reason was not captured and two later controlled inputs succeeded. A transport change without reproducing the disconnect would be speculative.
  Date/Author: 2026-07-23 / Codex with user approval.

## Release A Gate Classification and State Transitions

| Scenario | Required observable result | Classification when violated |
| --- | --- | --- |
| First install or normal release | Exact adapter identity is unique; candidate probe is read-only; final agent proof has `ok=true` | Safety blocker for wrong/ambiguous adapter; availability blocker for missing final agent |
| No lease or no wrench | External adapter OFF; `ready=false` is expected; NFC and internal Bluetooth are unchanged | Safety blocker only if the external adapter is ON or unrelated hardware changes |
| Reboot or exact USB replug | OFF initialization and guard are both requested by the exact VID/PID event; guard starts without relying on `is-enabled` text | Availability blocker if OFF is preserved but guard cannot run; safety blocker if the adapter is ON |
| Valid current lease | Only the owner generation may write fresh intent and reach Bluetooth/HID readiness | Safety blocker for non-owner, stale generation, or overlapping ownership |
| Agent stop, Pi5 loss, malformed intent, or expiry | Intent disappears or expires and the exact adapter reaches OFF within nine seconds | Safety blocker |
| Physical takeover | Old generation is fenced immediately; new Bluetooth activation waits until `connectAfter` | Safety blocker |
| Release failure or rollback | Repository, runtime, evidence, and maintenance state return to the verified baseline | Safety blocker |

`Result=success` plus `ExecMainStatus=0` is the oneshot success contract across supported systemd representations. `ready=false` without a lease/HID, an absent optional agent before its first installation, `is-enabled=disabled` with a deterministic event activation path, and error text emitted by passing negative tests are not independent blockers.

## Outcomes & Retrospective

Release A capability is deployed and boot-verified on Pi5 at `ef7f3c4a` and both pilot terminals at `38c7df98`. Both pilot terminals are paired with the same wrench, normal transfer works in both directions, and the exact external adapter fails closed within nine seconds for Pi5 loss and agent stop while NFC remains healthy. Screen departure and exact USB replug also converge safely. Physical takeover exposed one availability blocker rather than a safety violation: the destination adapter stayed OFF, but the agent hid the remote-owner state behind `communication_lost`, so the kiosk could not present the approved two-step action. The correction is locally validated and awaits one exact-head CI, one two-terminal release, and bidirectional takeover acceptance. Enforcement remains disabled.

## Context and Orientation

All Pi4 terminals authenticate to one Pi5 API with a client key. `AssemblyWorkSession.clientDeviceId` already binds a work session to a terminal. The torque agent runs in a privileged Docker container on a Pi4, reads only configured `/dev/input/by-id` HID links, grabs the input device through evdev, writes parsed events to a local SQLite outbox, and sends them to the Pi5 assembly API. Its existing browser binding is process-local and expires after eight seconds.

A connection lease is a short-lived Pi5 database record granting one terminal and one work session the right to use one registered physical wrench. A fencing generation is an integer incremented on every acquisition or takeover. Once a newer generation exists, events and renewals from an older generation are rejected even if the old terminal is delayed. The host Bluetooth guard is a root-owned systemd service that powers the exact configured external USB controller on only while it sees a fresh local lease-intent file written after a successful Pi5 renewal.

The schema lives in `apps/api/prisma/schema.prisma`. Torque-wrench routes and validation live under `apps/api/src/routes/torque-wrenches`, and the traceability intake lives in `apps/api/src/services/torque-wrenches/assembly-torque-traceability.service.ts`. The client is in `clients/torque-agent`. Host provisioning is under `infrastructure/ansible/roles/client`, and the work UI is `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`.

## Plan of Work

First, add an expand-only migration containing two new tables and nullable columns on the existing profile and torque-record tables. Implement a lease service that locks the profile and current lease in one transaction, validates the client-bound work session and confirmation, and exposes acquire, renew, release, physical takeover, status, and ADMIN/MANAGER enforcement activation. Extend agent event intake with optional lease fields for Release A compatibility; once `connectionLeaseEnforcedAt` is set, missing, wrong-owner, wrong-session, or older-generation events become retained `rejected` audit records.

Second, split the torque agent's current binding from its connection lease. Local `/lease/acquire`, `/lease/takeover`, and `/lease/release` actions call Pi5 with the terminal client key. A successful owner lease permits `/heartbeat` to maintain the work binding and writes a fresh local controller intent. A failed renewal, expired browser heartbeat, fencing response, or shutdown clears binding, stops the HID reader, removes controller intent, and best-effort releases the server lease. Every queued event snapshots the lease ID and generation before SQLite insertion.

Third, extend the exact-controller helper with bounded idempotent power-on, power-off, and status operations. Install a Python systemd guard that validates an atomic intent containing the current Linux boot ID and local monotonic deadline. Invalid, absent, stale, or cross-boot intent always requests power-off. The helper continues to discover by exact USB vendor/product and never persists `hciN`.

Fourth, change the assembly work page so physical confirmation does not silently acquire. The operator explicitly starts use, sees the remote owner when blocked, can perform a two-step physical-presence takeover, and explicitly ends use. Readiness requires server ownership, guard power, HID presence, and exclusive grab rather than only loopback HTTP availability.

Finally, add the two pilot host variables, update deployment safety contracts and documentation, and run all focused and full local validation. Do not contact managed hosts during implementation validation.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`. Preserve all pre-existing uncommitted Assembly-01 provisioning changes. Use `apply_patch` for tracked edits.

After each subsystem, run its focused tests. At the end run:

    cd /Users/tsudatakashi/RaspberryPiSystem_002
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web build
    pnpm lint
    cd clients/torque-agent && poetry run pytest && poetry run ruff check .
    cd ../.. && bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Use a disposable PostgreSQL instance for the complete migration ledger and lease concurrency integration tests. Clean up only the explicitly created disposable resources.

## Validation and Acceptance

The API tests must prove that two clients racing to acquire one profile yield exactly one owner; owner renew works; non-owner renew and release fail; an expired lease can be reacquired with a higher generation; physical takeover fences the old generation and returns a finite connection delay; and enabling enforcement is irreversible through the public API.

Traceability tests must prove that a valid owner event advances the bolt, a same-generation durable outbox retry remains idempotent, and missing, wrong-owner, wrong-session, or older-generation events produce retained rejected records without advancing the bolt. A rejected event must receive a successful API response so the agent acknowledges it.

Agent tests must prove that confirmation reuse does not acquire, only an explicit request identifier starts acquisition, repeated browser heartbeats renew but do not reacquire after fencing, every queued event contains its lease snapshot, and loss of Pi5 renewal clears controller intent. Guard tests must prove power-off for missing, malformed, stale, and wrong-boot intent; power-on only for a fresh intent; and power-off no later than the eight-second deadline plus one poll interval.

Web tests must prove every displayed state and the two-step physical takeover. Infrastructure tests must prove exact USB identity, bounded controller commands, power-off default, guard lifecycle ownership, and unchanged NFC/internal-Bluetooth behavior.

Production physical acceptance remains a later approved action and must follow the sequence in `docs/runbooks/assembly-torque-agent.md`.

## Idempotence and Recovery

The migration is additive and can be reapplied through Prisma safely. Lease acquire, renew, and release endpoints use lease ID, generation, and request ID for idempotency. The guard treats every operation as desired-state convergence, so restarts and USB replug repeat safely. `/run` is cleared at reboot, making the safe initial controller state OFF.

Before enforcement activation, Release A may roll back to the existing runtime while Assembly-01 remains unpaired. After activation, rollback is limited to a lease-capable runtime; if an older runtime must be restored, stop both torque agents first. Never delete the SQLite outbox or lease history during recovery.

## Artifacts and Notes

The implementation must not write the real wrench serial number into new public documentation or test fixtures. Inventory already contains the approved exact HID identity and remains the deployment source for that secret-adjacent value.

Final local validation evidence at 2026-07-22 18:14 JST:

    API focused real-PostgreSQL integration plus prior cleanup regressions: 46 tests passed
    API full suite: 453 files, 2362 passed, 7 external-integration tests skipped
    torque-agent Ruff: passed
    torque-agent pytest: 43 passed
    Web focused test: 7 passed
    Web full suite: 297 files, 1469 passed
    API TypeScript build: passed
    Web production build: passed (existing bundle-size/browser-data warnings only)
    root lint: passed
    Bluetooth helper/guard/template focused unittest: 21 passed
    full deploy contracts including migration gate and Ansible syntax: passed
    document inventory audit: passed
    git diff --check: passed

Release A deployment, reboot acceptance, pairing, and every physical check independent of takeover have completed. Bidirectional physical takeover and enforcement activation remain separately gated.

Physical-acceptance correction evidence at 2026-07-23 09:51 JST:

    torque-agent full suite: 45 passed
    torque-agent Ruff: passed
    Web full suite: 297 files, 1470 passed
    Web production build: passed with existing bundle/browser-data warnings only
    root lint: passed
    deploy contracts: 821 passed; disposable PostgreSQL migration/deploy-status and Ansible syntax passed
    document audit and git diff --check: passed
    No API, database schema, guard, Bluetooth helper, NFC, or public Web contract changed

Release A correction deployment and first takeover evidence at 2026-07-23 12:53 JST:

    exact-head CI at f64c4da2: passed
    standard rolling release 20260723-022706-9b18a5: success
    Pi5, StoneBase, and Assembly-01: exact SHA with verified evidence
    post-release same-SHA plan: targets=[] and warnings=[]
    StoneBase-to-Assembly controller sampling: no simultaneous ON; seven-second both-OFF handoff
    lease history: generation 11 TAKEN_OVER, followed by OPERATOR_RELEASE
    two-stage deliberate-confirmation acceptance: failed; corrective interlock pending validation

Rapid-click interlock correction evidence at 2026-07-23 13:07 JST:

    focused kiosk tests: 8 passed
    Web full suite: 297 files, 1470 passed
    Web lint and production build: passed
    root lint, document audit, and git diff --check: passed
    deploy contracts: 821 passed
    disposable PostgreSQL deploy-status integration: 20 passed
    Ansible contracts: 24 passed; all playbook syntax checks passed
    No API, database schema, guard, Bluetooth helper, NFC, or public API contract changed

## Interfaces and Dependencies

The Pi5 API adds `GET /api/torque-wrenches/:id/connection-lease` and POST actions `acquire`, `renew`, `release`, `takeover`, and `enforcement/enable`. Client actions authenticate with `x-client-key`; activation authenticates with ADMIN or MANAGER JWT. Lease status is one of `available`, `owned_by_self`, `owned_by_other`, `handoff_wait`, or `expired`. Only the owner response contains the opaque lease ID and generation.

The loopback agent keeps `/heartbeat` for the work binding and adds `/lease/acquire`, `/lease/takeover`, and `/lease/release`. `/health` returns process health separately from `ready`, plus lease, controller, and HID state. No new external Python dependency is required for the host guard.

Revision note 2026-07-22: Initial self-contained plan created from the user-approved implementation design and repository inspection. No implementation or deployment result has been recorded yet.

Revision note 2026-07-22 16:50 JST: Recorded the safe pause boundary, focused validation evidence, and exact remaining work. The disposable local PostgreSQL container is stopped before handoff.

Revision note 2026-07-22 18:14 JST: Resumed without the physical wrench, completed the remaining guard/UI/documentation work, hardened confirmation freshness and current-row deletion behavior, and completed full local validation. Production and physical acceptance remain gated.

Revision note 2026-07-22 19:22 JST: Recorded Draft PR #1068 CI success, the mutation-free aggregate-preflight stop, and the scoped candidate Bluetooth/new-agent preflight correction. Release A remains unapplied until the correction passes a new exact-head CI.

Revision note 2026-07-22 20:02 JST: Recorded Release A run `20260722-103023-77ca0e`, successful Pi5/StoneBase convergence, Assembly-01's verified automatic rollback, the systemd 257 oneshot result discovery, and the locally validated correction pending new CI and retry.

Revision note 2026-07-22 20:17 JST: Recorded exact-head CI at `c68691f2`, mutation-free preflight stop `20260722-111504-08a9c4`, the safe-OFF candidate probe correction, and successful read-only live probes on both pilot terminals.

Revision note 2026-07-22 21:07 JST: Recorded successful two-terminal Release A `20260722-113236-970014`, the complete gate-classification audit, live no-enforcement/no-lease evidence, and the single consolidated boot guard activation correction pending validation and release.

Revision note 2026-07-23 09:44 JST: Recorded final Release A boot deployment, pairing and independent physical-acceptance evidence, the confirmed takeover/UI-message blocker, the approved minimal correction, and the exact remaining CI, release, takeover, and enforcement gates.

Revision note 2026-07-23 09:51 JST: Recorded the aggregate local validation result for the single takeover correction candidate; exact-head CI and the approved two-terminal release remain next.

Revision note 2026-07-23 12:59 JST: Recorded exact-head Release A deployment, the safe non-overlapping first physical takeover, the operator-observed final-confirmation click-through, safe release, and the focused temporal-plus-checkbox UI interlock pending aggregate validation.

Revision note 2026-07-23 13:07 JST: Recorded complete aggregate local validation for the rapid-click interlock correction; exact-head CI and the approved three-host rolling redeploy remain next.

Revision note 2026-07-23 14:56 JST: Recorded exact-head deployment and bidirectional takeover acceptance, separated the unresolved memory-033 HID disappearance from the confirmed final-bolt notice defect, and documented the locally passing UI-only correction. No commit, push, deployment, reconnect change, or enforcement activation is authorized by this update.
