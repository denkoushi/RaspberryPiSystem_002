---
id: ADR-20260712-deploy-target-minimization-canary-hold
title: Deploy target minimization, canary hold, and Pi5 Blue/Green idempotent skip
status: accepted
date: 2026-07-12
source_of_truth: true
related_docs:
  - ./ADR-20260712-rolling-terminal-release-orchestration.md
  - ../plans/rolling-terminal-bluegreen-deploy.md
  - ../guides/deployment.md
  - ../runbooks/pi5-blue-green-deploy.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling-release.py
  - scripts/deploy/classify-deploy-impact.py
  - scripts/deploy/deploy-status-state.py
---

# ADR-20260712: Deploy target minimization, canary hold, and Pi5 Blue/Green idempotent skip

## Status

accepted

## Context

[ADR-20260712-rolling-terminal-release-orchestration](./ADR-20260712-rolling-terminal-release-orchestration.md)
made `scripts/update-all-clients.sh` → `scripts/deploy/rolling-release.py` (Rolling V2)
the canonical release coordinator: immutable SHA, Pi5 Blue/Green when needed, then
one terminal at a time.

Operators still paid avoidable cost and risk:

- Re-running the same SHA re-executed a full Pi5 Blue/Green even when runtime was
  already consistent on that revision.
- After the first kiosk succeeded, remaining terminals continued immediately with
  no operator pause for shop-floor verification.
- Impact classification was coarse; `apps/api` signage paths over-selected Pi3,
  docs-only changes looked like deploy work, and there was no opt-in way to shrink
  terminal targets from classification.
- `--limit` that selected zero kiosk/signage hosts failed with
  `no kiosk or signage targets selected` even when Pi5 release was required.
- Inventory `kiosk_canary` pointed at `raspberrypi4`, which is a weaker
  functional canary than a barcode-agent host.

Legacy `impact-analyzer.sh` / `deploy-all.sh` pipelines must not become a second
classification authority beside Rolling V2.

## Decision

1. **Pi5 Blue/Green idempotent skip (fail-closed)**  
   On success, record the SHA in Pi5 `logs/deploy/pi5-release-current.json`.  
   On the next run, skip Blue/Green only if the target SHA, immutable marker
   candidate API/Web tags, `runtimeStatus=consistent`, active slot, application
   gateway slot, and that slot's API/Web images all match. Any uncertainty runs
   Blue/Green as before.

2. **Canary hold (default on)**  
   After the first kiosk (canary) succeeds, if further terminals remain, stop with
   `canaryHold: waiting-verification` and wait for operator approval.  
   Approve from another shell via
   `scripts/update-all-clients.sh --approve <runId>`
   (SSH → `deploy-status-state.py approve`). The approval is accepted only while
   the lock-protected `canaryHolds[runId]` gate is
   `waiting-verification` and before its expiry; it transitions once to
   `approved`. Pre-issued, stale, generic terminal acknowledgements, and
   expired/finished holds cannot advance the release. Approval and expiry share
   the deploy-status lock, so only one terminal transition wins.
   `--canary-hold-timeout` defaults to 1800s; expiry fails closed (no further
   terminals; canary is not rolled back).  
   `--skip-canary-hold` disables the hold. Single-target and signage-only runs
   skip the hold automatically.

3. **Canary host**  
   Inventory `kiosk_canary` is `raspi4-kensaku-stonebase01` (barcode-agent enabled)
   for maximum functional coverage.

4. **Pi5-only normalization**  
   If `--limit` yields zero terminal targets but Pi5 release is required, run Pi5
   only and exit successfully.

