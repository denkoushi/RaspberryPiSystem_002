---
id: KB-401
title: Deploy release identity, activation, and runtime audit
status: investigation-complete-implementation-go-live-no-go
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
validation: offline source audit, immutable Git range classification, 747 deploy Python tests, aggregate deploy contracts, 13 Kiosk ACK tests, pure typed-claim state model, and approved Pi5 plus StoneBase read-only evidence receipt f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8
open_items:
  - implement the accepted typed-claim architecture through the staged ExecPlan
  - keep every live retry and Local execution blocked until the offline acceptance gate passes
  - request separate approval for the first Pi5 plus StoneBase canary only after that gate
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
check, extend its timeout, or restart every systemd service. The approved
read-only evidence gate has closed the incident-specific uncertainty, so the
accepted structural redesign is **Go for offline implementation only**. Live
preflight beyond an approved read-only scope, bootstrap, reverify, deployment,
and Local execution remain blocked.

## Safety state at the audit boundary

This audit began from `origin/main` at
`79ee42ac44e4ffbf33a515df7cc894e910fc8d95`. The integrated Local executor is
kept as the immutable comparison ref
`93d8bef4a31d52d0adcb18abfc1731f0e78d335c`; the audit branch does not modify
that ref.

The last run is terminal, not active. Pi5 remained stable at the candidate.
StoneBase used the already sealed file and runtime manifests, returned to
`651d056dbf5a6eea71cda210601dc618d7894415`, passed rollback ready and
independent evidence, and cleared maintenance.

After separate approval, the audit contacted only Pi5 and StoneBase with the
bounded read-only manifest. It created no run, maintenance, bootstrap, Local
unit, repository mutation, service mutation, or state edit. FJV appeared only
as `outside explicit StoneBase local Ansible POC scope` in existing durable
fleet output and was never connected to or probed. Every other terminal also
remained outside the connection scope.

## Evidence grades

`CONFIRMED` means repository source, an existing executable test, or a prior
canonical durable status observation proves the statement. `REJECTED` means an
observation contradicts the hypothesis. `INCONCLUSIVE` means the source admits
the behavior but the exact historical device event still needs bounded
read-only evidence. An inconclusive safety or progress condition blocks Go.

The audit distinguishes two questions that must not be collapsed:

1. Does the architecture admit the failure?
2. Did that exact admitted failure cause run `20260721-032457-3fce3c`?

Both questions are now confirmed. The exact browser process timeline was
collected under the separate read-only approval and matches the transition
admitted by the source.

## Unified incident timeline

| Event | Observed facts | Finding | Rollback and residue |
|---|---|---|---|
| Phase B run `20260720-232311-d2e8c8` | StoneBase completed at terminal SHA `73b3dbe4…`; terminal apply was 241,853 ms. Ready acknowledged the already verified Pi5 Web SHA `7cde783c…`, not the terminal candidate. | `CONFIRMED`: terminal Git proof and Kiosk Web proof were already different identities. This run did not exercise acquisition of a new Pi5 Web bundle. | No rollback. Evidence verified and maintenance cleared. |
| Bootstrap run `20260721-021000-1ede52` | Pi5 reached `85874ca9…`; StoneBase failed at `Install StoneBase local executor runtime lock`. | `CONFIRMED`: Ansible syntax and template contracts did not instantiate the role-relative `copy.src` resolution used at runtime. | Sealed rollback, rollback ready, evidence, cleanup, and maintenance clear succeeded. StoneBase returned to `73b3dbe4…`. |
| Bootstrap retry `20260721-023908-68527a` | Pi5 was not required. StoneBase reached `651d056d…`; SSH apply, control-plane ready, evidence, and cleanup succeeded. | `CONFIRMED`: ordinary SSH success did not prove optional Local runtime installation. Ready only proved the unchanged Pi5 Web authority. | No rollback. Maintenance cleared. |
| Local gate `20260721-024809-e2a35e` | Effective executor was SSH with `runner-ineligible: local runner preflight is malformed`. | `CONFIRMED`: runtime selection correctly failed before maintenance. Approved read-only evidence found Debian 13 aarch64, Python 3.13.5, no Python 3.11 binary/package candidate, and no active pinned runtime. | No release submitted. |
| Pinned runtime gate `20260721-032006-9a9b50` | Requested Local, effective SSH, fallback `candidate-requires-ssh-configuration`, runtime null, `releaseSubmitted=false`. | `CONFIRMED`: a candidate that changes its own runtime authority cannot bootstrap through Local and must use SSH first. | No release submitted. |
| Final bootstrap `20260721-032457-3fce3c` | Pi5 reached `93d8bef4…`; StoneBase SSH apply succeeded in 412,856 ms and ended at `03:44:14Z`. Forward ready timed out at `03:45:44Z`. The only browser lifecycle events in the approved `03:24:00Z–03:47:30Z` window were stop at `03:46:02Z` and start at `03:46:03Z`, during sealed rollback. | `CONFIRMED`: changed-only forward execution left the prior compiled browser bundle running. Rollback runtime restore restarted it, the new process loaded the still-forward Pi5 Web, and rollback ready recorded exact SHA `93d8bef4…`. | StoneBase returned to `651d056d…`; rollback evidence verified; maintenance cleared at `2026-07-21T03:46:31.968285Z`; browser remains active with `Result=success`. |

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

