# Pi5 single-host Blue/Green deployment

This ExecPlan is a living document and must be maintained in accordance with `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` are updated at every stopping point.

## Purpose / Big Picture

The production Pi5 currently exposes Caddy from the same Web container that is replaced during a release. This change adds an opt-in Blue/Green path: two API/Web slots run side by side, while one fixed Caddy gateway owns ports 80 and 443 and forwards traffic to the active slot. An operator can prepare and validate the inactive slot, switch the gateway atomically, keep the old slot for five minutes, and return to it automatically when health checks fail. The existing Phase 2 command remains available as the fallback when the host does not have enough memory or disk.

The user-visible proof is that `scripts/deploy/pi5-blue-green.sh status` reports the active and candidate slots, `prepare` starts only the inactive slot, and `switch` changes the gateway without recreating the active slot. A failed switch leaves the previous slot serving traffic and records a rollback reason.

## Progress

- [x] (2026-07-11) Confirmed the Phase 2 Pi5 image lifecycle and the production Compose storage/network layout.
- [x] (2026-07-11) Add the slot and fixed-gateway Caddy configuration to the Web image.
- [x] (2026-07-11) Add the Blue/Green Compose definition with no host ports on API/Web slots.
- [x] (2026-07-11) Add the resource-guarded `status`, `prepare`, `switch`, `rollback`, and `cleanup` command plus the explicit first `bootstrap` guard.
- [x] (2026-07-11) Add unit-like shell tests for state transitions, resource fallback, lock contention, and gateway rendering.
- [x] (2026-07-11) Add the Phase 3 runbook and deployment guide/index links.
- [x] (2026-07-11) Run shell, Compose, Caddy, existing Phase 2, and documentation validation; add the Phase 3 lifecycle test to CI.
- [ ] Open a separate PR and wait for hosted CI.
- [ ] Production bootstrap and acceptance are intentionally not part of this code PR.

## Surprises & Discoveries

- Observation: the existing `web` service owns host ports 80 and 443, so a Phase 3 bootstrap must stop that service before the gateway can bind the same ports.
  Evidence: `infrastructure/docker/docker-compose.server.yml` maps `80:80` and `443:443` under `web`.
- Observation: API storage is a mixture of named volumes and host bind mounts, and the existing Docker project network is named `docker_default` on Pi5.
  Evidence: the server Compose file declares the storage volumes and the deployed project uses the Compose default network.
- Observation: the gateway cannot use a separate lightweight image without duplicating the Caddy build.
  Evidence: `Dockerfile.web` already contains the Caddy binary and static site; the gateway will reuse that immutable Web image but will not mount its site as the public application.
- Observation: local macOS validation has no `flock` command.
  Evidence: the Phase 3 test passed through the command's atomic lock-directory fallback; Pi5 Linux uses `flock` when available.
- Observation: the gateway and slot Caddyfiles adapt successfully with the repository's Caddy image.
  Evidence: `docker run --rm -v <config>:/srv:ro caddy:2 caddy validate --config /srv/Caddyfile` returned `Valid configuration` for the HTTP gateway and slot templates; the TLS template passed `caddy adapt`.
- Observation: a local full Web image build could not reach the Dockerfile frontend resolver in the managed environment.
  Evidence: `docker build -f infrastructure/docker/Dockerfile.web ...` remained at `resolve image config for docker-image://docker.io/docker/dockerfile:1` and was canceled; the hosted `security-docker` CI job remains the authoritative full build check.

## Decision Log

- Decision: Keep Blue/Green opt-in and leave Phase 2/legacy deployment as the default.
  Rationale: the first gateway bootstrap changes the process owning ports 80/443 and must be accepted separately from code validation.
  Date/Author: 2026-07-11 / Codex
- Decision: Use one fixed gateway container plus four private slot containers on the existing Docker network. Only the gateway publishes host ports.
  Rationale: this gives an atomic routing boundary without requiring additional hardware or host port juggling.
  Date/Author: 2026-07-11 / Codex
- Decision: Reuse the existing named volumes and host paths for both API slots and the thumbnail/cert/log paths for both Web slots.
  Rationale: both slots must see the same database, files, certificates, and runtime configuration; destructive storage copies would be unsafe.
  Date/Author: 2026-07-11 / Codex
- Decision: Store state with an atomic JSON replacement and require the running image/slot identities to match before manual rollback.
  Rationale: stale state must not cause an operator to route traffic to an unknown container.
  Date/Author: 2026-07-11 / Codex
- Decision: Resource failure exits before starting any inactive container and prints the Phase 2 fallback command.
  Rationale: a single Pi5 cannot safely double the workload when it has less than 1.5 GB memory or 10 GB disk available.
  Date/Author: 2026-07-11 / Codex

## Outcomes & Retrospective

Repository implementation is complete: private API/Web slots, fixed gateway templates, external-network Compose, atomic state, resource gate, guarded switch/rollback/cleanup, monitor, tests, and operator documentation are present. Shell syntax, state-transition tests, Compose rendering, and Caddy adaptation passed. Production bootstrap, five-minute monitor acceptance, reboot restoration, and CI review remain separate rollout work because the first bootstrap changes the current process that owns ports 80/443.

## Context and Orientation

`infrastructure/docker/docker-compose.server.yml` is the existing production Compose definition for `db`, `api`, and `web`. It defines the database and all persistent storage. `infrastructure/docker/Dockerfile.web` builds the Web static site and Caddy binary. `scripts/deploy/pi5-image-deploy.sh` is the Phase 2 command that builds immutable API/Web images and performs a short maintenance-window replacement. This Phase 3 command is additive and does not modify the Phase 2 command's public interface.

