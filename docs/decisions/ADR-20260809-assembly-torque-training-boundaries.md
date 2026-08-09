# ADR-20260809 Assembly torque training boundaries

Status: Accepted

## Context

The existing physical torque-wrench lease row is coupled to `AssemblyWorkSession`. The production migration contract is expand-only and rejects the existing-table changes required to make that row dual-purpose. The training feature also needs immutable program conditions, five attempts, NFC identity, and ADMIN-only management.

## Decisions

1. Add `TorqueWrenchUsageLease` and its minimal history with database-enforced profile uniqueness and exactly-one assembly/training owner. It is the only active lease backend after a maintenance-window cutover.
2. Stop every old API lease writer and torque-agent before waiting for TTL and proving the old table has zero active leases. Do not dual-write or run old and new backends concurrently. Rollback follows the same writer-stop and active-zero rule.
3. Keep the lease service narrowly scoped to the discriminated union `{ assembly | training }`; it is not a generic workflow framework.
4. Store versioned training conditions and an immutable normalized condition fingerprint. Analytics aggregate only the same fingerprint, even when versions differ.
5. Reuse existing NFC employee resolution and JWT `ADMIN` authorization. Do not create a view-grant or training-specific password system.
6. Persist source-event idempotency and five attempts in the training attempt table. Do not add event sourcing, certification, ranking, or advanced analytics.

## Consequences

The cutover requires a bounded maintenance window and explicit SQL evidence. The retired legacy lease table remains physically present because the repository migration contract does not permit destructive cleanup in this change, but no normal runtime path uses it after cutover.
