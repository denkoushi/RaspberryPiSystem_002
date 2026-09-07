# Hermes business butler v1: gated phase 1 implementation

This ExecPlan is a living document. It follows `.agent/PLANS.md`; update
`Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes &
Retrospective` whenever work stops or a gate result changes. The durable design
policy is [ADR-20260907](../decisions/ADR-20260907-hermes-business-butler-design-policy-v1.md).
The technical precondition is the existing [business Hermes gate plan](./business-hermes-butler-gate-execplan.md).

The user approved implementation and subsequently authorized commit, push, PR,
merge, and production deployment on 2026-09-07. Image upgrades, new cron jobs,
business-data writes, and custom application-side agent loops remain excluded.
Local supervisor review and real-model checks have passed as recorded below.
Production rollout uses required CI for the exact release SHA and the standard
Pi5 release runner. Production/Pi4 acceptance remains pending. Response-time
optimization is deferred until the user evaluates the real device.

## Purpose / Big Picture

An operator should be able to start a consultation with an unknown number,
describe the work problem naturally, and receive help deciding what to inspect
or confirm next. Hermes should understand the purpose and business background,
explore only through authorized read-only capabilities, ask for necessary
clarification, reflect a correction, and keep the consultation available for a
later authorized handoff.

The phase 1 result is demonstrated by a local fixed-image gate followed, only if
that gate passes, by a small implementation over the latest active
nonconformity snapshot and published work-instruction photo/text data. A
consultation is an independent opaque case. The same source record or photo may be referenced by
multiple cases; what must remain isolated is each case's conversation history,
confirmed facts, unresolved items, corrections, and summary.

## Progress

- [x] (2026-09-07 JST) Read the repository and documentation rules required by `AGENTS.md`.
- [x] (2026-09-07 JST) Recorded the existing classify -> API search -> chat path and the current twelve-message UI memory boundary.
- [x] (2026-09-07 JST) Accepted the behavior and responsibility split in ADR-20260907.
- [x] (2026-09-07 JST) Defined this gate-before-implementation plan and linked it from the ADR.
- [x] (2026-09-07 JST) Completed the isolated fixed Hermes `/v1/responses` and HTTP read-only MCP transport gate, including handshake, tool discovery, tool call, trusted structured result, prior card/isolation checks, and bounded cancellation evidence. The local model result is not DGX evidence.
- [x] (2026-09-07 JST) Verified the existing DGX runtime boundary with a synthetic tool-selection/follow-up probe. Natural consultation acceptance remains pending.
- [x] Complete the local mixed Hermes + DGX natural acceptance and supervisor review. Production/Pi4 phase acceptance remains pending.
- [x] (2026-09-07 JST) Implemented opt-in SOUL, Context/AGENTS, and business Skill inputs using Hermes's standard profile paths; `platform_toolsets` explicitly enables `business_api` and `skills`.
- [x] (2026-09-07 JST) Added the backend-shaped read-only HTTP MCP surface and dedicated stable-gateway chat profile wiring; focused API/UI validation passed, while mixed Hermes + DGX natural dialogue and final card/application acceptance remain pending.
- [x] (2026-09-07 JST) Focused backend tests (13/13), API build, and the corresponding UI targeted checks passed; mixed Hermes + DGX natural consultation and application-level card acceptance remain pending.
- [x] (2026-09-07 JST) The approved additional 45-minute and subsequent 30-minute validation windows recorded production-equivalent startup and seeded Fastify MCP success. The final diagnostic ran `05:49:10Z`–`05:59:59Z`; the empty reply was traced to a missing test `API_SERVER_KEY`, and the remaining blocker is disposable Docker-to-host SSH-tunnel lifetime/reachability.
- [x] Implemented and exercised independent case history, resume, correction, automatic organization/save, and UI list flows through the actual application API and fixed Hermes + DGX.
- [ ] Validate all acceptance scenarios and measure natural dialogue and lightweight operation on a Pi4 after the remaining integration gate is accepted.

## Surprises & Discoveries

