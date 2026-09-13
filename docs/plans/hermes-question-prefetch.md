# Hermes question recipes and one-candidate prefetch


This living ExecPlan follows `.agent/PLANS.md`. Status: implementation in progress. Scope: dedicated business consultation on Pi5 with the existing Hermes/DGX API. User authorization includes production reflection and live Safari trials from the ongoing task; no model changes are included.

## Purpose / Big Picture


Show reusable questions immediately, and start preparing the most likely answer while the user reads them. A question recipe is a small, versioned prompt with the original question supplied as its subject and conditions. Prefetch means running one provisional, read-only answer before selection. If the user chooses that recipe without changing the consultation, adopt the prepared result; otherwise discard it and answer the actual choice. Completion speed and correctness must both be measured. The overall objective remains a useful answer within ten seconds; hiding time behind a long artificial selection delay is not proof of that objective.

## Progress


- [x] (2026-09-13) Read repository boundaries, inspected current consultation, Skill, session and cancellation contracts; lifecycle audit and start succeeded from origin/main `d619f32ffcd695aac812c3504196db21dc2e1946`.
- [x] Implemented initial recipe composition, isolated prefetch, adoption through existing evidence validation and background cancellation.
- [x] Focused API tests 51 passed (2.30s), UI tests 25 passed (3.92s); targeted lint passed. Final cancellation guard and SOUL consistency review completed.
- [ ] Commit, PR checks, merge and merged-main CI; integrationPending=true.
- [ ] Standard Pi5 rollout and final-version live trials, with timing and source checks.
- [ ] Lifecycle finish/audit and record actual outcome. Ten-second acceptance remains unproven.

## Surprises & Discoveries


The previous first-turn gate returned before runtime preparation and inference, so it could never hide inference behind user selection. Hermes native history is selected by both `conversation` and `X-Hermes-Session-Key`. Prefetching in the live session would pollute later questions after a different choice. Existing root maps coordinate cancellation and one foreground turn per consultation; the UI was cancelling only visibly busy requests.

Hermes `max_turns=2` can still perform final-summary requests; it is not a guarantee of two LLM calls. The last device trial was interrupted by model startup, so warm timing and cold startup must be reported separately.

Local API TypeScript compilation found unrelated stale generated Prisma/shared-package types in production-schedule modules. No Hermes errors were reported. Use clean hosted CI regeneration as the required type/build evidence; do not modify unrelated production scheduling code. Final review found that joining a prefetch and then falling back could otherwise double the foreground deadline. The entire selected operation now shares the existing configured timeout; a fake-clock regression proves both streams abort within that single budget.

Root-directory lint initially failed because the API ESLint project path is relative to the app; rerunning from each app directory passed.

## Decision Log


Use three finite templates (`record-answer`, `record-cause`, `published-procedure`) with the original question as data, rather than pre-registering individual business records. Version 1 belongs to this deployment. No entity guessing or new search engine is required.

Allow one unselected prefetch per API process. Start only on a new unscreened text consultation, not on scans or follow-ups. Use a new native conversation UUID, retain a completed result for at most thirty seconds, and bind reuse to the full consultation snapshot and exact displayed selection. A process restart loses provisional results and safely returns to normal inference. Never share answers across consultations.

Reuse the existing official Responses API, runtime lease controller, stream parser and evidence checks. Only a successfully validated selected result changes `hermesConversationId`. Failure, cancellation, expiry or mismatch must not persist a provisional assistant response. A failed prefetch permits one normal selected request; no response-format repair inference is introduced.

Record evaluated recipe/search improvements in the existing Skill through review and normal releases. This phase does not implement autonomous learning or a separate knowledge store. Changes to recipe meaning require a recipe version change; source schemas and tool contracts must be checked before adding genres. These decisions implement the user's clarified intent while keeping custom code at the app integration boundary.

## Outcomes & Retrospective


Implementation is in progress. No new-version production latency or correctness claim is available yet. PR1395 is the deployed baseline, not evidence for this change.

## Context and Orientation


`apps/api/src/services/assembly/business-hermes-consultation.service.ts` persists consultation messages and canonical case state. Its `chat` coordinates foreground requests, `performChat` handles choices and validates responses, and the extracted `infer` owns the existing runtime lease and Responses call. The prefetch map stores a provisional response promise, selection, snapshot and native conversation key. It does not write answer data to the business DB.