Blue and Green are names for two identical application slots. At any moment one slot is active (receives public traffic) and the other is inactive (candidate or previous). The fixed gateway is Caddy running in its own container; it is the only container that binds host ports 80 and 443. The gateway configuration contains the active API and Web service names and is written to a temporary file followed by an atomic rename before Caddy reloads it.

## Plan of Work

First add `Caddyfile.slot.template` and `Caddyfile.gateway.template`, then extend `Dockerfile.web` so `GATEWAY_CONFIG_FILE` starts the fixed gateway and `SLOT_API_UPSTREAM` starts a private Web slot. Existing local, production, and HTTP-only branches remain unchanged.

Next add `infrastructure/docker/docker-compose.phase3.yml`. It defines `api-blue`, `api-green`, `web-blue`, `web-green`, and `gateway`, uses the candidate image variables from the Phase 2 state, joins the existing `docker_default` network, mounts the same persistent storage as the production API, and publishes ports only on `gateway`. The database remains the existing `docker-db-1` service and is never duplicated.

Then add `scripts/deploy/pi5-blue-green.sh`. `prepare` checks available memory, disk, and load average; resolves candidate images from explicit flags or the Phase 2 candidate state; starts the inactive API/Web pair; validates the API health endpoint, Web Caddy configuration, and read-only smoke path; and records the candidate. `switch` validates the inactive slot again, renders and reloads the gateway, runs external read-only smoke checks, records `activeSlot`, `candidateSlot`, image names, switch time, and a five-minute stability deadline, and starts a guarded monitor. The monitor rolls back to the previous slot if API health, the gateway, or the configured kiosk read-only endpoint fails. `rollback` is guarded by the state and live slot identity, and `cleanup` stops the old slot only after the stability deadline. `status` prints the complete state.

Finally add shell tests that stub Docker, curl, and resource probes; add the runbook explaining the explicit bootstrap risk; and link the runbook from the deployment guide and index. Do not enable Ansible or execute the first gateway bootstrap in this PR.

## Concrete Steps

From `/tmp/raspi-phase3`, implement the configuration and command, then run:

    bash -n scripts/deploy/pi5-blue-green.sh
    bash scripts/deploy/tests/test-pi5-blue-green.sh
    docker compose -f infrastructure/docker/docker-compose.phase3.yml config --quiet
    git diff --check

The test must print `PASS: pi5 blue/green deployment lifecycle`. Compose validation must exit with status 0 when the required image variables are supplied by the test environment or must fail with the documented missing-variable error when they are absent.

## Validation and Acceptance

Repository acceptance requires that the API and Web slot services have no `ports` entries, the gateway alone maps 80 and 443, and all four slots share the existing persistent volume/path definitions. A resource probe below any threshold must exit before a `docker compose up` call and print a Phase 2 fallback recommendation. A prepared candidate must set `candidateSlot` without changing `activeSlot`. A successful switch must write a new gateway configuration, report the new active slot, and retain the previous slot until `cleanup` is run after five minutes. A simulated health failure must invoke rollback and leave the previous slot active. State writes must remain valid JSON even when the command is interrupted between updates.

Production acceptance is a later, separately approved operation: bootstrap the fixed gateway during a maintenance window, verify external read-only API/Web requests, switch Blue to Green, observe five minutes, exercise rollback, and verify reboot restoration of the last active slot. Single-Pi5 gateway and host failure remain explicitly non-redundant.

## Idempotence and Recovery

Running `prepare` repeatedly for the same image is safe; it recreates only the inactive slot and never changes the gateway. Running `switch` when the candidate is already active exits after a health check. `rollback` refuses missing, stale, or mismatched state. `cleanup` refuses to stop the previous slot until `stableUntil` has passed. If the command is interrupted, `status` exposes the last atomic state and the operator can rerun `switch`, `rollback`, or the Phase 2 command without deleting volumes or images.

## Artifacts and Notes

The Phase 2 state file remains the source for candidate image tags when explicit `--api-image` and `--web-image` flags are not provided. The Phase 3 state file is separate so that a failed Blue/Green experiment cannot corrupt the Phase 2 rollback record.

## Interfaces and Dependencies

The operator interface is:

    scripts/deploy/pi5-blue-green.sh <status|prepare|switch|rollback|cleanup> [--api-image IMAGE --web-image IMAGE] [--force]

Defaults are `PI5_PROJECT_DIR=/opt/RaspberryPiSystem_002`, `PI5_PHASE3_COMPOSE=$PROJECT_DIR/infrastructure/docker/docker-compose.phase3.yml`, `PI5_BLUE_GREEN_STATE_FILE=$PROJECT_DIR/logs/deploy/pi5-blue-green-state.json`, `PI5_BLUE_GREEN_MIN_MEMORY_MB=1536`, `PI5_BLUE_GREEN_MIN_DISK_GB=10`, and `PI5_BLUE_GREEN_MAX_LOAD_AVG=4.0`. Optional `PI5_BLUE_GREEN_KIOSK_HEALTH_URL` and `PI5_BLUE_GREEN_ERROR_RATE_URL` extend the monitor's read-only checks; the latter accepts JSON `errorRate`/`error_rate` and defaults to a 0.05 maximum. The command depends on Docker Compose v2, `curl`, `python3`, and the Caddy binary already included in the Web image.

Revision note (2026-07-11): Created for the Phase 3 implementation. The first production gateway bootstrap is intentionally separated from this PR because the current Web container owns ports 80/443; code and tests must be green before that controlled cutover.
