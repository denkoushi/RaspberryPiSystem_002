---
id: plan-fail-closed-production-config-and-terminal-health
title: Fail closed on production configuration drift and terminal peripheral health
status: in_progress
date: 2026-07-29
source_of_truth: true
scope: production Web configuration, NFC readiness, terminal peripheral monitoring, and telemetry alert delivery
related_docs:
  - ../decisions/ADR-20260729-fail-closed-production-config-and-terminal-health.md
  - ../knowledge-base/KB-403-production-config-contract-and-nfc-health.md
  - ./deploy-workflow-artifact-promotion-execplan.md
  - ../guides/deployment.md
related_code:
  - scripts/deploy/production_config_contract.py
  - scripts/deploy/release_build_contract.py
  - apps/web/src/config/
  - clients/nfc-agent/
  - clients/status-agent/
  - apps/api/src/services/clients/
validation:
  - pure production configuration contract and bundle audit tests
  - browser NFC readiness and terminal health probe tests
  - status-agent episode and API alert delivery tests
  - production Web and NFC Agent Docker exercises
  - complete local deployment contract with disposable PostgreSQL
open_items:
  - hosted CI and Draft PR
  - main merge and production rollout require later explicit approval
---

# Fail closed on production configuration drift and terminal peripheral health

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. Maintain this document in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

The Assembly-01 NFC incident was not a hardware failure. The application used
a production Web setting that had to be repeated manually through Ansible,
Docker environment rendering, Docker Compose, the Dockerfile, the signed build
contract, and application code. One copy was omitted. Existing tests compared
only the same incomplete lists, so the image and deployment passed while the
browser selected the wrong WebSocket policy. The terminal reader continued to
scan cards into a local queue, but deployment health treated a boolean-shaped
`readerConnected` field as sufficient even when its value was false and did
not reject a non-empty queue.

After this change, every production `VITE_*` reference has one typed registry
entry and a mechanically audited route into the immutable Web image, or one
explicitly documented exception. Missing, unknown, duplicated, malformed, or
secret-like build settings stop CI. A kiosk cannot acknowledge deployment
readiness until its browser proves that it uses the local-only NFC policy,
reaches the loopback agent, sees a connected reader, and observes an empty
queue twice in succession. During ordinary operation the existing one-minute
status-agent timer also checks each inventory-enabled peripheral and emits one
sanitized Slack alert after two consecutive failures, then records recovery
and permits a later recurrence to create a new alert episode.

The observable acceptance is not merely that Assembly-01 works. A fixture that
removes any production configuration hop must fail CI, a terminal with
`readerConnected=false` or `queueSize>0` must stop before mutation or withhold
its ready acknowledgement, and a two-minute simulated peripheral failure must
create exactly one operations alert without storing a card UID, token, raw
endpoint URL, or agent response.

## Progress

- [x] (2026-07-29 15:33+09:00) Confirmed GitHub authentication, a clean
  `main`, exact equality with `origin/main` at
  `49ba82126ee77113ed6db23548a04ff18b2a05c6`, and created branch
  `fix/fail-closed-production-config-and-terminal-health`.
- [x] (2026-07-29 15:33+09:00) Created this ExecPlan before code changes and
  fixed the implementation boundary: no public API, DTO, Prisma schema, or
  migration change; no production connection, merge, or deployment.
- [x] (2026-07-29 16:00+09:00) Implemented and tested one typed production Web configuration registry and
  exact audits of every application reference and production build hop.
- [x] (2026-07-29 16:00+09:00) Implemented the reasoned API environment compatibility audit without
  moving current API runtime values.
- [x] (2026-07-29 16:00+09:00) Implemented the shared NFC runtime contract, browser deployment proof,
  stricter terminal probe, safe resend semantics, and loopback-only NFC Agent.
- [x] (2026-07-29 16:00+09:00) Implemented the status-agent peripheral collector and generic telemetry
  alert policy with durable episode and retry behavior.
- [x] (2026-07-29 16:30+09:00) Completed focused and full Node-compatible Web/API,
  agent, ARM64 Docker, disposable PostgreSQL,
  Ansible, document, and cleanup validation.
- [x] (2026-07-29 16:32+09:00) Updated ADR, KB, guides, security runbook, indexes, Phase 2 evidence, and
  this living plan.