`apps/web/src/components/hermes/HermesFloatingChat.tsx` renders existing confirmation buttons and uses the authenticated cancel route when closing or leaving a consultation. `infrastructure/ansible/templates/business-hermes-chat/skills/business-consultation/SKILL.md.j2` describes recipe execution and reviewed improvement. SOUL already includes that template through Ansible. No additional packages, migrations, credentials or model settings are required.

## Plan of Work


Milestone one makes the behavior visible in controlled tests: question buttons return while inference is unresolved; choosing the first option joins that same inference exactly once; no answer is committed before selection. Implement versioned question composition and isolate the native speculative session. Verify mismatches, expiry, cancellation, failure fallback, session adoption and existing evidence rejection.

Milestone two integrates UI lifetime and Skill behavior. Closing the chat or changing consultation must cancel provisional work even while buttons are idle. The Skill must execute a provisional recipe without falsely asserting user confirmation and must preserve the original question's scope. Existing API/UI tests cover normal conversations as well as this new path.

Milestone three uses reviewed main artifacts and standard rollout to Pi5. In Safari, ask the known numbered query and a previously unused natural question, observe actual selection time, then final answer. Also choose a different candidate once. Verify source content, number of Responses/model/tool calls and whether the prefetch was adopted. Separate candidate latency, user selection delay, post-selection completion latency and total elapsed time. Stop tuning after this bounded trial and report measured acceptance honestly.

## Concrete Steps


Work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-question-prefetch`. Main repository is `/Users/tsudatakashi/RaspberryPiSystem_002`. Lifecycle was started using:

    python3 -m scripts.git_lifecycle.cli audit --json
    python3 -m scripts.git_lifecycle.cli start --branch feat/hermes-question-prefetch

Run the narrow checks first:

    pnpm --filter @raspi-system/api test src/services/assembly/business-hermes-consultation.service.test.ts
    pnpm --filter @raspi-system/web test src/components/hermes/HermesFloatingChat.test.tsx
    git diff --check

Local verification budget is 45 minutes because this includes deployment templates. Use hosted CI for broader checks rather than duplicating suites locally. Follow `.cursor/rules/20-git-workflow.mdc` and the PR template including its Deploy impact table. Verify exact-SHA CI before rollout; use the main repository's canonical vault file without printing its contents. Standard execution is:

    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan --limit raspberrypi5
    scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach --limit raspberrypi5
    scripts/update-all-clients.sh --status RUN_ID

Use the emitted run ID; do not guess it or edit deploy locks. After merge, `finish --worktree <exact-path> --pr <number>` and `audit --json` are required. Remove only the temporary dependency symlinks whose exact targets are the main repository before cleanup.

## Validation and Acceptance


Focused tests must prove immediate options despite unresolved runtime/inference, no preselection answer persistence, exactly one inference on matching selection, isolation on a different choice/free text, expiry, lease release after cancelled readiness, and rejection of untrusted record IDs. UI tests must prove closing an idle consultation requests cancellation. Broader CI protects existing API, web and deployment contracts.

A live success requires the same final deployed SHA, a correct answer checked against the original business record, and elapsed times from the actual Safari screen. Report ten seconds as unmet if it is unmet. One warm success does not prove all questions or cold-start availability. Prefetch should measurably reduce post-selection wait when it matches; the total question-to-answer time is reported separately.

## Idempotence and Recovery


All source edits are isolated in the feature worktree. Cancelling or expiring a provisional request aborts its stream and releases its lease through existing accounting, including late runtime readiness. Closing the page is best-effort cancellation; the configured inference timeout remains the server bound. No speculative answer survives restart. Revert the feature through a reviewed release if needed, rolling API, web and Skill back together through the standard deploy command. Do not modify DGX model profiles or production data for this task.

## Artifacts and Notes


Local audit evidence is in the current Codex workspace `work/hermes-prefetch-start-audit.json`. Further PR, exact SHA, CI, rollout run/recap/health and live measurements will be recorded here as they exist. Do not substitute earlier-version trials.

## Interfaces and Dependencies


Keep existing public confirmation (`prompt`, `options`) and selection (`prompt`, `option`) contracts. The new internal `questionRecipe` payload has `id`, `version`, `prompt`, and `speculative`; `confirmedIntent.confirmationComplete` remains false during provisional execution. `infer(input, conversationKey, signal)` returns the parsed official Responses result and owns timeout/lease cleanup. Existing trusted evidence validation remains the only path from that result to displayed records.

Revision note: initial plan records the clarified prefetch-and-reuse intent, implementation boundaries and pending production evidence.

Revision note: final review restored one foreground deadline across prefetch and fallback; the added regression and focused 51-test suite pass.
