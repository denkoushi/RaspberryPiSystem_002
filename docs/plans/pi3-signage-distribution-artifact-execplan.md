---
id: plan-pi3-signage-distribution-artifact
title: Build and attest one immutable Pi3 signage distribution artifact
status: in_progress
date: 2026-08-06
source_of_truth: true
scope: Stage 1 deterministic build, verification, CI scan, GHCR publication, and attestation only
related_code:
  - scripts/deploy/signage-release-artifact.py
  - clients/status-agent/
  - infrastructure/ansible/roles/signage/templates/
  - scripts/ci/classify_changes.py
  - .github/workflows/ci.yml
validation:
  - focused real-builder artifact contracts
  - CI classifier and workflow contracts
  - one complete local deploy-contract run
open_items:
  - merge the focused PR and verify exact-main GHCR publication and attestation
---

# Build and attest one immutable Pi3 signage distribution artifact

This ExecPlan is a living document. The sections `Progress`, `Surprises &
Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to
date as work proceeds. Maintain this document in accordance with
`.agent/PLANS.md`.

## Purpose / Big Picture

Pi3 signage currently receives its status agent as one small generated zipapp,
while its display scripts, systemd definitions, and maintenance asset remain
separate repository-managed inputs. Stage 1 creates one immutable distribution
artifact containing all of those release inputs. The artifact can be rebuilt
byte for byte from the same Git SHA, inspected without a Raspberry Pi, scanned
on pull requests, and published with an attestation only by an exact-main CI
run.

This stage changes distribution foundations only. It does not transfer or
install the new artifact, alter the existing Pi3 deploy path, contact any
terminal, recover an active run, or modify Pi4/Pi5 release behavior. A human can
observe the result by running the real builder twice, comparing the artifact
bytes, extracting the tar, and asking the verifier to prove every file digest
and mode. After merge, the exact main workflow additionally publishes a
distinct `raspisys-pi3-signage` OCI image and attests its source, artifact, and
manifest identities.

## Progress

- [x] (2026-08-06 14:30+09:00) Confirmed clean `main` and `origin/main` at
  `cc3030749b59ea09b461b85e63dd2e0a2a07b236`, audited the current status-agent
  builder, signage templates, CI classifier, release publication, and local
  deploy-contract runner, then created branch
  `feat/pi3-signage-distribution-artifact`.
- [x] (2026-08-06 14:35+09:00) Fixed the Stage 1 artifact allowlist, manifest
  schema, permission boundary, and non-goals before editing implementation.
- [x] (2026-08-06 14:42+09:00) Added real-builder and CI workflow contracts;
  the first focused run failed RED because
  `scripts/deploy/signage-distribution-artifact.py` did not yet exist.
- [x] (2026-08-06 14:58+09:00) Implemented deterministic build/verify/inspect,
  canonical ZIP_STORED normalization, and the isolated scratch OCI image.
- [x] (2026-08-06 15:08+09:00) Added exact Signage input classification,
  read-only contract/build/scan CI, scanned-byte handoff, and main-only
  publication/custom attestation.
- [x] (2026-08-06 15:16+09:00) Passed 38 focused Signage/classifier/workflow
  contracts, all 106 CI contracts, workflow YAML parsing, Python compilation,
  and diff whitespace validation.
- [x] (2026-08-06 15:24+09:00) Ran the complete local deploy-contract exactly
  once. It passed 106 Ansible template parses and initial lifecycle/safety
  contracts, then the local Docker Desktop metadata database returned an I/O
  error. Per scope, this environment failure will not be retried or converted
  into a product change; the clean hosted `deploy-contract` job remains the
  acceptance authority.
- [ ] Open the normal PR, obtain clean CI, merge, and verify exact-main publication/attestation.
- [ ] Finish with a clean repository without starting Stage 2, a preflight, or production work.

## Surprises & Discoveries

- Observation: the existing `signage-release-artifact.py` is intentionally a
  status-agent-only zipapp and also owns current staging/apply operations.
  Evidence: its archive contains four Python modules and
  `SIGNAGE-RELEASE.json`, while its CLI exposes `preflight`, `promote`,
  `consume`, and `cleanup`. Replacing it would change the current Pi3 runtime,
  which Stage 1 forbids.

- Observation: the complete secret-free release material already has a finite
  repository allowlist.
  Evidence: it is one generated zipapp, four shell templates, nine unit/timer
  templates, one tmpfiles template, and one maintenance SVG. Credentials and
  host values appear only as unrendered Jinja variables; inventory, vault,
  config, cache images, and run state are not needed.

- Observation: the existing status-agent zipapp uses DEFLATE, whose byte stream
  may depend on the runner's zlib implementation even though entry timestamps
  and order are fixed.
  Evidence: `scripts/deploy/signage-release-artifact.py` writes every entry with
  `ZIP_DEFLATED`. The distribution builder therefore re-emits those proven
  entry bytes with `ZIP_STORED`, sorted names, and fixed metadata without
  changing the deployed status-agent builder.

- Observation: local Docker artifact export is unavailable independently of
  the product implementation.
  Evidence: BuildKit stopped with `write ... containerdmeta.db: input/output
  error`; the single full deploy-contract run later stopped at the same Docker
  Desktop metadata boundary after its non-Docker safety contracts had passed.
  The repository builder, verifier, workflow YAML, and focused contracts remain
  green, so hosted CI is the required clean-runtime proof.

- Observation: the local pre-commit workspace lint environment is also outside
  this Stage 1 runtime.
  Evidence: the hook found Node 18 where the repository requires Node 20.9 or
  newer and could not find package-local ESLint installations. Per the frozen
  scope, dependency setup was not added; focused Python/CI contracts passed and
  hosted CI owns the clean Node validation.

## Decision Log

- Decision: Add a separate distribution builder and leave every function and
  action in `scripts/deploy/signage-release-artifact.py` unchanged.
  Rationale: Stage 1 must prove the new artifact without changing transfer,
  preflight, installation, rollback, or recovery behavior.
  Date/Author: 2026-08-06 / Codex

- Decision: Use an uncompressed POSIX tar with sorted paths, root numeric
  ownership, empty owner names, mtime zero, fixed modes, and regular files
  only.
  Rationale: these standard-library controls make byte-for-byte reproduction
  and fail-closed verification direct; OCI supplies the registry transport and
  layer compression independently.
  Date/Author: 2026-08-06 / Codex

- Decision: Keep the artifact digest outside the internal manifest.
  Rationale: embedding the digest of the containing tar would be
  self-referential. The internal manifest binds all payload bytes and modes;
  the external descriptor binds the canonical manifest digest and complete tar
  digest; the OCI attestation binds both to the registry digest and source SHA.
  Date/Author: 2026-08-06 / Codex

- Decision: Normalize only the embedded copy of the generated status-agent
  zipapp to uncompressed canonical entries.
  Rationale: this removes zlib-version variability from the complete artifact
  while preserving the existing Pi3 transfer/apply artifact implementation and
  its runtime behavior exactly.
  Date/Author: 2026-08-06 / Codex

- Decision: Isolate write permissions in a main-only publication job.
  Rationale: pull requests need build, contract, and scan capabilities but
  never package, identity-token, or attestation writes. Existing API/Web
  publication and attestations remain separate and unchanged.
  Date/Author: 2026-08-06 / Codex

- Decision: Publish the exact tar and descriptor scanned by the contract job,
  not a later rebuild.
  Rationale: deterministic rebuild tests remain necessary, but passing the
  same run-scoped bytes makes the scan-to-publication identity direct and
  removes a needless trust gap between jobs.
  Date/Author: 2026-08-06 / Codex

## Outcomes & Retrospective

Implementation is in progress. Stage 1 is complete only after the focused PR
is merged, exact-main publication and attestation bind the three required
identities, and the worktree is clean. Stage 2 transfer and activation work,
Stage 3 authority simplification, and all production operations remain outside
this plan.

The implementation design is frozen at canonical ZIP_STORED entries, a
deterministic POSIX tar, run-scoped scanned-byte handoff, publish-time
verification, and one existing-action custom predicate. Reproducible-build
frameworks, generalized CI artifact management, Docker cleanup work, and other
images are explicitly deferred.

## Context and Orientation

`scripts/deploy/signage-release-artifact.py` derives and builds the executable
status-agent zipapp. It is already consumed by the deployed Pi3 path and must
not change. `clients/status-agent/` and
`scripts/deploy/rolling_release/terminal_device_maintenance.py` are the Python
source closure embedded in that zipapp.

`infrastructure/ansible/roles/signage/templates/` contains the display scripts,
systemd service/timer definitions, tmpfiles rule, and maintenance SVG. The new
artifact stores unrendered templates because the repository contains no host
identity or credential suitable for an immutable shared artifact. A template
is a file containing Jinja variables such as `{{ ansible_user }}`; Stage 2 may
render those variables, but Stage 1 only packages and verifies the source.

The new internal `SIGNAGE-ARTIFACT.json` has `schemaVersion`,
`artifactKind`, `sourceSha`, `payloadDigest`, and `files`. Each file record has
an archive `path`, future `installPath`, repository `sourcePath`, `kind`,
`templated`, decimal `size`, four-digit octal `mode`, and lowercase SHA-256.
The payload digest is the SHA-256 of the canonical JSON file-record list. The
external descriptor adds the SHA-256 and size of the complete tar and the
SHA-256 of the exact internal manifest bytes.

`scripts/ci/classify_changes.py` selects conditional CI jobs. It must add one
`signage_artifact` category selected only by the allowlisted inputs, the two
artifact builders, their contract, and the Signage OCI Dockerfile, except that
the existing fail-closed full-suite cases still select all categories.
`.github/workflows/ci.yml` must expose that category, run one read-only
contract/scan job, include it in `ci-required`, gate exact-main publication on
the fixed external checks, and give only the publication job package,
attestation, and identity-token writes.

## Plan of Work

First add a contract that invokes the real builder, opens its real tar, and
checks the exact allowlist, source/install paths, bytes, sizes, fixed modes,
manifest digest, and artifact descriptor. Build twice into different paths and
require equal bytes and descriptors. Mutate the manifest, a payload, and the
expected source SHA independently and require verification to fail. Construct
temporary repository roots that attempt a secret or host-specific source and
require the allowlist builder to refuse them rather than filtering silently.

Then add `scripts/deploy/signage-distribution-artifact.py`. It imports the
existing status-agent builder without changing it, creates the zipapp in a
temporary directory, maps the fixed source allowlist to fixed archive and
future installation paths, creates the canonical manifest, and writes a
deterministic tar plus descriptor. Its `verify` command must distrust both tar
and descriptor: reject unexpected/missing/duplicate paths, links, devices,
directories, unsafe paths, metadata drift, payload drift, malformed schema,
source mismatch, manifest mismatch, artifact mismatch, or bounds violations.

Add `infrastructure/docker/Dockerfile.signage-release` as a scratch image that
copies only the tar and descriptor and labels the exact source and two internal
digests. Extend CI classification and workflow contracts before wiring the
workflow. The read-only job builds twice, verifies, builds a local OCI image,
scans the exact local image with Trivy, and uploads only those verified bytes
within the workflow run. The main-only job downloads the scanned tar and
descriptor, verifies their exact SHA binding again, publishes them to the
dedicated GHCR repository with the exact SHA tag, then uses a custom predicate
to attest `sourceSha`, `artifactSha256`, and `manifestSha256` against the
resulting OCI digest.

Finally pass focused tests, related CI contracts, and one invocation of
`bash scripts/ci/run-deploy-contracts-local.sh`. Do not rerun that full command
unless the user separately authorizes it. Publish the focused branch as a
normal PR, wait for clean CI, merge through the repository's protected flow,
and inspect the exact-main workflow and attestation. Stop without invoking any
deployment plan, preflight, terminal connection, active-run cleanup, or
production command.

## Concrete Steps

Run from `/Users/tsudatakashi/RaspberryPiSystem_002`:

    python3 -m unittest scripts.deploy.tests.test_signage_distribution_artifact
    python3 -m unittest scripts.ci.tests.test_classify_changes scripts.ci.tests.test_classify_event_changes scripts.ci.tests.test_staged_ci_workflow

Before implementation, the new artifact and workflow assertions must fail.
After implementation, both focused commands must pass. Then run related
existing artifact contracts and, only after all focused checks are green:

    bash scripts/ci/run-deploy-contracts-local.sh

That last command is the sole full deploy-contract run for this Stage 1 task.
It validates local files and disposable fixtures and must never contact managed
hosts.

## Validation and Acceptance

The artifact contract passes only if the real builder produces two identical
tar byte streams for one source SHA; extraction yields exactly the 16 payload
files plus `SIGNAGE-ARTIFACT.json`; every file byte, SHA-256, size, and mode
matches its manifest; tar ownership and mtime are normalized; and the external
descriptor matches the complete tar and exact manifest.

Separate tests must demonstrate fail-closed rejection of a secret or
host-specific input, changed manifest bytes, changed payload bytes, and an
expected source SHA different from the embedded SHA. CI contracts must prove
that Signage inputs select the new job, unrelated Pi4/Pi5/API/Web inputs do not
select it, pull-request execution has no write permission, only exact-main can
publish, and the existing API/Web release-set still has exactly its original
three attestations.

Acceptance additionally requires one green full deploy-contract run, a normal
clean PR, clean hosted CI, an exact-main dedicated OCI digest, an attestation
whose predicate records the exact source SHA and the locally derivable
artifact and manifest digests, no API/Web or Pi4/Pi5 regression, and a clean
repository. There is no terminal or production acceptance action in Stage 1.

## Idempotence and Recovery

Build and verify commands are pure local filesystem operations and may be
repeated into fresh paths. The builder writes through a temporary sibling and
atomically replaces its output so interruption cannot leave an accepted
partial artifact. Tests use temporary directories and remove their outputs.
CI publishes an immutable exact-SHA tag only after all gates pass; a digest
mismatch fails rather than overwriting a trusted identity.

If local dependencies prevent the full deploy-contract, record the environment
failure without altering product code. Never compensate by contacting Pi3,
editing the failed active run, or starting a deploy. Git recovery uses ordinary
feature-branch commits; no production rollback exists in this stage because no
runtime path changes.

## Artifacts and Notes

Initial authority:

    main = origin/main = cc3030749b59ea09b461b85e63dd2e0a2a07b236
    worktree = clean
    production access = forbidden for this plan

The artifact payload is exactly 16 files: one generated zipapp, four executable
shell templates, nine systemd unit/timer templates, one tmpfiles template, and
one static maintenance SVG. The manifest is a seventeenth tar member.

## Interfaces and Dependencies

`scripts/deploy/signage-distribution-artifact.py` must expose Python functions
equivalent to:

    build_artifact(root: Path, output: Path, descriptor: Path, source_sha: str) -> dict
    verify_artifact(artifact: Path, descriptor: Path, expected_source_sha: str | None) -> dict

and CLI actions `build`, `verify`, and `inspect`. It must use only the Python
standard library and the existing local status-agent builder. The build action
accepts repository root, output path, descriptor path, and exact source SHA.
The verify action additionally accepts an optional expected source SHA. Inspect
prints the verified descriptor and internal manifest as canonical JSON.

The OCI image must be `FROM scratch`, contain only
`/signage-release.tar` and `/signage-release-descriptor.json`, and carry labels
for the Git revision, artifact SHA-256, and manifest SHA-256. No new framework,
runtime dependency, secret, inventory value, transfer protocol, or deploy
adapter is permitted.

Revision note (2026-08-06): Created the self-contained Stage 1 execution plan
after the read-only repository audit and before RED contracts or implementation.

Revision note (2026-08-06): Recorded RED/GREEN evidence, the frozen
scan-to-publish byte boundary, and the one permitted full deploy-contract run's
local Docker environment failure before PR publication.
