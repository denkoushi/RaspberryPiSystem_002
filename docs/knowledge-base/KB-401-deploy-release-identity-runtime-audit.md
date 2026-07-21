---
id: KB-401
title: Deploy release identity, activation, and runtime audit
status: local-canary-blocked-host-trust-remediation
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
validation: offline source audit, approved read-only evidence receipt f591a727363aeb972ecdd4b388f2ea7aa5b4881ca94445aac57c42da3238d7b8, accepted-main SSH runs 20260721-162403-d398c0, 20260721-172923-90a38b, and 20260721-184600-ea3eba, canonical Local-ready preflight 20260721-190514-541561, safely cancelled canary 20260721-191113-a1c6ef, dual-source StoneBase Ed25519 host-key observation, bounded StoneBase runtime evidence, 890 deploy Python tests, and the complete deploy aggregate
open_items:
  - review and merge the pinned Local host-trust contract
  - complete its exact-scope SSH migration and a later neutral Local canary
  - keep Local rollout beyond StoneBase blocked until the canary completes
  - keep FJV and every terminal other than StoneBase outside connection, planning, preflight, and execution
---

# KB-401: Deploy release identity, activation, and runtime audit

## Executive conclusion

The typed-claim standard route and the sealed prefetch route are live. Canonical
Runs `20260721-162403-d398c0` and `20260721-172923-90a38b` completed exact-scope Pi5 plus StoneBase SSH
release with all eleven runtime members verified before notice, offline
terminal installation, typed Web/repository evidence, cleanup, and maintenance
clear. The second run installed the corrected immutable `r2` runtime, and
independent preflight `20260721-174938-0c7310` proved every exact runtime pin
and selected Local with no fallback.

Two Local canary attempts remained **No-Go** before terminal maintenance. The
first exposed a duplicated SSH-common-argument policy and the second exposed a
deeper host-trust mismatch: aggregate preflight used
`StrictHostKeyChecking=no` with an empty temporary trust store, while the
locked Local backend used `StrictHostKeyChecking=yes` without supplying a
trusted StoneBase key. Aggregate success therefore did not prove the locked
transport. Neither event was an Ansible `-c local` execution failure.

The structural remediation candidate owns one exact Ed25519 pin and one pure
transport contract. Aggregate preflight loads both from the immutable candidate
and stages a mode-0600 known-hosts file; the locked backend imports the same
accepted contract and pin after checkout. Both use strict checking, disable the
ambient global known-hosts store and automatic host-key updates, allow only
Ed25519 host keys, cross no private-key path, and fail before terminal contact
when the pin is absent or malformed.

The audited pre-redesign planner treated only stored files as mutation targets
and did not model a Kiosk browser as a consumer of the Pi5-hosted Web artifact.
That admitted a verified Pi5 release B alongside a terminal repository and
browser still at release A. The accepted architecture now separates mutation,
activation, and verification targets and requires distinct Web and terminal
repository claims, so the browser transition is planned and verified without
manufacturing a terminal Git change.

The remaining failure is now fully identified. `pip` generated Ansible console
scripts with absolute shebangs pointing into the private staging directory.
The installer verified that staging tree and then renamed it to the versioned
runtime path without rebinding or revalidating the scripts. Python survived the
rename, but every `ansible*` entry point returned `ENOENT`. The remediation uses
a new immutable `r2` runtime identity, rewrites only the exact locked
ansible-core console-script set to the final version path, revalidates after
publication, and switches `active` only after success. The broken old version
is retained; a failed `r2` publication is removed before activation. Staging
uses a bounded `.install.<16-hex>` name so pip's Linux 127-byte direct-shebang
limit is satisfied; the installer checks both staging and published production
paths against that limit when it loads.

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

### Approved bounded evidence outcome

