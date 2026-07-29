---
id: plan-deploy-workflow-artifact-promotion
title: Promote attested ARM64 release images without weakening deployment safety
status: in_progress
date: 2026-07-28
source_of_truth: true
scope: GitHub-built ARM64 API/Web release pairs, attested promotion, and safe Pi5 fallback
related_docs:
  - ../decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - ../decisions/ADR-20260728-change-aware-main-ci-and-server-web-ownership.md
  - ../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md
  - ./deploy-workflow-safe-shortening-execplan.md
  - ./deploy-artifact-timeout-canary-handoff-execplan.md
  - ../guides/deployment.md
related_code:
  - .github/workflows/ci.yml
  - scripts/ci/
  - scripts/deploy/pi5-image-deploy.sh
  - scripts/deploy/rolling_release/backends/pi5.py
  - infrastructure/ansible/roles/server/
validation:
  - pure build-contract and release-set tests
  - deployment classifier and workflow contract tests
  - complete local deployment contract with disposable PostgreSQL
  - ARM64 Docker promotion exercise in an isolated local registry
open_items:
  - terminal production evidence is recorded only after the explicitly approved rollout
---

# Promote attested ARM64 release images without weakening deployment safety

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. Maintain this document in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

The safe rolling deployment currently rebuilds the API and Web Docker images
on the Raspberry Pi 5 after the exact main commit and production Web settings
have been selected. The first production run after Phase 1 spent about fifteen
minutes in that candidate-image build. GitHub CI also builds Docker images, but
those images are x86-64, stay inside the hosted runner, and carry dummy release
metadata, so the production workflow correctly refuses to reuse them.

After this change, a successful main CI run can publish one inseparable pair of
ARM64 API and Web images. A signed release-set document binds both immutable
registry digests to the exact main Git SHA, effective non-secret build
configuration hash, Linux ARM64 platform, and trusted CI workflow. The Pi5
verifies that contract before pulling either image and then runs the existing
API health, Caddy, load, resource, Blue/Green, rollback, and stability checks.
If a usable release set is simply unavailable, the existing local Pi5 build is
still used. If a purported release set fails an integrity check, the release
stops instead of masking the failure with a fallback.

The observable result is that a future explicitly approved production rollout
records candidate build mode `promoted` and avoids the on-device Docker build,
while the sixty-second notice, human canary, serialized terminal handling,
five-minute Pi5 stability monitor, rollback authority, and same-SHA no-op proof
remain unchanged.

## Progress

- [x] (2026-07-28 18:05+09:00) Audited the Phase 1 plan and ADR, CI change
  classifier, Docker security workflow, API and Web Dockerfiles, Ansible Web
  build ownership, Pi5 candidate builder, candidate state, resource evidence,
  Blue/Green backend, readiness probe, and server configuration rollback
  manifest.
- [x] (2026-07-28 18:08+09:00) Confirmed clean current `main` at
  `942b5c967e4c2d8c2f7807d0b60a1757ad9bdde1` and created the isolated branch
  `perf/deploy-workflow-artifact-promotion`.
- [x] (2026-07-28 20:05+09:00) Implemented and tested one pure non-secret
  build-contract module and one strict API/Web release-set module.
- [x] (2026-07-28 20:45+09:00) Added change-aware native ARM64 API/Web
  publication, exact-digest scanning, fixed-check gating, and three GitHub
  attestations without changing required check names.
- [x] (2026-07-28 21:10+09:00) Added strict Pi5 release-set verification,
  run-scoped registry authentication, exact-digest pulls, and the existing
  local-build fallback.
- [x] (2026-07-28 21:20+09:00) Extended candidate evidence and server rollback
  contracts compatibly; production opt-in remains false.
- [x] (2026-07-28 22:45+09:00) Completed local unit, ARM64 Docker, disposable
  PostgreSQL, Ansible, shell lifecycle, and cleanup validation. Hosted CI
  remains the publication gate for the Draft PR.
- [x] (2026-07-29 06:37+09:00) Merged the implementation and follow-up
  exact-digest scan and transitive release-gate fixes through PRs #1114,
  #1115, and #1116. Exact main SHA `e873cda4cca16bb7a33f1777912af457709d064b`
  published and attested one valid ARM64 release set.
