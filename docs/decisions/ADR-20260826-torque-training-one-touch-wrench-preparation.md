# ADR-20260826 Torque training one-touch wrench preparation

Status: Accepted

## Context

Assembly torque training uses versioned server-side conditions and one currently available digital torque wrench. The wrench's lower, nominal, and upper values must be changed for each selected program before training. [The manufacturer's CEM3-BTLA specification](https://www.tohnichi.co.jp/products/download/attachment/48326) defines one-way communication from the wrench, so this system cannot read or change those physical settings.

The existing management API restricts torque-wrench master and setting changes to ADMIN/MANAGER JWT users. Requiring that flow before every kiosk training would add a separate login and duplicate the operator's physical confirmation. At the same time, accepting torque values from the kiosk would let a client substitute arbitrary settings.

`TorqueTrainingWrenchConfirmation` already records the session, program condition fingerprint, physical profile, setting history, employee and client identities with snapshots, and confirmation time. A separate preparation audit table would duplicate that lifecycle and could drift from the confirmation record. The expand-only migration validator does not permit adding a unique index to this existing table, so request ownership needs a separate minimal database-enforced key without copying its audit fields.

## Decisions

1. Register the approved fourteen carbon-steel and SUS304 programs as a versioned standard catalog. Programs remain visible even when no compatible wrench model or physical profile is assigned.
2. Classify each current program version as `READY`, `UNASSIGNED`, or `UNAVAILABLE`. Setup readiness checks capability assignment, model range, physical status, and calibration, but deliberately ignores the wrench's current setting because the operator is about to change it. Normal training eligibility continues to require exact current-setting agreement.
3. Add the training-only endpoint `POST /api/torque-training/sessions/:id/wrench-preparations`. It accepts only employee UID, physical profile ID, an idempotency request ID, and the literal confirmation `physicalSettingConfirmed: true`. Torque values are derived from the session's immutable program version on the server.
4. In one database transaction, append the server-derived setting history, create the existing wrench confirmation referencing that history, acquire the shared server-side usage lease for the same training session and client, and claim the idempotency request. If another active owner holds the wrench, every preparation write is rolled back before commit. Keep the confirmation as the sole audit truth. A minimal `TorqueTrainingWrenchPreparationRequest` ledger stores only the unique `requestId`, its confirmation ID, and creation time. It exists solely to claim concurrent requests within the expand-only contract; it does not duplicate session, employee, client, setting, or snapshot data. A replay follows the ledger to the original result and creates no additional setting history.
5. Authorize this narrow path with the registered kiosk client key, active session, matching NFC employee, assigned physical wrench, and setup-readiness policy. Keep the generic ADMIN/MANAGER setting API unchanged and route both paths through the same transaction-scoped setting writer.
6. Treat the button labelled `レンチ本体を表示値に設定して接続` as the operator's physical-setting confirmation. Do not add a checkbox or second dialog. The preparation transaction reserves the shared server-side usage lease before success; the browser then acquires the local torque-agent connection as the same owner. If only that local connection fails, retry connection without writing another setting or confirmation.
7. Preserve explicit identity as wrench inventory grows. The agent-detected serial number must resolve uniquely to an assigned profile; the UI and server do not guess among ambiguous or incompatible devices.
8. Synchronize the standard catalog through an explicit, idempotent CLI. Dry-run performs no writes, the full apply is transactional, and a legacy M5 program is disabled only when its exact code is explicitly supplied. Existing versions, confirmations, attempts, and history are never deleted.
9. The training settings dialog on the kiosk uses the same shared four-digit operation password as the existing self-inspection kiosk flows instead of redirecting to the management-console login. Every settings read or mutation requires both a registered kiosk client key and server-side password verification; the browser keeps the password only in React memory until the dialog closes. The existing ADMIN JWT routes remain available unchanged. Kiosk mutations append the client-device ID and name snapshot to `TorqueTrainingSettingsAuditLog` in the same transaction as the domain change. Because the password is shared, this audit identifies the terminal, not an individual person.

## Dependency direction

The standard catalog is pure data. Reconciliation depends on that catalog and Prisma, but runtime training does not depend on the CLI. Pure setup-readiness and torque normalization policies have no route or UI dependencies. The shared setting writer depends only on a transaction client and those policies. The preparation service coordinates existing repositories and the writer; HTTP routes validate and delegate. The web API client owns transport, UI state owns the preparation/connection sequence, and presentation components only render supplied state.

## Consequences

One kiosk action safely completes the system-side write, audit confirmation, and connection attempt while the physical wrench remains an explicit human operation. The kiosk cannot choose torque values, and ordinary failures remain recoverable: unassigned programs stay visible, connection-only failures can be retried, and request replay is harmless. Reusing the confirmation row avoids duplicate audit truth; the small request ledger provides only the database uniqueness that the existing table cannot gain safely in an expand-only migration. Rollout still requires applying the migration before deploying the new endpoint.

Existing databases are not populated by deployment. An operator must first dry-run the catalog CLI, review any explicitly named legacy M5 code and target wrench serials, and then run apply in a separately authorized operation.

The kiosk settings path removes the separate management-console login without weakening the server boundary: knowing the password without a registered kiosk client is insufficient, repeated attempts are rate-limited, and a failed audit append rolls back the corresponding settings mutation. Closing the settings flow clears the in-memory password. Individual attribution would require an additional NFC step and is intentionally outside this shared-password decision.
