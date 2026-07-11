---
title: Pi5 single-host Blue/Green deployment runbook
status: draft
scope: opt-in production Pi5 API, Web, and fixed Caddy gateway
date: 2026-07-11
source_of_truth: docs/runbooks/pi5-blue-green-deploy.md
related_code: [scripts/deploy/pi5-blue-green.sh, infrastructure/docker/docker-compose.phase3.yml, infrastructure/docker/Caddyfile.gateway.template]
related_docs: [../plans/pi5-blue-green-phase3.md, ../runbooks/pi5-minimal-downtime-deploy.md, ../guides/deployment.md]
validation: repository dry-run and Compose rendering; production bootstrap pending explicit acceptance
open_items: [Pi5 gateway bootstrap, five-minute monitor and rollback acceptance, reboot restoration]
---

# Pi5 single-host Blue/Green deployment runbook

## Scope and safety

This runbook is for the opt-in Phase 3 path. Two API/Web pairs run on the Pi5, but only the fixed `gateway` container publishes ports 80 and 443. The existing Phase 2 command remains the fallback. A single Pi5 does not provide redundancy for a gateway or host failure. API slots use a shared scheduler lease on `/app/alerts/.pi5-scheduler-leader`, so only one slot runs process-local background jobs at a time.

The first bootstrap is a controlled cutover because the current `docker-web-1` container owns ports 80 and 443. The Blue/Green command never stops that service automatically. Stop or otherwise release the old listener only during an approved maintenance window, then retry the gateway start if it reports a port conflict.

## Resource preflight

Blue/Green is allowed only when the host reports at least 1.5 GB available memory, 10 GB free disk, and a load average below `PI5_BLUE_GREEN_MAX_LOAD_AVG` (default 4.0). If the guard fails, no inactive container is started. Use the Phase 2 command for that release instead.

Confirm CI is green, the candidate API and Web images are immutable SHA tags, the existing database container is healthy on `docker_default`, and the storage/certificate paths are mounted. Do not use destructive database migrations; the old and new APIs must both accept the expanded schema.

## First bootstrap

Build and validate the candidate with the Phase 2 command first. Then, during the approved gateway cutover window, from `/opt/RaspberryPiSystem_002` run:

    scripts/deploy/pi5-blue-green.sh bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image <api-image> --web-image <web-image>

The command stops the legacy API only when the explicit scheduler-handoff flag is supplied, then starts `api-blue` and `web-blue`, validates their API/Caddy health, renders the gateway for Blue, and starts `gateway`. It does not stop the old Web service. Confirm external read-only requests to `/api/system/health` and `/` before treating Blue as active. The shared scheduler lease ensures only one API slot runs background jobs; the first handoff therefore requires the approved maintenance window.

## Prepare and switch

After bootstrap, prepare the inactive slot while Blue or Green continues serving traffic:

    scripts/deploy/pi5-blue-green.sh prepare --api-image <api-image> --web-image <web-image>
    scripts/deploy/pi5-blue-green.sh status

Preparation starts only `api-<inactive>` and `web-<inactive>`, checks the internal API health endpoint, and validates `/srv/Caddyfile.slot`. It does not reload the gateway. If resources become insufficient, it exits before `docker compose up` and prints the Phase 2 fallback.

Switch only after the candidate checks pass:

    scripts/deploy/pi5-blue-green.sh switch

The command writes the candidate gateway configuration to a temporary file, atomically renames it, reloads Caddy, and performs external read-only smoke checks. The previous slot remains running for five minutes. The state file records active/candidate/previous slots, image names, switch time, stability deadline, and rollback reason.

## Automatic and manual rollback

After a switch, a monitor checks the external API health, Web root, and optional `PI5_BLUE_GREEN_KIOSK_HEALTH_URL` every two seconds until the five-minute deadline. If `PI5_BLUE_GREEN_ERROR_RATE_URL` is configured, its JSON `errorRate` (or `error_rate`) must stay at or below `PI5_BLUE_GREEN_MAX_ERROR_RATE` (default 0.05). A failed check reloads the previous slot and records `automatic monitor threshold failure`. It does not delete the failed slot or images.

For a deliberate rollback, inspect state first and then run:

    scripts/deploy/pi5-blue-green.sh status
    scripts/deploy/pi5-blue-green.sh rollback --reason <operator reason>

Rollback refuses missing or stale slot state. Confirm that the old slot serves HTTP 200 before investigating the failed candidate. Do not reverse database migrations; the release policy requires the schema to remain valid for the previous API.

## Cleanup and reboot check

After the stability deadline, stop only the previous slot and keep current, previous, and candidate image references:

    scripts/deploy/pi5-blue-green.sh cleanup

After a maintenance reboot, run `status`, verify the recorded active slot is running, verify the gateway config points to that slot, and run the read-only smoke checks. If the gateway or host is unavailable, use the existing Phase 2 recovery path; Blue/Green cannot provide host-level redundancy on one Pi5.

## Recovery evidence

Record the candidate image SHAs, resource values, active/candidate slots, gateway reload result, external smoke result, switch duration, monitor result, and rollback reason. Keep the Phase 2 state file separate from the Phase 3 state file.
