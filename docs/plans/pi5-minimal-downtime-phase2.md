# Pi5 minimal-downtime image deployment

This ExecPlan is a living document and must be maintained in accordance with `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` are updated as work proceeds.

## Purpose / Big Picture

Pi5 currently rebuilds API and Web images while the production Compose project is being updated, then recreates both services together. After this change, an operator can build commit-SHA-tagged candidate images while the current services remain available, validate the candidates, and perform only the final container replacement inside the maintenance window. If the new services fail health checks, the command restores the exact API and Web images that were running before the switch. This milestone targets an externally observed interruption of no more than 30 seconds; Blue/Green routing is deliberately deferred to phase 3.

## Progress

- [x] (2026-07-11 08:35Z) Confirmed the current Compose and Ansible deployment rebuilds and recreates `api` and `web` together.
- [x] (2026-07-11 08:35Z) Created a clean phase-2 branch and worktree from merged PR #972.
- [x] (2026-07-11 08:31Z) Added the phase-2 image lifecycle command and Compose image override.
- [x] (2026-07-11 09:12Z) Added Caddy static maintenance-page templates and made the switch path use them before API replacement.
- [ ] Add shell tests for prepare, guarded switch, rollback, retention, and resource failures (completed: prepare state, invalid SHA, and concurrent lock; remaining: mocked switch failure, rollback, retention, and real resource failure).
- [x] (2026-07-11 08:34Z) Connected the command to the existing Pi5 deployment path behind the default-off `pi5_minimal_downtime_deploy_enabled` variable.
- [x] (2026-07-11 08:38Z) Added the operator runbook and release-delta migration compatibility guard.
- [ ] Run local validation and CI, then perform a non-switching Pi5 candidate build test.

## Surprises & Discoveries

- Observation: `infrastructure/docker/docker-compose.server.yml` gives API and Web only build definitions, not stable image names. A deployment therefore cannot reliably record and restore image identities without an override.
  Evidence: `docker-compose.server.yml` contains `build:` for both services and no `image:` entry.
- Observation: the Ansible server role has several independent recreation paths, including handlers and environment-change paths.
  Evidence: `infrastructure/ansible/roles/server/tasks/main.yml` and `handlers/main.yml` invoke `up -d --force-recreate` separately.
- Observation: scanning the complete Prisma migration history would reject valid candidates because historical releases already contain destructive SQL.
  Evidence: existing migrations contain `DROP INDEX`, `DROP COLUMN`, and temporary-table cleanup statements.
- Observation: macOS does not provide `flock`, although Pi5 Linux does.
  Evidence: the first local dry run failed with `flock: command not found`; the command now uses an atomic lock directory fallback for development and tests.
- Observation: memory inspection through `sysctl` is blocked in the managed macOS test sandbox.
  Evidence: `sysctl -n hw.memsize` returned `Operation not permitted`; dry-run now skips resource enforcement while real execution remains fail-closed.
- Observation: standalone Caddy validation must reproduce the production certificate mount.
  Evidence: the first Pi5 prepare-only run built both images successfully, then failed safely with `open /srv/certs/cert.pem: no such file or directory`; production API and Web were not replaced.
- Observation: external API health checks cannot be used while a global maintenance page is intentionally responding.
  Evidence: the switch path now checks the newly recreated API from inside its container, then restores external checking after Web returns to normal routing.

## Decision Log

- Decision: Add a standalone phase-2 lifecycle command before replacing the existing Ansible path.
  Rationale: the existing command remains a tested fallback while candidate preparation and rollback can be verified independently.
  Date/Author: 2026-07-11 / Codex
- Decision: Identify API and Web images with the same full Git commit SHA and keep state in `logs/deploy/pi5-image-deploy-state.json`.
  Rationale: immutable identities make rollback and incident review deterministic.
  Date/Author: 2026-07-11 / Codex
- Decision: Do not roll back database migrations.
  Rationale: phase 2 permits only backward-compatible Expand changes, so the old API must remain valid after migration.
  Date/Author: 2026-07-11 / Codex
- Decision: Scan only migration files added or modified between the supplied migration base and candidate SHA.
  Rationale: compatibility policy applies to the new release delta, not already-applied historical migrations. `PI5_MIGRATION_BASE_REF` allows the deploy wrapper to provide the known production commit; the candidate parent is the conservative local default.
  Date/Author: 2026-07-11 / Codex
- Decision: Enable the maintenance page through a live Caddy reload in the existing Web container instead of recreating Web before API replacement.
  Rationale: the currently active image may predate phase 2 and lacks the page. Caddy's admin reload keeps the public listener alive, lets the old Web container serve a static page during the API replacement, and is cleared when the new Web container starts.
  Date/Author: 2026-07-11 / Codex

## Outcomes & Retrospective

