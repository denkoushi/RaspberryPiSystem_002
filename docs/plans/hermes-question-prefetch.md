# Hermes question recipes and one-candidate prefetch


This living ExecPlan follows `.agent/PLANS.md`. Status: first-phase mechanism deployed and evaluated; product acceptance remains unmet. Scope: dedicated business consultation on Pi5 with the existing Hermes/DGX API. User authorization includes production reflection and live Safari trials from the ongoing task; no model changes are included.

## Purpose / Big Picture


Show reusable questions immediately, and start preparing the most likely answer while the user reads them. A question recipe is a small, versioned prompt with the original question supplied as its subject and conditions. Prefetch means running one provisional, read-only answer before selection. If the user chooses that recipe without changing the consultation, adopt the prepared result; otherwise discard it and answer the actual choice. Completion speed and correctness must both be measured. The overall objective remains a useful answer within ten seconds; hiding time behind a long artificial selection delay is not proof of that objective.

## Progress


- [x] (2026-09-13) Read repository boundaries, inspected current consultation, Skill, session and cancellation contracts; lifecycle audit and start succeeded from origin/main `d619f32ffcd695aac812c3504196db21dc2e1946`.
- [x] Implemented initial recipe composition, isolated prefetch, adoption through existing evidence validation and background cancellation.
- [x] Focused API tests 51 passed (2.30s), UI tests 25 passed (3.92s); targeted lint passed. Final cancellation guard and SOUL consistency review completed.
- [x] PR1396 merged as `ac0d4acca1340f8438bfa6d01a1d9515d7c25036`; main CI34733795726, CodeQL34733795715 and Secret scan34733795703 succeeded; integrationPending=false.
- [x] Standard Pi5 run `20260913-025506-c7024b` succeeded at 2026-09-13 12:06:57 JST. Final-version Safari trials and source comparisons completed, including an explicitly delayed-choice prepared-answer test.
- [x] Implementation worktree lifecycle finish/audit completed: cleanup=completed, main_sync=updated, remote branch absent.
- [ ] Product acceptance: correct natural-language answers within ten seconds is still unmet; one natural-language trial mixed unrelated cases.

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


The first-phase mechanism is deployed and works: matching unfinished inference is joined, a completed answer is adopted immediately, and a different choice uses an isolated confirmed session. This is not product acceptance. Two distinct numbered questions matched their source records; the natural-language question mixed different manufacturing operations and reversed part of the cause. The first numbered question was also repeated only to exercise adoption after preparation completed, not to improve a benchmark sample.

Initial buttons appeared in 0.67–0.75 seconds. Selected-request server times were 8.59 seconds for the first numbered question, 12.39 seconds for the natural question, and 47.24 seconds for a different recipe on an unused numbered question. Total initial-request-to-final-response server intervals were 20.73, 29.34 and 55.39 seconds, including actual selection delay. Matching trials overlapped selection wait with inference by 12.12 and 16.93 seconds. These are measured overlaps, not a controlled claim about baseline speedup.

In the deliberately delayed-choice functional test, preparation took 21.06 seconds. The tester waited 33.94 seconds after the candidate screen appeared; selecting the matching candidate then displayed the correct answer within 0.47 seconds. The full screen interval was 35.11 seconds. This proves prepared-answer adoption, not a ten-second answer from the original question.

The ordinary trials' screen completion observations were sparse: post-choice upper bounds were 11.98, 29.01 and 78.77 seconds. They are not exact screen latency measurements and must not be replaced by server times. Search/tool-result intervals remained below one second (approximately 0.04–0.65 seconds). The natural-language session repeated the same broad search twice and then mixed its six results; limiting iteration and adding recipes did not eliminate that error.

When a different recipe was selected, the app discarded its provisional result and did not adopt its session. The confirmed Hermes session nevertheless began approximately 24.8 seconds after the selected HTTP request arrived. Installed Hermes source already interrupts an SSE-disconnected agent using its standard hard-interrupt path; the observed delay has not been isolated between runtime readiness, admission and in-progress backend inference. Do not claim that the app abort guarantees immediate GPU cancellation.

The next acceptance work is to refine question recipes so that distinct operations are resolved before synthesis, verify faithful cause wording, and isolate the switch delay. Do not add more prompt restrictions or swap models without evidence that they address those observed failures. Reviewed Skill improvement remains an explicit versioned release process, not automatic learning.

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


Local audit evidence is in the current Codex workspace `work/hermes-prefetch-start-audit.json`. PR1396: https://github.com/denkoushi/RaspberryPiSystem_002/pull/1396. Final feature SHA was `a35be53048870b1b9e047b8a23ed4c3b8906921c`. PR CI34732959020 succeeded on attempt 2: the first attempt failed only in unrelated kiosk screenshot navigation waiting for networkidle; a single failed-only rerun passed. No tests were weakened. Main CI and deployed SHA are recorded above.

The standard rollout returned Result=success, ExecMainStatus=0, ActiveState=active, SubState=exited; recap ok=210 changed=27 unreachable=0 failed=0 skipped=35 rescued=0 ignored=0. API and web are the green slot with the exact merge-SHA tags and build configuration suffix `f6cfcc08e7cd7df2`; API and consultation Hermes were healthy. No rescue rollback ran. Rendered Skill0.3.0 and speculative SOUL instructions were verified in the running container.

The unchanged runtime reported `Mia-AiLab/Qwen3.8-Flash-Next-NVFP4`, served as `system-prod-primary`, with a 262144-token context and MTP3. No model configuration was changed for this feature. Native session counters and source comparisons are retained locally; business source text and actual answers are intentionally not copied into this repository. All figures above are from the deployed final version, not earlier trials.

## Interfaces and Dependencies


Keep existing public confirmation (`prompt`, `options`) and selection (`prompt`, `option`) contracts. The new internal `questionRecipe` payload has `id`, `version`, `prompt`, and `speculative`; `confirmedIntent.confirmationComplete` remains false during provisional execution. `infer(input, conversationKey, signal)` returns the parsed official Responses result and owns timeout/lease cleanup. Existing trusted evidence validation remains the only path from that result to displayed records.

Revision note: initial plan records the clarified prefetch-and-reuse intent, implementation boundaries and pending production evidence.

Revision note: final review restored one foreground deadline across prefetch and fallback; the added regression and focused 51-test suite pass.

Revision note: recorded merged-main CI, successful production rollout, four live scenarios, measured prefetch overlap and prepared-answer display, and the unresolved accuracy and switch-delay failures. Product acceptance remains open.