The separately approved follow-up used only canonical status and bounded
read-only commands. Canonical status for `20260721-121936-a828c3` reconfirmed
that the SSH release and independent terminal evidence succeeded while the
runtime bootstrap task ran once for 95,015 ms with Ansible outcome `ok`. The
Pi5 unit journal was filtered to the three known bootstrap task names and the
bounded marker; it recorded exactly:

    STONEBASE_LOCAL_RUNTIME_BOOTSTRAP:failed

This rejects the hypothesis that bootstrap was merely skipped or incorrectly
classified as current. It confirms that the installer returned a failure and
the ordinary SSH release deliberately continued.

The workstation could not establish a new StoneBase read-only session: the
direct Tailscale connection timed out, and a Pi5 ProxyJump reached SSH but had
no StoneBase credential on the workstation side. Both attempts stopped before
any StoneBase command executed. The already completed canonical aggregate
preflight remains the authoritative terminal observation and reports
`runtime-unavailable` before maintenance.

Because the installer discarded subprocess output, removed temporary staging,
and persisted no phase-specific observation, the historical failing phase is
not recoverable through further read-only inspection. The structural root
cause—loss of failure identity across installer, Ansible, runner, and durable
run state—is **CONFIRMED**. The underlying download/package/collection/link
failure remains **INCONCLUSIVE**. More connection retries cannot change that
evidence grade and are not authorized by this audit.

### Offline remediation and exit-gate result

The remediation implements one closed, secret-free observation across the
entire bootstrap boundary. The root-owned installer atomically persists a
random attempt ID, current phase, stable failure code, runtime version, exact
runtime-lock digest, cleanup state, and UTC observation time. It never stores
subprocess output, URLs, environment values, inventory values, or Ansible
variables. An interrupted process remains `running` at its last durable phase;
a failed process becomes `failed` with one allowlisted code; only a completed
install may become `changed` or `current`.

The closed phases cover host and lock validation, staging preparation, Python
download and safe extraction, hash-locked Python packages, collection download
and installation, runtime verification and publish, active-link activation,
cleanup, and internal observation failure. Primary failure identity is retained
even if staging cleanup also fails. A missing or malformed observation is
reported only as `unavailable` and never converted into runtime readiness.

The non-fatal SSH bootstrap contract remains intentional: an ordinary SSH
release may succeed while optional Local runtime bootstrap fails. The Ansible
callback copies only the closed observation into durable run telemetry. The
runner independently verifies the observation file ownership and mode, the
current lock-file digest, exact Python/Ansible/collection versions, existing
configuration, and storage. Neither SSH success nor the installer observation
alone produces the typed `runtime` claim. Preflight exposes the same bounded
observation even when it safely falls back to SSH.

The sealed Local inventory now explicitly fixes
`ansible_python_interpreter` to the active pinned runtime. This follows
Ansible's standard local-connection contract: `ansible-playbook -c local` is
standard, but an explicit inventory host does not receive the implicit
localhost interpreter binding automatically. The historical failure occurred
before any Local playbook ran; this interpreter correction prevents a separate
future drift to the OS Python after bootstrap succeeds.

Fault tests cover atomic observation, interruption, closed phase mapping,
primary-plus-cleanup failure, malformed or missing evidence, runtime-lock
digest mismatch, secret suppression, callback allowlisting, durable telemetry,
SSH fallback visibility, fixed interpreter inventory, and the route invariant
that SSH apply does not produce a runtime claim. The complete offline gate
passed with 856 deploy Python tests, 20 isolated PostgreSQL/API tests, 24
recovery tests, 99 Ansible template parses, lifecycle and safety contracts,
both inventories, and every Ansible syntax/check contract.

This closed the observability investigation gate for review and merge. It did
not retroactively identify the historical failed dependency phase or assert
that the pinned runtime was present on StoneBase. PR `#1053` and the canonical
run below satisfied that gate and converted the next failure from speculation
into the exact bounded `collection-install` observation.

### Accepted-main bootstrap and UTF-8 locale root cause

