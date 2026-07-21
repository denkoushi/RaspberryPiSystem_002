---
id: KB-401
title: Deploy release identity, activation, and runtime audit
status: investigation-open-live-evidence-pending
scope: standard Pi5, Kiosk, Signage, SSH Ansible, and experimental StoneBase Local Ansible release route
date: 2026-07-21
source_of_truth: true
related_code:
  - scripts/deploy/rolling_release/coordinator.py
  - scripts/deploy/rolling_release/policy.py
  - scripts/deploy/rolling_release/terminal_adapters.py
  - scripts/deploy/rolling_release/route_contract.py
  - scripts/deploy/terminal-profile-registry.json
  - apps/web/src/layouts/KioskLayout.tsx
related_docs:
  - ../decisions/ADR-20260721-deploy-release-identity-and-activation.md
  - ../plans/deploy-release-identity-architecture-execplan.md
  - ../plans/deploy-release-identity-readonly-evidence-manifest.md
  - ../plans/deploy-speed-phase-b-execplan.md
validation: offline source audit, immutable Git range classification, 747 deploy Python tests, aggregate deploy contracts, 13 Kiosk ACK tests, changed-only lifecycle contract, and a pure typed-claim state model
open_items:
  - obtain separate approval for the bounded Pi5 plus StoneBase read-only evidence manifest
  - confirm or reject the browser process timeline for run 20260721-032457-3fce3c
  - keep deployment and Local executor implementation frozen until the ADR Go gate is satisfied
---

# KB-401: Deploy release identity, activation, and runtime audit

## Executive conclusion

The standard route is safe against the observed failures but is not yet live in
the distributed-systems sense: it can fail closed and restore StoneBase, but it
does not always contain a deterministic transition that lets a stale Kiosk Web
bundle acquire and acknowledge the newly verified Pi5 Web bundle.

The current release planner treats a host as a mutation target based on files
stored on that host. A Kiosk browser is also a consumer of the Pi5-hosted Web
artifact, but that consumer relationship is absent from planning and durable
fleet state. `apps/web/` is intentionally classified as `server-app`, and the
tests intentionally produce a Pi5-only plan with zero terminal targets. At the
same time, the Kiosk ready acknowledgement is sent by the compiled JavaScript
bundle in the terminal browser and rejects a challenge for any other compiled
SHA. An already running browser is restarted only when its local launch script,
unit, or browser configuration changes.

Those rules are each locally reasonable, but together they admit a state in
which Pi5 is verified at release B, a terminal repository remains correctly at
release A, the terminal browser also remains at Web release A, and fleet state
still reports both hosts verified. A later terminal run can challenge that old
browser for Web release B and time out even though SSH Ansible and terminal
health succeeded. The state schema has no field that can expose this drift to
planning.

The current production path and experimental Local executor therefore remain
**No-Go for another live retry**. This is not authorization to weaken the ready
check, extend its timeout, or restart every systemd service. The structural
remedy is specified in the related ADR and implementation ExecPlan, but remains
blocked until the approved read-only evidence gate resolves the remaining
incident-specific uncertainty.

## Safety state at the audit boundary

This audit began from `origin/main` at
`79ee42ac44e4ffbf33a515df7cc894e910fc8d95`. The integrated Local executor is
kept as the immutable comparison ref
`93d8bef4a31d52d0adcb18abfc1731f0e78d335c`; the audit branch does not modify
that ref.

The last run is terminal, not active. Pi5 remained stable at the candidate.
StoneBase used the already sealed file and runtime manifests, returned to
`651d056dbf5a6eea71cda210601dc618d7894415`, passed rollback ready and
independent evidence, and cleared maintenance. No audit command has contacted a
device. FJV and every terminal other than StoneBase remain outside the live
scope.

## Evidence grades

`CONFIRMED` means repository source, an existing executable test, or a prior
canonical durable status observation proves the statement. `REJECTED` means an
observation contradicts the hypothesis. `INCONCLUSIVE` means the source admits
the behavior but the exact historical device event still needs bounded
read-only evidence. An inconclusive safety or progress condition blocks Go.

The audit distinguishes two questions that must not be collapsed:

1. Does the architecture admit the failure?
2. Did that exact admitted failure cause run `20260721-032457-3fce3c`?

The first is confirmed offline. The second remains inconclusive until the
browser unit timeline and durable run record are read under the separate
approval gate.

## Unified incident timeline

