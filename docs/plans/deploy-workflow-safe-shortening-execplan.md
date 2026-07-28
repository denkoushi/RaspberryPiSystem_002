---
id: plan-deploy-workflow-safe-shortening
title: Shorten deployment lead time without relaxing release safety
status: implemented
date: 2026-07-28
source_of_truth: true
scope: change-aware CI, precise Pi5 Web ownership, reusable build caches, and isolated deployment-contract validation
related_docs:
  - ../decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - ../decisions/ADR-20260726-deploy-readiness-policy-engine.md
  - ../decisions/ADR-20260728-change-aware-main-ci-and-server-web-ownership.md
  - ./deployment-foundation-refactor-execplan.md
  - ./deploy-speed-optimization-execplan.md
related_code:
  - scripts/ci/
  - scripts/deploy/terminal-profile-registry.json
  - infrastructure/ansible/group_vars/
  - infrastructure/docker/Dockerfile.web
validation:
  - CI and deployment-classifier unit contracts
  - complete local deployment contract with disposable PostgreSQL
  - final Web image and Caddy validation
  - required hosted CI on the exact pull-request head
open_items:
  - production rollout and real-device timing require separate explicit approval
---

# Shorten deployment lead time without relaxing release safety

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

The standard deployment is safe but performs work outside the actual impact of
some changes. The 2026-07-28 Kiosk SOP delivery took about 91 minutes from
implementation start to a green Draft PR and 47 minutes 25 seconds for the
canonical production rollout. Hosted CI ran the same cumulative feature diff
twice (7 minutes 15 seconds and 9 minutes 24 seconds), the production-enablement
head took 8 minutes 7 seconds, its exact main merge took 8 minutes 31 seconds,
and a documentation-only evidence merge still took 9 minutes 8 seconds.

The production rollout also treated Pi5 Web configuration as `global` or
`unknown`, so it safely widened from Pi5 and Kiosk Web consumers to all six Pi4
Kiosks plus the Pi3 Signage terminal. The typed release-claim architecture
already knows how to mutate Pi5, activate Kiosk browsers without terminal
Ansible, and exclude Signage. This change makes the source ownership precise
enough for that existing path to be selected.

The observable outcome is:

- main push CI uses an exact `before -> head` diff when that history is safe;
- documentation-only changes retain required checks without API, DB, E2E,
  Docker-image, or CodeQL analysis work;
- Pi5 Web build configuration targets Pi5 plus Kiosk activation and
  verification, never Signage or terminal mutation;
- Caddy compilation reuses local BuildKit module and build caches; and
- deployment-contract PostgreSQL validation remains isolated, complete, and
  self-cleaning.

This work does not shorten the 60-second Kiosk notice, the human canary gate,
terminal serialization, the Pi5 five-minute stability monitor, rollback,
immutable image pairing, migration verification, or same-SHA proof.

## Progress

- [x] (2026-07-28) Audited the current CI workflows, change classifiers,
  terminal registry, typed target planner, terminal coordinator, Pi5 candidate
  builder, Dockerfiles, Ansible variable ownership, and prior rollout evidence.
- [x] (2026-07-28) Confirmed clean `main` at
  `eb6f69c5d4a8a8c8f819299a864769b6cfe7c9e4` and created
  `perf/deploy-workflow-safe-shortening`.
- [x] (2026-07-28 16:05+09:00) Added one reusable event classifier and
  fail-closed push ancestry rules.
- [x] (2026-07-28 16:05+09:00) Split API/Web Docker-security selection while preserving the fixed
  `ci-required`, `codeql`, and `gitleaks` checks.
- [x] (2026-07-28 16:06+09:00) Moved Pi5 Web build variables to server-owned
  group vars and proved the allowlisted effective values are unchanged.
- [x] (2026-07-28 16:07+09:00) Registered precise server-owned paths and proved Web-only target
  architecture excludes Signage and terminal mutation.
- [x] (2026-07-28 16:21+09:00) Added persistent Caddy Go caches without changing the Caddy binary
  contract.
