# Extend the signed release set for an atomic torque cutover

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The standard deploy route must be able to combine one verified API image, one verified Web image, and one verified multi-architecture torque-agent image even when those components were built from different main commits. Before any browser, agent, or Bluetooth service is stopped, every selected host must already hold the exact candidate image bytes and a recoverable previous image. A deploy-only fix must therefore not require rebuilding an unchanged torque-agent or discovering a missing tag after the kiosks have been quiesced.

The visible success is an atomic two-kiosk cutover. The Pi5 control plane is a no-op when its running API/Web digests already match. StoneBase and Assembly-01 stage the same manifest-bound torque-agent digest without starting it. Both agents must then become healthy while Bluetooth and ownership remain OFF; only after the aggregate boundary passes may both browsers restart. A failure on either kiosk restores the previous set on both and keeps both browsers, agents, and Bluetooth OFF.

## Progress

- [x] (2026-08-18 JST) Re-read repository safety, architecture, test, Git, documentation, deployment and ExecPlan rules.
- [x] (2026-08-18 JST) Revalidated clean base `origin/main` and local HEAD at `2edefaa0657a0e34152d5622c8af0e1d5e52d90c`; created branch `feat/release-set-v2-torque-cutover` in the dedicated worktree.
- [x] (2026-08-18 JST) Confirmed that torque-agent source and Dockerfile are unchanged from artifact source `3464256da11ee77bebfceb4fafcff4524f5ac8ca` to the base commit.
- [x] (2026-08-18 JST) Confirmed the existing torque-agent multi-architecture index and child digests and the original ARM64/ARMv7 Trivy-success job.
- [x] (2026-08-18 JST) Created this ExecPlan and `docs/decisions/ADR-20260818-release-set-v2-component-adoption.md` before source edits.
- [ ] Implement backward-compatible release-set schema v2, the torque component adoption predicate, and combination compatibility evidence.
- [ ] Implement service-uninterrupted PREPARED staging before quiesce by reusing the standard wrapper and Ansible roles.
- [ ] Add focused contract, workflow, fixture and Ansible phase-boundary tests.
- [ ] Update the deployment guide and recovery runbook, then run bounded local validation.
- [ ] Commit, push, open a PR, pass exact-head CI, merge to main, and confirm signed main artifacts.
- [ ] Run the approved production cutover only after the exact main release-set v2 passes PREPARED for Pi5, StoneBase and Assembly-01.

## Surprises & Discoveries

- Observation: the API/Web release-set already has strict JSON parsing, immutable OCI publication, and GitHub attestation, but it only accepts schema version 1 and a single source SHA.
  Evidence: `scripts/deploy/release_artifact_contract.py` rejects every version except 1 and `.github/workflows/ci.yml` attests API, Web and release-set subjects.
- Observation: Pi4 agent publication creates BuildKit provenance and SBOM descriptors but no GitHub artifact attestation that the production verifier can validate.
  Evidence: `gh attestation verify` for torque index `sha256:810d4c17e581faa352c57ce6930f251d2f9ecb5f7839b1b29ae128f6d3c6c443` found neither an OCI bundle nor a GitHub attestation.
- Observation: the existing kiosk role already pulls candidate images while normal kiosk services remain active, but torque cutover invokes that role only after quiesce and Pi5 processing.
  Evidence: `release_kiosk/tasks/prepare.yml` performs rollback capture and `docker image pull`; `deploy-release-standard.yml` currently orders torque quiesce before Pi5 and kiosk roles.
- Observation: Pi5 preparation already detects the desired API/Web image IDs and classifies a matching running release as settled, but its pull and capacity checks currently happen after kiosk quiesce.
  Evidence: `release_pi5/tasks/prepare.yml` sets `release_pi5_same_release` from exact image IDs and maps it to route `settled`.

## Decision Log

- Decision: Extend the existing signed release-set to schema version 2 instead of creating a torque-specific release source of truth.
  Rationale: v1 remains readable and the same OCI storage, signature identity, parser and verification boundary can be reused. A parallel release system would recreate identity drift.
  Date/Author: 2026-08-18 / Codex.