| Event | Observed facts | Finding | Rollback and residue |
|---|---|---|---|
| Phase B run `20260720-232311-d2e8c8` | StoneBase completed at terminal SHA `73b3dbe4…`; terminal apply was 241,853 ms. Ready acknowledged the already verified Pi5 Web SHA `7cde783c…`, not the terminal candidate. | `CONFIRMED`: terminal Git proof and Kiosk Web proof were already different identities. This run did not exercise acquisition of a new Pi5 Web bundle. | No rollback. Evidence verified and maintenance cleared. |
| Bootstrap run `20260721-021000-1ede52` | Pi5 reached `85874ca9…`; StoneBase failed at `Install StoneBase local executor runtime lock`. | `CONFIRMED`: Ansible syntax and template contracts did not instantiate the role-relative `copy.src` resolution used at runtime. | Sealed rollback, rollback ready, evidence, cleanup, and maintenance clear succeeded. StoneBase returned to `73b3dbe4…`. |
| Bootstrap retry `20260721-023908-68527a` | Pi5 was not required. StoneBase reached `651d056d…`; SSH apply, control-plane ready, evidence, and cleanup succeeded. | `CONFIRMED`: ordinary SSH success did not prove optional Local runtime installation. Ready only proved the unchanged Pi5 Web authority. | No rollback. Maintenance cleared. |
| Local gate `20260721-024809-e2a35e` | Effective executor was SSH with `runner-ineligible: local runner preflight is malformed`. | `CONFIRMED`: runtime selection correctly failed before maintenance. Approved read-only evidence found Debian 13 aarch64, Python 3.13.5, no Python 3.11 binary/package candidate, and no active pinned runtime. | No release submitted. |
| Pinned runtime gate `20260721-032006-9a9b50` | Requested Local, effective SSH, fallback `candidate-requires-ssh-configuration`, runtime null, `releaseSubmitted=false`. | `CONFIRMED`: a candidate that changes its own runtime authority cannot bootstrap through Local and must use SSH first. | No release submitted. |
| Final bootstrap `20260721-032457-3fce3c` | Pi5 reached `93d8bef4…`; StoneBase SSH apply succeeded in 412,856 ms. Forward ready timed out after 90,084 ms. Sealed rollback, rollback ready, independent evidence, cleanup, and maintenance clear succeeded. | `INCONCLUSIVE` for the exact process event; high-confidence hypothesis is that changed-only execution left the prior compiled browser bundle running. `CONFIRMED` that the code has no other stale-bundle activation step. | StoneBase returned to `651d056d…`; final evidence verified; maintenance cleared at `2026-07-21T03:46:31.968285Z`. |

The final candidate range from `651d056d…` to `93d8bef4…` classifies as
server plus all terminal profiles because it contains deployment-control and
previously unknown runtime files. It therefore updates Pi5 and applies
StoneBase, but the changed-only Kiosk tasks still restart the browser only when
rendered local browser files differ.

## Confirmed structural findings

### 1. Mutation targets and artifact consumers are conflated

`scripts/deploy/terminal-profile-registry.json` maps `apps/web/` to
`server-app`, while `componentProfiles.server-app` is empty. The tests
`test_web_only_is_server`, `test_server_app_only_runs_pi5_with_zero_terminals`,
and `test_print_plan_includes_resolved_targets_and_classification` explicitly
assert that a Web-only release targets Pi5 and excludes Kiosks.

That is correct for terminal Git and Ansible mutation. It is incomplete for
Web artifact activation. A terminal browser consumes the new artifact even
when no terminal-owned file changes. The current planner has one `targeted`
boolean and cannot express "do not mutate terminal Git, but activate and verify
its browser consumer."

### 2. Safety is proved, but progress from a stale bundle is not

`resolveKioskReadyChallenge` accepts only an exact lowercase compiled
`VITE_RELEASE_SHA`, desired SHA, and verification ID. The Web test
`does not let a cached stale bundle acknowledge a newer desired release`
correctly prevents false success.

The same source contains no reload, navigation, cache-bust, or other activation
transition on mismatch. The Kiosk role restarts `kiosk-browser.service` only
when the launch script, unit, Firefox chrome, or user preference output changes.
Phase B intentionally removed the unconditional release-only service restart.
Consequently a stale bundle safely refuses ACK forever, and the coordinator can
only time out and roll back.

### 3. A single terminal `currentSha` cannot represent actual release state

Fleet state stores one `desiredSha`, one `currentSha`, and one binary
`unknown|verified` evidence value for a terminal. It does not store the Web SHA
compiled into the browser, the last verification claim type, Local artifact
digest, or runtime identity. Server records separately store API/Web images,
but those identities are not projected to each Kiosk consumer.

