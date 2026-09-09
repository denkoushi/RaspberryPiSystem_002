# Separate Hermes response parsing from evidence projection

This living ExecPlan follows `.agent/PLANS.md`. It records the approved implementation in the dedicated worktree and remains open for supervisor review and repository integration.

## Purpose / Big Picture

Hermes consultation responses currently make one service responsible for upstream Responses parsing, trusted evidence normalization, database history, and application display data. After this change, a reader can follow the upstream response boundary in `business-hermes-responses.ts` and the evidence/display boundary in `business-hermes-evidence.ts`, while the consultation service continues to own HTTP, case state, persistence, and failure behavior. A user can still request a consultation, inspect returned records with the existing summary/detail control, and receive the same public response and history contract.

## Progress

- [x] (2026-09-09 10:05 JST) Created branch `feat/hermes-consultation-boundaries` with the lifecycle CLI at `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-consultation-boundaries`, anchored to `83684c8a870dd130954598da3af23fb22797bbb0`; the original dirty worktree was not modified.
- [x] (2026-09-09 10:22 JST) Adopted only the consultation service/MCP changes, optional Web DTO and summary/detail UI changes, and official Hermes profile templates from the approved WIP. Runtime patches, comparison scripts, and unrelated documentation were excluded.
- [x] (2026-09-09 10:23 JST) Moved Responses receive/parse/normalize functions to `apps/api/src/services/assembly/business-hermes-responses.ts` and evidence key validation, merging, and display projection to `apps/api/src/services/assembly/business-hermes-evidence.ts`.
- [x] (2026-09-09 10:24 JST) Reduced `SOUL.md.j2`, `CONTEXT.md.j2`, and `SKILL.md.j2` to their distinct responsibilities. JSON response keys, evidence display rules, record view rules, and confirmation shape remain in the API instruction contract only.
- [x] (2026-09-09 10:19 JST) Completed local API/Web tests, builds, targeted lint, and diff checks; exact commands and results are recorded in the Validation section below.
- [x] (2026-09-09 10:26 JST) Applied supervisor feedback: kept the source-ID meaning contrast and scan correction rule in their owning profiles, reduced MCP descriptions to I/O semantics, expanded the API-only display/state contract, and reran the focused API suite with 34 passing tests.
- [ ] Supervisor review remains pending, followed by the approved existing-runner real LLM comparison, CI/PR/main integration, and standard Pi5-only deployment and device confirmation.

## Surprises & Discoveries

- The existing evidence projection test imported `projectTrustedEvidence` from the consultation service even though no production consumer did. The test now imports the function from the evidence module, avoiding a compatibility re-export while preserving behavior.
- `MAX_EVIDENCE` was used by both ID validation and evidence projection. It is defined once in the evidence module; the Responses parser imports the evidence boundary's constant and the service imports the same value.
- The linked worktree did not have dependency links. Validation temporarily linked the already-installed local dependency trees from the original worktree, removed those links afterward, and did not write to the original worktree.

## Decision Log

- Decision: Keep the consultation service as the orchestration and persistence boundary. Rationale: the approved change separates pure upstream parsing and trusted evidence projection without changing HTTP, database ordering, history limit 40, evidence limit 24, or failure codes. Date/Author: 2026-09-09 / implementation agent.
- Decision: Make the API's `CANONICAL_STATE_INSTRUCTIONS` the only place that describes JSON keys, case-state preservation, evidence/record selection, and confirmation shape. Rationale: SOUL expresses interaction posture, Context describes domain sources and fields, and Skill describes search procedure; the same contract had been repeated across those profiles. Date/Author: 2026-09-09 / implementation agent.
- Decision: Keep `displayFields`, `recordIds`, and `recordView` optional in the existing Web DTOs. Rationale: existing local card rendering needs them and optional additions preserve consumers and wire names. Date/Author: 2026-09-09 / implementation agent.
- Decision: Disable Hermes `auxiliary.background_review` and `auxiliary.title_generation`, and set provider `enable_thinking` false in the business profile. Rationale: the main API owns the saved answer/title and the approved latency work removes redundant auxiliary model calls while retaining the configured model. Date/Author: 2026-09-09 / implementation agent.
- Decision: Use the accepted policy in `docs/decisions/ADR-20260907-hermes-business-butler-design-policy-v1.md` as the design reference without copying it into this plan. Rationale: the ADR is the repository's durable source for SOUL/Context/Memory/Skill/Tools responsibility boundaries. Date/Author: 2026-09-09 / implementation agent.

## Outcomes & Retrospective

The implementation now has one-way dependencies from the consultation service to the two focused modules, with the response parser using the evidence module only for evidence ID rules. The API and Web behavior covered by the existing focused tests remains green, and the official profile no longer repeats the API display protocol. Real LLM behavior, CI, deployment, and merged-main verification remain open work for the supervisor.

## Context and Orientation

`apps/api/src/services/assembly/business-hermes-consultation.service.ts` accepts a consultation message, loads the case, calls Hermes Responses, validates the response, persists the user and assistant messages, and returns the public consultation DTO. `business-hermes-responses.ts` owns stream/envelope parsing, model message extraction, canonical state extraction, and trusted tool-response parsing. `business-hermes-evidence.ts` owns evidence ID validation, deduplication, trusted record projection, and optional display fields. The service remains the only module that performs the upstream request and database writes.

