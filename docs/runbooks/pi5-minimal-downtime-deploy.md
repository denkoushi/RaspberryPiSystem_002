---
title: Pi5 minimal-downtime deployment runbook
status: draft
scope: production Pi5 API and Web image deployment
date: 2026-07-11
source_of_truth: docs/runbooks/pi5-minimal-downtime-deploy.md
related_code: [scripts/deploy/pi5-image-deploy.sh, infrastructure/docker/docker-compose.phase2.yml, infrastructure/ansible/roles/server/tasks/main.yml]
related_docs: [../plans/pi5-minimal-downtime-phase2.md, ../guides/deployment.md]
validation: repository dry-run only; Pi5 prepare-only acceptance pending
open_items: [Pi5 prepare-only acceptance, measured switch acceptance, Slack alert integration]
---

# Pi5 minimal-downtime deployment runbook

## Scope

This runbook covers phase 2 deployment of API and Web on the single production Pi5. Candidate images are built and checked while the current system remains available. The final API and Web replacement is short but is not zero-downtime; phase 3 adds Blue/Green routing. Pi4 clients continue to use the terminal-specific maintenance and acknowledgement flow documented in `docs/guides/deployment.md`.

## Safety rules

Use `scripts/update-all-clients.sh` as the standard deployment entry point. Do not directly enable the Ansible phase-2 variable until prepare-only acceptance has passed on Pi5. A database release must be backward compatible with the currently running API. Rename, drop, truncate, and immediate required-column changes must be released through Expand/Contract across separate releases.

Never use `--force-destructive-migration` during an ordinary deployment. It is an emergency override that requires a reviewed recovery plan and explicit operator approval. The deployment command does not reverse database migrations.

## Preflight

Confirm CI is green, the target is a full 40-character commit SHA, and no other deployment is running. Confirm at least 10 GB disk space. Candidate preparation requires at least 768 MB available memory; the later Blue/Green phase has a stricter 1.5 GB requirement. Confirm the current external API health endpoint and Web root return HTTP 200.

Set `PI5_MIGRATION_BASE_REF` to the full SHA currently deployed on Pi5. This makes the Expand-only guard inspect every migration added by the release rather than only the candidate's final commit.

## Prepare without switching

On Pi5, from `/opt/RaspberryPiSystem_002`, run:

    export PI5_MIGRATION_BASE_REF=<currently-deployed-full-sha>
    scripts/deploy/pi5-image-deploy.sh prepare --ref <candidate-full-sha>
    scripts/deploy/pi5-image-deploy.sh status

Preparation must finish with `candidate prepared`. During the build, another terminal should repeatedly request `/api/system/health`; requests must remain HTTP 200. Preparation validates Compose rendering, the Web Caddy configuration, and a temporary API container. Failure here must leave production containers unchanged.

## Switch

Only after prepare succeeds, enable global maintenance for the Pi5 switch and run:

    export PI5_MIGRATION_BASE_REF=<currently-deployed-full-sha>
    scripts/deploy/pi5-image-deploy.sh switch --ref <candidate-full-sha>

The command applies backward-compatible migration state, replaces API, waits for external API health, replaces Web, and checks the external Web root. It records the previous images before replacement. Remove global maintenance only after both external checks pass. Record observed HTTP interruption; acceptance is 30 seconds or less.

## Failure and rollback

If switch health checks fail, the command attempts to restore the recorded previous API and Web images automatically. Inspect:

    scripts/deploy/pi5-image-deploy.sh status
    docker compose -f infrastructure/docker/docker-compose.server.yml ps
    docker compose -f infrastructure/docker/docker-compose.server.yml logs --tail=100 api web

If automatic recovery did not finish, run:

    scripts/deploy/pi5-image-deploy.sh rollback

Confirm external API and Web HTTP 200 before removing maintenance. Do not attempt to reverse Prisma migrations; the previous API is required to remain compatible with the expanded schema.

## Cleanup

After stable operation, run `scripts/deploy/pi5-image-deploy.sh cleanup`. It preserves candidate and previous image references from the state file. Keep the current generation, previous generation, and candidate generation until production acceptance is complete.

## Ansible opt-in

`pi5_minimal_downtime_deploy_enabled` defaults to `false`. After prepare-only acceptance, set it only for the intended Pi5 run through an explicit extra variable. If phase-2 preflight cannot be satisfied, leave it false and use the existing deployment path. Do not make the opt-in a permanent inventory default until measured switching and rollback tests pass.

## Acceptance evidence

Record candidate SHA, current SHA, prepare result, switch duration, external HTTP interruption, migration status, API/Web health, and rollback result if exercised. A successful Ansible recap must have `failed=0` and `unreachable=0`.
