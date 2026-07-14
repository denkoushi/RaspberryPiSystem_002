---
title: Pi5 and terminal rolling deployment resilience
status: in_progress
date: 2026-07-14
owner: Codex
related_code:
  - scripts/deploy/pi5-image-deploy.sh
  - scripts/deploy/pi5-blue-green.sh
  - scripts/deploy/rolling-release.py
  - infrastructure/ansible/roles/client
related_docs:
  - ../runbooks/pi5-blue-green-deploy.md
  - ../runbooks/deploy-status-recovery.md
  - ../decisions/ADR-20260714-rolling-deploy-resilience.md
  - ../knowledge-base/KB-401-rolling-deploy-resilience.md
validation: baseline deploy lifecycle tests passed before implementation
open_items:
  - Recover the offline RoboDrill01 kiosk, then update it through its own
    verified standard run.
  - Decide whether to update the reachable but deliberately untouched
    Sessaku-01 kiosk in a separate run after the failed RoboDrill01 run.
  - Keep Docker build metadata out of the dependency-layer cache key before
    the next source-changing Pi5 release; same-SHA reuse is working, but a
    fresh SHA still rebuilds the expensive API dependency layer.
---

# Pi5 and terminal rolling deployment resilience

This ExecPlan is a living document and follows `.agent/PLANS.md`. Keep
`Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` current as work proceeds.

## Purpose / Big Picture

The standard release must finish predictably without weakening its existing
fail-closed safety rules. The 2026-07-14 release showed that a candidate build
can make its own post-build load guard fail, migration history validation can
miss a restored file when no new migration exists, and an offline kiosk can
leave the coordinator running indefinitely.

After this work, a same-SHA candidate is validated and reused rather than
rebuilt, the known heavy signage renderer is paused only for candidate build
and validation, completed migration history is always checksum-verified, and
the rolling coordinator can cancel or time out a terminal without clearing its
maintenance state. During the one bootstrap release where the already-running
API does not yet expose the new internal pause endpoint, the release records
that limitation and uses the same bounded load gate rather than failing or
rebuilding. The user-visible proof is a Pi5 candidate build that waits for a
stable load below 3.00 instead of repeated rebuilds, plus a terminal failure
that is durably marked failed and remains in maintenance until an explicit
verified recovery.

## Progress

- [x] (2026-07-14) Confirmed the current production run is blocked at
  `raspi4-fjv60-80` while `docker compose ... up -d --build nfc-agent` waits.
- [x] (2026-07-14) Confirmed Pi5 has four online CPUs, cgroup v2 CPU support,
  and a signage worker plus Chromium consuming material CPU.
- [x] (2026-07-14) Confirmed the active deployment SHA is `284e0bc5` and
  created `fix/rolling-deploy-resilience` from it.
- [x] (2026-07-14) Baseline tests passed: Phase 2 candidate lifecycle, Phase
  3 lifecycle, and 65 rolling-release tests.
- [x] Add candidate identity, cache reuse, signage-only quiesce, serial build,
  and bounded stable-load wait.
- [x] Make migration history verification unconditional.
- [x] Add coordinator lease metadata, cancel, timeout, boot interruption
  evidence, and persistent journal provisioning.
- [x] Make client agent image builds change-aware.
- [x] (2026-07-14) Isolated `pgvector/pgvector:pg16`: Prisma generation,
  all 147 migrations, `migrate status`, 147/147 SHA-256 checksum rows, and
  `EXPLAIN (ANALYZE, BUFFERS)` for the checksum lookup succeeded; uniquely
  named container, volume, and network were removed and their absence checked.
- [x] Hosted CI passed for `c5d8a4da` and bootstrap compatibility follow-up
  `19ccd48e` (all 19 required checks on each SHA).
- [x] Pi5 deployed `19ccd48e`: the legacy bootstrap path recorded
  `legacy-api-unavailable`, serially built and cached the candidate, completed
  post-build stable-load sampling, verified all 147 migrations, switched slot,
  and completed the five-minute stability window.
- [x] Split the StoneBase01 change-classification facts, validate the
  regression locally, and pass all 19 hosted CI checks for `85fe6198`.
- [x] Pi5 deployed `85fe6198`: signage paused through the protected internal
  API, the API and Web candidate images built serially once, post-build load
  sampling passed without a rebuild, all 147 migration checksums matched, and
  Blue/Green completed its stability window.
