# Hermes measured Skill improvement


This living ExecPlan follows `.agent/PLANS.md`. Status: integration and live evaluation in progress. On 2026-09-13 the user approved deployment of telemetry, ten baseline questions, a standard Hermes Skill revision, and matched baseline/candidate evaluation. A candidate may reach production only if that comparison passes.

## Purpose / Big Picture


Turn business consultation experience into measurable, reviewable improvements. Operators can export automatically recorded turns, label correctness against source records, ask standard Hermes Skills to propose a revision in an isolated profile, and compare baseline and candidate observations before releasing that revision. Chat users incur no additional LLM calls. This implementation does not claim that a Skill revision already meets the ten-second product goal.

## Progress


- [x] (2026-09-13) Read repository rules and inspect consultation persistence and official Hermes Skills/review documentation; start dedicated worktree from origin/main 36b40ac6.
- [x] Persist per-turn timing, recipe, native session and outcome alongside existing history; export with existing Prisma access.
- [x] Implement local SQLite observations, source-grounded grading, linked report, isolated standard Hermes review, and comparison gate.
- [x] (2026-09-13) Validate failure, regression, held-out isolation, staging and successful candidate paths: 56 focused API/export tests, 17 offline tests, targeted ESLint and API TypeScript checks passed. Native staging contract passed in a temporary profile on the installed Hermes image.

- [x] (2026-09-13) Commit/push telemetry and evaluation implementation; create PR #1398. Freeze ten private source-grounded cases.
- [ ] Complete CI/main integration and standard Pi5 telemetry rollout.
- [ ] (2026-09-13) User approved the blocking Pi4 image OS-package repair. Update only affected runtime packages using existing Dockerfile patterns, then validate the six selected image contracts.
- [ ] Freeze ten source-grounded questions (five training, five held-out) and measure the deployed baseline.
- [ ] Execute native Hermes Skill review, test the resulting candidate under matching conditions, and grade against frozen records.
- [ ] Publish the comparison; release the candidate only if eligible; finish/audit all task branches.

## Surprises & Discoveries

PR #1398 CI run 34740354752 failed all six Pi4 image scans. The inspected NFC arm64 image reported 40 fixed-version OS findings; barcode and torque share gzip, PCRE2, SQLite and Perl-base findings. NFC additionally includes GLib and the full Perl packages. The user authorized this specific repair after the unrelated failure was reported. Main CI had skipped this matrix, so its success did not establish a passing baseline for these scans. No scanner exception is added.


Current consultation profile disables memory, background review, session search and Curator. The consultation Skill is compiled into SOUL, so modifying an unrelated on-disk Skill does not update the production prompt. Official Curator maintenance tracks usage and prunes/consolidates Skills; it does not establish business-answer correctness or latency improvements.

## Decision Log


Use the existing message JSON diagnostics to avoid a database migration. Keep learning telemetry private to export and out of model inputs/public conversation diagnostics. One final measurement write per persisted user request records failures as well as successes; write failure must not turn a valid answer into an unavailable response. Timing ends before telemetry persistence and is explicitly server timing, not screen timing.

Use an explicitly invoked offline Python command with SQLite (standard library), not a daemon or graph database. Observations link question/purpose, recipe, evidence snapshot, answer and review. Correctness requires a source reference and reviewer explanation. Unreviewed answers never become successes. Training and held-out cases are separated; the review prompt excludes held-out content. Native Hermes skill_manage stages revisions in a separate profile. Existing application authentication and runtime/model configuration remain unchanged. No unattended reviews compete with active production answers.

## Context and Orientation


`apps/api/src/services/assembly/business-hermes-consultation.service.ts` handles first-question choices and one speculative answer. Messages already contain `searchDiagnostics` JSON. `apps/api/src/scripts/export-business-hermes-learning.ts` exports private observations using existing database credentials. `scripts/hermes-learning/learning.py` consumes the export into SQLite and prepares a native Hermes Skills review. No business examples belong in Git. The deployed Skill template is `infrastructure/ansible/templates/business-hermes-chat/skills/business-consultation/SKILL.md.j2` and must still be released through the normal repository path.

