---
title: ADR-20260722: Fleet-Wide Torque Wrench Connection Lease
status: accepted
date: 2026-07-22
scope: shared CEM3-BTLA connection ownership across Pi4 assembly terminals
related_code: apps/api/src/services/torque-wrenches, clients/torque-agent, infrastructure/ansible/roles/client
related_docs: ../plans/assembly-torque-wrench-connection-lease-execplan.md, ../runbooks/assembly-torque-agent.md, ./ADR-20260717-assembly-torque-wrench-traceability.md
---

# ADR-20260722: Fleet-Wide Torque Wrench Connection Lease

## Context

The existing torque agent exclusively grabs one configured local HID device and binds it to one local browser heartbeat. The API also verifies that a submitted event belongs to the work session's client device. Those boundaries prevent local keystroke sharing and cross-client session submission, but they do not prevent two Pi4 terminals from competing for or accepting the same physical wrench when the wrench is moved between locations.

The physical wrench is always used close to its selected terminal. The wrench may be carried to another floor, so a fixed Bluetooth gateway cannot cover the required operation. Every eligible terminal therefore needs its own dedicated external Bluetooth controller, while Pi5 remains reachable over the existing client network.

## Decision

Pi5/PostgreSQL owns one short-lived connection lease for each `TorqueWrenchProfile`. The lease identifies one client device and one assembly work session, expires after eight seconds, and is renewed every two seconds. Every acquisition or physical-presence takeover increments a fencing generation. Agent events snapshot the lease ID and generation, and a newer generation prevents an older terminal from advancing work.

The retained lease also records the physical confirmation adopted by acquisition. That adopted confirmation may be reused by another work ID while the same terminal remains the retained owner and the wrench, latest setting, tightening condition, status, and calibration remain valid. The work session's recorded start terminal is audit data, not lease authorization. A different terminal must create a new physical confirmation before acquisition or takeover; the former terminal's adopted confirmation is no longer reusable.

The kiosk requires an explicit use-start action after physical wrench confirmation. Confirmation reuse never silently acquires a connection. If another terminal still holds a live lease, the destination terminal displays that owner and permits a two-step takeover only after the operator confirms that the physical wrench is present. The old generation is fenced immediately, while the destination delays Bluetooth activation until the former lease deadline plus one second. A fenced old page cannot reacquire without another explicit operator action.

Pairing remains an installation or handoff Runbook operation. The product does not add kiosk-driven Bluetooth discovery or pairing. If the wrench retains multiple host bonds, normal moves use saved bonds. If it retains only one bond, the operator performs manual pairing after acquiring the destination lease.

A root-owned host guard, separate from the Docker agent, is the final Bluetooth power authority. It powers the exact configured external USB controller on only while it sees a fresh lease intent written after a successful Pi5 renewal. Missing, stale, malformed, cross-boot, or abandoned intent powers the controller off within the eight-second lease plus one polling second. The internal controller is not modified.

The first production rollout is limited to StoneBase and Assembly-01. Capability deployment and per-profile enforcement activation are separate releases so the rollback baseline already understands leases before tokenless agent events are refused.

## Alternatives

- Direct Pi-to-Pi coordination was rejected because terminal reachability varies by floor, it creates split-brain ownership, and the existing system already centralizes business concurrency in PostgreSQL.
- A StoneBase-only Bluetooth gateway was rejected because the wrench is carried more than 100 metres to other floors.
- Relying only on the physical BLE single-connection limit was rejected because it cannot choose which terminal wins and cannot prevent stale queued data from being assigned after a move.
- Letting the Docker agent alone control Bluetooth was rejected because an abrupt container crash could leave the host controller powered after the application lease expires.
- Automatic kiosk pairing was rejected because wrong-device discovery, BlueZ authorization, and pairing-state recovery materially expand the safety boundary.

## Consequences

The design adds a database lease, a host systemd guard, more agent states, and an explicit operator action. In return, connection ownership is observable and auditable, delayed events are fenced after a handoff, and network or process failure becomes fail closed. The dedicated external adapter must not be shared with unrelated Bluetooth workloads.

The durable outbox remains useful. An event from the current generation may be delivered after a temporary outage; once another terminal acquires a newer generation, the older event is retained as rejected audit evidence and acknowledged without advancing work.

## Validation

Validate with real-PostgreSQL acquisition races, agent/guard failure tests, UI state tests, deploy safety contracts, and the two-terminal physical acceptance sequence in the Runbook. Production activation requires a lease-capable rollback baseline and separate approval.

## Supersedes / Superseded By

- Supersedes: none. This extends `ADR-20260717-assembly-torque-wrench-traceability.md`.
- Superseded by: `ADR-20260723-assembly-torque-cross-work-id-confirmation-reuse.md` supersedes only the start-origin-client authorization and session-local confirmation boundaries. Lease generation, takeover, guard, and activation decisions remain accepted.

## Local Notes JA

- レンチは使用するPi4の約1m以内に置く。Pi4同士の距離は排他制御方式に影響しない。
- 通常切替は「使用終了」から「使用開始」。押し忘れ時だけ、移動先で現物確認付き引継ぎを使う。
