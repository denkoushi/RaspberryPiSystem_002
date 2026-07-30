---
id: plan-artifact-pull-progress-diagnostics
status: in_progress
scope: Pi5 Docker Engine pull progress, timeout evidence, and safe local fallback
date: 2026-07-30
source_of_truth: this document
related_code:
  - scripts/deploy/pi5_artifact_promoter.py
  - scripts/deploy/docker_pull_progress.py
related_docs:
  - ./deploy-workflow-artifact-promotion-execplan.md
  - ./deploy-artifact-timeout-canary-handoff-execplan.md
  - ../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md
validation:
  - focused Python unit tests
  - isolated loopback Docker registry
  - disposable PostgreSQL deploy contracts
open_items:
  - publish one Draft PR and pass required CI
  - collect production evidence only after separate approval
---

# Make Pi5 artifact pull timeouts diagnosable without weakening fallback

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. This document follows `.agent/PLANS.md`.

## Purpose / Big Picture

The Pi5 currently tries to download the exact signed ARM64 API and Web images
created by GitHub Actions. A recent production API-image download stayed alive
for the full 600-second allowance but did not complete. The existing log proved
only that the child process was still alive. It did not show downloaded bytes,
the active Docker layer, or whether Docker was downloading, verifying, or
extracting.

After this change, the same production download emits one sanitized progress
snapshot every 30 seconds. A successful pull and a timeout both preserve a
bounded summary containing byte counts, layer counts, the last processing
phase, and the age of the last byte-level progress. An operator can then
distinguish a stalled transfer from a slow transfer or local extraction without
seeing credentials, commands, raw registry errors, or full image references.

The existing trust and safety behavior does not change. Signature, source SHA,
configuration hash, digest, platform, Blue/Green, rollback, 600-second
per-image timeout, 900-second promotion budget, and local-build fallback remain
authoritative.

## Progress

- [x] (2026-07-30 19:00+09:00) Confirmed clean current `main`, created
  `fix/artifact-pull-progress-diagnostics`, and recorded the implementation
  boundary before code changes.
- [x] (2026-07-30 19:00+09:00) Verified feasibility against Docker Engine API:
  its line-delimited response exposes `progressDetail.current`,
  `progressDetail.total`, layer IDs, download, verification, extraction, and
  completion states.
- [x] (2026-07-30 20:22+09:00) Added the bounded pure progress model and
  standard-library Docker Engine Unix-socket transport.
- [x] (2026-07-30 20:24+09:00) Integrated progress-aware release-set, API, and
  Web pulls into the existing promoter without
  changing trust or fallback decisions.
- [x] (2026-07-30 20:43+09:00) Passed focused tests, all 925 Deploy Python
  tests, isolated multi-layer Docker validation, all 156 disposable
  PostgreSQL migrations, deploy-status API tests, rollback contracts, and
  Ansible syntax validation. Run-owned Docker and PostgreSQL resources
  returned to zero.
- [x] (2026-07-30 20:45+09:00) Added KB-404, Deploy guide interpretation, and
  Phase 2 links, then regenerated and verified the document inventory.
- [ ] Publish one commit with one push and one Draft PR, then record required
  hosted CI in the PR body without an evidence-only commit.
- [ ] Collect a production pull trace only after separate merge and deployment
  authorization.

## Surprises & Discoveries

- Observation: the failing API artifact contains about 1,262,151,764 compressed
  bytes across 26 layers, with two layers accounting for roughly 1.06 GB.
  Evidence: the immutable OCI manifest for digest
  `sha256:66d0c1b91f556a9db614058d9c63137b46a349cea0d3536dcefa0bb1de6a591c`
  reports layer sizes of about 749 MB and 308 MB as its two largest layers.

- Observation: Docker CLI removes byte progress when stdout is not a terminal,
  while Docker Engine API retains exact byte progress.
  Evidence: a piped `docker image pull` printed only state transitions, whereas
  `POST /images/create` on `/var/run/docker.sock` returned repeated
  `Downloading` and `Extracting` records with `current` and `total`.

- Observation: the existing heartbeat cannot consume partial child output.
  Evidence: `scripts/deploy/pi5_artifact_promoter.py::_run_command` repeatedly
  calls `Popen.communicate()` and emits elapsed time only; stdout and stderr are
  returned only when the child exits.

- Observation: the isolated Docker validator cannot safely overlap a different
  test that creates and removes Docker resources after its baseline snapshot.
  Evidence: a parallel trial correctly observed layer progress but reported
  that a short-lived network owned by the other test had disappeared. Running
  the validator alone preserved the stable baseline of zero containers,
  seventeen volumes, and three networks and left no run-owned resources.

## Decision Log

- Decision: use Docker Engine's local Unix-socket streaming API for progress,
  with Python standard-library HTTP and socket support, rather than parsing
  terminal control sequences from Docker CLI.
  Rationale: the Engine API provides structured byte and phase fields, requires
  no new package, and avoids an unstable pseudo-terminal parser.
  Date/Author: 2026-07-30 / Codex.

