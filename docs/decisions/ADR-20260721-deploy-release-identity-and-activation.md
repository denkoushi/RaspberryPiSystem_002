---
id: ADR-20260721-deploy-release-identity-and-activation
title: Typed release claims and separate activation targets
status: accepted-offline-implementation-live-rollout-blocked
date: 2026-07-21
source_of_truth: true
scope: Pi5 and registered terminal-profile rolling release planning, verification, persistence, and rollback
related_code:
  - scripts/deploy/rolling_release/planner.py
  - scripts/deploy/rolling_release/policy.py
  - scripts/deploy/rolling_release/coordinator.py
  - scripts/deploy/rolling_release/fleet_state.py
  - scripts/deploy/rolling_release/route_contract.py
  - apps/web/src/layouts/KioskLayout.tsx
related_docs:
  - ../knowledge-base/KB-401-deploy-release-identity-runtime-audit.md
  - ../plans/deploy-release-identity-architecture-execplan.md
  - ../plans/deploy-release-identity-readonly-evidence-manifest.md
validation: current-source audit, pure typed-claim scenario model, complete current offline deploy contracts, and approved read-only incident evidence sha256:f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8
open_items:
  - implement the decision through the staged offline ExecPlan
  - retain the live rollout block until all migration and fault gates pass
---

# ADR-20260721: Typed release claims and separate activation targets

## Status

Accepted for offline implementation. Hardware rollout remains blocked. The
approved read-only evidence confirmed the exact stale-browser transition in
KB-401 and removed the incident-specific inconclusive item. Acceptance of this
ADR does not authorize bootstrap, reverify, deployment, or Local execution.

## Context

The current planner has one targeted flag per host. That is enough when a host
stores and executes every artifact it consumes. A Kiosk terminal violates that
assumption: its Git checkout and local agents are terminal-owned, while its Web
bundle is built and served by Pi5 and retained by a long-lived browser process.

The profile registry maps Web source only to Pi5, but Kiosk readiness is posted
by the compiled Web bundle. The durable terminal record stores only one Git SHA
and one binary evidence value. The system can therefore verify Pi5 Web B and
terminal Git A without recording whether that terminal's browser still holds
Web A.

The experimental StoneBase Local executor adds another independent identity:
a digest-bound candidate artifact executed by a pinned runtime. Its candidate
ACK is valuable but cannot also prove the Pi5 Web bundle or independent
terminal health. Reusing the existing `desiredReleaseSha` channel for both
meanings obscures this distinction.

KB-401 contains the incident timeline, source evidence, route audit, and test
coverage. This ADR records only the target architecture.

## Decision

### Separate three target sets

Planning will produce three ordered sets instead of one overloaded terminal
target list:

- `mutationTargets`: hosts whose owned repository, configuration, containers,
  services, or Pi5 images must change.
- `activationTargets`: artifact consumers that must acquire an already built
  artifact even if their owned files do not change.
- `verificationTargets`: subjects whose required release claims must be
  observed before success.

Terminal serialization applies to the union of terminal activation and
mutation targets. A host is processed once in registry order; its work record
states which operations are required. This preserves one-terminal-at-a-time
operation and avoids a second independent rollout loop.

A Web-only release mutates Pi5, activates each in-scope Kiosk browser, and
verifies Pi5 plus those browser consumers. It does not run terminal Git
checkout, agent lifecycle, or SSH Ansible solely to refresh Web.

### Persist typed release claims

Each host record will carry a bounded `releaseClaims` object. The initial claim
kinds are:

- `controlPlaneApi`: Pi5 API image identity.
- `controlPlaneWeb`: Pi5 Web image or a Kiosk browser's compiled Web identity.
- `terminalRepository`: terminal Git HEAD.
- `localArtifact`: candidate artifact and payload identity when Local is used.
- `runtime`: the selected execution runtime identity when Local is used.

