# Business Hermes Butler: design policy and technical gate

This is a living ExecPlan. It follows `.agent/PLANS.md` and must be updated whenever a gate result or design decision changes. The plan covers the first feasibility gate for the business Hermes butler; it does not authorize a production deployment, a Hermes image upgrade, or a custom agent loop.

## Purpose / Big Picture

An operator should be able to open an independent business consultation before a part number is known, describe a problem in ordinary language, and receive help that can inspect the authorized nonconformity and work-instruction sources. Hermes should ask for only the missing information it needs, select the next read-only search, check the result, and continue the consultation across turns. A later part number or nonconformity can be attached to the same business case.

The first visible proof is a local fixed-image conversation in which Hermes invokes a read-only test MCP source, receives bounded records and distinct photo asset identifiers, and returns a response whose cards are built from the trusted tool result. The model must never supply an arbitrary photo URL. The local proof must show that two case/session identities do not share conversation history or consultation state; the same published source may be referenced by both cases.

## Design Policy v1

The durable behavior and responsibility policy is [ADR-20260907](../decisions/ADR-20260907-hermes-business-butler-design-policy-v1.md). This gate uses its invariants: consultations are independent opaque application cases, part numbers are optional relationships, shared published sources are allowed, and case messages/confirmed facts/unresolved items/corrections/summaries must not mix. Existing JWT/clientKey read visibility, publication conditions, and active-asset rules remain the source of truth; this gate does not introduce a new row-ACL model. Hermes owns its native loop, while the application owns case state, trusted cards, timeout, cancellation, and audit metadata.

## Progress

- [x] (2026-09-07, JST) Read repository entry rules and the required safety, quality, debugging, architecture, documentation, and git-workflow rules.
- [x] (2026-09-07, JST) Audited the clean `main` worktree and created the dedicated branch/worktree from the exact fetched `origin/main` SHA `eb092c7122daee71b0074c041db2072a96fab8f5`.
- [x] (2026-09-07, JST) Inspected the fixed Hermes image digest and recorded the local upstream revision `f58fcc81` and version `v0.21.0`.
- [x] (2026-09-07, JST) Confirmed from the fixed image source that native agent/tool looping exists, MCP tool selection is static configuration, `/v1/responses` exposes structured tool output, and `/v1/runs` events do not expose tool-result bodies.
- [x] (2026-09-07, JST) Ran the disposable fixed-image HTTP MCP and `/v1/responses` gate. HTTP `initialize` → `tools/list` → `tools/call` used the bearer boundary and returned a structured function-call output.
- [x] (2026-09-07, JST) Verified the earlier trusted card projection, case/session isolation, delayed streaming disconnect behavior, and `/v1/runs` stop contract. The HTTP evidence is in `work/hermes-business-gate/http-mcp-summary.txt`; the local model remains transport evidence only.
- [x] (2026-09-07, JST) Measured the existing Pi5-approved DGX route with a synthetic read-only tool schema: the model selected the tool and produced a follow-up response. This is a capability probe, not final natural-dialogue acceptance.
- [x] (2026-09-07, JST) Backend consultation/MCP focused tests (13/13) and the API build passed; the corresponding UI implementation and targeted checks passed under supervisor review. Backend evidence is `work/hermes-business-gate/backend-validation.log`.
- [x] (2026-09-07, JST) In the approved additional 45-minute and subsequent 30-minute validation windows, production-equivalent fixed-image startup and seeded Fastify MCP protocol passed. The final diagnostic ran from `05:49:10Z` through `05:59:59Z`; the natural Hermes + DGX conversation remained unaccepted. Evidence is `work/hermes-business-gate/final-integration-timing.txt` and `final-diagnostic-summary.txt`.
- [x] (2026-09-07, JST) The initial empty reply was traced to the disposable test container omitting `API_SERVER_KEY`; the production template already renders that key. After adding an ephemeral test key, Hermes health passed, but the authenticated provider call lost the disposable host SSH tunnel and logged connection refused. This does not establish a DGX product failure.
- [ ] Complete the mixed Hermes + DGX natural consultation acceptance and application-level case/card review under the supervisor; no deployment is implied.

## Surprises & Discoveries

- The checked-in business Hermes route is currently a stateless two-call application flow: a strict intent classifier, deterministic exact lookup, then a final chat-completions call. It is not a Hermes-native tool loop.
- The fixed image accepts static `mcp_servers` and `platform_toolsets` configuration. The OpenAI-compatible chat-completions request's `tools` and `tool_choice` fields are not a confirmed per-request allowlist.
- `/v1/responses` can emit `function_call_output` with the tool result, while `/v1/runs/events` reports only tool name, preview, duration, and error. A card adapter that needs the authoritative payload must consume Responses output or keep the trusted tool result in the application process.
- The current API accepts either a kiosk client key or a JWT but passes only the request body to `BusinessHermesChatService`; caller identity is not propagated into Hermes. Hermes session IDs therefore cannot be used as the business authorization boundary.
- The fixed image's HTTP MCP transport performed the native handshake and tool call against the backend-shaped path with the dedicated bearer header. The API service must be reached through the stable gateway (`https://gateway/api/...`) so blue/green activation follows the canonical Caddy slot; pinning `api-blue` or `api-green` is invalid.
- With `platform_toolsets.api_server: [business_api]` alone, the fixed image exposed the MCP catalog but did not expose `skill_view` to the model. The dedicated profile therefore explicitly enables the official `skills` toolset and mounts SOUL, AGENTS context, and the business Skill through Hermes's standard paths.