- [x] (2026-07-29 06:44+09:00) Received explicit production-deployment
  approval. Verified the public release set and both images end to end with the
  production promoter and no real credential, then removed every validation
  image and container.
- [x] (2026-07-29 07:18+09:00) The first production run
  `20260728-221507-e5823b` stopped before candidate preparation because the
  root-owned mode-0600 promotion policy was unreadable by the release runner.
  No traffic, terminal, or database change occurred. Kept root ownership and
  narrowed group-read access to the trusted release runner instead of
  weakening the policy for all local users.
- [x] (2026-07-29 07:47+09:00) Validated the access correction with 18 focused
  tests, 42 CI policy tests, 892 orchestrator tests, all 156 disposable
  PostgreSQL migrations, 20 deploy-status tests, 24 inventory tests, 102
  Ansible templates, syntax checks, lint, document audit, and zero remaining
  run-owned container, volume, or network resources.
- [x] (2026-07-29 08:28+09:00) Merged the access correction through PR #1118
  and deployed exact main SHA
  `e320eb77fb3bc3c8e32f5bffbb156e74a99ad8ea`. Run
  `20260728-230421-7f27db` completed Pi5 Blue/Green stability and all six
  serialized Pi4 activation checks; Pi3 remained excluded and the same-SHA
  plan returned no targets.
- [x] (2026-07-29 08:40+09:00) Replaced the insufficient Debian `gh` package
  selection with official GitHub CLI 2.96.0 for Linux ARM64, pinned its
  published SHA-256, and added an Ansible capability probe for all four
  attestation-policy flags. The exact package checksum and executable
  interface passed in an isolated ARM64 container.
- [x] (2026-07-29 08:42+09:00) Passed 18 focused tests, 42 CI policy tests,
  892 orchestrator tests, all 156 disposable PostgreSQL migrations, 20
  deploy-status tests, 24 inventory tests, 102 Ansible templates, syntax
  checks, document audit, and zero run-owned database resources.
- [x] (2026-07-29 08:58+09:00) Merged the pinned-verifier correction through
  PR #1119. Production run `20260728-235649-158f9e` then stopped safely during
  server configuration because that fact-less playbook did not define
  `ansible_architecture`; rollback restored the four-file configuration
  manifest before candidate preparation, traffic switch, database work, or
  terminal activation.
- [x] (2026-07-29 09:13+09:00) Replaced the unavailable global Ansible fact
  with a local read-only `dpkg --print-architecture` probe through PR #1120.
  Hosted CI and the exact-main release set succeeded.
- [x] (2026-07-29 09:28+09:00) Production run
  `20260729-001448-8a9011` safely used the local fallback, switched Pi5, and
  passed the unchanged five-minute stability monitor. The fallback exposed a
  build-contract drift before terminal activation: CI rendered the configured
  agent URL while Pi5 Compose silently used its localhost default.
- [x] (2026-07-29 13:12+09:00) Diagnosed the Assembly-01 NFC regression without
  mutating the terminal. The reader and local agent were healthy and queued
  scans, while the compiled Web bundle lacked the server-owned
  `VITE_AGENT_WS_MODE=local` value and therefore never selected the terminal's
  loopback WebSocket.
- [ ] Complete the build-contract correction (completed: carry
  `VITE_AGENT_WS_MODE` through the Ansible Docker environment, Compose,
  Dockerfile, strict release contract, focused regression tests, all local
  deployment contracts, and a production Web build; remaining: hosted CI,
  standard production rollout, physical Assembly-01 scan, and same-SHA no-op
  proof).

## Surprises & Discoveries

- Observation: the existing `docker-security` job cannot be promoted.
  Evidence: it runs on `ubuntu-latest`, sets `load: true`, does not push, and
  uses fixed dummy `BUILD_COMMIT` and `BUILD_CONFIG_HASH` values.

- Observation: release identity includes compiled Web state, not only an OCI
  label.
  Evidence: `apps/web/src/layouts/KioskLayout.tsx` acknowledges readiness with
  the build-time `VITE_RELEASE_SHA`, while both Dockerfiles carry revision and
  configuration-hash labels.