`apps/web/src/api/domains/assembly.ts` keeps the optional wire fields, while `HermesChatPanel.tsx` renders the existing evidence cards and the adopted local summary/detail record control. `HermesFloatingChat.tsx` carries those fields between the API response and the panel. The business Hermes configuration template supplies the official profile, disables redundant auxiliary work, and leaves the fixed model selection unchanged.

## Plan of Work

The service's pure response functions are moved without changing their bodies or their call order. The service imports the focused functions and retains case loading, runtime leasing, HTTP request construction, asset revalidation, persistence order, and failure mapping. Evidence projection keeps the existing `kind:id` identifiers, active asset checks, field limits, and 24-item bound. The API instruction is shortened to the JSON and case-state protocol; the three official profile files carry only posture, domain meaning, and search procedure respectively.

This implementation stage adds no database migration, route change, generic classifier, new infrastructure, model change, or runtime patch, and it does not alter a running production configuration. The old production DTO's absence of the optional display fields is a later review/deployment concern; this branch preserves the existing field names and makes additions optional. After supervisor review, the approved comparison, CI/PR/main integration, and standard Pi5-only deployment stages can use the existing repository procedures.

## Concrete Steps

Run from `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-consultation-boundaries`:

    python3 -m scripts.git_lifecycle.cli start --branch feat/hermes-consultation-boundaries

Review the changed service and the two new modules. Confirm that `MAX_HISTORY` remains 40, `MAX_EVIDENCE` remains 24, the assistant message is saved before the consultation update, and all existing failure codes remain in the service. Review the official templates for the absence of JSON display keys and confirmation examples outside the API instruction.

Run the focused checks listed in the Validation section below. This implementation stage ends with local validation and supervisor review; the next approved stage uses the existing runner for real LLM comparison, followed by CI/PR/main integration and standard Pi5-only deployment review. Leave the worktree uncommitted until that review selects the integration lifecycle.

## Validation and Acceptance

Acceptance for this worktree is a successful API consultation test run with 34 passing tests, including stream parsing, case-state preservation, evidence trust, ID rejection, record projection, cancellation, and runtime release; a successful Hermes panel test run with 12 passing tests; successful API and Web builds; successful targeted lint; and a clean `git diff --check`. The exact commands and results are recorded in this plan so no additional validation artifact is required.

The successful local commands were:

    pnpm --filter @raspi-system/api test -- src/services/assembly/business-hermes-consultation.service.test.ts
    Result: PASS — 1 file, 34 tests.
    pnpm --filter @raspi-system/web test -- src/components/hermes/HermesChatPanel.test.tsx
    Result: PASS — 1 file, 12 tests.
    pnpm --filter @raspi-system/api build
    Result: PASS.
    pnpm --filter @raspi-system/web build
    Result: PASS — 2146 modules transformed.
    ./node_modules/.bin/eslint src/services/assembly/business-hermes-consultation.service.ts src/services/assembly/business-hermes-responses.ts src/services/assembly/business-hermes-evidence.ts src/services/assembly/business-hermes-consultation.service.test.ts src/services/assembly/business-hermes-mcp.service.ts
    Result: PASS — run from `apps/api`.
    ./node_modules/.bin/eslint src/api/domains/assembly.ts src/components/hermes/HermesChatPanel.tsx src/components/hermes/HermesChatPanel.test.tsx src/components/hermes/HermesFloatingChat.tsx
    Result: PASS — run from `apps/web`.
    git diff --check
    Result: PASS.

The implementation stage is locally validated. Real LLM comparison, CI/PR/main integration, and standard Pi5-only deployment and device confirmation are subsequent approved stages and remain pending; this branch has no commit or push yet.

## Idempotence and Recovery

All edits are confined to the dedicated linked worktree. Re-running focused tests and builds is safe. The original worktree at `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-latency-measurement` must remain untouched. If review rejects a template or module change, revert only the corresponding uncommitted file in this worktree; do not reset or clean the original dirty worktree. No database or running process is changed by this plan.

## Artifacts and Notes

The reviewable artifacts are the two new API modules, the edited consultation service and focused tests, the optional Web DTO/UI changes, the four business Hermes profile templates, and this plan. Unadopted files under `scripts/business-hermes-openai-compare/` and `scripts/business-hermes-runtime-patches/` were intentionally not copied.

## Interfaces and Dependencies

The service imports `asConfirmation`, `asStrings`, `cleanMessage`, `evidenceObjects`, `modelState`, `readResponsesStream`, `responseMessage`, `responseStatus`, `searchDiagnostics`, and `MAX_SUMMARY_CHARS` from `business-hermes-responses.ts`. It imports `asEvidenceIds`, `MAX_EVIDENCE`, `evidenceKey`, `mergeEvidence`, `projectTrustedEvidence`, and `rawEvidenceKey` from `business-hermes-evidence.ts`. The evidence module exports `ConsultationEvidence` and the existing trusted projection shape; the Responses module exports `BusinessHermesConsultationConfirmation`. No module imports the consultation service.

The public API types in the consultation service remain available to routes, and the Web DTO fields `displayFields`, `recordIds`, and `recordView` are optional additions. Database schema, route paths, response status values, error reason codes, history ordering, and persistence semantics remain unchanged.

Revision note (2026-09-09): after supervisor review, removed duplicated record/display/confirmation rules from SOUL, Context, and Skill; retained domain field/source meaning in Context and search/reuse/stop procedure in Skill; added this living plan and kept validation evidence in the plan rather than adding a separate log artifact.