Each claim has this semantic shape:

    {
      "expectedIdentity": "lowercase Git SHA or sha256-prefixed digest",
      "observedIdentity": "same identity domain or null",
      "authority": "closed repository-defined authority ID",
      "verificationId": "32 lowercase hex or null",
      "state": "unknown | verified",
      "observedAt": "UTC timestamp or null",
      "lastRunId": "run ID or null"
    }

Claim kinds define their identity domain and permitted authorities in code; the
JSON registry cannot invent commands or arbitrary authorities. A claim is
verified only when the expected and observed values match and the designated
independent verifier succeeds. Desired values and executor results are never
observations.

Terminal host evidence is derived: it is `verified` only when every claim
required by the current profile and selected execution mode is verified.
During migration, the legacy `desiredSha`, `currentSha`, and `evidence` fields
remain as compatibility projections. They continue to represent terminal Git
for terminal roles and the Pi5 release for the server; they cannot be used as
the source for new claim verification.

### Make claim requirements profile data, not profile-wide authority

The profile registry will replace the single `readyAuthority` option with a
closed declaration of consumed claim kinds and activation strategy IDs. Kiosk
consumes `controlPlaneWeb` and `terminalRepository`. Signage consumes
`terminalRepository`. StoneBase Local adds `localArtifact` and `runtime` for
that run without changing the Kiosk profile's Web requirement.

Legacy `readyAuthority` remains readable for one schema version through a
strict adapter that maps `control-plane` to the Kiosk Web claim and `terminal`
to the Signage repository claim. New writes use only typed claims. After every
supported fleet record has been rewritten and compatibility tests pass, the
legacy field can be removed in a separate change.

### Keep ACK channels exact and claim-specific

The Kiosk browser ACK continues to use its actual compiled SHA and verification
ID; it becomes a `controlPlaneWeb` claim. The Signage/terminal ready probe
becomes a `terminalRepository` claim. The Local runner's ACK becomes a
`localArtifact` claim bound to candidate SHA, artifact digest, payload digest,
and verification ID.

No ACK can satisfy more than one claim. Independent post-ACK observation still
checks terminal Git, authenticated identity, systemd Result/is-active, Docker
containers, and authenticated agent health. Local result files remain bounded
reconciliation evidence and never promote host success alone.

### Stage executor selection explicitly

Executor state will use `requestedExecutor`, `provisionalExecutor`, and
`effectiveExecutor`. Source/history classification may produce only a
provisional choice. `effectiveExecutor` is written after aggregate preflight has
proved candidate eligibility, runtime identity, and runner readiness. A
fallback reason is mandatory whenever effective differs from requested.

`--print-plan` either performs enough read-only proof to state an effective
executor or labels the value provisional. `--preflight-only` remains the
authoritative non-mutating transition to effective. Durable run state records
both decisions and the proof receipt; maintenance cannot begin from a
provisional Local choice.

### Add bounded browser activation

The steady-state Kiosk bundle will detect a valid verifying challenge whose
desired Web SHA differs from its own compiled SHA. While maintenance remains
visible, it will perform a bounded cache-busted same-origin navigation. Retry
state is bound to run ID, verification ID, and desired SHA and persists across
reloads. It has a fixed attempt and elapsed-time ceiling; exhaustion produces
no ready ACK and leaves rollback ownership with the coordinator.

The desired SHA remains only a challenge and cache key. The reloaded bundle
must still prove its own compile-time SHA before ACK.

An already deployed old bundle does not contain this logic. Its first migration
is a separate `kiosk-web-activation-v1` operation owned by the coordinator. It
runs only in maintenance, only when a sealed runtime manifest includes
`kiosk-browser.service`, and only when the terminal is known not to have the
activation capability. It is recorded as an activation result, not as an
Ansible configuration change. Response loss is reconciled through systemd
state before ready wait or rollback. After capability proof is persisted, the
steady-state path does not restart an unchanged service.

### Turn the route contract into an executable transition contract

Every route stage will declare:

- required durable phase and input claims;
- mutation, activation, read, or commit operation;
- successful postcondition and produced claims;
- safety failure policy;
- progress timeout and response-loss reconciliation;
- rollback eligibility and recovery owner;
- scenario IDs that exercise before-call, after-call, and response-loss
  boundaries.