- Observation: the production builder already has a strong non-secret
  allowlist and canonical hash boundary.
  Evidence: `scripts/deploy/pi5-image-deploy.sh` resolves Compose build
  arguments, permits one API argument and the explicit Vite arguments, writes
  a mode-0600 sealed JSON document, and rejects drift before provenance and
  evidence creation.

- Observation: the server configuration rollback manifest protects only
  `apps/api/.env`, `apps/web/.env`, and `infrastructure/docker/.env`.
  Evidence: `_SERVER_CONFIG_PATHS` in
  `scripts/deploy/rolling_release/backends/ansible.py` has exactly those three
  entries. Any managed registry credential must be added to the same sealed
  transaction before production enablement.

- Observation: public GHCR pulls need no credential, while GitHub CLI refuses
  to start attestation verification unless `GH_TOKEN` is nonempty even with
  `--bundle-from-oci`.
  Evidence: an isolated empty CLI config rejected the command before
  verification; the same public OCI bundle verified with an inert token, and
  the complete promoter then validated the release set plus both image
  attestations without registry login.

- Observation: the first production opt-in installed Debian's `gh` 2.46.0,
  which has no `attestation` command.
  Evidence: production run `20260728-230421-7f27db` recorded
  `GitHub attestation verifier is unavailable`, safely used the accepted local
  builder, completed Pi5 stability and all six Pi4 activation checks, and its
  same-SHA plan was empty. A read-only `gh version` and
  `gh attestation verify --help` probe confirmed the missing command.

- Observation: `server-config-release.yml` intentionally disables global
  Ansible fact collection, so the first pinned-verifier architecture assertion
  could not read `ansible_architecture`.
  Evidence: run `20260728-235649-158f9e` failed on that undefined variable,
  restored its server configuration manifest, and never reached candidate
  preparation. The package architecture can instead be read locally and
  without mutation from `/usr/bin/dpkg --print-architecture`.

- Observation: the signed release set was available, but CI and Pi5 calculated
  different configuration hashes for the same exact main SHA.
  Evidence: CI published configuration hash
  `176b793c75a54824ff56987e6c31edc9d10d428650559fc341bdd378f37d3563`,
  while Pi5 sealed
  `9b34d0beff0acc72d6bcf9d2e5795f3ad4c4695b33101c8b147f587cc7049dd6`.
  Their canonical non-secret contracts differed only at
  `VITE_AGENT_WS_URL`: CI resolved the server-owned
  `ws://100.106.158.2:7071/stream`, but `docker.env.j2` omitted the variable,
  so Compose used `ws://localhost:7071/stream`.

- Observation: the later Pi5 Web build still omitted the separate stream-mode
  variable even after the URL drift was corrected.
  Evidence: Assembly-01 reported `readerConnected: true`, `lastError: null`,
  and an increasing local queue at `http://localhost:7071/api/agent/status`,
  while `group_vars/server/web-build.yml` defined
  `web_agent_ws_mode: "local"` but Docker Compose, `Dockerfile.web`, and the
  signed Web build allowlist carried only `VITE_AGENT_WS_URL`. The browser
  therefore compiled the legacy candidate policy instead of
  `ws://localhost:7071/stream`-only policy.

- Observation: Docker is running on the development Mac as ARM64 with zero
  containers, while unrelated persistent volumes and networks exist.
  Evidence: the read-only inventory reported Docker 29.6.1, architecture
  `aarch64`, zero containers, seventeen volumes, and three networks. Tests must
  use unique labels and must not prune or alter those existing resources.

- Observation: a loopback registry published on the Mac host was not reachable
  from Docker Desktop's daemon, while a registry bound to the Docker VM
  loopback is both daemon-reachable and unavailable to the Mac LAN.
  Evidence: the first isolated attempts failed before publication and cleaned
  all labeled resources; the final validator uses Docker host networking with
  `REGISTRY_HTTP_ADDR=127.0.0.1:<random-port>` and no host port publication.

