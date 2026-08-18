---
id: ADR-20260818-release-set-v2-component-adoption
title: Adopt independently built torque-agent components through signed release-set v2
status: accepted
date: 2026-08-18
source_of_truth: true
scope: torque-cutover release composition, component adoption evidence, pre-quiesce staging
related_code:
  - scripts/deploy/release_artifact_contract.py
  - scripts/deploy/standard-ansible-release.py
  - .github/workflows/ci.yml
  - infrastructure/ansible/playbooks/deploy-release-standard.yml
  - infrastructure/ansible/roles/release_pi5
  - infrastructure/ansible/roles/release_kiosk
  - infrastructure/ansible/roles/release_torque_cutover
related_docs:
  - ../plans/release-set-v2-torque-cutover-execplan.md
  - ./ADR-20260728-attested-arm64-release-artifact-promotion.md
  - ./ADR-20260818-torque-wrench-global-ownership.md
  - ../guides/deployment.md
validation: backward-compatible contract tests, signed adoption and combination-rehearsal CI, phase-boundary simulation, and exact merged-main production preflight
open_items:
  - implementation, PR, main CI and approved production cutover
---

# ADR-20260818: Adopt independently built torque-agent components through signed release-set v2

## Status

Accepted for implementation and the already approved production cutover. Production mutation remains gated on exact merged-main CI, a signed schema-v2 release set, and successful staging of all candidate and rollback images before quiesce.

## Context

The current standard deploy route binds orchestration source, API/Web artifacts and every Pi4 agent tag to one Git commit SHA. That assumption failed after deploy-only fixes: API/Web artifacts existed for the new SHA, while the unchanged torque-agent had correctly not been republished. The route stopped both kiosks and updated Pi5 before discovering the nonexistent torque-agent tag.

API and Web already use a strict, signed release set. Pi4 agent publication produces a multi-architecture OCI index, SBOM and BuildKit provenance and scans both ARM64 and ARMv7, but it does not publish the same GitHub attestation contract. The valid torque-agent index built from main commit `3464256d` is unchanged at the current orchestration source and passed both scans. Rebuilding or retagging those identical bytes for every deploy-only edit is wasteful and preserves the faulty identity coupling.

Individually safe artifacts are insufficient. The API, Web controller and localhost agent exchange ownership tokens containing lease ID, generation, owner and session identity, and use exact-token renewal for communication recovery. A release must prove that one exact component combination implements the same protocol contract rather than permitting arbitrary signed images to be mixed.

## Decision

The existing signed release set is extended through a backward-compatible schema version 2. Schema version 1 remains readable and keeps its current API/Web semantics. Version 2 adds optional component identity and compatibility sections; it does not create an independent torque release source of truth. The same strict parser, OCI publication, signature identity and standard deploy wrapper remain authoritative.

For the initial torque cutover, version 2 binds exactly three components: ARM64 API, ARM64 Web, and the ARM64/ARMv7 torque-agent index. Each component has its own immutable digest and source SHA. The release-set source SHA identifies orchestration and composition; it is not required to equal the torque-agent source SHA.

The existing torque-agent digest is accepted with a custom signed component adoption predicate. The predicate is explicitly not build provenance. It records the original source SHA, workflow, run and job that built and scanned the image, the index and platform-child digests, the immutable source-closure paths, proof that their trees are unchanged at the adopting main commit, and a fresh scan under the same required HIGH/CRITICAL policy. The adoption workflow signs the existing digest only after both architecture scans pass. It does not rebuild or retag the image.

Version 2 also records protocol `torque-ownership` version 1 and one exact compatible digest tuple. A focused main-CI rehearsal covers lease acquisition, generation fencing, exact-token release, takeover delay, self-only status and exact-token recovery across the API, Web adapter/controller and agent code. The release set records the rehearsal workflow/run/job. Substituting any component digest invalidates the tuple even if the replacement has its own valid signature.