## Decision Log

- Decision: Keep the pinned image digest for the gate and do not upgrade Hermes or implement a replacement loop. Rationale: the user asked to follow the official behavior, and compatibility must be measured before changing the runtime. Date/Author: 2026-09-07 / Hermes gate worker.
- Decision: Use a disposable read-only MCP fixture and a disposable model endpoint for the first gate. Rationale: this proves transport, tool discovery, loop, and card provenance without reaching production data or the DGX. Date/Author: 2026-09-07 / Hermes gate worker.
- Decision: Treat the fixed image's native `/v1/responses` structured output as the candidate integration contract. Rationale: chat-completions hides tool-result bodies and run events are lifecycle-only. Date/Author: 2026-09-07 / Hermes gate worker.
- Decision: Keep consultations in a separate opaque business-case record and do not attach them to `AssemblyWorkSession`. Rationale: an independent consultation may begin without a work session and must survive a day boundary with its own messages and unresolved state. Date/Author: 2026-09-07 / Hermes gate worker.

## Outcomes & Retrospective

The fixed-image technical preconditions are satisfied without upgrading the pinned image or writing an application-side loop. HTTP MCP evidence and the Pi5-approved read-only DGX probe are separate from final natural-dialogue acceptance. The dedicated chat profile is opt-in; no secret, remote deployment, commit, push, or PR was performed. The remaining acceptance is the supervisor's mixed Hermes + DGX conversation and application card/case review.

## Context and Orientation

`apps/api/src/routes/assembly/business-hermes.ts` exposes the current business chat route. `apps/api/src/services/assembly/business-hermes-chat.service.ts` clips the conversation, classifies intent, performs exact part/target lookups, builds bounded evidence, and calls `BusinessHermesService.chat`. `apps/api/src/services/assembly/business-hermes.service.ts` currently posts to `/v1/chat/completions` and reads only final assistant text. This path is useful as a compatibility fallback, but it cannot itself provide the requested open-ended search loop.

`infrastructure/docker/docker-compose.phase3.yml` pins the business image to `nousresearch/hermes-agent:latest@sha256:23d7fdefc42ef4f874938835dcc9543468b45c3fe082415095ab48056c56c32a`. The checked-in example at `infrastructure/docker/business-hermes/config.yaml` disables memory and most built-in toolsets and has no MCP server. `apps/api/src/services/work-instructions/domain/manifest.ts` defines published work-instruction steps and immutable asset identifiers. Active assets are delivered through authenticated API routes. `ScawStfutekigoCurrent` in `apps/api/prisma/schema.prisma` contains the nonconformity fields, but the current read service performs exact part-number lookup and has no general text or embedding search.

Inside the pinned image, `gateway/platforms/api_server.py` creates an `AIAgent` with enabled toolsets and a session database. `hermes_cli/tools_config.py` resolves the static tool configuration and applies `agent.disabled_toolsets` last. `gateway/platforms/api_server_openai_routes.py` implements `/v1/responses`, including structured function-call and function-call-output items. `gateway/platforms/api_server_runs.py` implements run IDs and lifecycle SSE, but intentionally does not place tool-result bodies in run events. These facts are the basis for the gate below.

## Plan of Work

First, run the fixed digest with a temporary configuration that enables exactly one read-only MCP fixture and a local model endpoint. The fixture returns two independent cases, each with a distinct evidence ID, step number, and asset ID; it has no write method and no access to repository or production credentials. The model endpoint is deterministic and exists only to prove protocol behavior; its result must be labeled as transport evidence, not DGX capability evidence.

Next, exercise `/v1/responses` with an explicit case-scoped session key and inspect the structured output. Prove that the native agent asks for the fixture tool, receives its result, and produces a follow-up answer. Build a temporary server-side card projection from the fixture result, using an allowlisted asset-ID-to-URL map. Assert that an LLM-supplied URL is ignored, that case A's messages and unresolved state cannot appear in case B, that a shared published source may be independently referenced by both cases, and that a second turn can use the first turn's trusted result.

Then exercise stop/timeout with a deliberately delayed read-only tool and record whether the fixed API returns a bounded error and stops the run. If the fixed API cannot meet this boundary, record the failure and stop; do not add an application-side hidden loop to make the gate appear to pass.

After the local gate passes, and after the parent reviews the result, measure the actual configured DGX model with the same read-only fixtures. Record whether it selects a tool, asks a clarification when the fixture returns multiple candidates, and continues after a tool result. A mock model passing the first gate never counts as evidence that the DGX model has the needed behavior.