- Observation: the common deploy runner initially inherited a Node 18
  installation missing the macOS ARM64 optional `sharp` package.
  Evidence: the deployment Python and database contracts passed, but the API
  test import failed before tests ran. Re-linking the frozen lockfile with the
  repository-compatible Node 24 runtime restored `sharp`; the unchanged runner
  then passed end to end. Every failed attempt still proved its disposable
  PostgreSQL container, volume, and network count returned to zero.

## Decision Log

- Decision: Phase 2 promotes CI-built ARM64 images and does not introduce
  runtime feature flags or parallel terminal mutation.
  Rationale: the measured on-device candidate build is the largest remaining
  removable deployment block. Runtime configuration and terminal concurrency
  change different safety contracts and belong to a later phase.
  Date/Author: 2026-07-28 / Product owner and Codex.

- Decision: keep the API and Web as one release pair.
  Rationale: migration planning, release identity, rollback slots, and
  readiness evidence already bind them as a pair. Splitting their identity
  would broaden Phase 2 and weaken existing recovery reasoning.
  Date/Author: 2026-07-28 / Codex.

- Decision: use exact OCI digests and an attested release-set contract.
  Rationale: mutable tags are suitable only for discovery. The production
  decision must bind exact bytes, source SHA, configuration, platform, and
  trusted workflow.
  Date/Author: 2026-07-28 / Codex.

- Decision: absence or transient transport failure may use the existing local
  build, but a discovered artifact with an integrity mismatch must stop.
  Rationale: availability problems can safely use the established path.
  Signature, source, configuration, platform, or digest failures indicate
  tampering or an unsafe producer and must not be hidden.
  Date/Author: 2026-07-28 / Codex.

- Decision: keep publication main-only and use the existing x86-64 Docker
  security build for pull requests.
  Rationale: pull requests must not obtain package-write or attestation
  authority. Native ARM64 production work should happen once on the exact main
  SHA and can overlap the normal main checks.
  Date/Author: 2026-07-28 / Codex.

- Decision: preserve the local Pi5 builder as an independently tested adapter.
  Rationale: removing the accepted builder in the same change would make
  registry availability a new single point of failure.
  Date/Author: 2026-07-28 / Codex.

- Decision: do not make GHCR or the attestation verifier a hard fleet-readiness
  dependency.
  Rationale: a hard readiness gate would defeat the accepted availability
  fallback. Missing tools or transport are recorded as unavailable and invoke
  the local builder; discovered but invalid signed content still stops.
  Date/Author: 2026-07-28 / Codex.

- Decision: never copy the developer's broad GitHub token to Pi5 merely to
  satisfy GitHub CLI startup.
  Rationale: public OCI bundle verification does not use an API credential.
  An isolated temporary CLI config plus an inert fixed token preserves the
  exact signature policy without introducing a production secret. Private
  packages may still use the existing optional read-only credential path.
  Date/Author: 2026-07-29 / Codex.

- Decision: keep the artifact policy root-owned, with mode 0640 and group
  ownership assigned to the trusted release runner.
  Rationale: the candidate process intentionally runs without root, while the
  same account already owns the protected production environment files and
  Docker release authority. This permits the intended adapter without making
  the optional private-package token world-readable or executing mutable
  repository code through sudo.
  Date/Author: 2026-07-29 / Codex.

- Decision: install GitHub CLI 2.96.0 from its immutable upstream Linux ARM64
  package with the published SHA-256, and capability-probe the exact policy
  flags during server configuration convergence.
  Rationale: Debian's package name alone does not guarantee the attestation
  interface. Pinning both bytes and capabilities makes the production trust
  dependency explicit; checksum or policy drift fails before candidate
  preparation, while later registry transport failures retain the local
  builder fallback.
  Date/Author: 2026-07-29 / Codex.

- Decision: render every allowlisted non-dynamic Web build input used by the
  release contract into the Pi5 Compose environment from the same Ansible
  variables.
  Rationale: defaults are safe for standalone development but cannot define
  production image identity independently of the signed CI contract. A
  regression test now renders both adapters from one variable map and compares
  every API/Web value except the dynamically supplied release SHA.
  Date/Author: 2026-07-29 / Codex.

