# Assembly torque display latency

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current while implementation is
in progress.

## Purpose / Big Picture

After a CEM3-BTLA HID frame is completely received, the committed torque record
should normally appear in the assembly work screen's right pane within one
second. The durable SQLite outbox, API-side validation, connection lease,
confirmation, and idempotency rules remain authoritative and unchanged.

The current fixed delay comes from two independent timers: the torque agent
waits as long as one second before scanning its outbox, and the browser waits as
long as 1.2 seconds before reloading the work session. The implementation wakes
the sender immediately after durable enqueue and sends a local, non-authoritative
WebSocket notification only after the API acknowledges the record. The browser
then reloads the authoritative session. Existing polling remains the recovery
path when the notification is unavailable.

## Progress

- [x] 2026-07-24: Confirmed clean `main`, fast-forwarded from `origin/main`, and
  created `fix/assembly-torque-display-latency`.
- [x] 2026-07-24: Reproduced the fixed 1.0s agent and 1.2s browser waits by code
  inspection.
- [x] 2026-07-24: Applied all 152 migrations to a disposable PostgreSQL
  container and passed the torque-wrench integration tests (3/3).
- [x] 2026-07-24: Confirmed indexed plans for session lookup, torque history,
  and agent idempotency lookup. The disposable container, volume, and network
  were removed.
- [x] 2026-07-24: Implemented immediate outbox wake-up, persistent HTTP client, and
  post-acknowledgement delivery notifications.
- [x] 2026-07-24: Added the loopback WebSocket endpoint, exact origin
  validation, and bounded client sends.
- [x] 2026-07-24: Added coalesced browser refresh with the existing polling
  fallback.
- [x] 2026-07-24: Completed focused and broad validation and recorded the
  results below.

## Surprises & Discoveries

- The API record route completed in roughly 18-23ms in the disposable local
  database test. Database work is not the source of the multi-second fixed wait.
- `AssemblyTorqueRecord` and the existing web DTO already expose
  `sourceEventKey`, so the notification can be correlated without an API or
  Prisma schema change.
- The repository already uses loopback WebSockets for NFC and barcode agents,
  and the CSP already permits `ws:` and `wss:`.
- A full `prisma migrate diff` from a freshly migrated database to the current
  schema reports repository-wide historical drift in unrelated
  self-inspection, photo-tool, and index definitions. This branch does not
  change `apps/api/prisma`; the implementation diff for that tree is empty.
  Fixing historical drift is outside this latency change and would make the
  rollback surface unsafe.
- The first disposable integration run stopped before tests because
  `LOG_LEVEL=fatal` is not an allowed repository value. The isolated resources
  were removed, and the run succeeded with the allowed `LOG_LEVEL=error`.

## Decision Log

- Decision: Measure the controlled software latency from completed HID frame to
  right-pane render.
  Rationale: Device-internal and Bluetooth transmission time are outside this
  software boundary and require separate physical instrumentation.
- Decision: Keep the 1.2s full-session poll as a degraded-mode fallback.
  Rationale: A new high-frequency API or permanent 250ms full-detail poll would
  increase database load and change more safety-critical code.
- Decision: Publish only session/event/timestamp metadata after a successful API
  acknowledgement.
  Rationale: The notification is only an invalidation signal; the existing API
  remains the sole source of displayed torque values and judgement.
- Decision: Make `capturedAt` optional for previously queued SQLite rows.
  Rationale: Existing durable outbox data must remain replayable after upgrade.

## Plan of Work

1. Introduce small wake-up and delivery-notification ports in the torque agent.
   Persist `capturedAt`, wake the sender only after enqueue, reuse one HTTP
   client, and preserve startup drain plus bounded retry.
2. Add an origin-checked `/stream` WebSocket adapter to the loopback FastAPI
   application. Broadcast after API acknowledgement and local queue deletion;
   notification failures never requeue an accepted API event.
3. Add a web hook that filters the notification by session and source event,
   coalesces refresh requests into one in-flight GET, and retains the 1.2s
   polling fallback.
4. Add regression, concurrency, security, and latency tests. Validate the
   existing database schema and query plans in an isolated disposable
   PostgreSQL environment.
5. Document the decision, operations, diagnostics, and rollback. Do not deploy
   without separate authorization.

## Validation and Acceptance

- Torque agent: all pytest tests and Ruff checks pass.
- Web/API: focused tests, lint, and builds pass; existing torque integration
  tests pass on a disposable PostgreSQL database.
- Database: all migrations apply, Prisma reports no schema drift, and the three
  relevant lookups retain indexed plans.
- Normal synthetic path: 30 completed-frame events are delivered with no loss
  or duplicate UI update; every sample is at most 1,000ms and p95 is at most
  800ms. Degraded WebSocket behavior is verified through the 1.2s poll.
- Disposable Docker container, volume, and network are removed even on failure.

## Outcomes & Retrospective

Implemented the low-latency invalidation path without changing the public
assembly API, PostgreSQL schema, lease, confirmation, eligibility, or SQLite
durability contracts.

Validation completed on 2026-07-24:

- Torque agent: 51 tests passed; Ruff passed.
- Web: 299 test files and 1,493 tests passed. The focused latency and work-page
  set passed 18 tests, including 30 synthetic committed events within the
  800ms test budget and an actual right-pane refresh assertion.
- API: lint and build passed. On a disposable PostgreSQL database, all 152
  migrations applied and 26 related integration tests passed.
- SQL plans used `AssemblyWorkSession_pkey`,
  `AssemblyTorqueRecord_idx_session_recorded`, and
  `AssemblyTorqueAgentEvent_pkey`; measured executions were below 0.05ms in the
  isolated fixture database.
- Web build, root workspace lint, the torque-agent Docker image build, and all
  deploy safety contracts passed. Deploy contracts included 821 Python tests,
  20 isolated deploy-status tests, Ansible inventory/template/playbook checks,
  and rollback/release safety contracts.
- Every disposable test container, volume, network, and temporary verification
  image was removed. No production deployment or managed-host contact occurred.

Remaining work is separately authorized physical canary validation with 30 real
CEM3-BTLA frames. Keep deployment and canary acceptance outside this
implementation branch's local verification.