The system can therefore persist `terminal currentSha=A, evidence=verified`
while the browser's compiled Web SHA is stale relative to Pi5 Web B. A future
plan sees no unknown evidence and cannot repair or even report that drift.

### 4. `readyAuthority` is a profile-wide union of different claims

Kiosk selects `control-plane`; Signage selects `terminal`. The experimental
Local executor overrides Kiosk behavior and sends the candidate terminal SHA
through a root-owned ready probe. All of these values occupy the same
`desiredReleaseSha`, acknowledgement `releaseSha`, and per-target
`expectedReadySha` fields.

The exact SHA checks remain strong, but the field name does not reveal whether
the proof means compiled Web, terminal Git, or sealed Local candidate. This is
why a Local candidate ACK can be added without proving that the browser is on
the required Web artifact.

### 5. Route coverage checks existence, not semantic coverage

The 24-stage route contract assigns an owner, preflight proof, failure policy,
recovery owner, and rehearsal ID. Its test proves that the named test method
exists and that coordinator boundary calls are registered. It does not prove
that the test exercises each stage's precondition, postcondition, safety
invariant, progress invariant, timeout, and response-loss behavior.

Several stages share a single rehearsal. In particular `terminal.ready` maps to
an agent-death test; there is no rehearsal in the current main branch for a
stale browser acquiring a new Web bundle.

### 6. Preflight and runtime share parsers but not every real prerequisite

Aggregate terminal preflight strongly verifies host identity, resource bounds,
runtime manifest capture, enabled agent health, browser engine prerequisites,
and exact candidate-owned helper source. It does not instantiate every
candidate Ansible `copy.src`, nor does it observe the compiled Web SHA held by
the running browser.

The Local feature strengthened executor eligibility after discovering the gap,
but an optional bootstrap task can still fail without failing ordinary SSH
release. Effective executor selection correctly rejects that later; ordinary
SSH success alone is not runtime readiness.

## Release identity ledger

| Identity | Producer and holder | Current proof | Durable location | Invalidated by | Rollback expectation |
|---|---|---|---|---|---|
| Coordinator candidate Git SHA | Local launcher resolves Git; Pi5 coordinator stores it | Clean immutable checkout and exact candidate object | run `releaseSha`, fleet desired SHA | changed source ref, non-ancestor history, corrupt run state | Run identity never changes; host claims may restore previous values |
| Pi5 API image release | Blue/Green builder and active Pi5 slot | image label/reference plus independent live evidence | server `apiImage`, `currentSha` | slot/image/config mismatch | Pi5 Phase 3 owns its own reconciliation |
| Pi5 Web image release | Blue/Green builder and active Pi5 slot | image label/reference plus independent live evidence | server `webImage`, `currentSha` | slot/image mismatch | Pi5 remains forward during terminal-only rollback |
| Kiosk compiled Web release | Vite build embeds SHA; browser process holds bundle | browser POSTs exact SHA and verification ID | only transient ready ACK today | Pi5 Web switch, browser cache/process lifetime, missing activation | Must normally equal forward Pi5 Web even when terminal Git rolls back |
| Terminal repository release | SSH Ansible or Local bundle resets Git HEAD | independent terminal Git observation | terminal `currentSha` | checkout drift, dirty worktree, partial Local run | Restore sealed previous HEAD |
| Local artifact release | Pi5 binds candidate, payload, host, manifests; terminal runner holds one artifact | digest-bound result plus candidate ready probe | feature-branch run target fields and terminal receipt | response loss, digest mismatch, residue cleanup failure | Quiesce unit first, then use existing manifest only |
| Local runtime identity | Pinned Python distribution, wheels, Ansible, and collection | exact version/hash preflight | feature-branch runner preflight; active symlink on terminal | OS/runtime drift, missing symlink, partial optional install | Active symlink and runner files are manifest destinations |
| Verification cycle | Pi5 status helper generates 128-bit ID | exact ACK tuple | deploy-status entry and run target | phase change, rollback rebind, cleanup | Rollback generates a separate cycle |
| Maintenance authority | Pi5 status state binds run and client | maintenance ACK | deploy-status state | remove-client/remove-run after verified finalization | Retained on unknown rollback evidence |
| File/runtime rollback authority | Candidate helper seals manifests before maintenance | digest and exact capture result | run target plus root-owned terminal manifest | tampering, missing result, unsupported runtime | Sole terminal rollback authority |