- Decision: add `VITE_AGENT_WS_MODE` to the same exact non-secret Web build
  allowlist rather than changing terminal configuration or restoring the
  removed shared `/stream` proxy.
  Rationale: the intended `local` value already has one server-owned source.
  Carrying it through the immutable build boundary repairs all kiosk bundles
  centrally, preserves endpoint isolation, and leaves an empty default for
  environments that still require legacy behavior.
  Date/Author: 2026-07-29 / Codex.

## Outcomes & Retrospective

The implementation is locally complete. It separates pure build identity,
strict release-set validation, hosted publication, Pi5 acquisition, and the
existing local builder so each boundary is independently testable. It does not
change migration planning, API or Web behavior, terminal ordering, notice,
canary, five-minute stability, traffic switching, or rollback.

Local validation passed 888 deployment/orchestrator tests, 42 CI classifier
and workflow tests, 28 focused build/release/promotion/backend tests, 156
disposable PostgreSQL migrations, 20 deploy-status API tests, all Ansible
syntax checks, and the Pi5 image lifecycle shell test. The database ledger had
zero unfinished or rolled-back rows. `ClientDevice.apiKey` used its unique
index and completed in 0.024 ms in the final `EXPLAIN (ANALYZE, BUFFERS)`.

The isolated native ARM64 Docker exercise produced configuration hash
`138d7c254c301af7c800cace035e1a69269b9d0b6235e1ac3089ce61ea400383`,
API digest
`sha256:a09c46d292ea12d59177c263471cfb106d71ceb9f1adaca2e283bffaeb9f1c3b`,
Web digest
`sha256:77603b301830bfa5903e19691e3781832dd51c1cac5ee02543d963b0f9641cb4`,
and release-set digest
`sha256:62ed90f64d628cd7f62db1a4143d2823a8d8362da401b409783912152725c337`.
The API payload, Caddy configuration, platform, labels, strict release set,
and pull-by-digest flow passed. Run-owned Docker containers, volumes, networks,
and validation image tags all returned to zero; unrelated existing resources
and BuildKit caches were not pruned.

The Assembly-01 NFC correction has also passed 19 focused release/Ansible
contract tests, four NFC stream tests, the Pi5 image lifecycle, all 903
orchestrator tests, 24 inventory tests, 102 template parses, all 156
disposable PostgreSQL migrations, and 20 deploy-status API tests. A production
Web build contained both `mode:"local"` and the loopback stream URL. The
run-owned PostgreSQL container, volume, and network returned to zero. Hosted CI
and the approved production rollout remain the terminal acceptance steps.

Production deployment is now separately authorized. The primary production
Pi5 opts in through its host vars while the shared server default and
TalkPlaza remain disabled. Terminal deployment evidence is recorded in the
standard release state and PR rather than by adding a post-deployment
evidence-only source commit.

## Context and Orientation

`.github/workflows/ci.yml` runs change-aware hosted checks and ends in the fixed
`ci-required` aggregate. `scripts/ci/classify_changes.py` is the pure path
classifier. Phase 2 adds a release-pair decision to that data result rather
than embedding feature names or path logic in workflow YAML.

`infrastructure/ansible/group_vars/server/web-build.yml` owns Pi5 Web build
values. `infrastructure/ansible/templates/docker.env.j2` renders those values
into the Pi5 Compose environment. `infrastructure/docker/docker-compose.server.yml`
passes the allowlisted values to the Web Dockerfile. A new read-only renderer
will output only that non-secret allowlist for CI; it must never serialize
inventory-wide or Vault values.

`scripts/deploy/pi5-image-deploy.sh` currently owns candidate preparation. It
creates an immutable source archive, seals effective build arguments, builds
run-scoped API and Web tags, checks labels and health, measures resources, and
writes `logs/deploy/pi5-image-deploy-state.json`. Phase 2 will place a small
promotion adapter before its build step. The adapter may supply exact
run-scoped local images, but it cannot switch traffic or alter rollback slots.