## Plan of Work


First add telemetry around the existing request and inference lifecycle, including failed requests and speculative runs without changing inference instructions. Then implement bounded read-only export. Implement import, grading, reporting, review preparation/execution, and comparison using hashes for observations, source snapshots and Skill revisions. Finally exercise a synthetic full workflow and focused service tests. Production remains unchanged during local implementation.

## Concrete Steps


From the repository root run `python3 -m unittest discover -s scripts/hermes-learning -p 'test_*.py'`. From `apps/api` run `pnpm exec vitest run src/services/assembly/business-hermes-consultation.service.test.ts` and targeted ESLint. The CLI help and the operational instructions below describe the actual file contracts and commands after implementation.

## Validation and Acceptance


A completed turn records its recipe, elapsed time, inference timings and evidence link. Failure and cancellation remain counted; a telemetry database failure leaves the response intact. Reimport is idempotent. An unreviewed pending observation can complete once; changed completed/reviewed observations are rejected. Unknown correctness is visible and blocks promotion. Faster but newly wrong answers, missing held-out cases, changed sources and mismatched revisions are rejected. A complete source-reviewed paired run with no correctness regression and improved latency can export the exact tested Skill. The review input never includes held-out examples. Synthetic tests prove the mechanism, not real answer quality.

## Idempotence and Recovery


Read-only export does not modify business data. SQLite imports use transactions. Each review uses a new output directory and staged native Skill writes; no live profile files are edited. Promotion exports a file for the existing release process and checks its content hash. Delete no production state. Preserve this worktree for review at the locally implemented stage.

## Artifacts and Notes


Validation results and runnable operator commands will be recorded here. All real questions, evidence and answers remain outside Git in private output directories.

## Interfaces and Dependencies


Use existing TypeScript, Prisma, Vitest and ESLint for the API. Offline observation/report/comparison commands require only Python's standard library; native review additionally uses PyYAML from the Hermes environment and the installed `hermes` CLI. Review runtime model/provider credentials are supplied from the existing configuration and environment; do not print them or add a cloud fallback.

## Outcomes & Retrospective


Local implementation and focused validation are complete on `feat/hermes-learning-evaluation`, based on `36b40ac6b6536fa67710f6014f6bbcb900be2aa3`. The initial local-only phase ended before commit/push. The subsequently approved rollout phase committed the implementation as 12fc85f9 and opened PR #1398. Production rollout and real candidate evaluation remain pending CI completion. Existing WIP in other worktrees remains untouched.

Final tests: consultation service 54 and export 2 passed (2.22 seconds total Vitest process), offline evaluation 17 passed (0.285 seconds); targeted ESLint and API `tsc --noEmit` passed. Initial offline tests exposed a six-column SQL insert with seven placeholders, corrected before passing. Initial TypeScript checking needed the workspace part-search/shelf-layout packages built; after generating Prisma and building workspace dependencies it passed without unrelated source edits. Native `skill_manage(patch)` returned staged=true, wrote one pending record and preserved the original synthetic Skill inside a temporary directory that was removed afterward. This native contract check made no LLM request.

Four historical live observations were imported privately with explicit historical timing provenance: three source-grounded correct answers and one wrong case-mixing answer. This includes one intentionally delayed repeated-question functional check, not four independent benchmark questions. The private report linked 28 nodes and 29 edges, and a training-only native review bundle was prepared. LLM generation of that draft was not executed in this phase. Historical timings cannot pass the new comparison gate; their role is diagnostic context and training evidence.

No new Skill quality or production speed improvement has yet been demonstrated. The mechanism records experience and can propose/evaluate updates when explicitly run; it is not an enabled nightly job or automatic production self-modification. The new telemetry starts only after a separately authorized normal release of this code. Full CI/deploy/E2E and candidate-versus-baseline live quality trials have not been performed for this uncommitted change.

## Operator Workflow