- Decision: Model reuse of the `3464256d` artifact as signed component adoption, never as a new build provenance statement.
  Rationale: the bytes were built by the original workflow. The new statement proves later adoption using original source/run/job, an unchanged source closure, current scans, index/child digests and a fixed scan policy without misrepresenting who built them.
  Date/Author: 2026-08-18 / Codex.
- Decision: Version the torque ownership wire contract and bind one tested API/Web/agent tuple into each v2 release set.
  Rationale: independently valid images are not necessarily mutually compatible. The manifest must prevent arbitrary mixing even when every individual component is signed.
  Date/Author: 2026-08-18 / Codex.
- Decision: Keep durable evidence to a signed release-set v2 plus one run-scoped execution record.
  Rationale: adoption fields and compatibility evidence live inside or are directly referenced by the signed release set; PREPARED and rollback observations live in the existing run directory and Ansible facts. No independent receipt platform is introduced.
  Date/Author: 2026-08-18 / Codex.
- Decision: Treat PREPARED as service-uninterrupted, non-destructive staging rather than read-only verification.
  Rationale: `docker pull`, local digest materialization, rollback tags and run directories change disk state. They are safe before quiesce because running services are untouched and a failed candidate can be cleaned without stopping them.
  Date/Author: 2026-08-18 / Codex.

## Outcomes & Retrospective

Implementation is in progress. The current production control plane remains healthy and the two selected torque kiosks remain intentionally OFF after the previous fail-closed run. No new production mutation is permitted until an exact merged-main v2 manifest is signed, its declared component tuple is verified, and service-uninterrupted PREPARED staging succeeds on all three selected hosts.

## Context and Orientation

`scripts/deploy/release_artifact_contract.py` is the strict API/Web release-set parser and serializer. Schema v1 binds one main source SHA, one configuration hash, one ARM64 API digest, one ARM64 Web digest, and the producing workflow. `.github/workflows/ci.yml` publishes that JSON in an immutable OCI image and uses `actions/attest` for the API, Web and release-set digests.

`scripts/deploy/standard-ansible-release.py` is the only public deployment coordinator behind `scripts/update-all-clients.sh`. It resolves the selected main SHA and v1 release set, but currently invents every Pi4 agent tag from the same orchestration SHA. `infrastructure/ansible/playbooks/deploy-release-standard.yml` orders torque quiesce, Pi5, per-kiosk staging and aggregate resume. `release_pi5`, `release_kiosk`, and `release_torque_cutover` own the actual service lifecycle and rollback behavior.

A component adoption attestation is a signed claim that an already-built immutable image is accepted for a later release after its original source and CI evidence have been checked again. It is not build provenance. The initial adopted torque index is `sha256:810d4c17e581faa352c57ce6930f251d2f9ecb5f7839b1b29ae128f6d3c6c443`, built from `3464256da11ee77bebfceb4fafcff4524f5ac8ca`. Its ARM64 child is `sha256:4a086be9b7a5b2f5b35b6418a708de36bc3465387dda944a2f62e9bf3c2ebc7c`; its ARMv7 child is `sha256:5f63ea8ae48c446751279756b4b49572fe5b19150aa215a15bbc0a5fe6d24737`. Original workflow run `32093659078`, job `95581851495`, scanned both architectures successfully. The torque source closure is `clients/torque-agent` plus `infrastructure/docker/Dockerfile.torque-agent`; its tree is unchanged through the base commit.

The torque ownership protocol consists of the localhost acquire/takeover/renew/release/status payloads and the Pi5 usage-lease routes. Version 1 requires a profile ID, owner kind, client and session identity, lease ID, generation fencing, `connectAfter`, exact-token conditional release, self-only token status, and exact-token-only communication recovery. Existing API, Web and agent tests exercise those properties. Schema v2 records this protocol version and one exact tested component tuple so a deploy cannot substitute another individually signed digest.

## Plan of Work

First, evolve `scripts/deploy/release_artifact_contract.py` additively. Keep the existing `ReleaseSet` v1 representation and validation behavior. Add schema v2 data classes for the ARM64 API/Web images, the multi-architecture torque-agent component, its signed adoption evidence, and a compatibility record. The compatibility record names protocol `torque-ownership`, version 1, lists the exact component digests it covers, and names the exact main workflow run and job that ran the combination rehearsal. Unknown fields, duplicate keys, missing architectures, mismatched tuple digests, unexpected repositories and malformed evidence remain hard errors. v1 parsing and serialization tests must continue unchanged.

