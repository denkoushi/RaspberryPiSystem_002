# ADR-20260712: Rolling terminal release orchestration

Status: accepted

## Decision

The canonical deployment wrapper owns release ordering, maintenance state and
rollback decisions. It updates one terminal at a time after Pi5 Blue/Green has
completed its stability window. A terminal failure is restored to its recorded
revision and stops the remaining rollout.

`deploy-status.json` remains backward compatible through `kioskByClient`; the
field now represents any display terminal and may include `terminalType`.

## Consequences

Direct application playbook execution requires an explicit emergency override.
The previous all-target maintenance behavior is superseded because it exposed
terminals that were not being updated.