5. **Impact classifier**  
   Canonical classifier is `scripts/deploy/classify-deploy-impact.py`.  
   Add `components` (server-app, migration, nfc-agent, barcode-agent, status-agent,
   kiosk-role, client-role, signage-role, global, neutral, unknown) while keeping
   legacy keys `server` / `kiosk` / `signage` / `migration` / `paths`.  
   Signage paths under `apps/api` classify as server-only (not Pi3).  
   `clients/barcode-agent` and `clients/status-agent` are first-class.  
   `docs/` / `.cursor/` / `.agent/` / `.github/` and similar are `neutral`.  
   Unknown paths select all targets (fail-closed).  
   Classification compares the target SHA with the durable last-successful Pi5
   release marker, never `origin/main`. A missing, invalid, non-ancestor, or
   target-equal marker cannot prove terminal state, so it selects all terminals
   and requires Pi5 (fail-closed).
   Do **not** adopt legacy `impact-analyzer.sh` / `deploy-all.sh` as authority.

6. **Shadow Plan**  
   `--print-plan` emits auditable JSON: `sha`, `classification`, `pi5Required`,
   `terminalTargets` (rollout order), `canaryHold`, and when `--auto-minimize` is
   set, `excludedHosts` / `warnings`. Missing git/ansible yields exit 0 with
   warnings. Runtime selection rationale is stored under state `plan` and visible
   via `--status`.

7. **`--auto-minimize` (opt-in only)**  
   Shrink terminal targets from classification: no kiosk → exclude Pi4; no
   signage → exclude Pi3; barcode-agent-only → hosts with
   `barcode_agent_enabled: true`.  
   `unknown` / `global` / unclassifiable → all terminals (fail-closed).  
   Zero terminals from a valid Pi5-only selection and Pi5 not required → no-op
   success. A zero-match `--limit` is rejected rather than widened to all hosts.
   Default without the flag remains all terminals.  
   Default-on is deferred until production shadow plans match operator judgment
   across several real releases.

## Alternatives

- Default-on auto-minimize immediately — rejected until shadow evaluation proves
  agreement with human target selection.
- Restore legacy `impact-analyzer.sh` / `deploy-all.sh` as a parallel pipeline —
  rejected; one classifier under Rolling V2.
- Skip canary hold by default — rejected; shop-floor verification before fleet
  rollout is the safer default.
- Always re-run Pi5 Blue/Green on identical SHA — rejected; wasteful when
  runtime is already consistent (skip remains fail-closed on uncertainty).

## Consequences

- Good: same-SHA retries avoid redundant Blue/Green when safe.
- Good: operators can verify the canary on the floor before remaining terminals.
- Good: Shadow Plan and optional minimize reduce blast radius without changing
  the default full-fleet path.
- Good: Pi5-only `--limit` no longer fails spuriously.
- Cost: canary hold adds an approve step and a timeout failure mode (canary
  stays on the new revision).
- Cost: auto-minimize remains opt-in; operators must pass the flag deliberately.
- Cost: misclassified paths still fail closed to full targets (prefer overshoot
  over silent under-deploy).

## Validation

- Unit / shell coverage for classify, rolling-release plan/hold/skip, and
  approve acknowledgement paths.
- The canary hold/explicit approval and full rolling release were confirmed in
  production at immutable SHA `5806ec78d877e4310f3098f375894e27cdbe409d` by
  run `20260713-015951-baab37`; the repaired Pi5 cleanup/recovery path was also
  confirmed. See [KB-400](../knowledge-base/KB-400-pi5-bluegreen-cleanup-monitor-lock.md).
- Production shadow evaluation of `--print-plan --auto-minimize` against
  operator judgment remains required before any default-on decision. This run
  did not exercise auto-minimize or prove same-SHA skip behavior.

## References

- Related: [ADR-20260712-rolling-terminal-release-orchestration](./ADR-20260712-rolling-terminal-release-orchestration.md)
- Plan: [rolling-terminal-bluegreen-deploy.md](../plans/rolling-terminal-bluegreen-deploy.md)
- Operator guide: [deployment.md](../guides/deployment.md)
- Pi5 Blue/Green runbook: [pi5-blue-green-deploy.md](../runbooks/pi5-blue-green-deploy.md)