- [x] (2026-07-28 15:50+09:00) Strengthened disposable PostgreSQL
  random-loopback-port, migration-ledger, and cleanup evidence.
- [x] (2026-07-28 16:36+09:00) Completed final-source CI, deployment, Ansible,
  PostgreSQL, Docker image, Caddy, provenance, bundle, and cleanup validation.
- [x] (2026-07-28 16:25+09:00) Updated the ADR, guides, indexes, and generated
  documentation inventory.
- [ ] Commit once, push once, open one Draft PR, and record exact-head required
  checks in the PR body without a follow-up evidence commit.

## Surprises & Discoveries

- Observation: `collect_changed_files.py` already implements push
  `before -> head` collection, but `ci.yml` unconditionally forces every
  non-pull-request event to the full suite.
  Evidence: the workflow sets `force_full_reason` whenever
  `EVENT_NAME != pull_request`.

- Observation: CodeQL is a separate fixed required workflow and currently
  analyzes JavaScript/TypeScript even for documentation-only changes.
  Evidence: `codeql.yml` has one unconditional `codeql` job.

- Observation: the deployment registry already maps `apps/web/` to
  `server-app`, and the planner already turns a changed Pi5 Web claim into
  Kiosk activation without terminal mutation.
  Evidence: registry schema 4 and the Web-only target-architecture regression
  in `test_rolling_release.py`.

- Observation: the SOP production flag was stored inside the mixed production
  inventory, while its two Ansible templates had no deploy-impact mapping.
  Evidence: the historical feature diff classified as
  `global + unknown + server-app` and affected both Kiosk and Signage.

- Observation: the disposable deploy-status PostgreSQL test uses unique
  resource names and cleanup traps but defaults to fixed host port 55439.
  Evidence: `test-deploy-status-postgres.sh`.

- Observation: Docker is running on the Mac, no containers exist, the
  `pgvector/pgvector:pg15` image is already present, and unrelated named
  volumes exist.
  Evidence: read-only Docker inventory before implementation. Those volumes
  are outside this plan and must not be modified.

- Observation: forcing the complete Caddy stage with
  `--no-cache-filter caddy-build` re-ran package installation and emitted Go
  downloads, so it was not a valid positive cache-reuse test in this Docker
  Desktop environment.
  Evidence: the forced validation was stopped before producing an image. A
  normal same-source rebuild then reported the Caddy `go build` step as
  `CACHED` and completed in 7.68 seconds after the initial 1,406-second build.

## Decision Log

- Decision: keep event-to-diff resolution in one pure reusable CI module.
  Rationale: CI and CodeQL must make the same fail-closed decision without
  duplicating GitHub workflow shell branches.
  Date/Author: 2026-07-28 / Codex.

- Decision: path-select only pull-request and safe main-push events.
  Rationale: both expose a stable history boundary. Merge-group, manual, and
  scheduled events remain full because they have different trust and
  coverage purposes.
  Date/Author: 2026-07-28 / Codex.

- Decision: move only Pi5 Web build variables out of the mixed inventory.
  Rationale: general inventory edits can change fleet topology and must remain
  global, while a dedicated server-owned file gives future Web flag changes a
  precise, scalable owner. TalkPlaza keeps explicit `false` host overrides for
  the three flags that previously used template defaults, so the shared
  server group does not enable second-factory features implicitly.
  Date/Author: 2026-07-28 / Codex.

- Decision: preserve API/Web candidate pairing and terminal serialization.
  Rationale: component-specific image identities and parallel terminal state
  transitions would change rollback and evidence contracts and belong to a
  separately approved phase.
  Date/Author: 2026-07-28 / Codex.

- Decision: record hosted results in the Draft PR body instead of a tracked
  post-CI evidence commit.
  Rationale: a documentation-only commit after green CI makes GitHub re-run
  the cumulative PR diff at a new head.
  Date/Author: 2026-07-28 / Codex.

- Decision: emit the Docker image matrix from the pure classifier instead of
  encoding selection branches in workflow YAML.
  Rationale: the classifier owns path meaning and can unit-test API-only,
  Web-only, both-image, and fail-closed results; the workflow only executes
  the typed result.
  Date/Author: 2026-07-28 / Codex.

