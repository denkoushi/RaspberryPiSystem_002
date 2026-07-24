---
id: ADR-20260724-assembly-torque-low-latency-refresh
status: accepted
scope: assembly torque-agent delivery and kiosk work-session refresh
date: 2026-07-24
source_of_truth: docs/decisions/ADR-20260724-assembly-torque-low-latency-refresh.md
related_code:
  - clients/torque-agent/torque_agent
  - apps/web/src/features/assembly
related_docs:
  - docs/plans/assembly-torque-display-latency-execplan.md
  - docs/runbooks/assembly-torque-agent.md
validation:
  - torque-agent unit and latency tests
  - kiosk work-session refresh tests
  - isolated PostgreSQL integration and query-plan checks
supersedes: []
superseded_by: []
---

# ADR-20260724: Assembly Torque Low-Latency Refresh

## Context

The torque agent durably stores each complete HID frame in SQLite before sending
it to the assembly API. The assembly work screen renders the right-pane history
from the authoritative work-session API response.

The accepted safety boundaries are correct, but two independent timers add
fixed display latency. An idle torque agent can wait up to one second before
scanning its outbox, and the browser can wait up to 1.2 seconds before its next
full-session poll. Local isolated-PostgreSQL tests show that the record API
normally completes in tens of milliseconds, so weakening validation or changing
the schema would not address the cause.

## Decision

1. A successful durable enqueue sets a process-local wake signal. The sender
   drains existing rows at startup, wakes immediately for new rows, and retains
   its bounded retry schedule after delivery failure.
2. The sender reuses one HTTP client during its run instead of creating a new
   connection pool for every outbox scan.
3. After a 2xx API acknowledgement and successful local outbox deletion, the
   torque agent broadcasts a loopback WebSocket invalidation event on `/stream`.
4. The event contains only `sessionId`, `sourceEventKey`, `capturedAt`, and
   `acknowledgedAt`. It does not contain a torque value, serial number, raw HID
   input, judgement, or server-authoritative state.
5. The browser filters the event by work session and event key, then reloads the
   existing work-session API. It never renders the WebSocket payload as a torque
   record.
6. Notification and poll refreshes use one serialized coordinator. Concurrent
   requests are coalesced so an older response cannot overwrite a later one.
7. The existing 1.2-second poll remains enabled as the degraded-mode recovery
   path. WebSocket events are ephemeral and are not replayed.
8. The WebSocket remains bound to `127.0.0.1` and accepts only exact configured
   browser origins. A slow or disconnected browser is removed after a bounded
   send attempt and cannot block durable API delivery.

## Consequences

- The normal path has no fixed one-second agent wait or 1.2-second browser wait.
- The API, PostgreSQL record, lease, confirmation, eligibility policy, and
  idempotency key remain authoritative and unchanged.
- Old browser/new agent and new browser/old agent combinations remain safe
  because the polling path is unchanged.
- A WebSocket failure can still take slightly longer than one second to appear,
  but it cannot lose an acknowledged record.
- No Prisma migration or public assembly API change is required.

## Alternatives

- Poll the full work session every 250ms: rejected because it increases API and
  database load with the number of kiosks.
- Add a new high-frequency progress API: deferred because the loopback
  invalidation event meets the normal-path target with a smaller compatibility
  surface.
- Put the torque value directly in the WebSocket event: rejected because it
  would create a second, non-authoritative display path.

## Validation

Use deterministic wake-up, acknowledgement-order, retry, origin, duplicate, and
refresh-concurrency tests. Run the torque API integration suite against a
disposable PostgreSQL instance and retain existing indexed query plans. Measure
30 synthetic complete-frame events with a normal-path maximum of 1,000ms and p95
of 800ms or less, then repeat on an explicitly authorized canary kiosk before
production rollout.

## Local Notes JA

- WebSocketは「値の通知」ではなく「APIを今すぐ読み直す合図」である。
- 通知が壊れても、SQLite、APIの冪等性、1.2秒ポーリングを残すため記録は失われない。
- 本番配備と実機受入は、この実装とは別に承認する。
