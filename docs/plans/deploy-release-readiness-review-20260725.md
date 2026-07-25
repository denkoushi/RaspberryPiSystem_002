---
id: deploy-release-readiness-review-20260725
title: Build-aware deployment release-readiness review
status: in-progress
scope: canonical SSH rolling release before release-unit submission
date: 2026-07-25
source_of_truth: docs/plans/deploy-release-readiness-review-20260725.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/backends/systemd.py
  - scripts/deploy/rolling_release/route_contract.py
  - scripts/deploy/rolling_release/route_preflight.py
  - scripts/deploy/verify-phase12-real.sh
  - scripts/deploy/tests/test-verify-phase12-real.sh
  - scripts/ci/run-deploy-contracts-local.sh
  - scripts/deploy/tests/test_route_contract.py
  - scripts/deploy/tests/test_route_preflight.py
related_docs:
  - docs/guides/deployment.md
  - docs/runbooks/deploy-recovery.md
  - docs/plans/normal-ssh-deploy-gate-audit-20260722.md
validation: focused unit tests, full deploy contracts, CI, then production read-only preflight
open_items:
  - publish the Phase12 Blue/Green active-API verification follow-up and wait for required CI
---

# Add a Build-Aware Release-Readiness Review

This ExecPlan is a living document. The sections `Progress`,
`Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must
be kept up to date as work proceeds. This document is maintained according to
`.agent/PLANS.md`.

## Purpose / Big Picture

The normal deployment command already checks migrations, the Raspberry Pi 5
host, and selected terminals before it creates a release systemd unit. It did
not check the external TLS routes that a Docker image build needs. On
2026-07-25 that omission allowed three deployments to start and then stop
before production switching while Docker Hub, npm, or Prisma downloads
stalled.

After this change, a deployment that must build the server API or Web images
will first make bounded, read-only TLS handshakes from the Raspberry Pi 5 to
the external services named by the build contract. An unavailable build route
will appear with every other preflight problem in one structured report, and
the release unit will not be created. Deployments that do not build those
images will not pay for or be blocked by this probe. The report will also
publish a validated registry explaining every readiness gate's classification,
protected requirement, failure impact, observation, applicability, timeout,
recovery, and regression test.

## Progress

- [x] (2026-07-25 04:18Z) Confirmed that the candidate SHA
  `314fc43e3859b10730115525f8af56be2f8a50cc` is clean and its required CI run
  completed successfully.
- [x] (2026-07-25 04:18Z) Ran the existing production `--preflight-only`
  command for `raspberrypi5`; preflight
  `20260725-041836-ac685e` passed all 25 registered route stages without
  creating a release unit.
- [x] (2026-07-25 04:21Z) Audited the existing application, route contract,
  Pi5 route probe, Dockerfiles, and tests. Confirmed that the launch-time
  aggregate gate exists but external build dependency routes are absent.
- [x] (2026-07-25 04:35Z) Added and validated the machine-readable
  readiness-gate registry. The aggregate report includes all eight definitions
  and marks which gates apply to the current plan.
- [x] (2026-07-25 04:35Z) Passed the build requirement from the read-only
  target plan into the Pi5 route probe without changing `LaunchSpec` or the
  release bootstrap contract.
- [x] (2026-07-25 04:35Z) Added bounded TLS probes and structured, secret-free
  results for nine server-image build endpoints.
- [x] (2026-07-25 04:38Z) Ran 60 focused tests, all 841 deploy unit tests, the
  deploy safety contracts, the complete local deploy-contract suite, the
  documentation audit, Python compilation, and diff checks successfully.
- [x] (2026-07-25 07:37Z) Merged the reviewed implementation after required
  CI succeeded, then passed `--print-plan` and `--preflight-only` for immutable
  main SHA `e59db98c6218f7e3bf927589231a0ec13b0b0ac7`.
- [x] (2026-07-25 08:24Z) Completed standard Pi5-only deployment run
  `20260725-073820-042768`, verified exact API/Web release claims, health 200,
  and four later Gmail CSV schedules in `COMPLETED` state.
- [x] (2026-07-25 08:24Z) Corrected the post-deploy Phase12 verifier to inspect
  the single running Blue/Green API container, retain the legacy fallback, and
  fail closed if more than one active API is found. The focused contract,
  complete deploy-contract suite, and real Phase12 run passed
  `47 / 0 / 0`.
- [ ] Publish the Phase12 verifier follow-up and wait for required CI.

## Surprises & Discoveries

- Observation: the previously discussed release-readiness mechanism is partly
  present already. Normal `launch()` runs the same aggregate checks as
  `--preflight-only` immediately before `SystemdBackend.start()`.
  Evidence: `scripts/deploy/rolling_release/application.py` builds a read-only
  plan, runs migration, route, and terminal probes, and calls `start()` only
  when their aggregate outcome is zero.

- Observation: the 25-stage route inventory is detailed about ownership and
  recovery but not about why a gate is a blocker or when it applies.
  Evidence: `RouteStage` records owner, operation, proof, failure policy,
  recovery owner, and rehearsal, but has no classification, impact,
  applicability, or timeout fields.

- Observation: production preflight can pass while the image build route is
  unusable.
  Evidence: preflight `20260725-041836-ac685e` passed, while the three preceding
  release attempts had already demonstrated TLS failures to Docker Hub, npm,
  or Prisma during candidate creation.

- Observation: a local Git preparation failure can occur before the old
  aggregate report exists, which caused a diagnostic invocation to emit no
  JSON.
  Evidence: the first production `--preflight-only` attempt on 2026-07-25
  produced no parseable output; an immediate retry passed. Diagnostic mode now
  converts this boundary to one secret-free `incomplete` report with
  `releaseSubmitted: false`.

- Observation: the API and Web image builds use more than npm. Their
  Dockerfiles can contact Docker Hub, Debian repositories, npm, GitHub, PyPI,
  Prisma binary storage, Playwright browser storage, Alpine repositories, and
  the Go module proxy.
  Evidence: `infrastructure/docker/Dockerfile.api` and
  `infrastructure/docker/Dockerfile.web`.

- Observation: a real TLS trial from the development host completed all three
  rounds for all nine registered endpoints in about two seconds.
  Evidence: the success-count result was `3` for Docker auth, Docker registry,
  GitHub, Go proxy, npm, Playwright, Prisma, PyPI files, and PyPI index.

- Observation: the legacy Phase12 verifier still assumed the Compose service
  name `api`, although the canonical rolling release runs
  `bluegreen-api-blue-1` or `bluegreen-api-green-1`.
  Evidence: the first post-deploy run reported one migration FAIL and one
  scheduler-log WARN; direct inspection showed the active API healthy and all
  153 migrations current. Resolving the single running Blue/Green API made the
  same real check pass `47 / 0 / 0`.

## Decision Log

- Decision: extend the existing launch-time aggregate preflight instead of
  creating an independent deploy command or a reusable preflight receipt.
  Rationale: the existing check is already immediately adjacent to release
  submission and uses the exact SHA and target plan. A separate receipt would
  introduce freshness and ownership problems.
  Date/Author: 2026-07-25 / Codex.

- Decision: make external build connectivity a blocker only when the
  read-only plan classifies the release as `server-app` or `unknown`.
  Rationale: those classes can require an API or Web image build. A known
  `global` Ansible-only change does not satisfy the image-build condition in
  `infrastructure/ansible/roles/common/tasks/main.yml`; blocking it would
  recreate the false-positive problem this review is intended to prevent.
  Terminal-only, migration-only, and known Ansible-only releases are not
  blocked by unrelated public package services.
  Date/Author: 2026-07-25 / Codex.

- Decision: use TLS handshakes, not package downloads or authenticated API
  requests.
  Rationale: the incident was a TLS-connectivity failure. Handshakes are
  read-only, do not consume credentials, do not mutate caches, and can be
  bounded tightly. They prove route readiness rather than package existence.
  Date/Author: 2026-07-25 / Codex.

- Decision: probe each required endpoint concurrently for three rounds and
  require all three rounds to succeed.
  Rationale: the production network failure is intermittent. A single success
  would miss it, while sequential worst-case waits across all endpoints would
  make the gate unnecessarily slow. Three bounded rounds balance sensitivity
  and runtime.
  Date/Author: 2026-07-25 / Codex.

- Decision: do not add Gmail to the generic image-build blocker.
  Rationale: Gmail is a runtime dependency, not an image-build dependency, and
  an unrelated release must not be blocked by a temporary Gmail outage.
  Gmail health and the CSV scheduler will be verified as the incident-specific
  post-deploy acceptance.
  Date/Author: 2026-07-25 / Codex.

- Decision: preserve a single JSON result when `--preflight-only` fails before
  it can determine the candidate SHA.
  Rationale: this is diagnostic mode and creates no release unit. A stable
  `local.source-and-scope.incomplete` issue is more actionable and safer than
  exposing raw Git or SSH error output. Normal launch keeps its existing
  exception behavior and still stops before submission.
  Date/Author: 2026-07-25 / Codex.

- Decision: post-deploy checks select exactly one running Blue/Green API and
  fall back to the legacy Compose service only when no Blue/Green API exists.
  Rationale: accepting the first of multiple containers could verify the wrong
  slot during a release, while removing the legacy path would break older
  installations. Ambiguous discovery remains a hard verification failure.
  Date/Author: 2026-07-25 / Codex.

## Outcomes & Retrospective

The build-aware release-readiness review is deployed and production-validated.
The existing framework remains the sole deployment path, now with a version-2
route probe, eight reviewed gate definitions, per-run applicability, and
conditional three-round TLS evidence for nine build endpoints. The exact main
SHA passed required CI, read-only preflight, standard Blue/Green deployment,
release-claim verification, health checks, and Gmail scheduler acceptance.

The post-deploy Phase12 check exposed one separate legacy-name false negative.
Its minimal Blue/Green-aware fix passes the focused contract, the complete
deploy-contract suite, and real Phase12 `47 / 0 / 0`; publication and required
CI for that follow-up remain.

## Context and Orientation

The operator's only normal entry is `scripts/update-all-clients.sh`. It invokes
the Python rolling-release application in
`scripts/deploy/rolling_release/application.py`. A "preflight" is a read-only
set of checks performed before any release unit exists. A "release unit" is
the transient systemd service on the Raspberry Pi 5 that owns all later
deployment mutation and recovery.

`application.launch()` resolves an immutable Git SHA, validates inventory and
identity, and calls the read-only `build_print_plan()` function. The plan
contains `classificationComponents`; `server-app` means changed files can
require building the API or Web image. The application then asks
`SystemdBackend` to run three probes over SSH: production migration safety,
Raspberry Pi 5 route readiness, and selected-terminal readiness. It aggregates
their results in `_preflight_report()`. A non-zero result prevents
`SystemdBackend.start()`.

`scripts/deploy/rolling_release/route_preflight.py` is copied as source text
and executed with `/usr/bin/python3` on the Raspberry Pi 5. It uses only the
Python standard library and performs no checkout, build, playbook, service
change, or file write. This module is the correct owner for external route
checks because those routes are used from the same Pi5 during candidate image
creation.

`scripts/deploy/rolling_release/route_contract.py` is the machine-readable
inventory for all 25 deployment stages. This change adds a separate readiness
gate registry in that module. A route stage describes the complete execution
path; a readiness gate describes why a particular pre-submission observation
may block the path. Keeping the two concepts separate avoids pretending that
every execution stage is independently observable before submission.

## Plan of Work

First, add a frozen `ReadinessGate` record and `READINESS_GATES` registry to
`route_contract.py`. Each entry will name a stable issue code and provide the
classification (`safety`, `correctness`, or `warning`), the requirement it
protects, the operational impact of failure, how the fact is observed, when it
applies, its bounded timeout, its recovery action, and the regression test
that owns it. Validation will reject duplicate IDs, unsupported
classifications, empty explanations, blockers without timeouts, and missing
test ownership. The existing route-stage validation remains unchanged.

Second, change `SystemdBackend.build_route_preflight_command()` and
`preflight_route()` to accept a tuple of required external dependency IDs.
The JSON sent to the Pi5 becomes version 2 and accepts only known,
deduplicated IDs in deterministic order. `application.launch()` derives that
tuple from `planning_snapshot["classificationComponents"]`. Missing or
malformed classification is fail-closed and requests the build dependency
probe; a known terminal-only or migration-only classification requests none.
This does not alter `LaunchSpec`, the remote bootstrap, or the coordinator.

Third, add standard-library TLS probing to `route_preflight.py`. Each endpoint
is a hostname and port 443. The probe uses `socket.create_connection()` and
`ssl.create_default_context().wrap_socket()` with a short timeout. It sends no
HTTP request and records no exception text, IP address, certificate body, or
credentials. Endpoints in each of three rounds are checked concurrently with
`concurrent.futures.ThreadPoolExecutor`. A failed endpoint adds only its stable
issue code. The structured report includes successful round counts and
configured round count so the operator can distinguish intermittent failure
without exposing network details.

Fourth, add unit tests for schema rejection, applicability, aggregation,
intermittent TLS failure, total TLS failure, and gate-registry completeness.
Update application and systemd-backend tests so they prove `server-app`
requests the build probe, terminal-only work does not, and no release unit is
submitted when a required external route fails.

Finally, run local validation and required GitHub CI. After merge, run the
standard `--print-plan` and `--preflight-only` commands against production.
Only a passing exact-SHA report authorizes a normal deployment. Observe the
run through the standard `--status` command. If stopping becomes necessary,
use only the documented `--cancel` operation. Do not stop units, kill child
processes, or mutate production through direct SSH.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Run the focused tests while implementing:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
      scripts.deploy.tests.test_route_contract \
      scripts.deploy.tests.test_route_preflight \
      scripts.deploy.tests.test_systemd_backend \
      scripts.deploy.tests.test_release_application

Run the complete safety validation before publishing:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
      -s scripts/deploy/tests -p 'test_*.py' -q
    bash scripts/deploy/tests/test-deploy-safety-contracts.sh
    scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs
    git diff --check

After required CI succeeds for the merged SHA, perform read-only production
checks:

    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 \
      scripts/update-all-clients.sh main \
      infrastructure/ansible/inventory.yml \
      --limit raspberrypi5 --print-plan

    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 \
      scripts/update-all-clients.sh main \
      infrastructure/ansible/inventory.yml \
      --limit raspberrypi5 --preflight-only

The preflight JSON must contain the exact merged SHA, `status: "passed"`,
`releaseSubmitted: false`, the 25 route stages, a passed readiness review, and
three successful TLS rounds for every required build endpoint. Only then run
the same standard entry without `--preflight-only`.

## Validation and Acceptance

The implementation is accepted when all of the following behavior is
demonstrable.

A route payload with an unknown field, unknown dependency ID, duplicate
dependency, or unsafe type returns `incomplete` without running a network
probe. A `server-app` plan asks for all registered build endpoints. A
terminal-only plan asks for none. One failed TLS round for one required
endpoint returns `blocked` and the stable issue code for that endpoint while
preserving the results for every other probe. No raw exception, address,
response, or credential appears in the JSON.

The readiness registry validates at import and its test proves every gate has
a unique ID, supported classification, protected requirement, impact,
observation, applicability rule, timeout, recovery action, and existing
regression-test owner. The aggregate report includes this review and cannot
report `passed` if registry validation or a required external route fails.

In production, `--preflight-only` must pass at the exact merged SHA and must
not create a release unit. The subsequent standard deployment must reach a
durable success state. Gateway and API health must return HTTP 200. The
Gmail-import orchestrator must no longer remain locked by
`MeasuringInstrumentLoans`; at least one later CSV schedule must complete
instead of logging `Cycle skipped because previous cycle is running`.

## Idempotence and Recovery

All new readiness checks are read-only and safe to repeat. They open outbound
TLS sockets and close them without an HTTP request. They do not alter
repositories, Docker caches, services, Gmail state, or databases.

A blocked or incomplete preflight creates no release unit, so retry consists
of correcting the reported route and rerunning the same command. Once a real
release has started, inspect it with the standard `--status` command. If it
must stop, use only `--cancel` with a reason and then reconcile its durable
state. Production rollback remains owned by the existing Blue/Green
coordinator; this plan adds no direct rollback path.

## Artifacts and Notes

The baseline production preflight before implementation was:

    preflightId: 20260725-041836-ac685e
    sha: 314fc43e3859b10730115525f8af56be2f8a50cc
    status: passed
    releaseSubmitted: false
    routeCoverage: 25 stages
    diskFreeMb: 727438
    memoryAvailableMb: 4360

That success is evidence of the gap, not evidence that external build
connectivity was healthy.

## Interfaces and Dependencies

`scripts/deploy/rolling_release/route_contract.py` will expose:

    GateClassification = Literal["safety", "correctness", "warning"]

    @dataclass(frozen=True)
    class ReadinessGate:
        id: str
        classification: GateClassification
        protects: str
        failure_impact: str
        observation: str
        applicability: str
        timeout_seconds: int
        recovery: str
        regression_test: str

    READINESS_GATES: tuple[ReadinessGate, ...]
    validate_readiness_gates(...) -> None

`SystemdBackend.preflight_route()` will accept:

    preflight_route(
        spec: LaunchSpec,
        required_external_dependencies: tuple[str, ...] = (),
    ) -> CommandResult

The route preflight version-2 JSON adds:

    "requiredExternalDependencies": ["docker-auth", ...]

`route_preflight.execute()` will retain dependency injection for tests and add
a TLS probe callback. No third-party Python package is introduced.

Revision note (2026-07-25): Created after the post-incident audit showed that
the canonical aggregate preflight did not observe external image-build
dependencies. The plan deliberately extends the existing launch-time gate
rather than creating a second deployment path.

Revision note (2026-07-25 08:24Z): Recorded exact-SHA preflight, production
deployment, Gmail circulation acceptance, and the Blue/Green-aware Phase12
verification follow-up discovered during post-deploy validation.