- Observation: the route currently performs intent classification, deterministic API retrieval, and a chat completion. Evidence: `apps/api/src/services/assembly/business-hermes-chat.service.ts` and `business-hermes.service.ts`.
- Observation: the current UI memory window is request-scoped and limited to twelve messages. Evidence: the existing chat input and service clipping behavior; this is not a durable consultation record.
- Observation: source sharing is allowed. The same latest active nonconformity snapshot or published work-instruction source can support multiple independent cases; only consultation state and authorization context must be kept separate.
- Observation: the fixed-image transport precondition and Pi5-approved synthetic DGX tool probe passed, but no natural-dialogue acceptance, Pi4 measurement, or production-record result is claimed by this plan.
- Observation: the fixed Hermes HTTP transport reached the backend-shaped MCP route with authenticated `initialize`, `tools/list`, and `tools/call`; the evidence uses a mock model and must not be read as natural DGX behavior.
- Observation: the chat service must use the stable Caddy gateway on the private bridge to follow the active blue/green API slot. The dedicated profile keeps the guide profile unchanged and is disabled by default.

## Decision Log

- Decision: Treat ADR-20260907 as the policy source of truth and this file as the executable phase 1 plan. Rationale: policy and implementation can evolve without duplicating each other. Date/Author: 2026-09-07 / documentation gate worker.
- Decision: Run fixed-image `/v1/responses`, read-only MCP, DGX capability, card provenance, cancellation, and case separation in an isolated local gate before application implementation. Rationale: the native loop and boundaries must be demonstrated before building on them. Date/Author: 2026-09-07 / documentation gate worker.
- Decision: Keep the consultation as an independent opaque case, with no dependency on a part number or existing assembly session. Rationale: unknown-number intake and next-day handoff are core behaviors. Date/Author: 2026-09-07 / documentation gate worker.
- Decision: Preserve existing authentication visibility, publication rules, and active asset boundaries. Rationale: the phase adds consultation-state separation and tool mediation without inventing a new row-level ACL model. Date/Author: 2026-09-07 / documentation gate worker.
- Decision: Permit the same public source record to appear in more than one case while forbidding cross-case history, unresolved-state, correction, or summary leakage. Rationale: shared business evidence is normal; shared consultation state is not. Date/Author: 2026-09-07 / documentation gate worker.
- Decision: Load business identity/context/Skill through Hermes's standard SOUL, working-directory AGENTS.md, and HERMES_HOME skills paths, and explicitly enable the `skills` toolset. Rationale: injecting a Skill as fixed system text would bypass the official Skill mechanism. Date/Author: 2026-09-07 / Hermes gate worker.

## Outcomes & Retrospective

The fixed-image transport precondition and Pi5-approved synthetic DGX tool probe
are recorded as passed, while natural Hermes + DGX behavior, final card/case
integration, and Pi4 measurement remain pending. The profile is opt-in and no
deployment or image upgrade was performed. The production template already
renders the dedicated `API_SERVER_KEY`; the initial empty reply came from its
omission in the disposable test invocation. The corrected startup passed, but
the authenticated provider call lost the disposable Docker-to-host SSH tunnel,
so this does not establish a DGX product failure.

## Context and Orientation

The current endpoint is
`apps/api/src/routes/assembly/business-hermes.ts`. It invokes
`BusinessHermesChatService` in
`apps/api/src/services/assembly/business-hermes-chat.service.ts`, which
classifies the message, performs bounded nonconformity/work-instruction lookups,
and calls `BusinessHermesService` in
`apps/api/src/services/assembly/business-hermes.service.ts`. The upstream client
currently reads final chat-completions text. The current UI request carries at
most twelve messages and does not persist a business consultation.

Work-instruction publication and asset identity are defined in the existing
work-instruction domain near
`apps/api/src/services/work-instructions/domain/manifest.ts`. Existing JWT
roles and `clientKey` authentication remain the application boundary. Existing
read services and imports remain in use. The implementation must preserve the
existing public-version and active-photo boundaries rather than create a second
source of truth.