PR `#1053` was accepted as main SHA
`74080402971c4b3f7698a20332757c11365d53b1`. Canonical plan and preflight
selected only `raspberrypi5` and `raspi4-kensaku-stonebase01`; FJV and every
other terminal remained explicitly excluded. Preflight
`20260721-134900-0a3d34` passed and selected `ssh-ansible` before maintenance
with fallback `candidate-requires-ssh-configuration`, as required for a
candidate that changes its own runtime authority.

Canonical run `20260721-135020-37ce54` completed successfully. Pi5 release and
the fixed five-minute stability period took 623,410 ms, then both Pi5 image
claims were independently verified. StoneBase received the full 60-second
notice, entered maintenance, completed SSH Ansible in 340,008 ms, activated the
Web consumer, acknowledged the exact compiled Web challenge, verified both
`controlPlaneWeb` and `terminalRepository`, cleaned up, and cleared maintenance.
No rollback was needed.

The optional runtime observation was separately preserved as:

    status=failed
    phase=collection-install
    failureCode=collection-install-failed
    cleanup=complete
    lockSha256=sha256:e3bb5ce5ff5087438d59100b74b391a55ffbdf4c5063aaeaea5fc04928eae38e

The fixed collection artifact still matched SHA-256
`618b2cad75706f2939a5607271bfdcf4a10d3b6f3fe792e1569910c270485399`.
Running the same ansible-core 2.19.4 CLI under the installer's exact
`LANG=C LC_ALL=C` environment reproduced Ansible's startup rejection because
the detected locale encoding was not UTF-8. A clean Python environment using
`C.UTF-8`, the sealed collection path, `--no-deps`, and `--force` installed and
listed `community.general:11.4.1` successfully.

The direct cause is therefore **CONFIRMED**: the wrapper violated Ansible's
UTF-8 controller-locale requirement. It was not a raw `ansible-pull` or Local
connection defect, and Local Ansible remains the standard
`ansible-playbook -c local` mechanism. The remediation fixes every Ansible CLI
boundary in both installer and runner to a closed `C.UTF-8` environment and
forces the verified collection into the sealed runtime path so an unrelated
global collection cannot satisfy or suppress the install. Local execution
stays blocked until an accepted-main SSH bootstrap records a successful closed
observation and subsequent canonical preflight independently verifies the
exact runtime.

### Accepted UTF-8 remediation and maintenance-time download failure

PR `#1054` merged the `C.UTF-8` remediation as accepted main
`c5baa5297b2f5e60cc122f9ac2db2bca638f94cb`. Canonical run
`20260721-143844-16bae4` selected only Pi5 and StoneBase and completed the
ordinary SSH release successfully. Pi5 completed its fixed five-minute hold;
StoneBase completed the full notice, maintenance ACK, SSH apply, exact ready
ACK, independent evidence, cleanup, and maintenance clear. Both typed release
claims ended verified at accepted main, with no rollback. FJV and every other
terminal were not contacted.

The optional Local runtime observation was independently preserved as:

    status=failed
    phase=python-download
    failureCode=python-download-failed
    cleanup=complete
    lockSha256=sha256:e3bb5ce5ff5087438d59100b74b391a55ffbdf4c5063aaeaea5fc04928eae38e

The direct external route failure itself remains **INCONCLUSIVE** because the
bounded observation intentionally stores no raw network error. The structural
cause is **CONFIRMED**: after the terminal was already in maintenance, the
installer downloaded the Python standalone archive, resolved nine wheels over
the network, and downloaded the collection archive. Successful members lived
only in attempt-local staging. Thus fixed versions and hashes protected
integrity but did not provide liveness or reuse across a transient outage.

During the same detached run, an external observer also temporarily lost Pi5
reachability. The canonical unit continued, durable state reached success, and
later status reconciliation returned `persisted-success-unit-unloaded`. This is
**CONFIRMED** evidence that coordinator response-loss handling worked as
designed; it does not explain or repair the terminal runtime download boundary.