### 7. A planned executor is labeled effective before aggregate preflight

The approved `--print-plan` for fixed candidate `93d8bef4…` reported requested
and effective executor as `stonebase-local-ansible-poc` with no fallback. The
immediately following aggregate preflight `20260721-043630-dd9ed9` safely
reported effective executor `ssh-ansible`, fallback
`candidate-requires-ssh-configuration`, runtime null, and
`releaseSubmitted=false`.

The safety boundary works because preflight is authoritative, but the planning
field name overstates what has been proved. Executor selection must have three
states: requested, provisional after source/history classification, and
effective only after every runtime and candidate eligibility proof succeeds.
Durable planned state and operator output must not call a provisional choice
effective.

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
does not prove the future browser activation implementation. The historical
incident is now independently confirmed, so the prototype and evidence are
sufficient to open offline implementation; they are not sufficient for a live
retry.

## Approved read-only evidence receipt

The separately approved manifest ran on 2026-07-21 and was limited to Pi5 and
StoneBase. Raw output was retained only in a mode-0700 temporary directory,
was not added to the repository, and was deleted after digest verification.
The normalized allowlisted evidence digest is:

    sha256:f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8

It contains twelve source digests plus only the allowed derived fields. The
commands established:

- the four submitted runs are terminal; the two preflight-only IDs correctly
  have no durable run record;
- final forward apply completed without a browser lifecycle event;
- the browser stopped and restarted only during rollback at
  `2026-07-21T03:46:02Z–03:46:03Z`;
- rollback ready used the forward Pi5 Web SHA `93d8bef4…` and rollback evidence
  succeeded;
- current StoneBase HEAD is `651d056d…`, browser is active/running with
  `Result=success`, and status-agent service/timer results are healthy;
- aggregate preflight passed with zero submission but resolved the Local
  request to SSH fallback because the candidate requires SSH configuration.

The first status command form in the initial manifest incorrectly combined a
release branch with `--status`; the CLI rejected it before connection. The
canonical runbook form, with the approved Pi5 host explicitly supplied, was
used instead. This correction reduced options and did not broaden target or
authority. The manifest records the corrected command for future use.

## Runtime bootstrap observability addendum (2026-07-21)

### Scope and safety boundary

This addendum investigates the StoneBase runtime bootstrap as a release-route
contract, not as a request to retry one installer command. The following remain
frozen while the investigation is open: runtime bootstrap, Local Ansible,
terminal maintenance, candidate transfer, `--reverify-selected`, and all
deployment retries. FJV and every terminal other than StoneBase remain outside
both connection and probe scope.

The only post-implementation device interactions were canonical read-only
`--print-plan` and `--preflight-only` commands limited to Pi5 plus StoneBase.
The latter submitted no release, maintenance, artifact, or systemd unit.

### New evidence timeline

| Event | Observation | Finding |
|---|---|---|
| SSH bootstrap release `20260721-121936-a828c3` | StoneBase moved from `ee55f018…` to `59f50681…`; terminal apply and independent evidence succeeded; the runtime-bootstrap task took 95,015 ms and reported Ansible `ok`, not `changed`. | `CONFIRMED`: ordinary SSH release success and Local-runtime readiness are different claims. |
| Local canary PR #1052 | Non-executable README-only child candidate was merged as `3a015621…`; local contract tests and required CI passed. | `CONFIRMED`: the candidate history is Local-safe and does not itself require SSH configuration. |
| Canonical Local preflight `20260721-123603-b28b1e` | `releaseSubmitted=false`; requested executor was `stonebase-local-ansible-poc`; effective executor was `ssh-ansible`; fallback was `runner-ineligible: local runner preflight reports runtime-unavailable`; runtime evidence was null. | `CONFIRMED`: Local selection failed before notice, maintenance, transfer, or mutation. |

### Confirmed observability gap

The installer emits only `RUNTIME_INSTALL_CHANGED`, `RUNTIME_INSTALL_CURRENT`,
or the generic `RUNTIME_INSTALL_FAILED`. Its subprocess output is discarded.
The Ansible task deliberately keeps that raw command under `no_log`, treats a
nonzero result as non-fatal for an ordinary SSH release, and reduces it to
`changed|current|failed`. The runner then independently reduces an absent or
unreadable active runtime to `runtime-unavailable`.