The redesigned model must not use one identity as evidence for another row.

## Current temporal route audit

The following table covers all 24 main-branch stages. "Postcondition" is the
fact the next stage currently assumes. "Gap" records semantic coverage or
progress work, not an instruction to weaken the existing failure policy.

| Stage | Required precondition | Postcondition / recovery | Audit result |
|---|---|---|---|
| `local.source` | exact clean local SHA | immutable submission source or stop before SSH | Safety covered; no identity-consumer model yet. |
| `local.inventory` | read-only Ansible config and valid selection | bounded public topology or stop | Safety covered; output has one target set. |
| `local.remote-identity` | unique Pi5 public client ID | bound Pi5 identity or stop | Covered. |
| `pi5.production-ledger-preflight` | candidate migration ledger readable | aggregate blocker before submission | Covered. |
| `terminal.aggregate-preflight` | every selected terminal prerequisite readable | aggregate blocker before submission | Strong runtime checks; no running compiled-Web observation. |
| `pi5.bootstrap` | exact candidate and preflight success | transient release unit or no coordinator | Covered by before/after checkout faults. |
| `pi5.inventory` | normal Ansible/Vault/inventory | exact server and terminal identities before fleet write | Covered. |
| `pi5.executor-residue-recovery` | prior candidate workload readable | old authority retained until reconciliation | Covered for Pi5 workload only. |
| `pi5.fleet-begin` | fleet lock and strict state schema | active run durably committed | Covered. Schema cannot persist typed terminal claims. |
| `pi5.interrupted-recovery` | old run and sealed authorities readable | exact restore or active run retained | Covered for represented identities. Browser Web drift is unrepresented. |
| `pi5.scope-plan` | fleet evidence and classification | ordered mutation targets | Safety fail-closed. Missing activation and verification target sets. |
| `pi5.server-config` | sealed server config manifest | converged config or sealed restore | Covered. |
| `pi5.blue-green-release` | candidate build/switch prerequisites | verified Pi5 API/Web or Phase 3 reconciliation | Covered for Pi5; no downstream consumer activation obligation. |
| `terminal.apply-transport-preflight` | SSH pipelining/become | safe apply transport or stop | Covered for SSH; Local feature adds a separate eligibility proof. |
| `terminal.baseline-and-manifest` | clean terminal HEAD | file/runtime manifests retained | Covered, including response-loss fail closed. |
| `terminal.notice` | status-agent notice path available | 60-second scheduled notice or cleanup | Covered. |
| `terminal.maintenance` | sealed manifests and notice | maintenance ACK or manifest rollback | Covered. |
| `terminal.apply` | maintenance acknowledged | candidate terminal runtime or rollback | Apply result does not activate an unchanged browser bundle. |
| `terminal.ready` | one expected SHA and verification ID | one ACK plus independent terminal observation, or rollback | Exactness is strong; typed meaning and stale-bundle progress are missing. |
| `terminal.finalize` | verified observation and cleanup authority | fleet promotion, maintenance clear, committed cleanup | Covered for current schema; cannot promote per-claim evidence. |
| `terminal.rollback` | quiesced mutation and sealed manifests | previous terminal state plus ready/evidence, or maintenance retained | Strong. Kiosk ready still expects forward Pi5 Web and may depend on browser restart as a side effect. |
| `pi5.canary-approval` | verified profile canary | explicit approval or timeout/cancel | Covered; target roles will need activation-aware ordering. |
| `pi5.fleet-finalize` | all required current evidence | durable terminal run state | Covered atomically; schema migration required. |
| `local.status-cancel` | Pi5 run/control/unit readable | authoritative status or cooperative cancel | Covered. |

The Local feature adds artifact seal, single transfer, deterministic Local unit,
candidate ready, and residue cleanup stages. Its response-loss rule is sound:
an unknown or active Local unit retains maintenance and blocks rollback until
quiescence. The gap is above that executor boundary: a successful Local
candidate claim is still not a Kiosk Web claim.

## Preflight-to-execution comparison

