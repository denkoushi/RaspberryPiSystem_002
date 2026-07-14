---
title: Pi5 single-host Blue/Green deployment runbook
status: accepted
scope: production Pi5 API, Web, and fixed Caddy gateway
date: 2026-07-12
source_of_truth: docs/runbooks/pi5-blue-green-deploy.md
related_code: [scripts/deploy/pi5-blue-green.sh, scripts/deploy/pi5-phase3-legacy-guard.sh, infrastructure/docker/docker-compose.phase3.yml, infrastructure/docker/Caddyfile.gateway.template, infrastructure/ansible/templates/pi5-blue-green-reconcile.service.j2]
related_docs: [../plans/pi5-blue-green-phase3.md, ../runbooks/pi5-minimal-downtime-deploy.md, ../guides/deployment.md]
validation: shell safety lifecycle, Compose rendering, Caddy route checks, API scheduler fail-closed tests, and 2026-07-12 production candidate build/prepare/switch/five-minute monitor/cleanup acceptance
open_items: []
---

# Pi5 single-host Blue/Green deployment runbook

## Scope and safety

This runbook is for the standard Phase 3 path. Two API/Web pairs run on the Pi5, but only the fixed `gateway` container publishes ports 80 and 443. The existing Phase 2 command remains the fallback. A single Pi5 does not provide redundancy for a gateway or host failure.

## Production acceptance record (2026-07-12)

The Phase 3 bootstrap state was already recorded as `bootstrap-success`. The
normal release acceptance then built immutable API/Web images for
`95be149fb275ba94387b67c4cb1648e4ca7a6678`, prepared Green while Blue served
traffic, and ran the candidate migration `status/deploy/status` sequence. The
database reported 144 migrations and no pending work.

The first prepare attempt refused to start an inactive slot because the load
average was `3.41`, above the configured maximum `3.00`; no routing or database
state changed. After the load returned to `2.13`, Green prepared successfully.
The gateway switched to Green in one second, the five-minute monitor completed
without an alert or rollback, and `cleanup` removed Blue. The final state is
`activeSlot=green`, `runtimeStatus=consistent`, `result=cleanup-complete`; the
public `/api/system/health` endpoint returned `status: ok`.

An intentional bad-candidate, forced rollback, or host-reboot drill was not
needed to accept the normal production path. Those are optional future
operational exercises, not release blockers. This remains a single-Pi5 design:
host failure and power loss require future host redundancy rather than
Blue/Green recovery.

**While Phase 3 state is live, do not use normal Ansible api/web recreation, `manage-app-configs` handlers that restart compose api/web, Phase 2 `pi5-image-deploy.sh`, or legacy `docker-compose.server.yml` up for api/web.** Those paths are fail-closed by `scripts/deploy/pi5-phase3-legacy-guard.sh` because legacy Web binds 80/443 and would collide with the fixed gateway. Use only `pi5-blue-green.sh` until `reconcile --restore-legacy` (or a completed legacy-restored recovery) returns the host to the conventional path.

Scheduler ownership is a PostgreSQL session advisory lock, not a shared-file lease. The public API slot can therefore be a healthy `standby` while the old slot remains the scheduler `leader` during the five-minute rollback window. The canonical internal readiness endpoint is called only with `docker exec`; every Caddy boundary (including HTTP `:80` redirect routes) returns `404` for `/api/system/deploy-readiness/internal`. Ready responses also require `scheduler.databaseConnection === "connected"`.

The first bootstrap is a controlled, reversible maintenance cutover. The command itself verifies the legacy Web static maintenance page, stops the legacy API before the legacy Web, starts the fixed gateway in maintenance mode after 80/443 are free, and restores the captured normal legacy Caddy configuration plus restart policies on a failed/interrupted handoff. If legacy restoration cannot be proven, the fixed gateway **keeps the maintenance page** rather than leaving 80/443 dark. Operators must not manually stop legacy containers or retry a failed gateway start outside this command.

## Resource preflight