Second, add a small CI helper dedicated to the adoption predicate rather than expanding the release parser into a GitHub client. It validates the fixed initial source and index identities, confirms source ancestry and closure equality with Git, validates the OCI index contains exactly the required ARM64 and ARMv7 children, and emits a canonical predicate only after both Trivy scans pass. The predicate includes the original source SHA, original workflow/run/job, index and child digests, scan policy and current adoption workflow identity. `actions/attest` signs the existing torque index with a custom adoption predicate type. This never emits a provenance predicate and never retags the image.

Third, add a focused combination rehearsal job. It runs the existing API lease/generation/fencing tests, torque-agent global-ownership tests, and Web transport/controller compatibility tests against the current checkout. Before those tests count for the historical agent artifact, the adoption helper proves the entire agent source closure at the current checkout equals `3464256d`. The release-set v2 creation job may run only after the adoption and rehearsal jobs succeed, and records their immutable evidence and exact tuple.

Fourth, change the standard wrapper to resolve a v2 torque release set when `--torque-cutover` is selected. API and Web remain exact digest references from the release set. Torque becomes `repository@indexDigest`, not a tag derived from orchestration SHA. The wrapper validates the release-set signature using the existing pinned GitHub attestation pattern, validates the adoption predicate and tuple compatibility, and passes only exact digest references and the protocol version to Ansible. Normal deployment remains compatible with v1 and its current behavior.

Fifth, add a PREPARED play before the existing quiesce play. On Pi5, prefetch API/Web, inspect expected local image IDs and platform, check disk headroom, and capture the currently running exact image identities needed for recovery without starting or switching a container. On every selected Pi4, reuse `release_kiosk/tasks/prepare.yml` to capture the stopped or running previous torque image, pull the exact candidate digest, inspect its platform and digest, check disk headroom, and render run-scoped candidate/rollback files without switching a service. Facts survive into later plays so the post-quiesce kiosk phase does not repeat preparation. If any host fails, remove only the candidate and run-scoped staging created by this run; do not stop browsers, agents or Bluetooth.

Finally, retain the existing quiesce and aggregate finalize behavior. Pi5 preparation revalidates the prefetched images and uses its existing settled route when current image IDs already match, producing a no-op control-plane transition. All selected kiosks must stage successfully, then all agents must be healthy with no lease, no self token, the guard active and Bluetooth OFF. One failure restores every selected kiosk's captured previous image and leaves every target OFF. Browsers start only after the all-agent boundary passes.

## Concrete Steps

Work only in `/Users/tsudatakashi/RaspberryPiSystem_002-torque-wrench-global-ownership-deploy` on `feat/release-set-v2-torque-cutover`.

Inspect each milestone with:

    git status --short --branch
    git diff --stat
    git diff --check

Run the release contract and deploy wrapper tests using the repository Python without installing packages or changing the lockfile:

    python3 -m unittest scripts.deploy.tests.test_release_artifact_contract
    python3 -m unittest scripts.deploy.tests.test_standard_ansible_release
    python3 -m unittest scripts.deploy.tests.test_ansible_standard_release

Run the workflow-policy and classification tests selected by the CI changes, then the existing focused torque compatibility tests. Use existing app-local executables or frozen dependency installation only; `pnpm-lock.yaml` and `pnpm-workspace.yaml` must remain byte-identical to the base commit.

Use local OCI fixture JSON for parser and architecture failure cases. Registry and attestation verification that needs GitHub identity is final hosted-CI evidence, not a locally forged substitute. No production host is contacted during local implementation validation.

## Validation and Acceptance

Release contract tests must parse existing schema v1 documents without change and parse schema v2 only when API, Web and torque repositories, digests, platforms, evidence and compatibility tuple are exact. Tests must reject an altered torque digest, missing ARMv7 child, protocol mismatch, tuple substitution, provenance-shaped adoption predicate, stale or unknown evidence field, and a v2 release set whose rehearsal tuple differs from its components.

CI policy tests must prove adoption and publication can run only for exact `push main`, use no manual retag, scan the exact existing multi-architecture digest under the same HIGH/CRITICAL fixed-image policy, sign a custom adoption predicate only after both scans, and make v2 release publication depend on the combination rehearsal. The original build source/run/job and current adoption source/run must remain distinct.