Planner, coordinator validation, preflight route coverage, and fault tests will
consume the same declarations. A test name existing is no longer sufficient
route coverage.

## Required ordering

The existing safety sequence remains authoritative and is generalized as:

    source and aggregate preflight
      -> Pi5 mutation and five-minute stability when required
      -> terminal manifest seal when terminal mutation or activation needs it
      -> 60-second notice and maintenance ACK for Kiosk work
      -> terminal mutation, if required
      -> artifact activation, if required
      -> claim-specific challenges and ACKs
      -> independent claim/evidence observation
      -> runtime finalization and residue cleanup
      -> fleet claim commit
      -> maintenance clear

For Local response uncertainty, the deterministic Local unit must be proved
quiescent before rollback. For Kiosk activation uncertainty, service/process
state must likewise be reconciled. Unknown work never runs concurrently with
rollback.

## Compatibility and migration

The implementation will be additive before it is subtractive.

1. Introduce strict typed models and dual-read fleet schema without changing
   target selection or live behavior.
2. Backfill claim projections only from evidence already independently present
   in a verified fleet record. No browser claim is invented from Pi5 state.
   Missing Kiosk browser claims remain unknown and cause verification work.
3. Add the three target sets and print-plan visibility while the SSH executor
   remains the only default executor.
4. Deploy and prove the one-time Kiosk activation migration through the normal
   serial safety adapter.
5. Enable typed-claim success/finalization for SSH and Signage.
6. Rebase the StoneBase Local executor onto the accepted model and enable it
   only behind its existing explicit flag.
7. Remove legacy writes only after all production records use typed claims and
   rollback/interrupted recovery tests pass both schemas.

Old run records remain readable and immutable. Interrupted old-schema runs use
their original sealed manifests and legacy adapter; they are never converted
mid-run.

## Consequences

Web-only releases will include Kiosk activation/verification work even though
they avoid terminal Ansible. That is additional explicit work compared with
the current minimized plan, but it represents an artifact consumption
obligation that already exists physically.

Fleet state becomes larger and schema migration becomes more complex. In
return, planning can distinguish terminal Git, browser Web, Local artifact, and
runtime drift instead of treating all release SHAs as interchangeable.

Phase B's changed-only systemd and Docker behavior remains. Browser activation
is a separate artifact lifecycle and does not restore unconditional service
restarts.

Signage remains terminal-authoritative. The typed model changes representation,
not its existing ready probe, maintenance image, or rollback semantics.

## Alternatives rejected

- Increase ready timeout: rejected because a stale bundle has no transition to
  the desired bundle, so extra time does not create progress.
- Accept the desired SHA as browser identity: rejected because an old bundle
  could falsely acknowledge a new release.
- Restart every Kiosk service on every release: rejected because it reverses
  Phase B, conflates configuration with artifact activation, and still leaves
  Web-only target selection incomplete.
- Treat Pi5 Web evidence as every Kiosk's Web evidence: rejected because the
  browser process and cache are independent holders.
- Treat Local Ansible success or candidate ACK as full terminal readiness:
  rejected because neither proves browser Web, systemd, identity, or agent
  health.
- Add a one-off ACK-timeout fix only for StoneBase: rejected because the same
  target/consumer and state-schema problem applies to every Kiosk.

## Validation and Go gate

The pure typed-claim prototype expresses Web-only activation, Pi5 plus SSH,
terminal-only SSH, StoneBase Local, terminal rollback with forward Pi5 Web,
same-SHA no-op, and response-loss maintenance retention.

Offline implementation is Go because the read-only incident evidence is
confirmed and no safety- or progress-relevant inconclusive item remains in the
investigation. Live adoption remains No-Go. It requires the implementation
ExecPlan's complete offline suite, migration tests from strict legacy fixtures,
Web reload tests across actual page reloads, coordinator fault injection at
every new boundary, and a separately approved Pi5 plus StoneBase canary. FJV
and other terminals are not part of that first hardware proof.
