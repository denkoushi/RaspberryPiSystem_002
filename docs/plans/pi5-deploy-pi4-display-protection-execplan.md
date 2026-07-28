---
id: pi5-deploy-pi4-display-protection
title: Protect Pi4 display responsiveness during Pi5 releases
status: in-progress
date: 2026-07-28
scope: Pi5 candidate build and Blue/Green stability monitoring
source_of_truth: this plan
related_code:
  - infrastructure/docker/Dockerfile.api
  - infrastructure/docker/Dockerfile.web
  - infrastructure/docker/docker-compose.server.yml
  - infrastructure/docker/docker-compose.phase3.yml
  - scripts/deploy/pi5-image-deploy.sh
  - scripts/deploy/pi5-blue-green.sh
validation:
  - scripts/deploy/tests/test-pi5-image-deploy.sh
  - scripts/deploy/tests/test-pi5-blue-green.sh
  - scripts/ci/run-deploy-contracts-local.sh
open_items:
  - production validation through the canonical rolling release after explicit approval
---

# Protect Pi4 display responsiveness during Pi5 releases

This ExecPlan is a living document and must be maintained in accordance with
`.agent/PLANS.md`. The `Progress`, `Surprises & Discoveries`, `Decision Log`,
and `Outcomes & Retrospective` sections must remain current.

## Purpose / Big Picture

Pi4 kiosks obtain their data from the API running on Pi5. A Pi5 release must
therefore prepare and verify the next release without making an otherwise
healthy Pi4 screen feel slow. After this change, candidate compilation yields
CPU time to the live database and API, while the five-minute Blue/Green safety
window keeps its two-second runtime checks without repeatedly launching an
unchanged Caddy configuration validator.

The user-visible acceptance is that a normal Pi5 release completes with the
existing rollback and five-minute stability guarantees, while the recorded
health probe has no timeout and Pi4 display interaction does not visibly stall.

## Progress

- [x] (2026-07-28 08:35+09:00) Reviewed seven production Pi5 performance summaries and their two timeout samples.
- [x] (2026-07-28 08:45+09:00) Confirmed that the traffic switch itself was consistently fast and error-free.
- [x] (2026-07-28 08:55+09:00) Added low-priority, bounded-parallel candidate compilation and production-serving CPU weights.
- [x] (2026-07-28 08:58+09:00) Amortized immutable stability checks while retaining two-second runtime and public-path checks.
- [x] (2026-07-28 08:59+09:00) Passed the focused candidate-image and Blue/Green lifecycle tests.
- [x] (2026-07-28 09:04+09:00) Passed the complete local deployment contract, including 864 Python tests, isolated PostgreSQL integration, deployment safety contracts, inventory/profile checks, and Ansible syntax checks.
- [ ] Publish and production-validate only after the user explicitly approves the immutable SHA and target plan.

## Surprises & Discoveries

- Observation: The Blue/Green traffic switch is not the main delay source.
  Evidence: Across seven runs its p95 was 73–125 ms, its maximum was also
  73–125 ms, and it produced no communication error.

- Observation: Candidate preparation creates intermittent rather than
  continuous latency.
  Evidence: Candidate-build medians stayed at 57–61 ms, but individual samples
  reached 619–2,417 ms and one two-second timeout occurred.

- Observation: The five-minute monitor was doing expensive immutable work on
  every two-second sample.
  Evidence: `monitor_checks` called `slot_ready`, which ran Caddy validation and
  full image/runtime configuration proof each time. Production journal output
  showed repeated Caddy validator startup and shutdown. Monitor p95 was
  130–200 ms, individual samples reached 376–2,092 ms, and one timeout occurred.

- Observation: CPU and I/O pressure counters are unavailable on this Pi5
  kernel, but load and memory evidence remains available.
  Evidence: `/proc/pressure/cpu` and `/proc/pressure/io` do not exist on the
  production host; all seven summaries still contain load and available-memory
  samples.

## Decision Log

- Decision: Protect the shared Pi5 service instead of adding another Pi4-only
  measurement phase before mitigation.
  Rationale: Seven releases already show repeated contention on the common
  server path, and the user's requested outcome is responsive Pi4 displays,
  not additional telemetry.
  Date/Author: 2026-07-28 / Codex.

- Decision: Use process niceness plus single-worker Go-based compilation,
  rather than a new BuildKit daemon or builder.
  Rationale: The repository's existing Compose build route, immutable context,
  cache, retry budget, and image provenance remain unchanged. A dedicated
  builder would add a new durable runtime and compatibility boundary.
  Date/Author: 2026-07-28 / Codex.

- Decision: Give live API containers a relative CPU weight but no hard CPU
  reservation.
  Rationale: The API wins during contention, while idle CPU remains available
  to other workloads and normal runtime behavior is not capped.
  Date/Author: 2026-07-28 / Codex.

- Decision: Keep scheduler/database/public-path checks every two seconds, and
  run immutable structure proof every 15 samples plus the final sample.
  Rationale: Runtime failure and rollback signals retain their existing
  two-second cadence. Revalidating unchanged image, Compose environment, and
  Caddy syntax every 30 seconds is sufficient to detect drift before success
  while removing roughly 90 percent of validator process launches.
  Date/Author: 2026-07-28 / Codex.