Only a passing gate permits the later application design: a server-owned business-case record, principal-bound tool gateway, Responses adapter, trusted evidence-card projection, and a compatibility-preserving route/UI migration. A failed gate returns to the parent with the exact incompatibility and the smallest official-compatible remediation.

## Concrete Steps

All commands below run from `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-business-butler-gate`. Temporary fixture files and runtime state belong under `/tmp` and must be removed after the gate. Never place a credential in the fixture or repository.

    python3 -m scripts.git_lifecycle.cli audit --json
    git status --short --branch
    docker image inspect 'nousresearch/hermes-agent:latest@sha256:23d7fdefc42ef4f874938835dcc9543468b45c3fe082415095ab48056c56c32a'
    docker run --rm --entrypoint /opt/hermes/.venv/bin/hermes 'nousresearch/hermes-agent:latest@sha256:23d7fdefc42ef4f874938835dcc9543468b45c3fe082415095ab48056c56c32a' --version

The fixture configuration must name the MCP server under `mcp_servers`, point to its stdio command or local Streamable HTTP endpoint, and include only the fixture's read-only tools in `tools.include`. The Hermes API platform must include that MCP server in its static `platform_toolsets.api_server` selection and must not re-enable unrelated toolsets. The configuration must use an isolated `HERMES_HOME`, read-only root filesystem, no host repository mount, and a bounded timeout.

The first protocol request is a Responses request with an explicit session key and a neutral prompt such as “I have two unresolved cases; inspect the authorized records and tell me what you need next.” The expected result is a structured output containing an assistant function call, a function-call output containing the fixture's JSON payload, and a final assistant message. The result must include no secret, filesystem path, or arbitrary photo URL.

The isolation request repeats the same prompt with a different case-scoped key and the existing application authentication boundary. The expected result contains only the second case's consultation state; a normally visible published source may also be returned. Reusing a key after a principal change must be rejected or start a new application case; a Hermes session key alone is not accepted as an authorization decision.

The timeout request points at a fixture method that sleeps beyond the configured deadline. The expected observation is a bounded failure with the run stopped and no later tool result accepted into the case. A hanging or unbounded process is a failed gate.

## Validation and Acceptance

The repository validation is the lifecycle audit and a clean worktree check. The fixed-image transport gate passes only if the exact digest starts, discovers the named read-only MCP tool, completes at least one native tool loop, and exposes its authoritative result through `/v1/responses`.

The card-provenance gate passes only if cards are generated from the trusted fixture payload, retain the fixture evidence ID, part number, and source step, and derive the photo URL from a server-side asset map. A model-generated URL, path, unknown asset ID, or cross-case consultation state fails the gate. A shared published source is allowed in more than one case.

The continuity gate passes only if two independent authorized case identities remain isolated and the same case can continue on a later request without requiring a part number at case creation. The cancellation gate passes only if a delayed read-only tool is bounded and its late result cannot mutate the case.

The DGX capability gate is separate and must report the actual endpoint, model route, latency, tool-call rate, clarification behavior, and any failure. It is not satisfied by the deterministic local model. The Pi5-approved read-only synthetic DGX probe was performed; the mixed natural-dialogue gate remains pending.

## Idempotence and Recovery

The fixture and Hermes containers are disposable. Use a unique temporary directory per run, stop containers by ID, remove only those IDs, and delete only the temporary directory. Do not remove named project volumes or alter the shared compose stack. If a test times out, inspect and terminate only the fixture and fixed-image processes created by the gate. Restore the worktree to the last clean status before reporting.

If the fixed image cannot connect to the fixture, first record the exact transport/configuration error and verify the image digest again. One related configuration correction and one rerun are allowed under the repository debugging budget. Repeated identical retries, image upgrades, production network access, and custom-loop workarounds are outside this plan.

## Artifacts and Notes

The durable artifact for this phase is this ExecPlan. Gate output should be summarized here as short evidence, for example:

    fixed image: v0.21.0 / upstream f58fcc81
    MCP discovery: PASS or FAIL with exact error
    Responses function_call -> function_call_output -> final message: PASS or FAIL
    trusted card projection and case isolation: PASS or FAIL
    timeout/cancel: PASS or FAIL
    DGX model capability: SYNTHETIC READ-ONLY PROBE PASS; natural dialogue NOT ACCEPTED
    API/MCP implementation validation: PASS (focused backend tests 13/13, API build, UI checks)
    fixed-image production-equivalent integration: STARTUP PASS; natural response NOT ACCEPTED
    diagnostic: empty reply = test API_SERVER_KEY omitted; remaining blocker = disposable Docker-to-host SSH tunnel lifetime/reachability

No secrets, bearer tokens, production URLs, or raw customer records belong in this file.

## Interfaces and Dependencies

The later implementation must use the repository's existing authorization middleware and protected work-instruction asset route. It must keep the current card fields and add only an opaque case identifier and provenance fields needed for review. It must use the fixed Hermes API's supported Responses contract if the gate confirms it, and must not treat Hermes session IDs as principals. The first-phase MCP surface must consist of read-only operations over the nonconformity and published work-instruction domains, with existing read visibility/publication/active-asset rules and bounded output; it must not introduce a new row-level ACL model.