- [ ] Review and stage only intended files, create one commit, push the branch
  once, open one Draft PR, and wait for the exact-head required CI.

## Surprises & Discoveries

- Observation: the production Web configuration is not defined by one source.
  Evidence: the same input names are manually repeated in
  `infrastructure/ansible/group_vars/server/web-build.yml`,
  `infrastructure/ansible/templates/docker.env.j2`,
  `infrastructure/docker/docker-compose.server.yml`,
  `infrastructure/docker/Dockerfile.web`,
  `infrastructure/ansible/templates/release-build-contract.json.j2`, and
  `scripts/deploy/release_build_contract.py`.

- Observation: application code currently reads twenty distinct `VITE_*`
  names, while the signed Web build allowlist contains only nine.
  Evidence: repository searches found production references for API timeout,
  Barcode Agent, debug logging, manual-order device scope, and five leaderboard
  switches that do not cross the complete production build boundary.

- Observation: the old tests can agree on an incomplete contract.
  Evidence: the release-contract and workflow tests construct fixtures from
  the same handwritten subset rather than comparing that subset with every
  non-test application reference.

- Observation: the existing terminal health probe validates types rather than
  usable state for NFC and Barcode.
  Evidence: a boolean `readerConnected` field passes regardless of true or
  false, and any non-negative NFC queue size passes.

- Observation: the NFC resend worker can delete an event that no browser
  received.
  Evidence: `_resend_queued_events` records and removes an event after awaiting
  `broadcast()` without checking its boolean return.

- Observation: production API configuration has two conceptual sources but
  only Docker Compose inputs are effective for the container.
  Evidence: `api.env.j2` renders `apps/api/.env`, while production Compose
  reads `apps/api/.env.example`, `infrastructure/docker/.env`, and explicit
  environment entries. Sixteen compatibility keys currently exist only in the
  non-effective file and therefore need a reasoned frozen exception rather
  than an unsafe bulk move.

- Observation: Docker Desktop is available on native ARM64 with no running
  containers, while seventeen existing volumes and three existing networks
  belong outside this run.
  Evidence: the read-only baseline was recorded before implementation. Docker
  exercises must use unique labels and must never prune shared BuildKit cache.

## Decision Log

- Decision: keep one pure Python registry as the authoritative description of
  production Web build inputs and their category, then derive the release
  allowlist and audits from it.
  Rationale: this removes list-to-list comparisons while keeping parsing,
  hashing, CI, Docker, and Ansible concerns behind narrow adapters.
  Date/Author: 2026-07-29 / Codex.

- Decision: give Web application code one typed `import.meta.env` adapter and
  prohibit direct reads elsewhere.
  Rationale: one application-side boundary makes the complete consumed set
  mechanically enumerable and gives code a consistent parser for boolean,
  integer, URL, generated, and explicit-exception values.
  Date/Author: 2026-07-29 / Codex.

- Decision: treat `VITE_DEFAULT_CLIENT_KEY` as a registered per-terminal
  runtime exception, not an image build argument.
  Rationale: all kiosks share one immutable Web image; inventory query strings
  and local storage already supply the client-specific key without leaking
  one terminal identity into all terminals.
  Date/Author: 2026-07-29 / Codex.

- Decision: audit API source divergence now but defer runtime consolidation.
  Rationale: moving sixteen compatibility settings could alter application
  behavior beyond this safety change. A fail-closed, reasoned exception list
  prevents new drift and blocks inventory overrides until a separately
  reviewed consolidation.
  Date/Author: 2026-07-29 / Codex.

- Decision: reuse one `NfcRuntimeContract` for ordinary subscriptions and the
  deployment readiness proof.
  Rationale: deriving policy and endpoints twice could reproduce the same
  split-brain bug. The browser proof must observe exactly what the feature uses.
  Date/Author: 2026-07-29 / Codex.

- Decision: require two one-second-spaced healthy observations and preserve
  the existing ninety-second ready timeout.
  Rationale: this rejects momentary or stale health without weakening or
  lengthening the established deployment failure boundary.
  Date/Author: 2026-07-29 / Codex.

