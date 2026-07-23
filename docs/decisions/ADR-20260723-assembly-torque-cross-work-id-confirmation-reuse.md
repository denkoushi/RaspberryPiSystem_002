---
title: ADR-20260723: Cross-Work-ID Torque Wrench Confirmation Reuse
status: accepted
date: 2026-07-23
scope: assembly torque physical confirmation, work-session terminal attribution, connection-lease adoption, and agent intake
related_code: apps/api/src/services/torque-wrenches, apps/api/prisma/schema.prisma, apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx
related_docs: ../plans/assembly-torque-cross-work-id-reuse-execplan.md, ../runbooks/assembly-torque-agent.md, ./ADR-20260717-assembly-torque-wrench-traceability.md, ./ADR-20260722-assembly-torque-wrench-connection-lease.md
---

# ADR-20260723: Cross-Work-ID Torque Wrench Confirmation Reuse

## Context

Assembly work-in-progress is visible from every assembly kiosk, but torque-wrench APIs previously treated `AssemblyWorkSession.clientDeviceId` as authorization and required every physical confirmation to belong to the target session. Consequently, a work ID started on StoneBase could be opened on Assembly-01 but could not use the wrench there. Two work IDs with identical tightening conditions also required separate checks even when the same physical wrench and latest setting remained in front of one terminal.

Simply removing the session comparison is unsafe. Confirmation rows are append-only, so an old confirmation remains after the wrench moves to another terminal. The system needs an auditable indication of which confirmation established the retained lease owner's current physical evidence.

## Decision

`AssemblyWorkSession.clientDeviceId` remains the immutable start-origin snapshot and is not torque authorization. Actual input authority is the requesting kiosk client, the connection lease's owner client and target session, its lease ID and generation, and the confirmation adopted by that lease. Every accepted torque record continues to snapshot the real source client and lease token.

The retained `TorqueWrenchConnectionLease` stores nullable `adoptedConfirmationId`; acquisition and takeover copy it into append-only lease history. Existing null rows fail closed for cross-work reuse. A new confirmation can be adopted for the same live owner and session without incrementing generation, but the change is recorded as `CONFIRMATION_ADOPTED`.

A kiosk may reuse an adopted confirmation across any work ID or lot when the physical wrench profile, current latest setting, normalized tightening-condition fingerprint, current capability eligibility, instrument status, and calibration remain valid and the retained lease owner is that kiosk. Reuse never acquires Bluetooth automatically; every target work session still requires “このレンチを使用開始”.

Moving to another terminal invalidates reuse on the former terminal. The destination must create a current-session physical confirmation after the preceding foreign ownership boundary, then perform normal acquisition or the existing two-stage physical-presence takeover. Takeover advances the fencing generation. Operator changes and elapsed time alone do not invalidate a confirmation.

Agent input carrying a valid lease token may use an adopted confirmation created in another session. Tokenless input while enforcement is disabled retains the legacy same-session and start-origin-terminal restrictions. Administrator override remains target-session-only.

## Alternatives

- Mutate the work session's terminal assignment on every move: rejected because it erases start-origin meaning and duplicates the lease's current ownership audit.
- Reuse the newest confirmation for a profile without lease adoption: rejected because an old terminal's confirmation can outlive a physical move.
- Limit reuse to one lot: rejected because lot identity is not part of wrench compatibility or the tightening fingerprint.
- Add a fixed timeout or require the same operator: rejected because neither represents a physical or configuration state change.
- Enable connection-lease enforcement as part of this change: rejected because activation is a separately approved operational gate.

## Consequences

Operators can move between D26IIII, D26HHHH, and other matching work IDs without repeatedly checking the same wrench on the same terminal. A terminal move still requires deliberate physical evidence and preserves one-controller-at-a-time behavior. The nullable scalar has no foreign key; if its confirmation row is missing, repository validation returns no reusable confirmation and the operator must confirm again.

## Validation

Validate with pure policy tests, isolated-PostgreSQL migration and API integration tests using different lots and start-origin terminals, lease acquisition races, stale destination confirmation rejection, generation fencing, admin override rejection, Web explicit-start tests, and SQL `EXPLAIN (ANALYZE, BUFFERS)` of retained-lease and confirmation lookups.

## Supersedes / Superseded By

- Supersedes: the session-only confirmation-reuse boundary in `ADR-20260717-assembly-torque-wrench-traceability.md` and the start-origin-client authorization statement in `ADR-20260722-assembly-torque-wrench-connection-lease.md`.
- Superseded by: none.

## Local Notes JA

- 作業ID・ロットは再利用可否の安全キーではない。
- 同じ端末では、使用終了後も採用済み確認を次の作業IDで使える。ただし使用開始操作は毎回必要。
- 別端末へ移した場合は、移動先で現物確認を新しく作り、取得または二段階引継ぎで採用する。
- `connectionLeaseEnforcedAt`はこの変更では設定しない。