- [x] StoneBase01 and raspberrypi4 deployed `85fe6198` successfully. Both
  were verified with the kiosk/browser, status-agent, PC/SC, and required
  NFC/barcode container checks.
- [x] RoboDrill01 safely failed at the new SSH deadline while entering the NFC
  lifecycle. Its rollback attempt also could not reach the terminal; it stays
  in maintenance, the coordinator released its lock, and Sessaku-01 was not
  touched.
- [ ] Recover RoboDrill01 and complete its verified update; separately decide
  whether to update the reachable Sessaku-01 now that the original run has
  failed closed.

## Surprises & Discoveries

- The `3.00` default is not a host-specific measurement: it is four online
  CPUs multiplied by 0.75. It reads the one-minute load average after a
  candidate build, so the release can reject work it just caused.
- `docker compose build api web` builds both candidates in one invocation and
  candidate tags did not contain immutable image labels. A matching tag alone
  is insufficient evidence for safe reuse.
- The current migration validator can verify all applied history, but
  `migration_guard` returns before invoking it when there is no new migration.
- `ansible_command_timeout` did not bound the coordinator's child process as a
  whole. The release has no process-group timeout or cancellation interface.
- The historical Pi5 reboot cause cannot be recovered now because the previous
  boot journal is unavailable. Future incidents need persistent journal and
  durable boot identifiers.
- The first implementation accidentally replaced the fallback lock cleanup
  trap with the signage-resume trap. A combined EXIT handler now releases both
  resources; the Phase 2 lifecycle regression exposed and verified this path.
- The first field attempt correctly failed before any Pi5/Pi4 change because
  the previously deployed API did not yet contain the new signage-control
  route. The bootstrap-compatible path now records `legacy-api-unavailable`,
  keeps the old API serving, and relies on the bounded load gate for that one
  candidate build; all later releases use the protected pause/resume route.

## Decision Log

- Decision: retain the hard load threshold at `3.00`; sample it three times at
  20-second intervals for at most ten minutes before and after candidate build.
  Rationale: 3.00 preserves 25% CPU headroom while eliminating immediate
  self-induced retry churn.
  Date/Author: 2026-07-14 / user and Codex
- Decision: pause only signage rendering, never leaderboard or unrelated
  schedulers.
  Rationale: the renderer and Chromium were measured consumers; the other
  workloads were not proven contributors.
  Date/Author: 2026-07-14 / user and Codex
- Decision: a missing signage-control route on the API that is currently
  serving is a bootstrap compatibility condition, not a reason to disable
  safety checks or abort forever.
  Rationale: the route cannot pause an older process that does not contain it.
  The candidate is built once under the existing bounded 3.00 load contract,
  cached for reuse, and enables pause/resume for all subsequent releases.
- The `85fe6198` field run confirmed that bounded sampling prevents the
  self-induced build/retry loop: it waited through post-build load rather than
  rebuilding. The initial API image build still took about 25 minutes because
  revision/config labels currently occur before the expensive OS/Python OCR
  dependency layer in the Dockerfile. Exact-image reuse avoids that cost on a
  retry of the same SHA, but a future SHA invalidates it. This is recorded as
  a follow-up cache-layout correction rather than hidden by raising the 3.00
  load threshold.
- RoboDrill01 became unreachable during the NFC lifecycle. The new SSH
  deadline returned a normal Ansible `UNREACHABLE` result, the per-terminal
  timeout/rollback path marked it failed, retained its maintenance flag, and
  released the coordinator lock; later terminals were not started.
- The StoneBase01 canary exposed an Ansible evaluation-order error: one
  `set_fact` task calculated image-build facts and runtime-recreate facts that
  referenced them together. Ansible evaluates that task's expressions before
  publishing its facts, so `barcode_agent_image_build_needed` was undefined.
  The release stopped before the client agent lifecycle or kiosk services were
  changed. The terminal remains in maintenance while the classification is
  split into two ordered tasks and revalidated.
  Date/Author: 2026-07-14 / Codex
- Decision: leave FJV60/80 in maintenance today and update the four reachable
  kiosks after the current run is safely cancelled.
  Rationale: an unreachable terminal cannot prove rollback or normal UI state.
  Date/Author: 2026-07-14 / user

## Outcomes & Retrospective