Blue/Green is allowed only when the host reports at least 1.5 GB available memory, 10 GB free disk, and a one-minute load average below 75% of online CPUs (or a stricter explicit `PI5_BLUE_GREEN_MAX_LOAD_AVG`). If the guard fails, no inactive container is started. Use the Phase 2 command for that release instead.

Before any bootstrap, deploy the scheduler-readiness prerequisite (PR1) through the legacy Phase 2 path and verify from the legacy API container that `GET /api/system/deploy-readiness/internal` returns `ready: true`, `database: "ready"`, `scheduler.role: "leader"`, and `scheduler.databaseConnection: "connected"`. Confirm CI is green, candidate API/Web tags share the same immutable commit/config suffix, JWT secrets in `infrastructure/docker/.env` are strong (not empty / `replace-me` / weak placeholders), the existing database container is healthy on `docker_default`, and storage/certificate paths are mounted.

The command extracts the full commit SHA from the image tags, allows **new** Prisma migration files only (Expand-only allow-list SQL; modified existing migrations are refused), runs candidate `prisma migrate status`, `migrate deploy`, and `status` while the old API is still serving, then verifies the old API again. A migration file restored to Git after it was already applied is exempt from SQL-shape revalidation only when `_prisma_migrations` records it as finished and not rolled back and its SHA-256 exactly matches the recorded checksum; database lookup failure or checksum mismatch fails closed. DB rollback is never attempted; every migration that can still execute must be Expand-only and compatible with both APIs.

## First bootstrap

Build and validate the candidate with the Phase 2 command first. Then, during the approved gateway cutover window, from `/opt/RaspberryPiSystem_002` run:

    scripts/deploy/pi5-blue-green.sh bootstrap --confirm-bootstrap --allow-legacy-scheduler-handoff --api-image <api-image> --web-image <web-image>

The controlled sequence is fixed:

1. Run migration/compatibility checks and start Blue as a healthy scheduler `standby` while the PR1-updated legacy API is still `leader`.
2. Capture the legacy normal Caddy configuration **and legacy image digests/tags**, display and verify its static maintenance page, and atomically record the bootstrap transaction.
3. Set legacy API/Web restart policies to `no`, stop legacy API, and wait for Blue to become `leader`.
4. Stop legacy Web, verify 80/443 are free, start the gateway maintenance page, then atomically reload it to Blue after external API/Web smoke checks pass.
5. Persist active state. Run `cleanup` after acceptance to remove the stopped legacy containers; images and volumes are retained.

Any error or signal before durable active state prefers legacy restoration using the **captured** legacy images (never a fresh Compose build). If that restoration fails, the gateway maintenance page is retained. Confirm external read-only requests to `/api/system/health` and `/` before treating Blue as active.

## Prepare and switch

After bootstrap, prepare the inactive slot while Blue or Green continues serving traffic:

    scripts/deploy/pi5-blue-green.sh prepare --api-image <api-image> --web-image <web-image>
    scripts/deploy/pi5-blue-green.sh status

Preparation first applies the same Expand-only migration guard/status/deploy/status sequence while the current leader remains healthy. It then starts only `api-<inactive>` and `web-<inactive>`, checks API/Caddy health and the internal readiness contract, and requires the inactive slot to be scheduler `standby`. It does not reload the gateway. If resources become insufficient, it exits before `docker compose up` and prints the Phase 2 fallback.

Switch only after the candidate checks pass:

    scripts/deploy/pi5-blue-green.sh switch

The command validates that the current slot is scheduler `leader` and the candidate is `standby`, writes the candidate gateway configuration to a temporary file, atomically renames it, reloads Caddy, and performs external read-only smoke checks. The public candidate remains `standby`; the previous slot remains scheduler `leader` for five minutes. If durable state cannot be saved after a successful gateway cutover, the command rolls back to the previous slot or moves the gateway to maintenance so routing and state cannot diverge. State schema v2 records fixed blue/green image pairs, migration commits/timestamps/status, legacy quarantine/removal state, gateway target, and monitor roles. It never silently replaces malformed or image-rewritten state.