Keep the following files private and outside Git. The Python tool does not connect to production automatically. Export runs with the existing API database environment and writes a new file with owner-only permissions. From `apps/api`, for example:

    pnpm exec tsx src/scripts/export-business-hermes-learning.ts --since=2026-09-13T00:00:00Z --until=2026-09-14T00:00:00Z --out=/private/learning/day-1.jsonl

In a built API environment the equivalent entry is `node dist/scripts/export-business-hermes-learning.js` with the same flags. The destination directory must already exist. Reads are paginated in batches of 100 messages and answer IDs are restricted to the same consultation. Legacy messages without telemetry are omitted; pending and failed requests remain visible. Telemetry is filtered from public history and never sent to the answering LLM.

From the repository root import those observations. `--skill` must be the exact rendered Skill used during that run. `--runtime` is an operator-attested identity of the unchanged app, Hermes image, model and shared runtime configuration, excluding the Skill content being tested. This tool cannot remotely attest that identity; preserve the original deployment/profile evidence alongside the export. The Skill hash is computed from bytes and later edits cannot inherit the earlier result.

    python3 scripts/hermes-learning/learning.py --db /private/learning/results.sqlite import --input /private/learning/day-1.jsonl --skill /private/learning/baseline.SKILL.md --runtime SAME_APP_HERMES_MODEL_CONFIG
    python3 scripts/hermes-learning/learning.py --db /private/learning/results.sqlite report > /private/learning/report.json

The report contains per-revision/recipe/phase counts, reviewed accuracy and review coverage, p50/p95 server timings, prefetch counts and a JSON graph linking questions, recipes, observations and source IDs. P50 and p95 are nearest-rank percentiles; small samples are not population estimates. Missing measurements remain unknown. Prefetch start/adoption counts describe the selected export window, not a guaranteed hit rate across window boundaries. The main elapsed time stops after response assembly and before the final telemetry DB write. `questionToAnswerMs` also includes the user's selection delay. Neither is screen latency. Inference measurements include runtime readiness and the Responses request; they are not isolated GPU-generation measurements. Search diagnostics count observed search-result records, not all LLM calls or detail tools.

Read each answer against its original record. Assign at least five distinct training cases and five distinct held-out cases for the default gate. Held-out means examples withheld from the Skill-improvement prompt. Assign the split before reviewing candidates and keep it fixed; do not reuse a paraphrase of a training example as independent held-out evidence. `--source-revision` identifies the frozen source-data snapshot. A record ID alone does not identify its revision. Require a factual reason, including a correction for failed answers:

    python3 scripts/hermes-learning/learning.py --db /private/learning/results.sqlite grade --id USER_MESSAGE_ID --split train --verdict fail --reviewer SOURCE_REVIEWER --source-revision CORPUS_SNAPSHOT_HASH --source-ref RECORD_AND_VERSION --reason '原文の対象工程と回答の工程が異なる。正しい工程と条件を確認する。'

Use `--split holdout` for withheld examples and `--verdict pass` only for a complete correct answer. An unreviewed answer remains unknown; failed, missing and clarification-only answers cannot be graded as passing. Repeated observations of the same question/purpose share the split. Follow-ups without a recipe are scoped to their original consultation, so they cannot accidentally be paired across unrelated cases. Context fingerprints further reject comparisons with changed prior facts or available evidence.

Prepare an improvement bundle using only reviewed training examples from that baseline Skill. The latest 20 training observations are included, with a 100,000-character input cap. Larger source material requires a narrower collection. The command marks those cases as exposed and never includes held-out examples:

    python3 scripts/hermes-learning/learning.py --db /private/learning/results.sqlite review --skill /private/learning/baseline.SKILL.md --out /private/learning/review-1

