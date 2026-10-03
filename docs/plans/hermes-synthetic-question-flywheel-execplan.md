# Hermes synthetic question flywheel for nonconformity retrieval

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows `.agent/PLANS.md` at the repository root.

## Purpose / Big Picture

Business Hermes Chat on the Pi 5 answers shop-floor questions from about 8,250 nonconformity records. Until 2026-10-03 its accuracy was judged on 73 to 86 hand-written questions, so most changes moved the score by two to five questions and could not be told apart from chance. Real kiosk questions are still rare, and the owner does not want shop-floor users to carry the cost of improving the system: the first experience has to be good.

After this plan, the Pi 5 builds its own test questions every night from the records it already holds, grades them with two independent models, and writes a short report that says how many questions failed and at which stage. A change to retrieval is then judged on hundreds of questions that resemble real ones, with a paired significance test, before it reaches the kiosk. When real kiosk questions arrive, they are mixed into the same set without anyone labelling them by hand.

To see it working: after the night window, `retrieval/flywheel-report.mjs` on the owner's Mac prints, for the newest night, the number of questions generated, kept, and answered, and the loss counts by stage, for example "generated 120, kept 84, relevant shown 61, nothing shown 9 (outside judged candidates 5, rejected by judge 3, asked back 1)".

## Progress

- [x] (2026-10-03) Research of established practice and owner decision to build the flywheel (see Context and Decision Log).
- [ ] Milestone 1: seeds and contrastive question generator, offline, with unit tests.
- [ ] Milestone 2: two-model filter and labels for generated questions, offline, checked against the hand-written development sets.
- [ ] Milestone 3: nightly runner on the Pi 5 behind a flag, with a per-night report.
- [ ] Milestone 4: acceptance gate for retrieval changes on the rolling set, with held-out rotation and real-question mixing.

## Surprises & Discoveries