- Decision: fail before mutation on any NFC queue backlog and never flush it
  automatically.
  Rationale: a queued scan may be business data. Silent deletion is less safe
  than stopping deployment and requiring an operator to reconcile the queue.
  Date/Author: 2026-07-29 / Codex.

- Decision: extend the shared status-agent with an independent collector while
  disabling that collector for signage.
  Rationale: the existing sixty-second timer, authenticated telemetry channel,
  and status evidence are reusable. A separate module keeps peripheral policy
  out of core storage-health code and remains scalable to new agents.
  Date/Author: 2026-07-29 / Codex.

- Decision: emit an alert only after two consecutive failures, once per
  episode, and retry delivery when posting fails.
  Rationale: two samples suppress transient noise; durable local state prevents
  duplicates; refusing to mark failed posts as emitted avoids silent alert
  loss. Recovery ends the episode and permits a later recurrence to notify.
  Date/Author: 2026-07-29 / Codex.

- Decision: bind the NFC Agent to loopback and remove unused privileged
  control routes.
  Rationale: browser and local probes are the only repository consumers.
  Removing network exposure and unauthenticated reboot, shutdown, and flush
  surfaces closes KB-393 C-3 without changing Tailnet policy.
  Date/Author: 2026-07-29 / Codex.

## Outcomes & Retrospective

Local implementation and validation are complete. Preventive tests prove that
a missing configuration hop cannot pass CI, and operational tests prove that
peripheral failure is stopped at deployment or reported through the two-sample
alert path. The full API suite passed 474 files and 2,485 tests against an
isolated PostgreSQL instance. The common deployment runner passed 102 Jinja
templates, 906 Python deployment tests, all 156 migrations, 20 deploy-status
API tests, 24 inventory tests, every Ansible syntax check, and indexed
`ClientDevice.apiKey` lookup. Web, status-agent, and NFC Agent suites passed.

Native ARM64 Docker exercises built the production Web and NFC Agent images,
validated the exact configuration hash and OCI labels, proved loopback-only
NFC status/WebSocket behavior, preserved queued events until real delivery,
and returned removed control routes as 404. All run-owned containers, volumes,
networks, and validation images returned to zero; the seventeen existing
volumes and shared BuildKit cache were unchanged.

Hosted CI and publication remain. Phase 2 artifact promotion also remains
separately incomplete until production records a `promoted` candidate; the
most recent production API pull exceeded its 600-second allowance and safely
used the local builder.

## Context and Orientation

The server builds one immutable Vite Web bundle. Vite is the Web build tool;
every variable beginning with `VITE_` is compiled into browser JavaScript and
cannot be changed by editing a terminal after the image is built. Ansible owns
the intended production values in
`infrastructure/ansible/group_vars/server/web-build.yml`. It renders
`infrastructure/ansible/templates/docker.env.j2`, Docker Compose forwards
selected values as build arguments, `infrastructure/docker/Dockerfile.web`
exposes them to Vite, and the release contract hashes the same non-secret
values so CI images and Pi5 policy can be compared.

The Web application currently reads build settings directly from
`import.meta.env` in multiple files. The new
`apps/web/src/config/productionBuildConfig.ts` becomes the only production
reader. It exports typed values and the NFC runtime contract consumes those
values. The Python module
`scripts/deploy/production_config_contract.py` describes the same supported
keys, categories, production values, and validation rules for CI and release
tooling. Tests compare actual application references and every build surface
against that registry instead of maintaining another independent list.

The terminal-local NFC service lives under `clients/nfc-agent`. It exposes a
status endpoint on port 7071 and a WebSocket stream used by the browser.
`clients/nfc-agent/nfc_agent/resend_worker.py` retries queued scans. The
deployment browser acknowledges readiness from
`apps/web/src/layouts/KioskLayout.tsx`; the server coordinator then waits up to
ninety seconds for that acknowledgement. The existing local probe
`scripts/deploy/terminal-agent-health-probe.py` checks terminal agents before
mutation and when collecting release evidence.

The shared `clients/status-agent` program already runs from a systemd timer
every sixty seconds and sends authenticated status and log data to the API.
The new peripheral collector stores only sanitized episode state in
`/run/raspi-status-agent/terminal-agent-health.json`. An episode is one
continuous unhealthy interval for an agent signal. The first unhealthy sample
opens the episode locally. The second sends a sanitized log. A successful
sample records recovery and closes the episode. If posting fails, the episode
remains unsent so the next timer run retries.