## Outcomes & Retrospective

Phase 1 is implemented and locally validated. Main-push CI can now use a safe
exact diff, CodeQL can retain its required check while skipping proven
non-code changes, and Docker security can select API and Web separately.
Pi5 Web build inputs have one server-owned source with unchanged effective
values. The deployment fixture produces Pi5-only mutation, six Kiosk
activations/verifications with `mutationRequired: false`, and no Signage
work.

The complete deployment contract passed twice, including once after the
TalkPlaza inheritance safeguard was added, against random-port disposable
PostgreSQL databases and removed every run-owned Docker resource. The final
Web image passed Caddy, provenance, and SOP bundle checks. The first build
took 1,406 seconds while a normal identical rebuild took 7.68 seconds with
all Caddy layers cached. Required hosted checks remain the final publication
gate and will be recorded in the Draft PR body. Production merge, deployment,
and device access remain unauthorized.

## Context and Orientation

`.github/workflows/ci.yml` owns conditional hosted jobs and the fixed
`ci-required` aggregate. `scripts/ci/collect_changed_files.py` owns Git
name-status collection, and `scripts/ci/classify_changes.py` is the pure
path-to-job classifier.

`scripts/deploy/terminal-profile-registry.json` is the data-only source for
repository path ownership. `classify-deploy-impact.py` converts its components
to Pi5 and terminal-profile impact. The typed planner then derives ordered
mutation, activation, and verification work from release claims.

`infrastructure/ansible/inventory.yml` contains server API settings and the
complete terminal topology. Pi5 Web build values now live in
`infrastructure/ansible/group_vars/server/web-build.yml`; Ansible
automatically loads that directory for the server inventory group. Explicit
TalkPlaza host overrides retain its pre-move feature defaults.

`infrastructure/docker/Dockerfile.web` builds the Web bundle and a custom
pinned Caddy binary. The pnpm store, Caddy Go module directory, and Caddy Go
compiler cache now use persistent BuildKit cache mounts.

## Plan of Work

Implement a pure event classifier around the existing collector and path
classifier. It accepts event name, base SHA, and head SHA, returns the complete
classification, and forces full coverage when a stable event policy or
ancestor relationship cannot be proved. Both CI and CodeQL consume it.

Extend the classification result with `codeql`, `docker_api`, and
`docker_web`. Keep the fixed aggregate check, but split API and Web image
security work so an unselected image is not built. CodeQL retains the fixed
job name and reports success without initializing the analyzer only when the
shared classifier proves there is no analyzable JavaScript/TypeScript impact.

Move the existing explicit Pi5 Web values into
`group_vars/server/web-build.yml`. Add ordered exact registry mappings for
that file and other unambiguous Pi5 server assets before broad Ansible rules.
General inventories, shared roles, broad playbooks, deleted/renamed paths, and
unknown files remain fail-closed.

Add BuildKit cache mounts around Caddy `go build`, keeping every module,
replacement, build flag, process priority, and final validation unchanged.

Update the disposable PostgreSQL test to request a random loopback port by
default, assert the complete migration ledger, retain the existing indexed
`EXPLAIN (ANALYZE, BUFFERS)`, and prove exact resource cleanup on both success
and failure.

## Concrete Steps

During implementation, run focused CI and deployment classifier tests. Before
the single push, run exactly one complete deployment contract:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Build the final Web Dockerfile under a unique validation tag, inspect its
provenance labels, validate all bundled Caddy configurations, and repeat the
same-source build to observe cache reuse. Remove only the validation
container/image tags; never prune shared BuildKit cache.

Stage only the reviewed files, create terse commits locally, and push the
branch once. Open one Draft PR against `main`. Because this change modifies
workflow and classifier policy, the first PR deliberately runs the full suite.
Do not add a tracked CI-outcome commit after it passes.

## Validation and Acceptance

Pure tests must prove:

- pull requests use merge base;
- safe main pushes use exact before/head ancestry;
- missing, zero, unavailable, or non-ancestor push bases force full coverage;
- merge-group, manual, and scheduled events remain full;
- rename, delete, unsupported status, and unknown paths remain full;
- docs-only selects repository policy, keeps gitleaks externally, and skips
  CodeQL analysis;