- Observation: the production relevance judge (JEV) is lenient. Grading the same 419 question-record pairs with the DGX business LLM (Qwen3.8 Flash-Next) agreed within one grade on 94% (Cohen's kappa 0.78 on "relevant"), but of 1,715 pairs JEV called relevant, Qwen agreed on 58%. A blind reading of 118 disputed development pairs sided with Qwen in 67% of them.
  Evidence: `docs/plans/hermes-retrieval-accuracy-log.md`, entries of 2026-10-02 and 2026-10-03.
- Observation: questions that name only a department or a period ("三島工場機械課の最近の不適合を教えて") have no content condition, so relevance grading does not apply to them. They caused many grader disagreements and must be scored on filters instead.

## Decision Log

- Decision: build questions from the records themselves instead of asking people for test questions.
  Rationale: the owner rejected user-carried improvement. Established practice (Airbnb CASTLE 2026, JaCWIR, RAGAS, ARES) generates queries from the corpus for cold start.
  Date/Author: 2026-10-03, owner and Claude.
- Decision: generate from a contrastive pair. The generator sees the key facts of one record (A) and of a similar record (B) and must write a question that A answers and B does not.
  Rationale: CASTLE reports that contrastive grounding plus seeds brought synthetic queries about nine times closer to real ones in length distribution than InPars or Promptagator style generation, and the pair gives a label by construction. Similar records are common in this corpus.
  Date/Author: 2026-10-03, Claude.
- Decision: the generator never sees the full record text; it gets the field facts written as short phrases, and it must not reuse any run of four or more characters from A's body.
  Rationale: a question written while reading the answer copies its words and becomes too easy ("curse of knowledge", 2026). Lexical retrieval would look better than it is.
  Date/Author: 2026-10-03, Claude.
- Decision: seeds come from fields and intents, not from people. A seed is a combination of an intent (phenomenon, cause, countermeasure, disposition, similar case), a style (terse two to six words, colloquial, kana instead of kanji, with a typo), and a role (worker, inspector, designer, quality). Real kiosk questions, when present, become seeds too.
  Rationale: seed-guided generation narrows the gap between synthetic and real queries (7.5 to 9 times in the cited studies). Real users write short and urgent questions, so the style mix leans terse.
  Date/Author: 2026-10-03, Claude.
- Decision: the generator and the graders are different models. The DGX business LLM generates; JEV and the DGX business LLM grade, and a question is kept only when both agree A is grade 3 and B is grade 1 or lower.
  Rationale: a model grading its own output is lenient (CASTLE: 98 to 99% self-agreement against 91 to 93% from people). Two graders that both have to agree is the conservative label measured on 2026-10-02.
  Date/Author: 2026-10-03, Claude.
- Decision: everything runs on the Pi 5 inside the API container, in the existing night window, through existing routes only: the DGX business gateway through the consultation egress (as the enrichment runner did) and TypeSafe for JEV. No record leaves for any other service. The private side of the DGX and the Private Pi 5 are not touched.
  Rationale: the session that writes this plan cannot run code in production; only released code that the standard release delivers may run there. Record text may go to TypeSafe (approved) and to the in-house DGX.
  Date/Author: 2026-10-03, Claude.

## Outcomes & Retrospective

None yet.

## Context and Orientation

Retrieval for nonconformity questions lives in `scripts/hermes-search/retrieval/`. The worker `worker.mjs` runs inside the API container of the Pi 5 and answers kiosk questions in three steps. `planner-jev.mjs` turns a question into a plan (filters such as department, a content query, a limit) by asking JEV, a remote classification model reached through the TypeSafe API. `executor.mjs` ranks records with character-bigram BM25 and DGX embeddings fused by reciprocal rank fusion, takes the top 30 candidates (`RELEVANCE_POOL_DEFAULT`), and asks JEV in `relevance-jev.mjs` which of them describe the asked event. Accepted records are shown.

Evaluation tools added on 2026-10-02 are `graded-labels.mjs`, which pools candidates of evaluated runs and grades each question-record pair from 0 to 3 with JEV, and `graded-score.mjs`, which reports for a run how many questions showed a relevant record and, for questions that showed nothing, the stage that lost the answer. `evaluate.mjs` runs the pipeline over a gold file offline. Gold files, snapshots, labels, and run outputs are private and stay in `~/Documents/hermes-retrieval-private` on the owner's Mac; they are never committed.

The overnight enrichment runner `enrichment-runner.mjs` with `enrichment-dgx.mjs` is the model for a night job: the API process starts it when its flag is true, it calls the DGX business LLM at `HERMES_INFERENCE_ORIGIN` through `HERMES_INFERENCE_EGRESS` with `HERMES_INFERENCE_TOKEN`, only inside `HERMES_RETRIEVAL_ENRICHMENT_WINDOW` (22 to 6 Tokyo time), and writes JSON lines and a status file under `/app/storage/hermes-search/runtime/`. The dense store `retrieval-dense-dgx.bin` holds one embedding per record, which gives the nearest neighbours needed for contrastive pairs without new embedding work.

Terms used here: a "seed" is a small instruction that fixes the intent, style, and role of one generated question. A "contrastive pair" is two similar records where only one answers the question. A "grade" is 0 (unrelated) to 3 (the asked event is in the record). "Kept" means both graders agree on the pair labels. A "loss stage" is where a kept question failed in the live pipeline: planner asked back, no relevant record among the judged candidates, or the judge rejected the relevant record.

## Plan of Work

Milestone 1 builds the generator offline. Add `scripts/hermes-search/retrieval/flywheel-seeds.mjs` with a pure function that, given the catalog and a seeded random generator, returns seeds as `{ intent, style, role }`, with the style mix weighted 50% terse, 20% colloquial, 15% kana, 15% typo. Add `flywheel-pairs.mjs` that picks record A at random among records with non-empty body text and finds B as the nearest neighbour by cosine in the dense store among records that share A's department or part name, skipping exact duplicates. Add `flywheel-facts.mjs` that turns a record into short field facts (phenomenon, cause, countermeasure, disposition, part, department) without copying long spans. Add `flywheel-generate.mjs` that builds one chat request per pair and seed, asks for JSON `{ "question": string }`, and rejects a question that copies four or more consecutive characters from A's body, names a record number, or is longer than 60 characters. The DGX call reuses the request shape of `enrichment-dgx.mjs` (temperature 0.7 for diversity, thinking off, JSON schema). Unit tests in `flywheel.test.mjs` use a fake model and a synthetic corpus and check seed weights, pair selection, the copy guard, and determinism for a fixed random seed.

Milestone 2 adds the filter and labels. `flywheel-filter.mjs` grades A and B for each generated question with JEV (reusing `gradeBatch` from `graded-labels.mjs`) and with the DGX business LLM (the grading prompt used on 2026-10-02, moved into `grade-dgx.mjs`). It keeps a question only when both graders give A grade 3 and B grade 1 or lower. For kept questions it runs the live pipeline once, pools the top 30 candidates, and grades the pool with both graders, so every kept question carries consensus labels for later scoring. Offline acceptance compares a few hundred generated questions with the hand-written development sets: their length distribution (KL divergence against the real kiosk questions in the receipts), the share kept, and the loss-stage counts.

Milestone 3 runs it nightly. `flywheel-runner.mjs` is started by the API process like the enrichment runner when `HERMES_FLYWHEEL_ENABLED=true`, inside the existing night window, with a nightly budget `HERMES_FLYWHEEL_MAX_QUESTIONS` (default 100) and concurrency 1. It writes `runtime/flywheel/questions-YYYY-MM-DD.jsonl` (question, seed, A and B ids, consensus labels, live result ids, loss stage, no record text) and `flywheel-status.json`. The release path forwards the two variables the same way `standard-ansible-release.py` forwards the enrichment ones. `flywheel-report.mjs` reads a copied night file on the Mac and prints the summary shown in the Purpose section.

Milestone 4 turns the set into a gate. Questions are assigned to development or held-out by a hash of their id (70/30), so the implementing agent reads only development questions. A retrieval change is accepted only when, on the same night's held-out questions, the paired sign test over questions where the two configurations differ does not show a loss and the development set shows a gain. Real kiosk questions from the receipts join the set with the same two-grader labels; synthetic questions are down-weighted as real ones accumulate (CASTLE moved from 10:1 toward parity).

## Concrete Steps

Run tests from `scripts/hermes-search`:

    node --test retrieval/

Expected after Milestone 1: the previous count plus the new flywheel tests, all passing. Offline generation for Milestone 2 runs on the Pi 5 only after Milestone 3 is released; before that, the owner runs one prepared command in a terminal, as on 2026-10-02 for grading, because the implementing session may not execute code inside production containers.

## Validation and Acceptance

Milestone 1 is accepted when the unit tests pass and a fixed random seed yields the same seeds and pairs twice. Milestone 2 is accepted when, on 200 generated questions, at least half are kept, the length distribution of kept questions is closer to the real kiosk questions than the hand-written paraphrase sets are, and a blind reading of 30 kept development questions finds A relevant in at least 25. Milestone 3 is accepted when a released Pi 5 with the flag on writes a night file and a status file, the report prints the summary, kiosk answers during the day are unaffected (receipt latency unchanged), and no request goes to any host other than the DGX gateway and TypeSafe. Milestone 4 is accepted when a known-good change (the 2026-10-02 move from 15 to 30 candidates) passes the gate and a known-bad change (judge reading 5 candidates) fails it.

## Idempotence and Recovery

Generation and grading append to dated files and skip pairs already processed, so a stopped night continues the next night. Turning `HERMES_FLYWHEEL_ENABLED` off stops the runner without touching answers. Deleting the `runtime/flywheel/` directory only removes the test set. Nothing in this plan changes how questions are answered.

## Artifacts and Notes

Research summary that shaped the design (2026-10-03): CASTLE (Airbnb, arXiv 2605.21812) for seeds, contrastive pairs, separate generator and judge, daily generation and cold-to-warm mixing; "Beyond Benchmark Scores" (arXiv 2609.14579) for the synthetic and real distribution gap; "The Curse of Knowledge in LLM Query Simulation" (arXiv 2608.25245) for answer-word leakage; "LLM-based relevance assessment still can't replace human relevance assessment" (arXiv 2412.17156) for judge circularity and leniency; JaCWIR for Japanese LLM-generated retrieval questions.

## Interfaces and Dependencies

In `scripts/hermes-search/retrieval/flywheel-seeds.mjs`, define `export function sampleSeeds({ count, random })` returning `[{ intent, style, role }]`. In `flywheel-pairs.mjs`, define `export function samplePairs({ records, denseEntries, count, random })` returning `[{ a, b, similarity }]` with record ids. In `flywheel-generate.mjs`, define `export async function generateQuestion({ pair, seed, facts, chat })` returning `{ ok: true, question } | { ok: false, reason }`, where `chat` is an injected function with the same contract as the DGX request in `enrichment-dgx.mjs`. In `flywheel-filter.mjs`, define `export async function filterAndLabel({ items, gradeJev, gradeDgx, runPipeline })`. No new npm dependency is needed.