To actually ask Hermes for a revision, add `--execute --runtime-config /opt/data/config.yaml` to that same command on its FIRST invocation and use a fresh output directory. Execute in the existing Hermes runtime environment during a quiet period, where the configured local model endpoint and required token environment variables are already usable. The CLI uses `hermes chat --query-file ... --toolsets skills --max-turns 6`, non-TTY stdio and a ten-minute process timeout. It uses a separate `HERMES_HOME` under the bundle, copies only model/custom-provider routing into its owner-only config, and enables standard `skills.write_approval`. It does not start a scheduler, change the live profile, acquire a new production deployment, or provision another model. No MCP business credentials/tool configuration are copied to the reviewer. PyYAML and the `hermes` executable come from the native Hermes environment.

A successful review execution must produce native `pending/skills/*.json` entries targeting only patch/edit of `business-consultation/SKILL.md`, while the copied baseline remains unchanged. A zero-exit review with no staged change is not called an improvement. Inspect the private `review.log` for unsuccessful runs. Failed execution leaves the isolated bundle for inspection; rerun with a fresh output directory. Native staging was verified on the installed Hermes image with synthetic text in a temporary profile, without an LLM request or live Skill change.

Use standard Hermes to inspect and apply the candidate ONLY inside that isolated review profile:

    HERMES_HOME=/private/learning/review-1/profile hermes

Inside Hermes run `/skills pending`, `/skills diff ID`, then `/skills approve ID` for the chosen revision. This creates a candidate for testing, not a production update. The candidate file is `/private/learning/review-1/profile/skills/business-consultation/SKILL.md`. Preserve the baseline separately.

Obtain candidate observations through the same isolated business-consultation test environment used for baseline observations, with the same frozen records, question inputs, selection delay and repeat count. The reviewer profile has no business MCP and is NOT the answer-testing profile. The business SOUL template includes the Skill at rendering time: merely approving the Skill in the reviewer profile cannot change the tested or live prompt. Use the existing Ansible template rendering/test environment to embed the candidate in SOUL; retain its resulting profile evidence. This command set deliberately does not deploy profiles or drive Safari; it imports the resulting measured turns and performs the comparison. Import them using `--skill` pointing at the exact candidate and the same shared `--runtime` identity. Grade both training and held-out answers against the same source snapshot.

    python3 scripts/hermes-learning/learning.py --db /private/learning/results.sqlite compare --baseline-skill /private/learning/baseline.SKILL.md --candidate-skill /private/learning/candidate.SKILL.md

Exit 2 means the candidate is ineligible; the JSON gives reasons. The gate requires matching cases and repeat counts, at least five distinct cases in each split, known compatible timing boundaries, matching context/runtime/source revisions, no candidate errors and no loss of previous correctness. Both server response and question-to-answer p50 must improve without p95 regression, and inference p50/p95 may not regress. Intentional extra choice waiting cannot establish an improvement. `--minimum 1` exists for exercising the mechanism with synthetic fixtures and is not adequate production evidence.

Once eligible, adding `--out /private/learning/eligible.SKILL.md` writes the exact tested bytes to a NEW file. It never overwrites production. Reflect the reviewed change in `infrastructure/ansible/templates/business-hermes-chat/skills/business-consultation/SKILL.md.j2`, update recipe version if its meaning changes, and use the repository's existing review/release process for any separately authorized production reflection. Re-run evaluation when Skill bytes, input context, source revision, model or runtime changes. Curator remains disabled in the answering profile; its catalog maintenance is not an answer-quality grader.

## Milestones


The first milestone persists and exports ordinary successful, failed, pending and cancelled consultation observations without extra model calls. Service and export tests establish the behavior and preserve the public response shape.

The second milestone turns observations into a private SQLite record, source-reviewed labels, a linked JSON report and a native Hermes Skill-review bundle. The installed native staging contract is verified independently from LLM answer quality.

The third milestone compares measured baseline/candidate cases and writes only an eligible exact Skill artifact. Synthetic complete/failing workflows establish the gate. New production answer quality and latency remain outcomes to measure after deployment and collection, not claims of this implementation.

Revision note (2026-09-13): added executable telemetry/export/evaluation/standard-review integration. Historical trial data is separately marked and cannot be mixed with the new timing boundary for promotion. No production profile or model was changed.