The policy uses five responsibility names. **SOUL** controls personality and
dialogue. **Context** carries the current business background. **Memory** means
continuing facts exposed by official Hermes Memory; it is distinct from the
application DB that stores each case's messages, confirmed facts, unresolved
work, corrections, and summary. **Skills** are reusable
procedures. **Tools/MCP** are authorized read-only exploration means. These are
behavioral roles; the plan does not choose RAG, embeddings, or a transport until
the gate demonstrates a need.

This phase does not verify visual image understanding and keeps Hermes vision
disabled. The agent may use photo IDs, accompanying text, and a server-provided
published viewer reference; it must not claim to have inspected the image's
appearance.

An **independent case** is an opaque application identity with its own messages,
confirmed facts, unresolved items, corrections, summary, and title.
A **source record** is either the latest active nonconformity snapshot or a
published work-instruction pointer/item that can be referenced by several cases.
A **trusted card** is assembled by the server from a source result and its
authorized active asset ID. A **principal** is the existing authenticated
caller. No principal-to-source row ACL is added
by this plan; existing read visibility and publication/asset authorization stay
the source of truth.

## Plan of Work

### Milestone 0: Preserve the existing boundary

Before editing application code, document the current route, service, UI, auth,
published-version, and asset contracts. Keep imports and existing read behavior
working. Do not add a data source, write API, cron schedule, or persistent model
memory as a side effect of discovery.

### Milestone 1: Complete the isolated technical gate

Use the exact fixed official Hermes image already selected by the gate plan. The
local harness must expose one disposable read-only MCP fixture and use the
official `/v1/responses` interface. The fixture returns bounded business-shaped
records, source version dates, public/edited text, active photo IDs, and source
references. It has no write method, repository mount, production credential, or
unrelated source.

Exercise the native model -> tool call -> tool result -> follow-up response
sequence. Keep the authoritative fixture output in the harness and construct
cards from it. A model-written URL or filesystem path is never accepted. Test
two independent cases using the existing authentication boundary and distinct
case identities. Reusing a source record across cases is expected; sharing
messages, unresolved items, corrections, or summaries is a failure.

Run a delayed read-only call, cancel it, and confirm that a late result cannot
change the case. Resume the canceled case and confirm that a later valid result
can be recorded once. Record each gate result as PASS, FAIL, or NOT RUN.

### Milestone 2: Verify existing DGX capability

After the isolated transport gate is ready and the supervising reviewer permits
the capability check, use the existing DGX runtime boundary with the same
fixture. Record the model route, tool selection, clarification behavior for no
match/multiple/conflicting results, latency, timeout, and failure output. Do not
change DGX ownership or add a new runtime.

If the fixed image, Responses transport, read-only MCP, DGX behavior, trusted
card projection, cancellation, or case separation fails, stop here. Return the
exact evidence to the supervisor and do not proceed to Milestones 3 onward. A
small official-compatible configuration correction can be reviewed; an
unauthorized image upgrade or custom loop is not a correction.

### Milestone 3: Implement SOUL, Context, and Skills

After a passing gate, add the smallest behavior inputs needed for a natural
business consultation. SOUL states how Hermes explains uncertainty, asks the
counterpart's intent, and acknowledges corrections. Context carries the current
item/photo/document relationship and source-of-truth status. Skills describe
purpose understanding, business-background collection, result-driven search,
candidate comparison, clarification, evidence citation, correction, and resume.

These inputs guide the model; they do not authorize access. The server remains
responsible for authentication, source visibility, publication, active assets,
case state, count limits, cancellation, and audit metadata.

### Milestone 4: Add existing-database read-only MCP operations

Expose only business capabilities over the latest active nonconformity snapshot
and published work-instruction reads:

- semantic explanation of an authorized nonconformity or work-instruction
  concept;
- condition or description text search; and
- bounded detail retrieval for a selected record and published work-instruction
  photo/text evidence.