| Prerequisite | Current preflight | Execution dependency | Result |
|---|---|---|---|
| Exact candidate Git object | Yes | Pi5 and terminal checkout/artifact | Aligned. |
| Inventory/host/status identity | Yes | all status and transport calls | Aligned. |
| File/runtime manifest parser | Same candidate helper | capture and rollback | Aligned. |
| Enabled agent stable health | Same candidate helper | lifecycle and final evidence | Aligned. |
| SSH pipelining and become | Exact read-only command | SSH Ansible | Aligned. |
| Candidate Ansible source lookup | Syntax/template checks only | controller/remote `copy.src` lookup | Gap exposed by `20260721-021000-1ede52`. |
| OS/architecture/Python runtime | General system probe; Local feature adds exact runner proof | pinned Local execution | Initial gap; feature now fails closed but bootstrap remains optional. |
| Browser executable/config | Binary, link, service, and inventory contract | Kiosk launch | Aligned for launch prerequisites. |
| Running browser compiled SHA | Not observed | control-plane ready ACK | Critical gap. |
| Browser ability to acquire desired Web | Not modeled | progress from stale to exact ACK | Critical gap. |
| Optional Local bootstrap outcome | Not an SSH success condition | later Local eligibility | Intentionally separate, but must be reported explicitly. |

## Scenario and test coverage

| Scenario | Existing proof | Missing proof |
|---|---|---|
| Pi5 Web only, terminal Git excluded | Classifier and planner tests explicitly produce Pi5-only | Each Kiosk consumer is activated and acknowledges compiled Web. |
| Pi5 plus terminal, unchanged systemd config | Phase B contract suppresses release-only restart | Stale browser reaches the new Web without an unrelated config restart. |
| Terminal-only SSH, Pi5 unchanged | Coordinator test ACKs verified old Pi5 Web while terminal reaches new SHA | Typed persistence of both facts. |
| StoneBase Local candidate | Feature tests prove artifact/result/candidate ACK | Separate browser Web and runtime claims in coordinator success. |
| Runner/runtime absent | Feature preflight falls back before maintenance | Bootstrap outcome surfaced as its own bounded state. |
| Local submit/unit response loss | Feature fault tests retain maintenance and reconcile | Typed claim state must remain unknown until reconciliation. |
| Forward Pi5 plus terminal rollback | Manifest and ready rollback tests | Browser forward-Web and terminal previous-Git claims persisted independently. |
| Signage terminal authority | Terminal-ready probe and adapter tests | Compatibility migration to typed terminal-repository claim. |
| Same-SHA no-op | Planner and Pi5 skip tests | No-op must also require complete non-stale consumer claims. |

## Offline typed-claim prototype

A pure in-memory prototype with no device, filesystem, SSH, or production code
modeled separate mutation, activation, and verification sets. It passed
Web-only, Pi5 plus SSH, terminal-only SSH, StoneBase Local, terminal rollback
with forward Web, and no-op scenarios. A Local response-loss scenario retained
maintenance and prohibited rollback while its claim remained unknown.

    PASS typed-claim prototype: web-only, pi5+ssh-config-unchanged,
    terminal-only-ssh, stonebase-local,
    terminal-rollback-with-forward-web, no-op;
    local-response-loss=maintenance-retained

This proves only that the proposed state split is internally expressible. It
does not prove browser activation or the historical incident and cannot turn
the current No-Go into Go.

## Read-only evidence still required

The separate manifest limits access to Pi5 and StoneBase and collects only:

- canonical durable status and sanitized timing for the named runs;
- known task/result lines from the relevant Pi5 release-unit journals;
- StoneBase `kiosk-browser.service` start/stop/result timestamps around the
  final run;
- current terminal HEAD, service state, and public Local runner preflight.

The expected confirming pattern is: no forward Kiosk browser restart after the
successful SSH apply, forward ready timeout, browser restart during sealed
runtime restore, and prompt rollback ready ACK for the still-forward Pi5 Web
SHA. A different pattern rejects the incident hypothesis but does not remove
the independently confirmed architecture gap.

## Go / No-Go decision

Current decision: **No-Go**.

Go requires all of the following:

1. The incident-specific browser timeline is confirmed or replaced by another
   fully evidenced root cause.
2. Fleet and run state can persist separate required claims without trusting a
   Local result, SSH success, or desired challenge as an observation.
3. A Web-only plan creates activation and verification work for every affected
   Kiosk consumer without creating unnecessary terminal Git/Ansible mutation.
4. A stale bundle has a bounded steady-state activation path, and a pre-feature
   bundle has a separately manifest-owned one-time migration path.
5. Critical scenarios and every route stage consume the same executable
   transition contract in tests.
6. The default SSH route, Signage authority, fail-closed rollback, 60-second
   notice, five-minute Pi5 monitor, and serial terminal order remain intact.

Timeout extension, unconditional service restart, bypassing the compiled SHA
check, trusting the Local result alone, or manually editing durable state are
explicitly rejected as remedies.