The standalone lifecycle foundation, explicit image override, initial shell tests, and default-off Ansible integration now exist. Shell syntax, whitespace, lifecycle tests, and Ansible syntax validation pass. Mocked rollback/retention tests, documentation, and real Pi5 candidate validation remain; no phase-2 production switch has been attempted.

## Context and Orientation

`infrastructure/docker/docker-compose.server.yml` defines the production `db`, `api`, and `web` services. The Web container contains Caddy and owns host ports 80 and 443. `infrastructure/ansible/roles/server/tasks/main.yml` currently builds and recreates API and Web during the ordinary server play. `scripts/server/deploy.sh` is an older direct server deployment entry point with the same build-then-recreate behavior. The new lifecycle command belongs under `scripts/deploy/` so both Ansible and direct operator workflows can call one implementation.

A candidate is the pair of API and Web images built from the requested Git commit. A switch is the short operation that recreates production API and Web containers from those already-built images. The previous pair is the exact image IDs observed before switching. Expand/Contract means a database change is first released in a form accepted by both old and new API versions; destructive removal happens only in a later release after the old version is no longer needed.

## Plan of Work

Add a Compose override that assigns explicit image references to API and Web and removes any need to build during switch. Add `scripts/deploy/pi5-image-deploy.sh` with `prepare`, `switch`, `rollback`, `status`, and `cleanup` commands. `prepare` checks disk and memory, builds SHA-tagged images without stopping production, validates Compose and Caddy configuration, starts isolated validation containers, checks API health and Web file serving, and records the candidate. `switch` records current image IDs, enables global static maintenance, applies backward-compatible migrations, recreates API first and waits for health, recreates Web, performs external smoke checks, disables maintenance, and records timing. Any failure after replacement restores the recorded images and leaves an alert and state record. `cleanup` retains current, previous, and candidate generations.

After the standalone command is tested, add an explicit Ansible variable that selects it. The default remains the legacy path until a real Pi5 prepare-only acceptance run passes. Add a migration guard that rejects Prisma migration SQL containing destructive statements unless an emergency override is explicitly supplied.

## Concrete Steps

From the repository root, run shell and Python unit tests, validate Compose rendering, and run the lifecycle command in dry-run mode:

    bash scripts/deploy/tests/test-pi5-image-deploy.sh
    docker compose -f infrastructure/docker/docker-compose.server.yml -f infrastructure/docker/docker-compose.phase2.yml config --quiet
    scripts/deploy/pi5-image-deploy.sh status

On Pi5, the first acceptance is prepare-only and does not alter running containers:

    scripts/deploy/pi5-image-deploy.sh prepare --ref <full-commit-sha>

Only after prepare reports success may an operator run:

    scripts/deploy/pi5-image-deploy.sh switch --ref <full-commit-sha>

## Validation and Acceptance

During `prepare`, repeated external health requests must continue returning HTTP 200. A candidate with a failed API health check or invalid Caddy configuration must never recreate production services. During `switch`, the state file must record start time, end time, downtime estimate, current images, previous images, and rollback result. A forced post-switch health failure must restore both previous images. The measured external interruption must be at most 30 seconds. The old API image must pass health checks against the expanded database schema after migration.

## Idempotence and Recovery

Preparing the same SHA is safe and reuses or rebuilds the same immutable tags. Switching to the already-current SHA is a no-op after health verification. The state file is written through a temporary file followed by an atomic rename. A process lock prevents concurrent Pi5 image deployments. `rollback` refuses to act without recorded previous images. Database migrations are never reversed by this command.

## Artifacts and Notes

Phase 1.5 production evidence showed all selected Pi4 clients acknowledged maintenance before updates and every final Ansible recap had `failed=0`. That establishes the maintenance prerequisite used before a phase-2 Pi5 switch.

## Interfaces and Dependencies

The public operator interface is `scripts/deploy/pi5-image-deploy.sh <prepare|switch|rollback|status|cleanup>`. It uses Docker Engine, Docker Compose v2, `curl`, `python3`, and existing repository Dockerfiles. Image names default to `raspi-system-api:<sha>` and `raspi-system-web:<sha>`. Runtime state defaults to `/opt/RaspberryPiSystem_002/logs/deploy/pi5-image-deploy-state.json` and can be redirected in tests with `PI5_DEPLOY_STATE_FILE`.

Revision note (2026-07-11): Initial plan created after inspecting the merged phase-1.5 main branch. The standalone opt-in lifecycle was chosen to preserve the existing production fallback during rollout. The migration guard was narrowed to the release delta after static validation found destructive SQL in historical, already-applied migrations. Local dry-run validation added a portable process-lock fallback and skipped host resource enforcement only in dry-run. The Ansible role now selects the lifecycle only through an explicit default-off variable. The first Pi5 prepare-only run proved fail-closed behavior and added the missing read-only certificate mount to standalone Caddy validation. After prepare passed, static Caddy maintenance templates and an internal API-health path were added before attempting any switching.
