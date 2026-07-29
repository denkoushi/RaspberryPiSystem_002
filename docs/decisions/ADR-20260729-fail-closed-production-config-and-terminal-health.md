---
id: ADR-20260729-fail-closed-production-config-and-terminal-health
title: Fail closed on production configuration and terminal peripheral health
status: accepted-for-implementation
date: 2026-07-29
source_of_truth: true
scope: immutable Web configuration, kiosk readiness, peripheral telemetry, and operations alerting
related_code:
  - scripts/deploy/production_config_contract.py
  - apps/web/src/config/
  - apps/web/src/features/nfc/nfcRuntimeContract.ts
  - scripts/deploy/terminal-agent-health-probe.py
  - clients/status-agent/terminal_agent_health.py
  - apps/api/src/services/clients/client-telemetry-alert-policy.ts
related_docs:
  - ../plans/fail-closed-production-config-and-terminal-health-execplan.md
  - ../knowledge-base/KB-403-production-config-contract-and-nfc-health.md
  - ../guides/deployment.md
validation: pure configuration audits, browser and agent tests, ARM64 Docker exercises, disposable PostgreSQL, and full deployment contracts
open_items:
  - hosted CI and Draft PR
  - main merge and production rollout require separate approval
---

# ADR-20260729: Fail closed on production configuration and terminal peripheral health

## Context

The Assembly-01 reader continued to scan cards, but the immutable Web bundle
did not contain the intended local-only NFC mode. Production settings were
copied by hand through multiple Ansible, Docker, release, and application
surfaces. Tests compared incomplete handwritten lists with one another, so a
missing setting still produced a valid image and a successful deployment.

The deployment probe also accepted a boolean-shaped `readerConnected` value
without requiring `true`, ignored an NFC queue backlog, and ordinary
status-agent telemetry did not inspect NFC, Barcode, or Torque agents.

## Decision

Use one pure typed registry for every production `VITE_*` setting. Derive the
signed Web build allowlist from it and mechanically audit the application
references, Ansible source, rendered Docker environment, Compose build
arguments, Dockerfile, release contract, and generated application defaults.
Missing, unknown, duplicated, malformed, secret-like, or inconsistent values
stop CI. Per-terminal client identity remains an explicit runtime exception.

Use one `NfcRuntimeContract` for both normal browser subscriptions and kiosk
deployment readiness. A kiosk may acknowledge readiness only after two
one-second-spaced observations prove local-only policy, the exact loopback
agent endpoints, a connected reader, and an empty queue. The terminal probe
requires usable NFC and Barcode state and rejects an NFC backlog before
mutation. Queued NFC events are deleted only after an actual successful
broadcast.

Keep the existing sixty-second status-agent timer and add a separate,
inventory-driven peripheral collector. The first unhealthy observation opens a
local episode. The second emits one sanitized `terminal_agent_health` log.
Delivery failures retry, recovery closes the episode, and a later recurrence
may notify again. The API selects alerts through a pure telemetry policy while
preserving existing SD-card behavior and the current database schema.

Bind NFC Agent HTTP/WebSocket to loopback and remove its unused flush, reboot,
and poweroff routes. Do not automatically flush a queue or weaken Tailnet
controls.

## Consequences

Adding a new production Web setting requires one registry entry and complete
audited propagation; an omitted hop cannot silently use a browser default.
Deployment may stop for a disconnected reader or any unconsumed NFC event,
requiring operator reconciliation rather than data loss. Persistent peripheral
failure becomes visible through the existing operations Slack route within two
timer observations.

This change does not add a public API, DTO, Prisma field, migration, automatic
queue deletion, automatic recovery, or automatic canary approval. The
sixty-second notice, serialized terminals, human canary, five-minute Pi5
monitor, and rollback contracts remain unchanged.

## Alternatives Considered

Adding only the missing NFC build variable was rejected because it would leave
the duplicated configuration process intact. Treating defaults as production
configuration was rejected because it hides omission. Alerting on the first
sample was rejected as noisy, while requiring manual polling was rejected
because latent peripheral failures would remain invisible. Automatic queue
flush and reader restart were rejected because they can destroy business data
or conceal a hardware fault.
