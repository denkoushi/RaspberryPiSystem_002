---
id: KB-404
title: Pi5 GHCR API image pull timeout without layer progress evidence
status: mitigated
scope: signed ARM64 artifact acquisition on the production Pi5
date: 2026-07-30
source_of_truth: true
related_code:
  - scripts/deploy/docker_pull_progress.py
  - scripts/deploy/pi5_artifact_promoter.py
related_docs:
  - ../plans/artifact-pull-progress-diagnostics-execplan.md
  - ../plans/api-image-runtime-boundary-execplan.md
  - ../plans/pi5-api-image-local-storage-scalability-execplan.md
  - ../plans/deploy-workflow-artifact-promotion-execplan.md
  - ../guides/deployment.md
  - ../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md
  - ../decisions/ADR-20260730-bounded-api-runtime-artifact.md
validation: focused progress/promoter tests, isolated loopback Docker registry, and full deployment contracts
open_items:
  - verify one separately approved production API pull completes as promoted
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

After the progress diagnostic was deployed, production run
`20260730-121829-96482d` supplied the missing evidence. Docker reported a
1,189,680,246-byte download target for the active layers. Progress reached
60,146,725 bytes at 30 seconds, 170,460,072 at 90 seconds, 256,443,304 at
180 seconds, 334,037,928 at 240 seconds, 434,504,223 at 300 seconds, and
492,175,903 at 420 seconds. It was unchanged for the 330-, 360-, and
390-second observations, then resumed. At 540 seconds it had reached
717,619,743 bytes. The 600-second timeout retained a final snapshot of
793,117,215 bytes (66.7 percent), two completed layers, phase `downloading`,
and no extraction progress.

The effective average was about 1.32 MB/s. At that rate, the first complete
pull needs roughly fifteen minutes. This is a slow transfer with one
approximately 107-second stall, not a completed download blocked in
verification or extraction.

## What is confirmed

- The failure was availability, not a signature, digest, source SHA,
  configuration hash, repository, or platform mismatch.
- The 600-second image timeout and 900-second promotion budget behaved as
  designed.
- A partial pull did not bypass verification or reach traffic switching.
- Run-owned tags and temporary authentication state were cleaned.
- The local builder fallback, Blue/Green checks, five-minute monitor, terminal
  rollout, and same-SHA no-op remained effective.
- The diagnostic production run completed successfully after fallback. Traffic
  switching and the 302.9-second stability monitor succeeded without rollback,
  and the same-SHA plan was a no-op.

## What remains unknown

The trace proves that the artifact is too large to finish within 600 seconds at
the observed effective rate. It does not isolate why the Pi5-to-GHCR transfer
averaged that rate or paused for about 107 seconds.

The operator Mac reached the Pi5 through a Tailscale DERP relay and showed
unstable latency during the same period. That path is not the Pi5-to-GHCR
download path, so it is not evidence that the home router caused the image
pull delay. The trace likewise does not justify attributing the stall solely to
GHCR or Docker.

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

The measured response is bounded rather than open-ended. API image pull receives
1,200 seconds, Web image pull remains at 600 seconds, and the whole promotion
receives 1,500 seconds. Exact-digest and signature verification, thirty-second
progress, integrity fail-closed behavior, cleanup, and the local-build
availability fallback remain unchanged.

The API Dockerfile also exposes a stable `api-runtime` boundary. The
2026-07-31 footprint follow-up removed the duplicate full Chromium browser,
Ansible community collections, and Web-only pnpm dependencies without
removing OCR or backup behavior. A local exact ARM64 OCI build measured
845,913,117 compressed bytes across 26 layers, with a 530,496,867-byte largest
layer. That is 32.98 percent below the 1,262,151,764-byte baseline.

CI now rejects the exact ARM64 OCI image above 1,000,000,000 compressed bytes,
a 700,000,000-byte single layer, or forty layers. It also fixes the intended
minimum reduction above twenty percent. The image still keeps NDLOCR,
RapidOCR, Tesseract.js, Poppler, PostgreSQL client tools, Ansible Core, and a
Playwright headless shell. Runtime smoke rendered both PNG and PDF output and
executed the Core-only client-directory backup playbook.

This does not create one extra full copy for every release: Docker reuses
content-addressed layers and the release labels remain after filesystem
changes. PR #1135 was merged as
`09fe5a9d0fd1e44aa7fcaafb5d34b0e1da7a0b21`; main CI run
`30606390289` passed, including the exact ARM64 release API image and release
set. An approved production artifact promotion remains the final acceptance
boundary; a local-build fallback is safe but does not prove the transfer
improvement.

## Validation and production boundary

Unit tests inject time and stream events, so timeout and heartbeat behavior do
not wait 600 real seconds. An isolated loopback registry verifies actual
multi-layer byte progress and cleanup without pruning shared BuildKit cache or
changing existing Docker resources. The disposable PostgreSQL deployment
runner remains the regression boundary for migration, status, readiness,
rollback, and Ansible contracts.

Production acceptance for the mitigation is separate: after hosted CI and a
separately approved Pi5-changing deployment, the exact signed API pull must
finish as `promoted` within the new bound, or preserve its progress and use the
existing safe fallback. Further API slimming, prefetch, or service extraction
will be considered only if that bounded first pull or later growth remains
operationally unacceptable.