Evidence is limited to two systems. The signed release-set v2 is the durable artifact and compatibility authority; existing run-scoped Ansible state records staging, previous images, phases and rollback. Adoption data is embedded in or referenced directly from the signed release set. There is no separate general manifest service, prepared-receipt database or rollback engine.

For torque cutover, PREPARED means service-uninterrupted, non-destructive staging. Before quiesce, Pi5 and every explicitly selected torque kiosk pull but do not start the exact candidate images. They verify expected digest, target architecture, disk headroom and recoverability of current image bytes. A staging failure cleans only candidate and run-scoped state created by that run and leaves all running services unchanged. Calling this phase read-only is prohibited because image pull and rollback tags change local disk state.

After PREPARED, the existing route performs quiesce, control-plane reconciliation, stopped agent staging, aggregate agent health/OFF verification and browser resume. A Pi5 already running the exact API/Web image IDs follows the existing settled route and does not switch slots or rerun migrations. One selected kiosk failing stage or agent health causes every selected kiosk to restore its captured previous torque image and remain OFF. Browsers restart only after every selected agent is healthy, owns no lease or token, the guard is active and Bluetooth is OFF.

Only kiosks named by an explicit limit and carrying complete torque inventory are eligible. Missing inventory is neither guessed nor generated. NFC and barcode components, services, images and dependencies do not change in this cutover.

## Alternatives

Republishing torque-agent for every orchestration SHA was rejected because it creates unnecessary builds and scans and retains the source of the incident. It also keeps unrelated full-fleet agent publication coupled to deploy-only changes.

A torque-only permanent manifest was rejected because it would create a second release authority, duplicate signature and storage logic, and eventually drift from the standard release set.

Manual retagging, digest overrides and unsigned historical-CI references were rejected because they cannot prove immutable bytes, source or scan policy. Describing later adoption as new build provenance was rejected because it would make a false supply-chain claim.

Registry existence checks immediately before a post-quiesce pull were rejected because they still leave transfer, disk-capacity and architecture failures inside the outage window. Service-uninterrupted staging supplies a concrete success path instead of adding another refusal after shutdown.

## Consequences

The release contract becomes more expressive and its validation tests become larger. CI performs fresh scans when adopting an unchanged historical component, but it avoids rebuilding the image. The deployment downloads candidates before the maintenance window, which consumes disk and may require cleanup on staging failure, while materially reducing downtime and eliminating missing-artifact discovery after shutdown.

Normal schema-v1 deployment remains compatible. Torque cutover opts into schema v2 and exact digest variables. Once the approach is proven, other components may use the same schema extension in separately approved work; this change does not generalize NFC, barcode, Signage or the entire fleet.

The first v2 production run has no previous v2 manifest for the stopped kiosks. Its rollback authority is the exact existing image captured and verified during PREPARED. After success, the signed v2 set becomes the previous release set for subsequent runs.

## Validation

Contract tests must preserve all v1 behavior and reject malformed v2 identities, missing platforms, changed compatibility tuples and evidence ambiguity. CI policy tests must prove exact-main-only adoption, two architecture scans, a custom non-provenance predicate, source-closure equality and a required combination rehearsal. Deploy tests must prove all candidate and previous images are verified on every target before any stop task, Pi5 exact-match no-op, all-host rollback and OFF state after one-sided failure, and browser start only after aggregate healthy/OFF evidence.

Production proceeds only from the exact merged main SHA whose required CI published the signed v2 set and adoption evidence. Its explicit target remains Pi5, StoneBase and Assembly-01. The final run must record PREPARED, QUIESCED, CONTROL_PLANE, AGENTS_STAGED, AGENTS_HEALTHY_OFF and BROWSERS_RESUMED in order.

## Supersedes / Superseded By

- Extends `ADR-20260728` from an API/Web-only signed pair to a backward-compatible component-aware release set.
- Applies `ADR-20260818-torque-wrench-global-ownership` to release compatibility and atomic cutover.
- Superseded by: none.
