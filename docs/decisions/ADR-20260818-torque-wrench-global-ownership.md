---
title: "ADR-20260818: One torque-wrench owner across all terminals and workflows"
status: accepted
date: 2026-08-18
scope: assembly and training ownership, localhost agent recovery, shared kiosk control
related_code: apps/api/src/services/torque-wrenches, apps/api/src/services/torque-training, clients/torque-agent, apps/web/src/features
related_docs: ../plans/torque-wrench-global-ownership-execplan.md, ../runbooks/assembly-torque-agent.md, ./ADR-20260722-assembly-torque-wrench-connection-lease.md, ./ADR-20260809-assembly-torque-training-boundaries.md
---

# ADR-20260818: One torque-wrench owner across all terminals and workflows

## Context

`TorqueWrenchUsageLease` already stores one current row for each physical wrench and distinguishes assembly and training owners. Generation fencing prevents an older token from advancing work after takeover. The remaining product flow is uneven: assembly has owner presentation and a physical-presence takeover panel, training does not, assembly and training duplicate lease mutations, and a delayed old-page loopback release can clear a newer local lease.

Network safety also needs a usable recovery path. Loss of Pi5 communication must stop Bluetooth and HID immediately, but creating a new lease automatically would bypass explicit ownership. Keeping the exact existing token long enough to confirm it after a short outage can recover work without creating new authority.

## Decision

The PostgreSQL current row and generation remain the system-wide source of truth. Ownership consists of an owner identity `{ ownerKind, clientDeviceId, sessionId }` and a token `{ torqueWrenchProfileId, leaseId, generation }`. The API centralizes locking, active-owner decisions, same-owner renew, takeover, generation increment, handoff timing and token checks in a common coordinator. Assembly and training adapters retain only their business-specific session, eligibility and physical-confirmation validation.

The loopback agent is the sole browser path for lease operations because it owns Bluetooth and HID. Release is conditional on the complete expected owner and token. Exact match releases; no lease is `already_absent`; mismatch is `stale_noop` and leaves the current lease, binding, guard and Bluetooth untouched. All three are successful cleanup outcomes for browser navigation.

On temporary agent-to-Pi5 communication loss, the agent removes guard intent and stops Bluetooth and HID immediately. It may retain the last confirmed complete token in memory only while the browser heartbeat and known lease expiry remain valid. Recovery invokes renew, never acquire or takeover. Automatic resynchronization is allowed only if Pi5 confirms the identical profile, lease ID, generation, owner kind, session and client. Any mismatch, fencing, expiry, release or browser heartbeat loss discards the candidate and leaves the device OFF until an explicit use-start or takeover.

Both kiosk workflows use one connection controller, pure presentation mapping and reusable two-stage takeover panel. The page provides workflow-specific session and confirmation data; it does not implement lease transitions. Pairing may remain stored on multiple terminals, but effective lease, Bluetooth power and input acceptance have at most one owner.

Existing audit action strings and business-specific outbox expiry rules remain unchanged. Assembly may accept an event captured under the current generation and delivered after expiry; training retains its send-time expiry check. Both must reject the old lease ID or generation once takeover advances the generation.

## Alternatives

Adding a training-only takeover component was rejected because it would leave two state machines and preserve the delayed-release race. Rejecting every cleanup mismatch or blocking navigation was rejected because it protects by preventing normal completion rather than safely completing it. Automatically acquiring after communication recovery was rejected because it can create a new generation without operator intent. Unifying assembly and training event-expiry semantics was deferred because generation fencing meets the ownership goal without changing unrelated business acceptance rules.

## Consequences

The shared coordinator and controller add explicit interfaces but reduce duplicated transition rules. Status responses can display another owner's terminal, location and workflow, but never expose that owner's token or session identifier. A stale page cleanup becomes harmless and idempotent. A short outage can recover the same authority, while every true loss of ownership remains fail-closed and returns to an explicit, usable operator path.

No database migration, Bluetooth discovery, pairing workflow, parser, NFC rule, tightening progression, training score or five-attempt rule changes. Deployment and physical validation require separate approval.

## Validation

Use pure policy tests, real-PostgreSQL cross-workflow races and fencing tests, loopback agent release and recovery tests, and assembly/training controller and page tests. Apply all migrations to an isolated temporary database and inspect the profile-current-row and owner/expiry query plans. Physical validation, when separately approved, must show old side OFF before new side ON in both workflow directions.

## Supersedes / Superseded By

- Supersedes only assembly-only ownership and browser-control portions of `ADR-20260722`; its central lease, generation fencing, guard and explicit physical takeover decisions remain accepted.
- Extends `ADR-20260809` by making its assembly/training lease union a shared runtime coordinator and operator flow.
- Superseded by: none.