- Decision: keep Docker CLI as a capability fallback only when the Engine API
  cannot be opened before a pull starts.
  Rationale: observability must not make a previously viable deployment
  unavailable. Once an Engine pull starts, a timeout or transport failure must
  not trigger a duplicate network pull; it follows the existing safe local
  builder fallback.
  Date/Author: 2026-07-30 / Codex.

- Decision: store only bounded aggregate progress and at most eight validated
  12-character hexadecimal layer IDs.
  Rationale: these fields identify the stalled work without persisting a token,
  authorization header, command line, URL, reference, or untrusted daemon
  message.
  Date/Author: 2026-07-30 / Codex.

- Decision: do not increase timeout values, prefetch images, or change the API
  image in this work.
  Rationale: the unresolved question is whether the failure is transfer,
  registry/daemon, or local extraction. A performance change before measuring
  that boundary would hide rather than prove the cause.
  Date/Author: 2026-07-30 / Codex.

## Outcomes & Retrospective

The local implementation is complete. The Engine adapter records structured
download, verification, extraction, and completion data; its result passes
through the promoter and Pi5 status evidence. Engine capability failure before
the request uses the existing CLI path. A timeout or transport failure after
the request starts does not duplicate the pull and preserves a bounded final
snapshot for the existing local builder fallback. Integrity decisions are
unchanged.

Focused progress/promoter/backend and workflow tests passed. All 925 Deploy
Python tests passed. The isolated registry exercise pulled 4,195,906 bytes
across three completed layers through the real Engine API. The common runner
applied all 156 migrations, reported a current Prisma migration status, found
no incomplete or rolled-back rows, passed 20 deploy-status API tests, and used
`ClientDevice_apiKey_key` in 0.013 ms under
`EXPLAIN (ANALYZE, BUFFERS)`. All Ansible syntax and rollback contracts passed.
Run-owned Docker and PostgreSQL containers, volumes, and networks returned to
zero; the seventeen pre-existing volumes and shared BuildKit cache were not
changed.

This outcome is diagnostic evidence, not a claim that Phase 2 promotion is
complete. Phase 2 becomes complete only after a separately approved production
run records a trustworthy `promoted` candidate. Publication and hosted CI are
still pending.

## Context and Orientation

`scripts/deploy/pi5_artifact_promoter.py` validates a signed release set and
then downloads the API and Web images by exact digest. Availability failures
raise `PromotionUnavailable`; the caller
`scripts/deploy/pi5-image-deploy.sh` then uses the accepted local builder.
Integrity failures raise `PromotionIntegrityError` and stop before traffic
switching. The promoter writes a small JSON result that becomes
`artifactPromotion` in the Pi5 candidate and rolling-release status state.

The promoter currently starts `docker pull` through the generic
`CommandRunner`. `PromotionTimingPolicy` gives the release set 120 seconds,
each image 600 seconds, all other commands 300 seconds, and the entire
promotion 900 seconds. `_command_event` writes one start, heartbeat, success,
failure, or timeout JSON record to the system journal. The heartbeat contains
no work progress.

Docker Engine exposes the same pull operation as `POST /images/create` on its
local Unix socket. Its response is a stream of JSON objects. Each layer can
report `Downloading`, `Verifying Checksum`, `Download complete`, `Extracting`,
and `Pull complete`. Downloading and extracting records include current and
total byte counts. The release runner already has Docker socket permission
because it executes the current Docker CLI pulls and image inspections.

## Plan of Work

Create `scripts/deploy/docker_pull_progress.py`. Define immutable
`PullProgressSnapshot` and `PullResult` values, a `DockerImagePuller` protocol,
a pure accumulator that accepts validated Docker Engine events, and a concrete
local Engine implementation. The implementation uses a local
`http.client.HTTPConnection` subclass backed by an AF_UNIX socket. A worker
reads the chunked HTTP response while the coordinator polls a bounded queue at
the configured heartbeat interval. Closing the connection cancels the current
request on timeout or interruption. Lines, layer counts, identifiers, and
stored results all have explicit size limits.

The progress accumulator keeps download and extraction counters separately.
It retains the greatest observed byte value per layer, counts completed and
known layers, records the last safe phase, and calculates bytes advanced since
the preceding heartbeat and seconds since byte progress. It never stores raw
status strings or raw errors. Unknown status values increment a bounded
counter; malformed or oversized protocol records make the pull unavailable.

Build Docker registry authorization in memory from the existing
`PromotionConfig`. Public pulls send the Docker Engine representation of an
empty authorization object. Private pulls send username, password, and
`ghcr.io` server address as a base64 URL-safe header. The header is never
provided as a process argument and never crosses the progress/result boundary.

Change `pi5_artifact_promoter.py` so only pull operations use the injected
`DockerImagePuller`; attestation, provenance inspection, tagging, and cleanup
continue through the existing command adapter. The release-set, API, and Web
timeouts remain 120, 600, and 600 seconds under the same 900-second budget.
If the Unix socket cannot be opened before the request, use the old Docker CLI
pull and record `observabilityMode: cli-fallback`. If a streamed pull starts
and times out or fails, do not retry it through the CLI.