The API receives client logs in its existing client telemetry module. It
already converts SD-card health logs into database `Alert` and pending Slack
`AlertDelivery` rows. The refactoring extracts a pure generic telemetry alert
policy, preserves SD-card fingerprints and routing, and adds
`terminal_agent_health` routing to the existing operations Slack destination.
No database type, migration, DTO, or public URL changes.

## Plan of Work

First add the Python production registry and tests that enumerate all twenty
non-test application `VITE_*` references. Model image inputs, the generated
release SHA, the client-key runtime exception, and development-only settings
as distinct types. Derive `WEB_BUILD_ARGUMENT_KEYS` from the registry. Add
auditors for Ansible values, rendered Docker environment, Compose arguments,
Dockerfile arguments and environment, release contract template, and the
production bundle. Add an API environment auditor with the current sixteen
reasoned compatibility exceptions. Register all new files with both deployment
and CI change classifiers before their broad fallback rules.

Next add the sole typed Web configuration adapter and replace direct production
reads. Explicitly carry the missing production values with exact strings:
`/ws`, `120000`, `ws://localhost:7072/stream`, false debug logging, true manual
device scope, true leaderboard cache/SWR/mutation mirror/client filter, and
false leaderboard performance logging. Keep the shared image free of a default
client key.

Then extract the pure NFC runtime contract. Make the subscription hook and
deployment readiness proof consume it. The proof fetches the loopback status
endpoint twice, one second apart, and checks local-only policy, loopback
identity, `readerConnected === true`, and `queueSize === 0` before sending the
existing SHA-bound ready acknowledgement. Strengthen the terminal probe with
the same usable-state rules.

Correct queued NFC resend deletion semantics, bind the agent to 127.0.0.1, and
remove the three unused control routes. Tests exercise no-subscriber, partial
success, exception, route removal, and loopback binding.

Add the status-agent collector as a pure module with injectable HTTP and clock
adapters. Render only inventory-enabled Pi4 agents into its configuration.
Persist sanitized state atomically. Integrate emitted unhealthy and recovery
logs with the existing telemetry sender. Extract the API alert policy and add
episode-aware terminal health fingerprints while preserving storage behavior.

Finally update documentation, run focused and complete validations, inspect
Docker cleanup against the baseline, review the whole diff, and publish one
intentional commit to one Draft PR. Do not merge or deploy.

## Concrete Steps

Work from:

    cd /Users/tsudatakashi/RaspberryPiSystem_002

The branch was created with:

    git switch main
    git pull --ff-only origin main
    git switch -c fix/fail-closed-production-config-and-terminal-health

During implementation run focused tests after each boundary. For the final
local verification, use a repository-compatible Node 22 runtime and pnpm 9:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    python3 -m unittest discover -s clients/status-agent/tests -p 'test_*.py'
    python3 -m pytest clients/nfc-agent/tests
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/api test
    bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

For Docker validation, record the pre-test container, volume, and network
inventories; use a unique run ID and label for the production Web and mock NFC
Agent exercises; remove only those run-owned containers, images, volumes, and
networks; then prove the run-owned count is zero and the pre-existing seventeen
volumes remain. Never run a BuildKit cache prune.

The common deployment runner creates a uniquely named PostgreSQL container,
volume, and network, publishes only a random 127.0.0.1 port, applies all
migrations, runs `migrate status`, checks the migration ledger, executes
`EXPLAIN (ANALYZE, BUFFERS)` for `ClientDevice.apiKey`, and cleans its resources
through EXIT, INT, and TERM traps. It must never connect to an existing
container or volume.

After all checks pass, stage only listed files, inspect the cached diff, create
one commit, push once, and open one Draft PR with the root cause, safety
boundaries, tests, and explicit statement that production deployment has not
occurred.

## Validation and Acceptance

Configuration acceptance requires exactly twenty registered production
application references. Removing any one key from Ansible, docker.env,
Compose, Dockerfile, release template, Python allowlist, or final bundle must
make the audit fail with the missing key and surface name. Unknown, duplicate,
non-string, newline-containing, and secret-like keys must fail. Reordering
inputs must preserve the canonical hash. Direct `import.meta.env.VITE_*` use
outside the sole adapter must fail. The bundle must prove debug false, the
intended feature switches, loopback Barcode, `/ws`, and the 120-second API
timeout.