`scripts/deploy/rolling_release/backends/pi5.py` invokes candidate preparation
and rejects state that does not match the current run, SHA, image identifiers,
and resource evidence. `scripts/deploy/pi5-blue-green.sh` then owns inactive
slot preparation, switching, five-minute monitoring, and cleanup. Those latter
contracts remain unchanged.

A release set is a small, strict JSON document identifying the two container
images that form one release. An OCI digest is the immutable `sha256:` identity
of registry content. An attestation is a GitHub OIDC-signed statement that the
trusted workflow produced a specified digest from a specified source commit.

## Plan of Work

First, add `scripts/deploy/release_build_contract.py`. It will define immutable
Python data classes for API and Web build arguments, normalize exact allowlists,
reject duplicate or unknown fields, and return canonical JSON and its SHA-256
digest. The Pi5 shell builder and CI renderer will call this one module so the
configuration identity is not reimplemented in YAML or shell. Add focused
unit tests before changing callers.

Next, extend `scripts/ci/classify_changes.py` with a `release_pair` result. It
will be true for source or infrastructure paths that can change the Pi5 API or
Web image, false for proved documentation-only and terminal-only changes, and
true for unknown or fail-closed input. Extend workflow contract tests so
publication remains impossible on pull-request and untrusted events.

Add main-only native ARM64 release jobs to `.github/workflows/ci.yml`. They
resolve the exact non-secret build contract, build API and Web in parallel on
`ubuntu-24.04-arm`, push immutable digest-addressed images to GHCR, scan those
same digests, and upload small digest records. After `ci-required`, a bounded
gate checks the exact SHA's fixed `codeql` and `gitleaks` results. It then
creates and signs one strict release set. Job permissions remain minimal and
package/attestation write permissions exist only in the main publication
jobs. Pull-request jobs retain the existing load-only security behavior.

Add `scripts/deploy/release_artifact_contract.py` for strict release-set
parsing and policy verification. Add a registry adapter that uses a run-scoped
Docker configuration directory, authenticates with a root-owned,
release-runner-readable token file,
verifies the GitHub attestation against the exact repository, workflow,
`refs/heads/main`, source SHA, and non-self-hosted signer, pulls both images by
digest, checks Linux ARM64 and existing OCI labels, and retags them to the
current run-scoped candidate names. Partial pairs are deleted before return.

Integrate the adapter into `pi5-image-deploy.sh` after the effective build
arguments have been sealed and before local builds start. The builder records
`promoted`, `local-built`, `local-fallback`, or `reused`. A missing release set,
temporarily unavailable registry, or missing optional credential records a
bounded fallback reason and calls the unchanged local build. A signature,
schema, source, configuration, architecture, label, or digest mismatch aborts.
All later health, Caddy, load, resource evidence, and Blue/Green phases remain
the same.

Add an opt-in Ansible variable with a false default, a root-only credential
file, and readiness probes for the exact verifier executable and GHCR TLS
endpoint. Add the credential destination to the sealed server configuration
rollback manifest and prove capture, restore, count, permissions, and log
redaction. The feature remains disabled in production inventory in this
implementation PR.

Add one ADR for attested ARM64 release promotion, update the deployment and CI
guides with short operational and recovery instructions, link the ExecPlan
from the thin indexes, and refresh generated document inventories. Record the
completed Phase 1 production evidence in its existing plan without duplicating
the Phase 2 implementation log.

## Concrete Steps

Work from:

    /Users/tsudatakashi/Documents/Codex/2026-07-28/new-chat-2/RaspberryPiSystem_002-phase2

The branch is:

    perf/deploy-workflow-artifact-promotion

Run focused tests after each contract change. Before publication, run:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Use a unique label such as
`raspi-phase2-<timestamp>-<random>` for local Docker registry, container,
volume, network, and validation tags. Capture the read-only Docker inventory
before creating them. Register cleanup traps before starting the first
container. Remove only exact resources bearing that run label and prove that
zero remain. Never run Docker cache or volume prune.

After every local check succeeds, inspect the complete diff, stage explicit
paths, commit once with a conventional message, push the branch, and open one
Draft PR targeting `main`. Do not merge, enable the production variable, add a
real token, connect to a device, or deploy.

## Validation and Acceptance