## Outcomes & Retrospective

The local implementation now addresses both repeated contention regions found
in production evidence. Candidate TypeScript, Vite/esbuild, Prisma generation,
and Caddy compilation run at niceness 10. Vite/esbuild and Caddy Go work use one
Go worker, so the independent Web and Caddy stages cannot each consume every
Pi5 core. The production DB/API/Web and Blue/Green gateway definitions carry
higher relative CPU weights.

The five-minute hold is still 300 seconds. Every two seconds it proves the
active and rollback schedulers, database connectivity, and public API/Web
path. Full image/runtime/Caddy structure is proved on the first sample, every
30 seconds, and the final sample. Focused local safety tests, Docker build
checks, the complete local deployment contract, and `git diff --check` all
pass. A later explicitly approved production release remains open; until then,
the improvement in Pi4 display responsiveness is not yet proven on hardware.

## Context and Orientation

`scripts/update-all-clients.sh` is the only production release entry.
`scripts/deploy/pi5-image-deploy.sh` prepares immutable API and Web images while
the current Pi5 API remains public. `infrastructure/docker/Dockerfile.api` and
`Dockerfile.web` contain the CPU-intensive compile steps.

`scripts/deploy/pi5-blue-green.sh` starts the inactive slot, switches the fixed
gateway, and observes both slots for five minutes. A runtime check proves that
the APIs, database connection, scheduler roles, and public routes work. A
structural check additionally proves immutable image identity, effective
Compose environment, and Caddy configuration. Structural state changes only
through an external mutation, so it need not launch a validator every two
seconds.

Docker `cpu_shares` is a relative weight used only when containers compete for
CPU. It does not reserve CPU and does not prevent another container from using
idle capacity. Linux `nice -n 10` lowers the priority of the build process
relative to the live processes.

## Plan of Work

In both Dockerfiles, apply niceness only to compile and code-generation layers,
leaving the existing dependency cache and immutable provenance layout intact.
Set `GOMAXPROCS=1` for Vite's Go-based helper and Caddy compilation, and use
`go build -p 1` for Caddy package compilation.

In the server and Phase 3 Compose definitions, assign the database and API a
weight of 4096 and request-serving Web/gateway containers a weight of 2048.
Do not add hard CPU or memory limits to production services.

In `pi5-blue-green.sh`, retain `MONITOR_INTERVAL=2` and `STABLE_SECONDS=300`.
Add a fixed production structural cadence of 15 monitor samples. On ordinary
samples call scheduler readiness for both slots and the public smoke test. On
the first, periodic structural, and forced final samples call the existing full
readiness functions. Any failure continues to persist switchback-required
evidence for the coordinator; the executor does not decide rollback itself.

## Concrete Steps

Work from the repository root:

    cd /Users/tsudatakashi/RaspberryPiSystem_002

Run the focused contracts:

    bash scripts/deploy/tests/test-pi5-image-deploy.sh
    bash scripts/deploy/tests/test-pi5-blue-green.sh

Expected terminal lines include:

    PASS: pi5 image deployment lifecycle
    PASS: pi5 blue/green safety lifecycle

Run the complete deployment contract:

    scripts/ci/run-deploy-contracts-local.sh

Before any production action, ensure the work is committed, the immutable SHA
has successful required CI, the worktree is clean, and show the canonical plan:

    RASPI_SERVER_HOST=<approved-host> \
      scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml \
      --print-plan

Do not execute that production command without explicit user approval.

## Validation and Acceptance

Local acceptance requires both focused lifecycle tests, the deployment safety
contract, and `scripts/ci/run-deploy-contracts-local.sh` to pass. The tests must
prove the exact CPU weights, low-priority compiler commands, two-second
runtime-check path, 30-second structural path, and forced final structural
sample.

Production acceptance requires a normal approved release. The release must
finish successfully, leave Pi5 stable, and produce no performance-probe
timeout. Compare candidate-build and stability-monitor p95/max values with the
seven-run evidence above. A human should also confirm that a Pi4 screen remains
responsive during candidate build and the five-minute stability window.

## Idempotence and Recovery

All changes are declarative or process-local. Rebuilding the same immutable
candidate remains cacheable and preserves the current retry and timeout
budgets. CPU shares are reapplied by Compose whenever a slot is created and do
not require manual cleanup. If a release check fails, the existing coordinator
keeps evidence unknown and uses the existing Blue/Green switchback or sealed
rollback path. Do not edit run state, locks, Compose containers, or fleet state
manually.

## Artifacts and Notes

The production evidence consists of seven summaries under
`logs/deploy/release-runs/*.pi5-performance-summary.json` on Pi5. Across those
runs, only two timeout samples occurred: one during candidate build at load
5.09 and one during stability monitoring at load 4.20.

## Interfaces and Dependencies

No public API, database schema, terminal protocol, release state schema, or
inventory contract changes. The implementation uses existing Docker Compose
`cpu_shares`, Linux process niceness, Go runtime parallelism, and the existing
Blue/Green readiness functions.

Revision note (2026-07-28): Created after seven production samples showed that
candidate contention and repeated structural monitoring, rather than the
traffic switch, were the actionable shared-server causes.