The accepted structural remedy is to prefetch and verify all eleven fixed
members on Pi5 before terminal notice, retain them in a content-addressed cache,
transfer the sealed set during the SSH bootstrap, and run terminal installation
with `pip --no-index --find-links` plus the local collection archive. A prefetch
failure remains pre-maintenance and performs only existing pre-mutation
manifest cleanup. The Pi5 receipt is not trusted as runtime readiness; only a
successful terminal observation and later exact runner preflight can produce
the runtime claim.

The offline remedy now passes the complete deploy aggregate. Its fixed lock is
`sha256:ecde0bbe80d4065f9bb84ecdc9372c08f0530635af459898e6ac8cb233165e5c`;
all eleven members were fetched in a temporary controller cache and matched
their exact size and digest, totaling 59,603,748 bytes. This proof contacted no
device. Unknown fallback reasons are excluded from prefetch, and each offline
installer failure boundary retains a bounded fail-closed observation.

The Pi5 cache specifically lives below the existing ignored durable release
root at `/opt/RaspberryPiSystem_002/logs/deploy/local-runtime-artifacts`. The
release unit runs as unprivileged `denkon5sd02`; cache directories and members
must be owned by that exact effective identity and cannot be group/world
writable. Only the transferred StoneBase cache is root-owned.

PR #1055 merged the offline remedy as accepted main
`89a765c5798302c3c6216a5367776ebdaed5d764`. Its first canonical read-only
preflight, `20260721-161503-c1d96f`, correctly selected Pi5 plus StoneBase and
effective SSH fallback `candidate-requires-ssh-configuration`. It also exposed
a separate receipt bug: aggregate preflight passed requested/effective executor
to the route contract but not the fallback reason, so its public receipt omitted
the required prefetch stage. No mutation was started. The contract now rejects
reasonless Local-to-SSH routes and binds the terminal probe reason explicitly;
live execution remains No-Go until that fix is accepted and a repeated
preflight returns `stonebase-local-bootstrap-success`.

### Accepted prefetch bootstrap and relocatable-runtime root cause

PR #1056 merged the route-receipt correction as accepted main
`a4fb0c64b4173232e94b7fda01d387180c1eb04a`. Preflight
`20260721-162318-686bfe` selected only Pi5 and StoneBase, effective SSH fallback
`candidate-requires-ssh-configuration`, and scenario
`stonebase-local-bootstrap-success`; its receipt placed
`terminal.runtime-artifact-prefetch` before `terminal.notice`.

Canonical run `20260721-162403-d398c0` then completed successfully. Pi5 passed
its fixed five-minute stability hold and independent API/Web evidence.
StoneBase sealed its manifests, and Pi5 downloaded and verified all eleven
members (59,603,748 bytes) against lock
`sha256:ecde0bbe80d4065f9bb84ecdc9372c08f0530635af459898e6ac8cb233165e5c`
before the 60-second notice. Offline SSH apply took 333,426 ms. The exact Web
and repository claims, independent evidence, cleanup, and maintenance clear
all succeeded; Pi5 and StoneBase ended verified at accepted main. FJV and every
other terminal remained outside the target and connection scope.

The independent preflight `20260721-164634-7a7a94` correctly refused Local
before maintenance. Its bounded observation proved bootstrap `changed`, phase
`complete`, cleanup `complete`, the exact lock digest, and runtime version
`cpython-3.11.15-20260510-ansible-core-2.19.4`, while the runner separately
reported `runtime-unavailable`. This rejected download, package, collection,
active-link, and missing-bootstrap hypotheses.

Bounded StoneBase inspection then proved the publication defect. The active
symlink and version directory were root-owned and present; the pinned Python
reported 3.11.15. All ten ansible-core console scripts existed, but every
shebang named the same removed staging path below
`versions/.cpython-3.11.15-20260510-ansible-core-2.19.4.*/extract/python`.
Executing `ansible` or `ansible-galaxy` therefore returned `ENOENT`. The cause
is **CONFIRMED**: standard pip console scripts use an absolute interpreter
shebang, and the installer validated before rename but not after rename. It is
not a defect in Ansible's standard `ansible-playbook -c local` connection.

