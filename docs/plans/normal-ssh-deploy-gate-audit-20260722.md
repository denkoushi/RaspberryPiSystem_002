---
id: normal-ssh-deploy-gate-audit-20260722
title: Normal SSH deployment gate audit and first stabilization
status: in-progress
scope: canonical normal SSH rolling release; static source/test audit and one observer-gate correction
date: 2026-07-22
source_of_truth: docs/plans/normal-ssh-deploy-gate-audit-20260722.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/coordinator.py
  - scripts/deploy/rolling-release.py
  - scripts/deploy/rolling_release/route_contract.py
  - scripts/deploy/rolling_release/terminal_preflight.py
  - scripts/deploy/rolling_release/terminal_adapters.py
  - scripts/deploy/deploy-status-state.py
  - apps/web/src/layouts/KioskLayout.tsx
validation: offline source and test audit only; no device connection, preflight, deployment, PR, or merge
open_items:
  - publish the first stabilization only after normal code review and hosted CI
  - obtain separate approval before a Pi5 plus StoneBase release attempt
  - decide whether each live terminal-agent health probe is a release requirement or an operator warning
---

# Normal SSH Deployment Gate Audit

## Purpose

This is a factual audit of the normal SSH rolling-release path before further
workflow changes. It replaces an earlier broad redesign draft that incorrectly
treated every browser acknowledgement as the same kind of gate.

The concrete question is: which failures must stop an irreversible operation,
which prove the deployed release, and which only report that an observer saw a
screen? The audit uses repository code, tests, CI records, and the durable
facts reported for run `20260721-235409-b51bd2`. It does not authorize or
perform any device action.

## Observed Run Facts

`20260721-235409-b51bd2` completed Pi5 candidate work, Blue/Green switching,
the fixed five-minute stability monitor, and Pi5 API/Web claims. It stopped
before StoneBase maintenance, SSH apply, repository mutation, or rollback
because the pre-notice browser acknowledgement was not recorded within 30
seconds.

The observed timings were approximately six seconds for the plan, thirty
seconds for aggregate preflight, and ten minutes forty-six seconds for the
recorded Pi5 release-and-stability phase. These are distinct from the preceding
GitHub CI wait. They do not prove a 15-minute end-to-end terminal target is
currently attainable.

## Actual Route

`route_contract.py` has 25 route stages, not 24. Several stages are state or
recovery boundaries rather than independently selectable quality gates.

| Route group | Current owner | What can stop it now | Audit result |
|---|---|---|---|
| Local source, inventory, and Pi5 identity | local application | dirty or mismatched SHA, invalid inventory/scope, identity mismatch | Safety gate: no remote release unit exists yet. |
| Migration, Pi5 route, and aggregate terminal preflight | Pi5 / terminal probes | migration ledger, Pi5 prerequisites, any selected-terminal prerequisite | Pre-mutation gate. It currently combines direct safety facts with browser and agent health observations. |
| Fleet lock, interrupted-run recovery, scope planning | Pi5 coordinator | malformed/active recovery authority, unsafe target classification | Safety gate: retains the existing recovery authority. |
| Pi5 config, candidate switch, stability, API/Web claims | Pi5 coordinator | manifest/config failure, candidate failure, stability failure, missing exact claims | Safety/correctness gate: terminal work must not begin. |
| Per-terminal transport, baseline, and manifest | terminal adapter | SSH/become failure, dirty or unreadable baseline, missing sealed rollback manifest | Safety gate immediately before a terminal mutation. |
| Terminal apply, direct evidence, rollback, cleanup | terminal adapter | Ansible error, uncertain response, missing direct service/repository evidence, failed cleanup | Correctness/recovery gate. Sealed manifest remains the only rollback authority. |
| Kiosk pre-notice and maintenance display ACK | Kiosk browser plus deploy-status API | timeout currently stopped the run | Observation of a display; it does not prove SSH mutation or release identity. Corrected below. |
| Kiosk `ready` ACK | Kiosk browser plus deploy-status API | missing exact SHA and verification-ID acknowledgement | Required correctness claim today: it is the sole `controlPlaneWeb` proof for the Kiosk profile. It remains hard. |
| Human canary hold | operator approval record | timeout stops remaining targets | Policy gate, not a technical safety proof. It is not reached for a single selected StoneBase target. No change in this correction. |
| Status/cancel and fleet finalization | Pi5 control/state stores | unreadable or uncommitted durable state | Correctness/recovery gate. |