- Pi5 Web config selects Web, deploy-contract, and Web Docker security but not
  API, DB infra, client, E2E, or API Docker security; and
- broad Docker/global paths still select both images and the full suite.

Deployment tests must prove a Pi5 Web configuration change produces:

- Pi5 as the only mutation target;
- all in-scope Kiosks as activation and verification targets;
- no Kiosk terminal mutation;
- no Signage target; and
- the existing notice, canary, five-minute monitor, rollback, and no-op
  contracts unchanged.

Ansible validation must compare the allowlisted Pi5 Web variable values before
and after the move and render both production inventories successfully.

The disposable PostgreSQL run must generate Prisma, apply all migrations,
report status current, find zero incomplete or rolled-back migration rows,
execute the indexed `ClientDevice.apiKey` EXPLAIN, pass the deploy-status API
tests, and leave no run-owned container, volume, or network.

## Idempotence and Recovery

Classifiers and registry evaluation are pure. A missing fact always widens
work rather than narrowing it. Re-running local tests is safe.

Disposable Docker resources use exact UUID-bound names and the
`com.raspi-system.temporary=true` label. Cleanup addresses only those exact
names. Existing containers, volumes, networks, images, BuildKit cache, and
databases are never fallback targets.

If variable equivalence, target architecture, required CI, image validation,
or cleanup proof fails, stop on the feature branch. Do not merge, deploy,
connect to hardware, edit release state, or weaken a safety gate.

## Artifacts and Notes

The Pi5 Web variable allowlist was identical before and after the move:

    web_api_base_url=/api
    web_ws_base_url=/ws
    web_agent_ws_url={{ websocket_agent_url }}
    web_agent_ws_mode=local
    web_kiosk_due_mgmt_layout_v2_enabled=true
    web_kiosk_sop_popup_enabled=true
    web_kiosk_production_schedule_order_split_enabled=false

TalkPlaza retains `/api`, `/ws`, and local agent mode, while the due-management
layout, SOP popup, and production-order split flags resolve to `false`, matching
their pre-move template behavior.

Focused CI tests passed 32 tests. Focused Ansible/classifier/planner tests
passed 71 tests. The canonical deployment-contract runner passed 100 Jinja
templates, 868 deployment tests, 24 inventory/profile tests, all Ansible
syntax/check cases, and the isolated PostgreSQL integration.

The final PostgreSQL run used host port 52709, applied all 156 migrations,
reported zero incomplete or rolled-back migration rows, passed 20 API tests,
and used `ClientDevice_apiKey_key` for the requested lookup. Cleanup reported
zero run-owned containers, volumes, and networks. The preceding complete run
used port 52562 and recorded EXPLAIN execution time of 0.015 ms with the same
index and cleanup result.

The final Web image had revision
`1111111111111111111111111111111111111111`, configuration hash
`2222222222222222222222222222222222222222222222222222222222222222`,
and image ID
`sha256:77f6a9c4bc112e184ac19a7b0154369fa26243222fc02be489adb0b7849c6c34`.
HTTP, local TLS, maintenance HTTP/local/production Caddy configurations and
the `inspectionDrawingSop` bundle were present and valid. The validation tag
was deleted; shared BuildKit cache was deliberately retained.

## Interfaces and Dependencies

No HTTP API, shared DTO, Prisma model, migration, existing route, production
entry point, release-state schema, or terminal protocol changes.

The CI classifier adds stable boolean outputs `codeql`, `docker_api`, and
`docker_web`, plus a JSON `docker_matrix` derived from those booleans. The
event wrapper depends only on Git and the existing pure classifier. The
deployment registry reuses the existing `server-app` component. The new
server group-vars file contains only existing non-secret Web build values.

## Revision Note

2026-07-28: Updated the living plan after implementation and local validation
to record exact classifier ownership, Ansible equivalence, deployment target
proof, isolated database evidence, Docker cache measurements, cleanup, and the
remaining Draft-PR hosted-CI gate.