The offline fix publishes a new
`cpython-3.11.15-20260510-ansible-core-2.19.4-r2` directory. Before rename it
accepts and rewrites only the exact ten ansible-core entry points from the exact
staging interpreter to the immutable final interpreter. It then validates
Python 3.11.15, ansible-core 2.19.4, and community.general 11.4.1 from the final
path before switching the atomic `active` symlink. Unexpected, missing,
symlinked, writable, oversized, or post-publication-invalid scripts fail closed;
an unactivated `r2` directory is removed, while the old active version remains.
The staging directory has a fixed short random name and the production staging
and destination shebang sizes are code-checked at import, preventing pip's
standard Linux long-shebang shell wrapper from entering this exact rewrite
protocol. The Local artifact runtime claim now includes the `r2` build identity.

Regression and complete aggregate validation passed 872 deploy Python tests,
20 isolated PostgreSQL/API tests, 24 recovery tests, 99 Ansible template
parses, deploy safety and lifecycle contracts, and all inventory/playbook
syntax and check-mode contracts. This is offline evidence only. Local remains
No-Go until the fix is reviewed and merged, a canonical exact-scope SSH run
installs `r2`, and a later canonical preflight independently returns effective
Local with no fallback.

## Direct transport parity addendum

PR #1057 merged at `0deb78228f8abbf36543796ea23144384712775a` after its
long-shebang review finding was fixed. Canonical run
`20260721-172923-90a38b` used the unchanged serial SSH route, kept the fixed
Pi5 stability and terminal notice windows, installed `r2`, and finished with
ready ACK, independent evidence, cleanup, and maintenance clear. Independent
preflight `20260721-174938-0c7310` then observed bootstrap `changed/complete`,
the exact supply lock, Python 3.11.15, ansible-core 2.19.4,
community.general 11.4.1, runner v3, and runtime identity
`sha256:f607570e67d68855078486c54bfd5fe467b082e150582deab1862b0413310dd2`.

Canary `20260721-175030-81ee22` did not enter Local execution. The coordinator's
locked repeat selection fell back before Pi5 mutation was committed to the
terminal route, with public contract and runner evidence both null. Source
audit confirmed two coupled contract defects:

1. aggregate preflight proved the Local runner through Ansible but did not
   apply the direct backend's connection-contract policy;
2. the direct backend rejected the inherited global inventory string
   `-o StrictHostKeyChecking=no`, then collapsed that transport exception into
   the misleading reason `local public inventory contract is malformed`.

The value is not needed by Local and must not weaken it. The fixed backend
accepts only that exact legacy string as an ignored compatibility value,
continues to construct its own command with `StrictHostKeyChecking=yes`, and
still rejects ProxyJump and every other nonempty SSH common argument. Separate
public-contract and direct-runner fallback codes prevent recurrence from being
misdiagnosed. The canary was cancelled through the canonical durable control
path before notice or maintenance; StoneBase remained untouched by that run.

PR #1058 merged that correction as accepted main
`e98060520c7d26909887073de2e13b203024e8d8`. The next exact-scope preflight,
`20260721-181758-b97f76`, proved the pinned runtime unchanged but still selected
SSH fallback `candidate-requires-ssh-configuration`. This was not another
transport or Ansible failure. The release-wide impact registry classified the
two changed coordinator modules as terminal-neutral `deploy-control`, while
the Local eligibility gate maintained a second path list and rejected the same
modules as terminal configuration. The duplicated classification authority is
the confirmed cause.

The structural remediation makes the terminal profile registry the canonical
owner for neutral and deploy-control paths. It separately classifies every
script installed by `local-runner-bootstrap.yml` as
`local-executor-runtime`, scoped by an explicit StoneBase inventory capability.
Those installed files still require the ordinary SSH bootstrap route. A
contract test derives the installed script sources from the Ansible task and
requires every one to retain runtime impact, so a future helper cannot silently
inherit coordinator-only treatment. This change itself includes terminal
runtime and inventory contracts and therefore deliberately requires one final
SSH bootstrap before a later Local-only canary.

