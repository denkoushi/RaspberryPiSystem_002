---
id: KB-403
title: Production configuration drift and latent terminal peripheral failure
status: implementation-complete-publication-pending
scope: Assembly-01 NFC incident, immutable Web configuration, deployment readiness, and peripheral alerts
date: 2026-07-29
source_of_truth: true
related_code:
  - scripts/deploy/production_config_contract.py
  - apps/web/src/config/productionBuildConfig.ts
  - apps/web/src/features/nfc/nfcRuntimeContract.ts
  - clients/nfc-agent/
  - clients/status-agent/terminal_agent_health.py
  - apps/api/src/services/clients/client-telemetry-alert-policy.ts
related_docs:
  - ../decisions/ADR-20260729-fail-closed-production-config-and-terminal-health.md
  - ../plans/fail-closed-production-config-and-terminal-health-execplan.md
  - ../guides/deployment.md
validation: focused and full Web/API/agent tests, ARM64 Docker exercises, 156 disposable migrations, SQL EXPLAIN, and full deployment contracts
open_items:
  - hosted CI and Draft PR
  - main merge, production rollout, Slack delivery, and physical-device proof require separate approval
---

# KB-403: Production configuration drift and latent terminal peripheral failure

## Incident

Assembly-01 displayed the NFC prompt but did not react to a card. The reader,
PC/SC service, and NFC Agent were healthy and continued to enqueue scans. The
browser was not connected to the terminal-local WebSocket because the intended
`VITE_AGENT_WS_MODE=local` value existed in Ansible but was omitted from the
immutable Web image build boundary.

The earlier corrective deployment restored physical scanning, but the
incident exposed a broader defect class: manually duplicated production
configuration could be incomplete while build, signature, deployment, and
readiness checks still succeeded.

## Root cause

Production Vite inputs were repeated independently through Ansible,
`docker.env`, Compose, Dockerfile arguments, a signed release contract, Python
allowlists, and direct `import.meta.env` reads. Tests compared overlapping
handwritten subsets, not the complete set consumed by the application.
Browser defaults therefore converted an omitted production value into a
plausible but incorrect bundle.

The same audit found omitted production wiring for API timeout, Barcode Agent,
debug logging, manual-order device scope, and leaderboard feature switches.
The deployment probe also checked the shape rather than usability of
peripheral status, and the one-minute telemetry path monitored host health but
not terminal peripherals.

## Corrective contract

- One typed registry classifies all twenty Web settings as immutable image
  inputs, generated values, terminal runtime exceptions, or development-only.
- CI audits every production hop and rejects direct application-side
  `import.meta.env` access outside one typed adapter.
- API environment drift is audited without moving the sixteen currently
  non-effective compatibility settings.
- NFC subscription and deployment readiness share one runtime contract.
- Readiness requires a local-only loopback endpoint, `readerConnected=true`,
  `queueSize=0`, and two consecutive browser observations.
- Terminal probes reject disconnected NFC/Barcode readers and any NFC backlog.
- The resend worker removes only the successfully broadcast prefix.
- NFC Agent listens on loopback and no longer exposes flush, reboot, or
  poweroff routes.
- The existing status-agent timer records peripheral episodes and sends one
  sanitized alert after two consecutive failures, with retry and recovery.

## Operator guidance

An NFC queue backlog is business data, not disposable health residue. Do not
flush it automatically. Confirm the business screen is open, restore the
browser-to-loopback connection, and let actual WebSocket delivery drain the
queue in order. A deployment that reports peripheral preflight or readiness
failure must remain stopped until the reader and queue are reconciled.

Alert payloads intentionally omit card UID, last event content, credentials,
raw URLs, and raw agent responses. Use the terminal name, agent, signal,
severity, episode ID, timestamp, consecutive count, and optional queue size to
guide a read-only diagnosis.

## Validation boundary

Local validation proves the configuration audit, production bundle, loopback
NFC image, queue retention and delivery semantics, peripheral episodes,
telemetry alert policy, all 156 migrations, indexed client lookup, deployment
planner/readiness/rollback, and cleanup of run-owned Docker/PostgreSQL
resources. Hosted CI, production rollout, real Slack delivery, and physical
device monitoring remain separate acceptance gates.