Use dedicated internal MCP authentication and read-only methods. Reuse existing
JWT/clientKey visibility and existing published-version/active-photo rules. Do
not expose database credentials, unrestricted SQL, or raw internal paths. Every
result includes a count limit, source identity, public version or published
pointer as applicable, edited content, source version date, and active photo ID
when applicable. A source may be
referenced by several cases; the MCP result must not carry another case's
conversation state.

Maintain existing imports and ingestion behavior. Do not add an external data
source, business write, cron, or RAG/embedding dependency before a separate
behavior-backed decision.

### Milestone 5: Implement independent case continuity

Add an opaque consultation-case record rather than reusing an assembly work
session. At minimum, store case identity and authorization references,
title, timestamps, user and assistant messages, source references, confirmed
facts, unresolved questions, corrections, and a summary. Keep raw server/source
content visibly separate from the summary.

Opening a case requires no part number. A part number, nonconformity number,
manufacturing order, or work-instruction target is a relationship that can be
discovered and corrected later. A title or relationship change is a reviewable
correction. The new-list flow must reopen a case on the next day for another
another authorized user without exposing another case's state.

The response adapter consumes the trusted tool result and constructs the
existing evidence card contract. It may add opaque case/source provenance but
must not allow model-created URLs. The server resolves an authenticated photo
URL from the active asset ID and existing route.

### Milestone 6: Add UI flows and measure Pi4 behavior

Add only the UI needed for a new consultation list, resume, title, and corrected
relationship display. Keep the Pi4 client lightweight and the existing DGX
runtime unchanged. Verify natural dialogue for unknown-number, part-only,
cross-check, correction, no-result, multiple ambiguity, and conflicting-source
scenarios.

After code review and gate approval, measure the Pi4 for response time,
memory/CPU footprint, cancellation, failure recovery, and next-day handoff. A
local fixture or DGX-only result cannot stand in for this measurement.

## Concrete Steps

All commands start in
`/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-business-butler-gate`.
Use a unique temporary directory for disposable fixtures and logs.

Begin with read-only inventory:

    git status --short --branch
    python3 -m scripts.git_lifecycle.cli audit --json
    rg -n "business-hermes|BusinessHermes|clientKey|authorizeRoles" apps/api/src

For Milestone 1, inspect the fixed digest, start only the local fixture and
Hermes containers, use an isolated Hermes home and bounded timeouts, and do not
mount the repository or shared project volumes. Send a Responses request with
an unknown-number prompt, repeat it with a second case, resume the first case,
and execute the delayed cancellation. Retain redacted structured output and
record the exact tool and case identifiers.

For Milestone 2, run the same fixture through the current DGX model route only
after the local gate and supervisor review. Record measured route, latency,
tool-call, clarification, timeout, and failure data. Do not alter runtime
settings while a gate is failed; the separately recorded Pi5-approved
read-only probe does not constitute natural-dialogue acceptance.

For later milestones, run the narrowest API/UI tests after each change, then the
repository-required suite. Update all living-plan sections whenever work stops.
Commit, PR, merge, and standard production deployment are now explicitly authorized.

## Validation and Acceptance

### Gate acceptance

Record these independently as PASS, FAIL, or NOT RUN:

- fixed official image and `/v1/responses` transport;
- read-only MCP discovery and bounded result;
- DGX model capability through the existing runtime;
- trusted card with evidence ID, source step, public/edited text, source version
  date, count limit, active photo ID, and server-derived image URL;
- rejection of model-written URL/path and unauthorized asset;
- separation of case messages, confirmed facts, unresolved items, corrections,
  and summaries while allowing a shared public source;
- cancellation, timeout, late-result rejection, and valid resume.

Any FAIL stops later implementation pending supervisor review. No hidden loop or
unapproved image change can turn a FAIL into a PASS.

### Product acceptance

After implementation, a reviewer must be able to:

1. start with an unknown number and receive a useful focused question;
2. start with a part number only and receive evidence or a clear question;
3. request a cross-source relationship check with source identities shown;
4. correct an assumption and see the next search and case state update;
5. receive explicit no-result, multiple-candidate ambiguity, and conflicting
   source handling;
6. open the new list, resume next day as another authorized user, and see
   raw source, confirmed, unresolved, and summary data distinguished;