NFC acceptance requires browser and Python tests to reject false reader state,
non-empty queue, malformed JSON, and timeout. The ready acknowledgement appears
only after two healthy observations. Cancellation and verification-identity
change cannot leak a late acknowledgement. The resend worker removes only
events whose broadcast returned true, preserving remaining order after false
or exception. Control endpoints return 404 and the service binds only
127.0.0.1.

Monitoring acceptance requires the first unhealthy sample to persist state
without a post, the second to post exactly one sanitized event, subsequent
samples in the episode to stay quiet, failed posts to retry, recovery to emit
INFO and close the episode, and a later failure to use a new episode ID. Slack
and stored data must omit UID, last event payload, token, raw URL, and raw
response. API integration must create one pending operations Slack delivery
per episode and preserve existing SD-card behavior.

The production Web and NFC Agent images must build under Docker Desktop ARM64.
The Web image must carry the expected OCI revision/configuration labels and
compiled values. The mock NFC Agent must answer status and WebSocket on
loopback while removed routes return 404. All run-owned resources must be zero
after success and injected failure.

The final common runner must pass all existing deployment planner, readiness,
rollback, Ansible, 156-migration, ledger, API, and SQL plan checks. No
production host is contacted. Hosted CI for the Draft PR must select the full
suite because the contract itself changes and every required fixed-name check
must succeed.

## Idempotence and Recovery

All configuration and alert decisions are pure until adapters render a file,
query a local agent, or post telemetry. Tests inject clocks, processes, and
HTTP clients, so they never wait real minutes. Atomic state writes use a
temporary file in the same `/run` directory followed by replacement; an
interrupted write leaves the previous valid state.

Docker validation uses unique explicit names. On failure or interruption,
cleanup targets only those names and labels. The disposable PostgreSQL runner
has existing EXIT, INT, and TERM traps and validates zero remaining resources.
No existing DB, container, volume, network, or BuildKit cache is deleted.

The Git branch is isolated from main. Before publication, `git diff` and
`git diff --cached` identify every intended file. The single feature commit can
be reverted normally. Main merge and production deployment remain outside this
authorization.

## Artifacts and Notes

Initial repository state:

    branch: main
    head: 49ba82126ee77113ed6db23548a04ff18b2a05c6
    origin/main: 49ba82126ee77113ed6db23548a04ff18b2a05c6
    worktree: clean
    Docker: 29.6.1, ARM64, 0 containers, 17 volumes, 3 networks

The prior production symptom was an increasing NFC queue with a connected
reader. The corrective Web deployment restored physical Assembly-01 scanning,
but the absence of a full configuration registry and peripheral monitoring is
the latent-system risk addressed here.

## Interfaces and Dependencies

`scripts/deploy/production_config_contract.py` must expose immutable typed
records for every supported Web setting, a deterministic ordered image-input
view, explicit generated/runtime/development categories, validation of values
and names, and audit helpers that return structured errors rather than reading
GitHub or Docker.

`apps/web/src/config/productionBuildConfig.ts` must be the only non-test module
that reads `import.meta.env.VITE_*`. It exports parsed strings, booleans,
positive integer milliseconds, the generated release SHA, and the declared
runtime exception. Consumers never apply independent fallback semantics.

The NFC runtime module must expose one immutable result containing policy,
stream URL, and status URL plus a predicate for the local-only deploy proof.
The subscription hook and deployment readiness use the same result.

The status-agent collector must accept configuration, previous state, an
injectable local probe adapter, an injectable telemetry emitter, and an
injectable clock. Its result contains only agent, signal, severity, episode ID,
observed time, consecutive failures, and optional queue size.

The API telemetry alert policy must accept a sanitized client-log description
and return either no alert or a route, severity, stable fingerprint, summary,
and metadata. Storage and terminal agent policies are independent rule
implementations selected through the same narrow interface.

Revision note (2026-07-29): Created the self-contained implementation record
before code changes, capturing the approved safety boundaries, tests, cleanup,
publication limit, and known incomplete Phase 2 promotion proof.