PREPARED tests must prove that all selected hosts pull exact digest references before the first quiesce task; expected digest, architecture, free space and previous-image recoverability are required on every host; one host's pull or capacity failure prevents every stop task; cleanup removes only run-scoped candidate state; and successful preparation is reused rather than repeated after quiesce.

Cutover tests must prove Pi5 matching images use the settled/no-op route, a one-sided stage or agent-health failure restores the previous torque image on every selected kiosk and leaves all OFF, and browsers start only after every agent reports healthy, unowned, token-free and Bluetooth OFF. Inventory tests must continue rejecting every explicitly selected Pi4 without complete torque configuration, and must never infer or enable an unselected kiosk.

The final repository gates are focused Python and Ansible contract suites, selected CI policy tests, existing torque API/Web/agent compatibility tests, `git diff --check`, documentation link checks, and:

    git diff --exit-code 2edefaa0657a0e34152d5622c8af0e1d5e52d90c -- pnpm-lock.yaml pnpm-workspace.yaml

Hosted main CI must publish and verify the exact adoption attestation and signed v2 release set before production staging. Production acceptance requires all declared artifacts and rollback sources present on their target hosts before quiesce, Pi5 no-op when already matching, aggregate healthy/OFF agent proof, and browser restart only after that proof.

## Idempotence and Recovery

Schema v1 remains readable, so normal deployments can continue while torque cutover opts into v2. PREPARED is repeatable for the same run and digest. A failed pre-stage does not stop services and may delete only image/tag/run-directory state created by that run. A retry creates a new run ID and revalidates all exact identities.

After quiesce, the existing aggregate fail-closed path owns recovery. It stops browsers and candidate agents, removes guard intent, proves Bluetooth OFF, restores every captured previous image without starting it, and removes run-scoped staging. It does not roll back a healthy already-matching Pi5 merely for symmetry. The first v2 migration uses the exact previous images captured before quiesce as its rollback authority; after a successful cutover, the signed v2 release set becomes the previous set for later runs.

## Artifacts and Notes

Base evidence:

    orchestration base: 2edefaa0657a0e34152d5622c8af0e1d5e52d90c
    torque source:       3464256da11ee77bebfceb4fafcff4524f5ac8ca
    torque index:        sha256:810d4c17e581faa352c57ce6930f251d2f9ecb5f7839b1b29ae128f6d3c6c443
    torque ARM64:        sha256:4a086be9b7a5b2f5b35b6418a708de36bc3465387dda944a2f62e9bf3c2ebc7c
    torque ARMv7:        sha256:5f63ea8ae48c446751279756b4b49572fe5b19150aa215a15bbc0a5fe6d24737
    origin run/job:      32093659078 / 95581851495

The original repository worktree remains unrelated user WIP and is never modified. Production currently has the new Pi5 API/Web healthy and the two selected torque kiosks OFF. This plan does not authorize a third production run before merged-main signed artifacts and complete PREPARED evidence exist.

## Interfaces and Dependencies

Release-set schema v2 extends, rather than replaces, the v1 document. Its stable concepts are an orchestration source, an ARM64 API/Web pair, an optional torque component, and an optional torque compatibility record. The torque component contains repository, multi-architecture index digest, source SHA, required platform child digests, and adoption predicate identity. The compatibility record contains protocol name/version, the exact API/Web/torque digest tuple, and the rehearsal workflow/run/job identity.

The custom adoption predicate type is distinct from SLSA build provenance. It records original build identity, source-closure paths and equality result, OCI index and children, scan policy/results, and current adoption workflow identity. The existing release-set attestation remains the deploy-time root object.

The wrapper passes exact references through variables such as `release_pi5_api_image`, `release_pi5_web_image`, and `release_kiosk_torque_image`. Ansible consumes those references and never reconstructs component tags from `release_sha` in torque-cutover mode. Facts marking prepared Pi5 and kiosk candidates are run-scoped and are accepted only when their run ID and exact digest match the sealed v2 manifest.

Revision note (2026-08-18): created after the user approved A-minimal and the monitoring review required schema-v2 reuse, combination compatibility, bounded evidence, signed Trivy adoption, and service-uninterrupted staging before quiesce.