7. confirm that A/B histories and unresolved state never mix even when they
   reference the same published source;
8. cancel/fail a tool call, resume, and confirm its late result cannot mutate
   the case;
9. observe natural dialogue and a recorded lightweight real-Pi4 measurement;
10. confirm imports continue and no other source, business write, or cron exists.

## Idempotence and Recovery

The local fixture and Hermes containers are disposable. Stop and remove only
resources created by the current run; never remove shared volumes or alter the
repository compose stack. If a process hangs, retain the transcript and
terminate only its recorded process/container ID. Correct one directly evidenced
configuration error and rerun once; repeated identical failures stop the gate.

If later implementation is disabled, the existing chat path remains available
while the independent case adapter is repaired. A canceled or timed-out tool
call must be marked incomplete and cannot be replayed as a successful result by
late network delivery.

## Artifacts and Notes

The durable artifacts are this plan, ADR-20260907, and the technical gate plan.
Append only short redacted evidence, for example:

    fixed image / Responses: PASS (fixed v0.21.0)
    read-only MCP: PASS (HTTP handshake/list/call; see work/hermes-business-gate/http-mcp-summary.txt)
    DGX capability: SYNTHETIC PROBE PASS; natural dialogue NOT RUN
    trusted card provenance: PASS (local fixture evidence)
    case-state separation: PASS (local synthetic cases)
    cancellation and resume: PASS for fixed-image transport contract; app acceptance pending
    Pi4 measurement: PASS | FAIL | NOT RUN

The early NOT RUN entries above describe the initial gate only. Natural DGX dialogues were subsequently exercised as recorded in the supervisor checkpoints; Pi4 remains **NOT RUN**. Do not record secrets, bearer tokens, production URLs, raw business
records, or unmeasured success.

## Interfaces and Dependencies

The application continues to use existing JWT roles and `clientKey`
authentication. The internal MCP adapter uses dedicated service
authentication and read-only methods. It reuses existing source visibility,
published-version, and active-photo authorization. It does not invent a new row
ACL system.

The minimum future shapes are:

- `ConsultationCase`: opaque ID, authorization reference, title,
  status, timestamps, messages, and relationship correction metadata;
- `CaseFact`: confirmed or unresolved fact, source reference, and correction
  history;
- `CaseSource`: source identity, public version, edited content, source version
  date, active photo asset ID, and bounded result position;
- `TrustedEvidenceCard`: existing `evidence.id`, `kind`, `partNumber`, `step`,
  authenticated server-derived `imageUrl` when applicable, and minimal
  case/source provenance;
- `ReadOnlySearchResult`: operation kind, bounded records, count limit, and
  safe source metadata; never credentials or another case's conversation state.

The supported Hermes contract is the fixed image's Responses structured output
only if the gate confirms it. Pi4 stays lightweight, the existing DGX runtime
stays in place, imports remain usable, and new sources, writes, cron jobs,
unrestricted SQL, and automatic model self-training remain out of scope.

Revision note: 2026-09-07 — created as the approved phase 1 implementation plan,
separating design policy into ADR-20260907 and clarifying that published source
records may be shared while consultation state remains isolated.


## Supervisor checkpoint — 2026-09-07 17:00 JST

The user requested a safe pause at 17:00 and will explicitly resume later. All delegate handoffs have been recovered; further work is supervisor-only. The user removed validation time limits, so the pause is their requested stopping point, not a budget exhaustion.

Implemented after handoff: native streaming function-call-output preservation (including input_text arrays and full incremental items), saved confirmation/search diagnostics, literal published-text SQL pagination, published-version-based detail resolution, authenticated local photo delivery, removal of title/identifier/save forms and number-explanation copy, explicit server cancellation, safe rendering of acknowledgement plus valid state JSON, and yes/no replies that add no inferred meaning. Returning to the consultation list now refreshes shared cases.