## Important Distinctions

### Browser ACKs are not interchangeable

The Kiosk UI sends `notice`, `maintenance`, and `ready` acknowledgements from
the same browser code. Their current meanings differ:

- `notice`: confirms that the best-effort pre-notice was observed. It carries
  no candidate SHA and does not execute or recover a device.
- `maintenance`: confirms the maintenance screen was observed. The old Kiosk
  activation code also used this acknowledgement as a precondition for a
  browser restart, even though the coordinator already owns the durable
  maintenance request.
- `ready`: binds the expected control-plane Web SHA and an unguessable
  verification ID. The Kiosk profile maps it to the required
  `controlPlaneWeb` release claim. Reclassifying it as a warning without a
  replacement proof would weaken final release verification.

Therefore the observed notice failure was a false deployment stop, but a
future ready failure remains a genuine failure to prove the current Kiosk Web
release. The first correction changes only the former class and preserves the
latter.

### Agent health is not yet classified by this audit

Aggregate terminal preflight and final direct terminal evidence both test the
configured NFC, barcode, and torque agents. The registry does not make those
agent results typed release claims, but current code treats them as blockers.
Whether an individual agent may be warning-only is a product/operations
decision: it cannot be inferred safely from its implementation detail. This
correction leaves all current agent gates intact.

### Validation is duplicated today

The documented operator sequence calls `--print-plan`, then
`--preflight-only`, then normal launch. In addition, normal launch itself
calls `build_print_plan()` and reruns migration, route, and aggregate terminal
preflight before submitting the release unit. The independent plan remains a
useful diagnosis, but its result is not an admission receipt. Consolidating
this duplication is a later change; it is not mixed with the observer-gate
fix.

## First Stabilization Implemented Locally

The following narrow change is implemented and awaiting normal review/CI.

1. A 30-second Kiosk `notice` ACK timeout now records a bounded run warning
   and continues. The warning contains only host, phase, outcome, observer,
   timeout, and UTC observation time. It does not retain a client key, request
   body, or browser URL.
2. A 30-second Kiosk `maintenance` ACK timeout uses the same warning record
   and continues after the coordinator has durably requested maintenance.
   Kiosk Web activation now requires that durable maintenance request, not an
   acknowledgement from the display.
3. The Kiosk `ready` ACK, exact repository/direct evidence, Pi5 stability,
   serial order, sealed rollback, maintenance clear, agent health, and final
   release claims remain fail-closed. If a restarted Kiosk cannot acknowledge
   the exact Web SHA, normal rollback still runs.

This is intentionally not a broad "ignore browser failures" change. It moves
display-observation failure out of the mutation admission path while retaining
the final browser-backed identity proof.

## Durable Evidence Gap

Before this correction, a notice timeout removed the live client entry and its
acknowledgement data. The completed run retained only a generic exception, so
it could not distinguish a browser that never polled from a rejected or late
HTTP acknowledgement.

The first correction preserves the coordinator-observed fact
`observer-unconfirmed / timeout` in the run record. It cannot infer a browser
HTTP rejection that never reached Pi5. Capturing authenticated rejection
categories in deploy-status history is a separate observability enhancement,
not a prerequisite for the safe timeout behavior above.

## Validation

The local first-correction validation completed without device access:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py' -q
bash scripts/deploy/tests/test-deploy-safety-contracts.sh
scripts/ci/run-deploy-contracts-local.sh
node scripts/docs/audit-docs.mjs
git diff --check
```

The focused regressions prove that a notice timeout and a maintenance timeout
are persisted as warnings and the SSH route continues. A Kiosk activation test
also proves that the exact `ready` claim remains mandatory after an
unconfirmed maintenance display.

## Next Steps

1. Review and publish this isolated correction through normal CI.
2. With separate deployment approval, measure one Pi5 plus StoneBase release.
   It should either complete with warnings or stop at a remaining hard gate
   with durable evidence.
3. Use that result to make one next decision at a time: agent criticality,
   duplicated admission/preflight, or measured terminal convergence time.

No Local executor, direct SSH command, hardware connection, preflight, or
deployment is part of this audit or its local validation.