This is safe for secrets and correctly prevents Local execution, but it cannot
answer which sealed bootstrap transition failed: download, digest check,
archive validation, wheel installation, collection installation, final lock
validation, or atomic activation. The root cause of this particular failed
bootstrap is therefore **INCONCLUSIVE**, not a confirmed network, package, or
host defect. Retrying any one suspected step would be a near-sighted repair
and is prohibited by this investigation.

### Required contract audit

The next design must model these distinct identities and outcomes without
collapsing them into a host-level success:

| Boundary | Required bounded fact | Current state | Required audit result |
|---|---|---|---|
| installer | phase, stable failure code, runtime-lock identity, cleanup outcome | generic failure only | prove secret-free diagnosis is sufficient to classify every installer exit |
| Ansible bootstrap | installer observation plus whether SSH application may continue | `changed|current|failed` debug fact, no durable target field | decide and test the explicit non-fatal/blocked contract |
| runner preflight | fixed Python, ansible-core, collection versions, storage, configuration, prior bootstrap observation | typed availability code, no installer phase | bind a safe prior-bootstrap observation without trusting it as runtime proof |
| coordinator selection | requested, effective, fallback, exact preflight receipt | fail-closed SSH fallback | retain fallback as durable evidence and never promote it after maintenance |
| route/fleet finalization | terminal repository, Local artifact, runtime, independent health claims | SSH success can coexist with missing runtime claim | make that coexistence visible rather than silently treating it as Local readiness |

The installer state machine to audit is:

    lock-read -> download -> digest-verify -> safe-extract
      -> hash-locked Python packages -> collection-install
      -> runtime-lock-verify -> atomic-active-link -> runner-preflight

Each edge needs a precondition, bounded produced fact, response-loss behavior,
cleanup owner, and a rule for whether an existing SSH release may continue.
No error text, URL query, environment value, inventory value, `.env`, token,
or key may enter telemetry, durable state, or a candidate artifact.

### Scenario and test matrix

| Scenario | Existing proof | Missing proof to add before remediation |
|---|---|---|
| valid runtime, Local selected | runner preflight validates exact versions | installer-to-runner lineage and durable runtime claim |
| missing active runtime | `runtime-unavailable` fallback before maintenance | bounded installer phase and cleanup evidence |
| digest, archive, wheel, collection, lock, link failures | installer has defensive branches | deterministic unit tests for every branch and no-secret output checks |
| installer response loss | Local unit response loss is covered | bootstrap-specific reconciliation and no false `current` result |
| SSH app success with Local unavailable | observed in `20260721-121936-a828c3` | durable state and operator status distinguish app success from Local readiness |
| Local unit response loss | route tests retain maintenance and reconcile | runtime claim remains unknown until deterministic unit reconciliation |
| terminal rollback with Pi5 forward | typed-claim tests cover separate Web/repository state | runtime bootstrap residue is not adopted as rollback authority |

A pure, non-device state-machine prototype must cover normal ready, same-SHA
no-op, bootstrap failure with SSH continuation, Local response loss, and
sealed terminal rollback. It may use synthetic identities only; it must prove
that a host cannot become Local-ready from an SSH success or an installer
result alone.

The prototype passed those five cases. Its assertions explicitly reject both
`ssh_verified` alone and an `installer_observed` result alone as Local-ready.
It is a temporary investigation artifact, not production code or a release
simulation.

### Investigation exit gate

The investigation may recommend an offline remediation only when it supplies
a closed, secret-free bootstrap observation schema; explicit persistence and
compatibility rules; fault tests for every state-machine edge; and a route
contract consumer for the observation. Otherwise the decision remains No-Go,
and no bootstrap retry or Local execution is authorized.

## Go / No-Go decision

Current split decision:

- **Go**: implement the accepted typed-claim/activation architecture offline in
  the dedicated staged ExecPlan.
- **No-Go**: any production retry, bootstrap, reverify, Local execution, or
  canary until the new offline acceptance gate is complete and a new exact
  hardware approval is granted.

Live rollout requires all of the following:

1. Fleet and run state can persist separate required claims without trusting a
   Local result, SSH success, or desired challenge as an observation.
2. A Web-only plan creates activation and verification work for every affected
   Kiosk consumer without creating unnecessary terminal Git/Ansible mutation.
3. A stale bundle has a bounded steady-state activation path, and a pre-feature
   bundle has a separately manifest-owned one-time migration path.
4. Critical scenarios and every route stage consume the same executable
   transition contract in tests.
5. Requested, provisional, and effective executor values cannot be confused in
   plan, preflight, or durable state.
6. The default SSH route, Signage authority, fail-closed rollback, 60-second
   notice, five-minute Pi5 monitor, and serial terminal order remain intact.

Timeout extension, unconditional service restart, bypassing the compiled SHA
check, trusting the Local result alone, or manually editing durable state are
explicitly rejected as remedies.