PR #1059 merged the shared policy as accepted main
`0ff5fc2de5a6d14523570bb7f5753076bc3380e3`. Canonical run
`20260721-184600-ea3eba` selected the expected pre-maintenance SSH fallback
because the candidate history contained the inventory capability and installed
runtime contract. Pi5 release and fixed stability monitoring, StoneBase
manifest sealing, 60-second notice, maintenance ACK, SSH apply, exact ready
ACK, independent evidence, cleanup, and maintenance clear all succeeded. The
terminal apply took 223,073 ms; independent evidence took 8,424 ms. FJV and
every other terminal remained outside connection and execution scope.

Independent preflight `20260721-190514-541561` then selected requested and
effective `stonebase-local-ansible-poc` with no fallback. It proved Python
3.11.15, ansible-core 2.19.4, community.general 11.4.1, runner v3, runtime `r2`,
and identity
`sha256:f607570e67d68855078486c54bfd5fe467b082e150582deab1862b0413310dd2`.
The implementation, bootstrap, and eligibility gates are therefore complete;
the remaining No-Go applies only until one neutral fixed-SHA Local canary
completes its own artifact, candidate ACK, independent evidence, and cleanup.

## Pinned host-trust addendum

Evidence-only commit `21d3cd86cc7bd2924c0de9e9f18dcea1bd946ea3` was accepted
after preflight selected effective Local. Canary `20260721-191113-a1c6ef`
then repeated locked selection and safely chose SSH fallback
`runner-ineligible: local direct runner preflight is unavailable`. The operator
requested canonical cancellation immediately. The unit honored cancellation at
`after-pi5-stability`; Pi5 evidence and cancellation cleanup completed at
`2026-07-21T19:20:50Z`. StoneBase remained `pending`, with no notice,
maintenance, artifact, transfer, runner unit, or repository mutation.

Source audit confirmed the mismatch. Aggregate preflight had constructed SSH
with `StrictHostKeyChecking=no` and `UserKnownHostsFile=/dev/null`. The locked
backend constructed `StrictHostKeyChecking=yes` and relied on an ambient trust
store. Thus the two probes had the same address, user, port, and default client
identity, but different server-authentication prerequisites. The cause is
**CONFIRMED**; Ansible Local connection behavior is not implicated.

The StoneBase Ed25519 public host key was observed through two independent,
read-only paths: an authenticated exact-host Ansible command reading
`/etc/ssh/ssh_host_ed25519_key.pub`, and `ssh-keyscan -t ed25519` from Pi5 to
the resolved StoneBase address. Key type and base64 payload matched exactly.
Only the public wildcard-scoped known-hosts record is stored; the documented
fingerprint is `SHA256:dwaQeBhabIj6zN3FCNgWCV/+3oedfoVkVjP0ZYc9+Jc`.
No inventory variables, private keys, tokens, or credentials were retained.

The offline remediation rejects extra records, comments, RSA keys, malformed
Ed25519 blobs, symlinks, noncanonical paths, arbitrary SSH common arguments,
and Local-only private-key paths. A malformed candidate pin blocks before any
terminal transport. The unchanged SSH route retains its prior compatibility
behavior. The complete deploy Python discovery passed 889 tests; live Local
remains No-Go until review, accepted-main SSH migration, repeated strict
preflight, and a neutral canary complete.

## Go / No-Go decision

Current split decision:

- **Go**: the accepted typed-claim SSH route and offline implementation/review
  of the relocatable `r2` publication fix.
- **No-Go**: Local execution until the pinned host-trust change is accepted,
  migrated through SSH, independently proved, and followed by one StoneBase
  canary that completes artifact verification, candidate ACK, independent
  evidence, and cleanup.

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