The Pi5 hardening and bootstrap compatibility implementation passed focused
local checks and hosted CI. Pi5 is now running `85fe6198`; its protected
signage pause/resume, serial candidate build, stable-load wait, complete
migration-history validation, and Blue/Green stability window all completed.
StoneBase01 and raspberrypi4 also run `85fe6198` and passed service and kiosk
verification. RoboDrill01 became unreachable after maintenance began and is
therefore explicitly failed, unreverted, and still in maintenance. The
fail-closed coordinator did not touch Sessaku-01. FJV60/80 remains in its
pre-existing maintenance state.

The same-SHA retry path is now safe and does not rebuild candidates. A genuine
new SHA still has a first-build cost because Docker metadata labels precede an
expensive dependency layer; moving the metadata layer after stable build
inputs is the remaining performance follow-up. The 3.00 threshold remains
unchanged because it is a safety headroom policy, not a source-build cache
solution.

Focused evidence: `test-pi5-image-deploy.sh` passed; the Phase 3 lifecycle
passed with the test load sample override; rolling-release 67 tests and
deploy-status 6 tests passed; the client agent command-selection test passed;
the protected signage control API and scheduler tests passed (9 tests); the
focused kiosk Web set passed (5 files / 22 tests); API/Web builds and Web lint
passed. Full API/Web suites exceed this local execution channel's hard command
lifetime and are deliberately deferred to the required hosted CI gate rather
than being reported as local passes.

## Context and Orientation

`pi5-image-deploy.sh` owns immutable candidate build and validation.
`pi5-blue-green.sh` owns slots, migration application, resource safety, and
the five-minute rollback window. `rolling-release.py` owns the Pi5-to-terminal
ordering and deploy-status state. The Ansible common role already gathers old
and new Git SHA differences, while the client role currently unconditionally
builds NFC and barcode images.

## Plan of Work

First make the candidate pair self-identifying with revision and configuration
labels. Build the API and Web one at a time, and reuse only images whose labels
match the requested SHA and current Compose environment hash; validation still
runs on every attempt. Add a token-protected local-only signage control and
turn the scheduler off for the transient validation container.

Next centralize bounded Pi5 resource sampling and record the samples in the
candidate/release state. Always compare every completed Prisma migration
checksum with the candidate working tree before applying pending migrations.

Then add a boot-aware rolling coordinator lease, a controlled cancellation
path, and bounded terminal process groups. A terminal that loses reachability
or exceeds its deadline remains visibly failed in maintenance. Add persistent
journald configuration and capture previous-boot evidence during recovery.

Finally, derive NFC and barcode image-build decisions from the common Git diff
facts. Source and Docker build-input changes build an image; only `.env`
changes recreate from the existing image; unrelated changes only ensure the
container is running.

## Concrete Steps

Run the focused deploy tests after each script boundary, then run the full
workspace validation. For database validation, use a uniquely named temporary
`pgvector/pgvector:pg16` container, volume, network, and dynamic host port;
apply all migrations, run `migrate status`, query `_prisma_migrations`, and run
`EXPLAIN (ANALYZE, BUFFERS)` for the checksum lookup. A shell `trap` removes all
temporary Docker resources whether validation passes or fails.

## Validation and Acceptance

Acceptance requires that candidate reuse never skips validation, label or
configuration mismatch rebuilds, a load timeout does not rebuild, and signage
is resumed on both success and failure. It requires migration history failure
with no new migration, terminal process-group cancellation, boot-mismatch stale
lease recovery, and maintenance retention for an unavailable host. API/Web
lint, build, relevant tests, deploy-script tests, and isolated database checks
must pass before hosted CI and production rollout.

## Idempotence and Recovery

Candidate reuse is valid only for an exact SHA/config label pair and always
revalidates health. A failed wait leaves the existing public slot unchanged and
resumes signage. Cancellation touches only the specified live run, retains any
in-progress terminal maintenance record, and clears a lock only after its
process group is absent. A boot-id mismatch is recorded as an interruption and
never inferred as success.

## Artifacts and Notes

Today’s follow-up release must explicitly select Pi5 plus StoneBase01,
raspberrypi4, robodrill01, and sessaku-01. FJV60/80 and Pi3 stay out of scope.
FJV60/80 is updated later through its own standard run after physical recovery
and verified kiosk operation.

## Interfaces and Dependencies

New operator surface: `scripts/update-all-clients.sh <branch> <inventory>
--cancel <runId> --reason <text>`. The internal signage endpoint accepts only
Docker/loopback callers with `x-deploy-control-token`; the token is sourced
from the existing protected Pi5 environment, never from a browser request.
