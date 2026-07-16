---
id: KB-400
title: Pi5 Blue/Green cleanup and monitor lock handoff
status: active
scope: Pi5 Phase 3 Blue/Green release coordination
date: 2026-07-13
source_of_truth: true
related_code:
  - scripts/deploy/pi5-blue-green.sh
  - scripts/deploy/rolling-release.py
related_docs:
  - ../runbooks/pi5-blue-green-deploy.md
  - ../guides/deployment.md
  - ../plans/rolling-terminal-bluegreen-deploy.md
validation: focused shell and rolling-release tests; PR #995/#996 CI; 2026-07-13 approved production confirmation of expired-handoff recovery, bounded cleanup handoff, and complete terminal rollout
open_items: []
---

# KB-400: Pi5 Blue/Green cleanup and monitor lock handoff

## Context

Production rolling release `20260713-003409-234059` reached the Pi5 cleanup
handoff after the stability window and received the Blue/Green lock-conflict
error. The event occurred at the boundary between the background monitor and the
coordinator-owned cleanup, not as authorization for a second deploy.

## Root Cause

The monitor inherited the Blue/Green mutation lock from `switch`. This preserved
monitor/cleanup exclusion, but the coordinator attempted cleanup before the
in-flight monitor released that lock. The nonblocking cleanup command therefore
failed before changing containers or durable Phase 3 state.

## Fix

The rolling coordinator retries only that exact pre-mutation lock-conflict from
`cleanup` for up to 30 seconds. It checks the lock-free Phase 3 status before
each retry and stops if the state is inconsistent or a new stability window is
active. It does not retry candidate build, prepare, switch, rollback, or terminal
rollout. A different error or an exhausted retry bound remains fail-closed and
stops the release before terminal rollout.

## Production Confirmation (2026-07-13)

The next approved standard releases confirmed both the recovery boundary and
the normal rollout path.

- Run `20260713-015518-ca2c09` recognized the exact expired, consistent
  two-slot handoff left by the original incident. It recorded
  `pi5HandoffRecovery=expired-handoff-cleaned`, normalized Pi5 to one active
  slot, and then stopped at the load guard before a new candidate or any
  terminal update started.
- After the load fell, run `20260713-015951-baab37` deployed immutable SHA
  `5806ec78d877e4310f3098f375894e27cdbe409d`. Pi5 completed Blue/Green
  monitoring and cleanup with `activeSlot=blue`, `runtimeStatus=consistent`,
  and `result=cleanup-complete`. The StoneBase01 canary hold received explicit
  operator approval; all five Pi4 kiosks and `raspberrypi3` signage then
  completed successfully with no maintenance residue.

## Operator Recovery

While the coordinator is running, use only `--status`, `--attach`, and the
read-only Blue/Green `status`. Do not manually invoke `cleanup`, `rollback`,
`reconcile`, or another mutating Blue/Green command; doing so breaks the one-owner
release contract. If the bounded retry ends in failure, wait for the coordinator
to stop. The next Pi5-required standard rolling release can perform one
coordinator-owned direct cleanup only when status proves the expired, consistent
two-slot handoff shape; it then requires normalized single-slot state before any
same-SHA skip or new candidate build. A lock conflict in this later recovery, or
any malformed, stale, future-window, cleanup-failure, or non-normalized state,
fails closed. Do not remove a lock or force cleanup manually.

## Prevention

- Keep monitor completion and cleanup mutually exclusive.
- Keep retry scope exact, bounded, and cleanup-only.
- Cover lock conflict, successful bounded retry, exhausted retry, and no terminal
  rollout after a cleanup failure in the Phase 3/rolling-release tests.
- Cover the next-release expired-handoff recovery before both same-SHA skip and
  candidate build, including failed direct cleanup and failed post-cleanup
  normalization.

## Open Items

- None for this incident. Production shadow evaluation of
  target minimization is tracked separately in the rolling-release plan.

## References

- [Pi5 Blue/Green runbook](../runbooks/pi5-blue-green-deploy.md)
- [Deployment guide](../archive/deployments/legacy-operator-guide-through-2026-07.md#pi5-blue-green-phase3)
- [Rolling release plan](../plans/rolling-terminal-bluegreen-deploy.md)