Evidence in work/hermes-business-gate: root-prepause-api.log (24 tests), root-prepause-ui.log (17 tests), root-prepause-types.log, root-build.log, root-search-db.log (23 groups, published-only pagination), root-db-tests.log (case persistence), root-natural.json, root-handoff-dialogue.json, root-confirmation-roundtrip.json, and root-skill-gate.json. Real Hermes/DGX tests demonstrated number-only and numberless responses, source cards, correction, second-principal handoff, separate-case uncertainty, no match, and persisted yes/no interaction. The fixed official skill gate evaluated allow=false/stage=true; no skill approval action is exposed to the model.

Still open: final behavioral review (unnecessary repeat searches, verbose/raw identifiers, redundant clarification, distinction between source dates and publication); full source/diff review; real Pi4 workload/display and production acceptance. The first number-only held-out run took 95.4 seconds with eight search calls. Source display and conversational state function, but this is not a claim that all behavior meets the design policy. No production deploy, commit, push, or image update occurred. Vision capability was measured with a synthetic red/blue image; the business flow still uses photo references/text and does not claim visual inspection.

Preserve the worktree, stopped disposable Docker containers and volumes, and private local restart environment. See the user-facing pause/resume record for the exact remaining work and restart order. Do not resume until the user asks.

Safe-pause verification: no listeners on 18080/8080/4173/4174/18081 and no running hermes-business-gate containers. The pg2 container used AutoRemove and was removed on stop; its final consistent pg_dump is preserved in prepause-db.sql.gz. restore-local-db.py is prepared but has not been executed. Other fixed-Hermes/egress/legacy-PG containers are stopped and retained. This limitation must be checked at resume.


## Supervisor checkpoint — resumed 2026-09-07

The user explicitly resumed work. The final backup was restored successfully into a
named local PostgreSQL volume with AutoRemove disabled; four saved messages and
the pending confirmation survived restoration. Local API, Vite, fixed Hermes,
and the approved DGX tunnel are running again. No worker was reactivated.

The user deferred response-time optimization until their real-device experience.
The proposed ten-second threshold is withdrawn from phase 1 acceptance.

Dialogue policy lives in SOUL/Context/Skills; the application supplies the
structured response and case-state contract. The model output allowance is 1,600
tokens to avoid truncating the answer plus saved state. The measured DGX route
reports max_model_len 262144; no image or agent-loop change was made.

NC query now includes business identifiers, and an additional condition narrows
the query instead of broadening it. Context and source descriptions distinguish
individual corrective content, disposition, remarks, discovery date, and source
update date; an empty field is not evidence that work was not performed.

Validation: final-api-tests.log records 24 tests passing; the later cancellation
regression brings the service file to 14 tests passing (final-cancellation-tests.log).
resume-db-validation.log records four actual-DB tests passing, including identifier
search/refinement, persisted history, published detail after a different draft,
and published-group pagination. final-contract-natural.json records three ready
responses: a neutral number-only inquiry without binary buttons, explicit
corrective/disposition distinction, and a single yes/no assembly confirmation.
The browser reopened those saved cases through the real API and rendered the
corresponding confirmation.

Final review found that the third dialogue’s summary proposed another process
although the answer correctly distinguished the separate documents. SOUL now
applies the same evidence/scope rules to handoff state as to the visible answer.
The English output contract did not consistently preserve that boundary or emit
binary confirmations; final-scope-natural.json records that failed follow-up.
The contract was consolidated in Japanese, including explicit field semantics;
final-japanese-contract.json is the next verification. No UI semantic matcher or
custom agent loop was added. Cancellation during
source-asset verification now discards the late answer before saving.

Remaining boundary: production deployment/hosted CI and Pi4 workload/display
acceptance require the separate release workflow and explicit release authority.
All local fixtures are synthetic. The consultation list currently shows the latest
100 cases; older cases remain stored and retrievable by ID. List pagination is a
recorded scaling follow-up, not a claim of unlimited browsing.


### Final-answer extraction correction