## Automatic and manual rollback

After a switch, a background monitor checks the external API health, Web root, optional `PI5_BLUE_GREEN_KIOSK_HEALTH_URL`, both scheduler roles, and readiness metrics every two seconds until the five-minute deadline. Monitor completion and the coordinator's cleanup handoff are serialized: cleanup must not run concurrently with an in-flight monitor. A readiness error rate over `0.05` fails only after at least 20 samples. If configured, `PI5_BLUE_GREEN_ERROR_RATE_URL` is checked too. A failed check rolls back only after proving the previous slot is a healthy scheduler `leader`; otherwise it records a critical alert and leaves routing unchanged for manual recovery.

While the canonical rolling-release coordinator is live, operators may use `status` and
the release `--status`/`--attach` views, but must not manually run `cleanup`,
`rollback`, `reconcile`, or another mutating Blue/Green command. This preserves one
owner for the monitor, cleanup, and terminal-rollout decision.

For a deliberate rollback, inspect state first and then run:

    scripts/deploy/pi5-blue-green.sh status
    scripts/deploy/pi5-blue-green.sh rollback --reason <operator reason>

Rollback refuses missing/stale state and proves the target's image, API/Caddy health, and scheduler `leader` role before changing the gateway. Do not reverse database migrations; the release policy requires the schema to remain valid for the previous API.

## Cleanup and reboot check

After the stability deadline, stop and remove the previous slot, wait up to the readiness retry limit for the active API to become scheduler `leader`, then remove the quarantined legacy API/Web containers. Images and persistent volumes are not deleted:

    scripts/deploy/pi5-blue-green.sh cleanup

The canonical coordinator owns normal cleanup. At the monitor handoff it may retry
**only** the exact pre-mutation Blue/Green lock-conflict failure for at most 30
seconds. Each attempt reacquires the lock and reruns cleanup's state, stability,
image, and scheduler checks. Any other cleanup error, or exhaustion of that bound,
fails closed and does not advance terminals. Do not work around a live coordinator
by issuing a manual mutating command; after it has stopped, inspect `status` and
follow the recovery path below. The incident and prevention record is
[KB-400](../knowledge-base/KB-400-pi5-bluegreen-cleanup-monitor-lock.md).

If that coordinator has stopped after an exhausted retry, the next **Pi5-required
standard rolling release** may recover only an exact expired two-slot handoff:
consistent runtime, valid distinct active/previous slots, application gateway on
the active slot, matching monitor slots, and an elapsed `stableUntil`. The
coordinator runs one direct `cleanup` before same-SHA skipping or candidate
building, then requires normalized single-slot state before continuing. This
recovery does not retry a lock conflict; it records `pi5HandoffRecovery` in the
release state. Any incomplete, stale, future-window, failed-cleanup, or
non-normalized post-cleanup state stops before terminal rollout.

`status` is read-only: it reports live slot image/health/readiness, gateway target, and legacy quarantine/removal state and marks mismatches as `stale`. `reconcile` (also installed as systemd `pi5-blue-green-reconcile.service` for the deploy user with the `docker` supplementary group) repairs a rebooted active slot, re-applies legacy quarantine, resumes the five-minute monitor when `stableUntil` is still in the future, recovers incomplete `bootstrapping` / `bootstrap-failed` state to legacy or gateway maintenance, and refuses `compose up` when running containers do not match state images. For an emergency fallback, run `reconcile --restore-legacy`; it stops Phase 3 and recreates legacy services from the **captured** legacy images via `docker-compose.legacy-restore.yml` without deleting volumes. If the gateway or host is unavailable after a full legacy restore, the conventional Ansible/Phase 2 path is allowed again; Blue/Green cannot provide host-level redundancy on one Pi5.

## Alerts

Critical and warning events write acknowledged=false deploy-alert payloads under the `ansible-update-bluegreen-*` routing prefix so the existing Pi5 alert pipeline can surface them.