Emit one `artifact-promotion` progress line at each heartbeat. Add a bounded
`pullDiagnostics` object to unavailable results and successful pull summaries
to promoted results. The existing candidate-state plumbing already copies the
entire safe artifact-promotion result; extend tests to prove `--status`
retains the additive fields and rejects secret-bearing content as before.

Create `docs/knowledge-base/KB-404-pi5-ghcr-api-image-pull-timeout.md` as the
incident and investigation source of truth. Record what is confirmed, what is
still unknown, the latest production evidence, and how to interpret each
progress phase. Link it from the knowledge-base index, the deployment guide,
and the Phase 2 ExecPlan without duplicating the narrative.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Implement and run focused tests first:

    python3 -m unittest scripts/deploy/tests/test_docker_pull_progress.py
    python3 -m unittest scripts/deploy/tests/test_pi5_artifact_promoter.py

Run all deployment contracts:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/ci/validate-artifact-pull-progress-docker.sh
    bash scripts/ci/run-deploy-contracts-local.sh

Run documentation and diff checks:

    node scripts/docs/audit-docs.mjs --check
    git diff --check

After all checks pass, stage only the files named by this plan, create one
conventional commit, push the branch once, and create one Draft PR targeting
`main`. Do not merge or deploy.

## Validation and Acceptance

Pure tests must cover interleaved multi-layer downloads, cached layers,
verification, extraction, completion, no-progress heartbeats, malformed
records, bounded layer IDs, timeout, transport failure, cancellation, and
hostile error text. They must use injected clocks or sessions and never wait
600 real seconds.

The isolated Docker test must start a run-labeled registry on Docker VM
loopback, push a small multi-layer image, remove only its run-owned local
reference, pull it through the new adapter, and observe nonzero download bytes,
multiple phases, and a terminal success. It must also simulate a stalled local
response, prove bounded cancellation, and leave zero resources with the run
label. It must not prune shared BuildKit cache or touch pre-existing Docker
volumes, containers, or networks.

The disposable PostgreSQL runner must apply all migrations, report a current
`migrate status`, find zero incomplete or rolled-back migrations, use the
existing `ClientDevice.apiKey` index under `EXPLAIN (ANALYZE, BUFFERS)`, pass
deploy status/planner/readiness/rollback/Ansible contracts, and remove its
container, volume, and network on success, failure, INT, and TERM.

The implementation is accepted locally when no secret appears in captured
stdout, stderr, result JSON, candidate state, or status output; integrity
mismatches still stop; pull availability failures still select local fallback;
and timeout values are unchanged.

Production acceptance is separate. On the next approved Pi5-changing release,
the journal must show a safe progress record every 30 seconds. If the pull
times out, `--status` must retain the last phase, bytes, layer counts, and
no-progress age. This evidence determines whether the next work is API image
slimming, registry/network correction, or safe prefetch.

## Idempotence and Recovery

The Python unit tests are repeatable and use no external resources. The Docker
validator owns every created resource by a unique run ID and label, removes
only those resources, and verifies zero remaining run-owned resources. The
PostgreSQL runner follows its existing unique-resource traps and never connects
to an existing database.

If the new Engine transport cannot establish a connection before starting, the
old CLI pull remains available. If a pull begins and is interrupted, close the
HTTP connection, stop the worker within a bounded grace period, remove
run-scoped tags and extracted containers, and preserve the original timeout or
interruption result. Re-running a deployment remains safe because exact
digest/provenance checks and candidate-residue reconciliation are unchanged.

## Artifacts and Notes

The expected journal record is a single bounded JSON line such as:

    artifact-promotion {"stage":"api-image-pull","state":"progress","phase":"downloading","elapsedSeconds":60.0,"downloadedBytes":104857600,"downloadTotalBytes":1262151764,"bytesAdvancedSinceLastHeartbeat":52428800,"secondsSinceByteProgress":0.2,"knownLayers":26,"completedLayers":4,"activeLayerIds":["5c8728e73c4b"],"timeoutSeconds":600}

This example contains no command, image reference, URL, token, authorization
header, or raw Docker error.

## Interfaces and Dependencies

`scripts/deploy/docker_pull_progress.py` must expose:

    class DockerImagePuller(Protocol):
        def pull(
            self,
            reference: str,
            *,
            username: str,
            token: str,
            execution: PullExecution,
            event_sink: Callable[[PullProgressSnapshot], None],
        ) -> PullResult: ...

    @dataclass(frozen=True)
    class PullProgressSnapshot:
        phase: str
        elapsed_seconds: float
        downloaded_bytes: int
        download_total_bytes: int
        extracted_bytes: int
        extract_total_bytes: int
        bytes_advanced_since_last_heartbeat: int
        seconds_since_byte_progress: float
        known_layers: int
        completed_layers: int
        active_layer_ids: tuple[str, ...]

    @dataclass(frozen=True)
    class PullResult:
        elapsed_seconds: float
        final_snapshot: PullProgressSnapshot
        observability_mode: str

The transport uses only Python standard-library modules. No new runtime Python
package, HTTP API, database field, Prisma migration, or image build input is
introduced.
