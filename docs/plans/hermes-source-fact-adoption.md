# Hermes source-fact adoption

This living ExecPlan follows `.agent/PLANS.md`.

## Purpose / Big Picture

Allow nightly preparation to adopt bounded, source-exact record answers without a human correctness label. Start with explicit questions about a named nonconformity record or a named published work instruction. Preserve all source conditions by quoting the entire projected record or all ordered instruction steps. This is record retrieval, not automatic certification of engineering judgments or causal inference.

## Progress

- [x] (2026-09-14) Inspected the nightly producer, cache worker and activation boundary; created isolated task worktree from fetched main.
- [x] (2026-09-14) Implemented source-fact preparation, independent source reconstruction and protected contract checks.
- [x] (2026-09-14) Verified current/changed sources, unsupported conditions, regression, feedback bypass prevention and atomic activation with focused tests.
- [x] (2026-09-14) Recorded local validation.
- [ ] Integrate through PR and required CI; deploy to business Pi5 through the previously approved standard rollout; record production evidence separately.

## Surprises & Discoveries

The existing independent holdout demands human-reviewed real questions, which are not available. The user authorizes fact-grounded automated evaluation instead. Existing unstructured model candidates cannot safely pass merely by quoting a substring; automatic adoption must be restricted to exact whole-record retrieval with explicit scope. The cache currently routes by similarity and numeric identifiers, so new certified answers need a stricter query boundary.

## Decision Log

On 2026-09-14, choose a separate fact candidate catalogue alongside the existing staged model catalogue. The API captures complete MCP detail responses before model generation and builds bounded factual candidates. The Python worker independently reconstructs allowed scopes and exact answers from these responses, verifies their detail fingerprints, and creates positive and abstention contract questions. These are source-grounded synthetic contract checks, not independent real-user accuracy estimates. No evaluation prompt is sent to the model. The existing regression checks still prevent harm. No model, dependency, table schema, all-corpus throughput or DGX configuration changes are included.

Existing negative feedback may keep a disputed answer out of service as a conservative veto; it is not evidence that another answer is correct. Positive feedback is not an adoption oracle. General model-generated answers remain staged unless independently evaluated by the existing route.

## Context and Orientation

`apps/api/src/services/assembly/business-hermes-nightly.service.ts` reads detail records, prepares model candidates and starts the Python worker. `services/hermes-answer-cache/maintenance.py` evaluates caches and writes an activation manifest. `runtime.py` verifies immutable identities and atomically switches the active pointer. `server.py` serves question suggestions and source-backed answers. The new fact metadata must survive catalogue loading and must exclude certified records from unrestricted semantic matching. The API still rereads sources before delivering cached answers.

## Plan of Work

Add bounded TypeScript preparation for nonconformity whole records and published instruction whole steps; bind immutable detail packets and a separate factual catalogue to each job before model calls. Independently reconstruct exact supported facts and source-grounded checks in Python. Evaluate the factual catalogue against protected regression checks and unseen query forms plus unsupported-condition checks; require zero factual errors or missing positives and a real positive retrieval gain. Adopt only the tested factual catalogue when no independent holdout exists. Preserve source/hash/cancellation and previous-active rollback boundaries.

## Concrete Steps

Work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-source-fact-adoption`. Run the lifecycle audit/start already recorded. Run `pnpm --filter @raspi-system/api exec vitest run src/services/assembly/business-hermes-source-facts.test.ts src/services/assembly/business-hermes-nightly-preparation.test.ts src/services/assembly/business-hermes-nightly-candidates.test.ts src/services/assembly/business-hermes-nightly.service.test.ts`. From the root run `python3 -m unittest discover -s services/hermes-answer-cache -p 'test_*.py' -v` with cache requirements installed, and `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json`. Run ESLint on the four modified/new API files. The task used the existing external Python cache-test environment for dependencies. Keep local validation within the repository 20-minute validation budget; hosted CI is a later integration boundary.

## Validation and Acceptance

A job with no human holdout and a valid explicit-scope fact must progress through prepare, evaluate and atomic activation; the served answer must exactly retain units, numbers, identifiers and all conditions. Wrong product, wrong target, added conditions, unknown fields and causal questions must not receive a certified fact suggestion. Modified answer, evidence, detail fingerprint, or post-evaluation fact files must fail closed. A protected old answer may not regress. Model-only candidates still await independent evaluation. Repeated source snapshots must not claim an accuracy gain from catalogue growth alone.

## Idempotence and Recovery

Write job-local private files atomically. Existing active answers remain until all checks pass. Retain the previous-active pointer through the standard activation code. Never modify private production data or manufacture human-reviewed holdouts. The user previously authorized the nightly workflow production rollout; this completes that same workflow. Production deployment and its evidence remain separate from local implementation evidence. Use the standard Pi5-only print-plan/detach/status route after exact main SHA CI and artifact success; no other devices are in scope.

## Artifacts and Notes

The starting main SHA is `fb545dcd70552882ed9f365a344802bdc344cd24`. Audit output is stored outside the repository in the current chat work directory. No production data is committed.

## Interfaces and Dependencies

Keep the version 1 catalogue envelope; add validated optional `fact` metadata only to source-certified cases. Use the existing SHA256 detail fingerprint, private filesystem, GPTCache, FastEmbed and atomic activation. Include the Python fact module in the existing cache Dockerfile.

## Outcomes & Retrospective

Local implementation and validation are complete. The pipeline can activate a source-exact factual catalogue without `holdout.json` or human correctness labels. General model-generated answers remain staged. The source-grounded synthetic checks demonstrate bounded retrieval correctness, not measured real-user accuracy or broad reasoning improvement. Published instruction support requires one unambiguous published row, all ordered nonempty steps, explicit part/target and bounded complete text; records exceeding 4,000 answer characters or 100 canonical-question characters remain ineligible. Nightly throughput stays at four documents.

Validation: 15 API tests passed (source-facts, preparation, candidates and nightly service); the six preparation tests passed again after bounding source-reference fields. All existing 20 Python tests and 11 new factual tests passed across the focused runs; the final factual run passed 11 tests, including actual GPTCache construction with controlled embeddings and real serving dispatch. This does not benchmark the deployed model. Targeted ESLint and `tsc --noEmit -p tsconfig.build.json` passed. An initial invocation against development tsconfig failed because its include paths exceed rootDir; using the existing build configuration resolved the invocation without repository configuration changes. The initial Python integration path assertions were corrected to resolve macOS temporary-directory aliases. Local validation and failed-command investigation remained within the 20-minute budget.

No credentials or production datasets were copied. Dependencies were installed into the task worktree with offline/frozen-lockfile/ignore-scripts; Prisma and workspace type outputs were generated locally without lockfile changes. Full-corpus preparation, cross-table reasoning, broad natural-language inference are outside the completed local milestone. The approved production rollout remains in progress.

Revision 2026-09-14: define the first automatic-adoption boundary around whole-record facts so model agreement cannot become the correctness oracle.

Revision 2026-09-14: completed local implementation and recorded source-exact adoption, actual serving checks, limits and separate deployment status.