The native response store identified the missing-confirmation root cause: the
fixed Responses endpoint can concatenate tool-phase draft text/JSON and the
final answer into one output_text content part. The application extracted the
first embedded JSON, silently choosing an earlier draft. The final native answer
did contain confirmation and corrected state. The response-only parser now
selects the final embedded object; business tool-result parsing retains its
existing first-object behavior. A regression supplies an earlier different title,
summary, and question followed by the final confirmation and checks the saved
state. The service suite now passes 15 tests (26 total across targeted API files).

Evidence: native-concatenated-response.json contains the synthetic native envelope;
final-parser-dialogue.json and final-parser-roundtrip.json are the real-model
verification after the parser correction. Prior failures remain recorded and are
not attributed solely to model quality.


### Native history-chain correction

The first post-parser roundtrip invented a second assembly step. Inspection of
the fixed runtime showed that X-Hermes-Session-Key binds session identity but
does not load Responses history. The saved response history contained only the
latest acknowledgement, so previous source results were absent despite correct
application case storage. The official handler in
`gateway/platforms/api_server_openai_routes.py` restores history through
`conversation` or `previous_response_id`. The request now supplies the existing
server-owned opaque hermesConversationId as `conversation` as well as the header.
No new session store, custom loop, or client-controlled history was added.

The request-contract test checks this field. final-native-chain.json and
final-native-chain-roundtrip.json record the ensuing real-model verification.
Earlier summary-based handoff evidence is retained but does not establish native
history continuity by itself.


### Conversation continuation and choice UI verification

Native conversation chaining retained the initial request and tool results. The
acknowledgement completed the only assembly step instead of inventing step 2.
A different VIEWER principal then excluded final inspection; the response kept
assembly completion, removed final inspection from unresolved items, and left
openQuestions empty (final-native-handoff.json). A fresh conversation did not
claim another case’s product/process (final-native-isolation.json).

That fresh-case probe exposed a choice UI limitation: every model confirmation
was rendered as yes/no, including a multiple-candidate question. The confirmation
now carries explicit options (two to five bounded strings), which are preserved
and rendered verbatim. Without options the UI invents no buttons and free text
remains available. Yes/no is one supported option set, not a semantic UI matcher.
The 18 UI tests include candidate choices and the absence of invented yes/no
buttons. final-options-dialogue.json records the real-model check.


## Local completion checkpoint — 2026-09-07 18:21 JST

Local implementation and supervisor acceptance are complete for the synthetic
source environment. API: 26 targeted tests, including 15 consultation-service
tests. UI: 18 targeted tests. Four opt-in actual-DB tests passed. API build, Web
typecheck, scoped lint, Compose validation, and diff whitespace checks passed.
No dependency or image upgrade, business write tool, or custom loop was added.

Final real conversations verified explicit candidate options and yes/no options
(final-options-dialogue.json, final-binary-options.json). The browser reopened
both saved option sets, clicked a candidate, and received the selected NC/public
procedure explanation with correct individual-corrective terminology
(final-options-click.json). Options are bounded and may wrap on a narrow panel.

The earlier pre-chain handoff tests are supplemented by actual native history
continuity and a second-principal correction with an empty unresolved list
(final-native-handoff.json). SOUL and field-meaning Context were confirmed loaded
from the native prompt store. Remaining work is release/hosted CI and real
Pi4/production acceptance under explicit authority. The user-facing review and
release proposal state the current 100-case list and non-vision limitations.

## Production rollout integration — 2026-09-07

The standard `release_pi5` role now prepares the dedicated profile and API
configuration, starts consultation Hermes after routing reaches the new MCP,
and restores profile files and prior container running states on failure.
Only a newly attached gateway network connection is removed on rollback;
consultation volumes are retained. The gateway receives its stable DNS alias.
Dedicated API and MCP credentials derive from the existing Vault-delivered
business key with distinct labels unless explicitly overridden in Vault.
The business Pi5 inventory enables the approved consultation service.

The deployment contract suite exercises fresh startup, failed startup, and
restoration of an existing stopped service with actual Ansible tasks and a
stateful Docker double. Required hosted CI and release artifact checks precede
any production mutation. Runtime and Pi4 acceptance evidence will be recorded
after the canonical release run completes.
