---
id: KB-404
title: Pi5 GHCR API image pull timeout without layer progress evidence
status: investigating
scope: signed ARM64 artifact acquisition on the production Pi5
date: 2026-07-30
source_of_truth: true
related_code:
  - scripts/deploy/docker_pull_progress.py
  - scripts/deploy/pi5_artifact_promoter.py
related_docs:
  - ../plans/artifact-pull-progress-diagnostics-execplan.md
  - ../plans/deploy-workflow-artifact-promotion-execplan.md
  - ../guides/deployment.md
  - ../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md
validation: focused progress/promoter tests, isolated loopback Docker registry, and full deployment contracts
open_items:
  - collect one production pull trace after separate merge and deployment approval
  - choose image slimming, network correction, or prefetch only from measured evidence
---

# KB-404: Pi5 GHCR API image pull timeout

## Incident

Production run `20260730-095004-92ae3e` successfully selected the exact signed
release set and verified its attestations. The subsequent API image pull stayed
alive for the full 600-second allowance and timed out. Cleanup succeeded and
the existing local builder fallback completed the release safely.

The immutable API artifact contained about 1,262,151,764 compressed bytes
across 26 layers. Its two largest layers were about 749 MB and 308 MB. A
GitHub-hosted runner could retrieve the same artifact in about one minute, but
that comparison does not identify the Pi5 bottleneck.

## What is confirmed

- The failure was availability, not a signature, digest, source SHA,
  configuration hash, repository, or platform mismatch.
- The 600-second image timeout and 900-second promotion budget behaved as
  designed.
- A partial pull did not bypass verification or reach traffic switching.
- Run-owned tags and temporary authentication state were cleaned.
- The local builder fallback, Blue/Green checks, five-minute monitor, terminal
  rollout, and same-SHA no-op remained effective.

## What remains unknown

The earlier heartbeat recorded only elapsed time. It did not record Docker
layer bytes or phases, so existing evidence cannot distinguish:

- a Pi5-to-GHCR network or registry stall;
- a transfer that remained active but was too slow for the artifact size;
- a completed download blocked in checksum verification or extraction;
- a bounded Docker Engine transport error.

Do not attribute the incident to the router, GHCR, Docker, disk, or image size
without a progress trace.

## Diagnostic contract

The promoter now prefers Docker Engine's local Unix-socket pull stream. Every
30 seconds it emits only bounded aggregate values:

- stage and phase (`downloading`, `verifying`, or `extracting`);
- downloaded and total compressed bytes;
- extracted and total bytes reported by Docker;
- bytes advanced since the preceding heartbeat;
- seconds since byte progress;
- known and completed layer counts;
- at most eight validated 12-character layer IDs.

Timeout and transport-unavailable results preserve the last snapshot under
`artifactPromotion.pullDiagnostics`, which is visible through the standard
`--status` output. Commands, image references, URLs, tokens, authorization
headers, and raw Docker errors are never copied into the journal or release
state.

If the Engine API is unavailable before a pull starts, the existing Docker CLI
path remains available. Once an Engine pull starts, timeout or transport
failure does not start a duplicate pull; it follows the existing local builder
fallback.

## Interpretation

- `downloading` with zero byte increase and a growing
  `secondsSinceByteProgress` points to the transfer/registry/daemon boundary.
- `downloading` with steady but insufficient byte increase points to artifact
  size versus effective throughput.
- `verifying` or `extracting` after download completion points to Pi5-local
  checksum, decompression, disk, or Docker processing.
- `transportReasonCode` identifies a bounded Engine API class; it is not a raw
  daemon message.

One trace is evidence for the next investigation, not permission to weaken
signatures or increase timeouts. Keep the 600-second per-image timeout,
900-second total budget, exact-digest verification, and local fallback until a
separate approved plan changes them.

## Validation and production boundary

Unit tests inject time and stream events, so timeout and heartbeat behavior do
not wait 600 real seconds. An isolated loopback registry verifies actual
multi-layer byte progress and cleanup without pruning shared BuildKit cache or
changing existing Docker resources. The disposable PostgreSQL deployment
runner remains the regression boundary for migration, status, readiness,
rollback, and Ansible contracts.

Production acceptance is separate: the next approved Pi5-changing deployment
must show 30-second progress and retain the final safe snapshot on timeout.
Only then should the team choose API image slimming, network correction, or
safe prefetch.