Pure tests must prove stable canonical hashes, strict allowlists, duplicate-key
rejection, source and platform binding, API/Web pair binding, and fail-closed
classification. Workflow tests must prove that package and attestation writes
are main-only and that the fixed required check names remain unchanged.

The local ARM64 Docker exercise must build one exact API/Web pair, push it to a
loopback-only disposable registry, pull it by digest, promote it to run-scoped
tags, validate labels and architecture, run the existing API/Caddy checks, and
remove every validation resource. Local tests may replace the external
attestation command through an injected test adapter; production verification
must never have a bypass flag.

`scripts/ci/run-deploy-contracts-local.sh` must use only its unique random-port
PostgreSQL container, volume, and network. It must generate Prisma Client,
apply every migration, report current migration status, prove zero unfinished
or rolled-back ledger rows, run `EXPLAIN (ANALYZE, BUFFERS)` for the existing
`ClientDevice.apiKey` lookup, pass deploy-status and rollout contracts, and
prove cleanup on success and representative failure.

No API route, DTO, Prisma schema, migration, browser behavior, terminal order,
notification duration, canary gate, Pi5 stability duration, or Blue/Green
rollback behavior may change. A future production validation is successful
only when `--print-plan` shows the expected target architecture, the candidate
state records `promoted`, traffic and readiness checks pass, the same-SHA plan
is a no-op, and no secret appears in state or logs.

## Idempotence and Recovery

Contract generation and validation are pure and repeatable. Registry
publication uses exact content digests; mutable tags are discovery aids only
and never authorize production. Candidate pulls happen before any public
traffic change. A failed or interrupted acquisition removes its run-scoped
Docker configuration and unreferenced candidate tags, leaving active and
rollback slot images untouched.

If GitHub or GHCR is unavailable before a trustworthy release set is found,
the current local builder remains the safe recovery path. If integrity fails
after a release set is found, stop and preserve evidence; do not fall back.
Disabling the opt-in variable restores the exact Phase 1 behavior. The server
rollback manifest restores the previous credential file and three environment
files if host configuration convergence fails.

## Artifacts and Notes

The Phase 1 production timing supplied by the preceding deployment task was:

    run ID: 20260728-090633-139928
    total: 58m33s
    Pi5 candidate build: about 15m06s
    Pi5 release and stability: about 21m09s
    terminal safety flow: unchanged and successful
    same-SHA re-plan: no-op

This timing motivates moving image creation before deployment. It is evidence,
not a fixed performance threshold.

## Interfaces and Dependencies

In `scripts/deploy/release_build_contract.py`, define:

    API_BUILD_ARGUMENT_KEYS: tuple[str, ...]
    WEB_BUILD_ARGUMENT_KEYS: tuple[str, ...]
    normalize_build_arguments(api: Mapping[str, object],
                              web: Mapping[str, object],
                              release_sha: str) -> BuildContract
    canonical_contract_json(contract: BuildContract) -> str
    build_config_hash(contract: BuildContract) -> str

In `scripts/deploy/release_artifact_contract.py`, define:

    parse_release_set(raw: str) -> ReleaseSet
    validate_release_set(release_set: ReleaseSet,
                         expected_repository: str,
                         expected_sha: str,
                         expected_config_hash: str,
                         expected_workflow: str) -> None

The release set has schema version 1 and exact fields for repository, source
SHA and ref, configuration hash, platform, API and Web OCI repositories and
digests, and workflow path, run ID, and attempt. All parsers reject duplicate
JSON keys and unknown fields.

The Pi5 adapter returns one of:

    promoted
    unavailable
    integrity-failure

Only `unavailable` permits the caller to invoke the existing local builder.
`integrity-failure` is terminal. The adapter cannot switch traffic, run
migrations, mutate terminal hosts, or decide rollback policy.

Revision note (2026-07-28): Created after the product owner approved Phase 2
implementation. It records the audited current contracts and fixes the
implementation boundary before code changes begin.

Revision note (2026-07-29): Recorded the Assembly-01 NFC production diagnosis
and the missing `VITE_AGENT_WS_MODE` build-contract boundary before publishing
the corrective change.
