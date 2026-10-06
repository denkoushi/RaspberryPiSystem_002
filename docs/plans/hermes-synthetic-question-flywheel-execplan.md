# Hermes synthetic question flywheel for nonconformity retrieval

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows `.agent/PLANS.md` at the repository root.

## Purpose / Big Picture

Business Hermes Chat on the Pi 5 answers shop-floor questions from about 8,250 nonconformity records. Until 2026-10-03 its accuracy was judged on 73 to 86 hand-written questions, so most changes moved the score by two to five questions and could not be told apart from chance. Real kiosk questions are still rare, and the owner does not want shop-floor users to carry the cost of improving the system: the first experience has to be good.

After this plan, the Pi 5 builds its own test questions every night from the records it already holds, grades them with two independent models, and writes a short report that says how many questions failed and at which stage. A change to retrieval is then judged on hundreds of questions that resemble real ones, with a paired significance test, before it reaches the kiosk. When real kiosk questions arrive, they are mixed into the same set without anyone labelling them by hand.

To see it working: after the night window, `retrieval/flywheel-report.mjs` on the owner's Mac prints, for the newest night, the number of questions generated, kept, and answered, and the loss counts by stage, for example "generated 120, kept 84, relevant shown 61, nothing shown 9 (outside judged candidates 5, rejected by judge 3, asked back 1)".

## Progress

- [x] (2026-10-03) Research of established practice and owner decision to build the flywheel (see Context and Decision Log).
- [x] (2026-10-03) Milestone 1: seeds and contrastive question generator, offline, with unit tests (#1662, merged as f4854ed7 and released to the Pi 5 with no behaviour change).
- [x] (2026-10-03) Milestone 2 trial: 69 pairs generated and graded on the Pi 5 through the existing routes, run by the owner (see Surprises).
- [x] (2026-10-03) Milestone 2 code: per-token copy guard, keep rule on the anchor only, graders, and a busy guard for the business LLM (#1664).
- [ ] Milestone 2 remainder: pooled top-30 labels for kept questions; moved into the Milestone 3 runner, which has the live pipeline in the same process.
- [x] (2026-10-03) Milestone 3 code: `flywheel-runner.mjs` started by the API after each corpus refresh when `HERMES_FLYWHEEL_ENABLED=true`, inside the enrichment night window, with a nightly budget and the busy guard; it writes the night file and `flywheel-status.json`. The release path forwards `HERMES_FLYWHEEL_ENABLED` and `HERMES_FLYWHEEL_MAX_QUESTIONS` without defaulting them (this change). The flag stays off until a release sets it.
- [x] (2026-10-04) Milestone 3, first night on the Pi 5: 100 pairs tried between 22:05 and 22:28, 80 valid questions, 78 kept, 20 dropped as copies of the record text, 2 ungraded or unconfirmed; median 17 characters. The business LLM was slow for the first minutes (one `dgx_busy` stop per question), then fast.
- [x] (2026-10-04) Milestone 3 remainder, part 1: each kept question is answered by the kiosk's own pipeline in the runner (`flywheel-live.mjs`), and the line records the shown ids, the judged candidate ids, and the loss stage; `flywheel-report.mjs` prints the night summary (this change).
- [x] (2026-10-05) Second night (2026-10-04, after #1677): 100 pairs, 76 valid, 64 kept, median anchor overlap 0.36 (from 0.44); 12 dropped because the graders did not confirm the anchor, 4 as too_similar after the retry. Live scoring showed the anchor for 34 of 64, but 48 of 64 live runs fell back to lexical (`vectorStatus` timeout) because the query embedding competed with the business LLM on the DGX while generation ran. The runner now generates and grades first and scores kept rows afterwards, and later starts of the same night fill in rows that still lack `live` (this change).
- [x] (2026-10-05) Milestone 3 remainder, part 2, offline: `flywheel-shown-labels.mjs` grades the shown records outside a question's known relevant set with JEV and keeps `{anchor: {record: {g, p}}}` in the private folder; the gate reads them with `--labels`. On the two nights' runs, 414 of 495 such records got grade 3, so most `other_shown` answers were relevant (this change). Nightly grading with both graders is still open.
- [x] (2026-10-05) Milestone 4, acceptance met on the 2026-10-04 set with labels: dense on against dense off gains 3 and loses 0 on development (36 to 39 of 47) and gains 1 and loses 0 on held-out (14 to 15 of 17), so the known-good change is accepted and the known-bad change (the reverse) is rejected. The rule changed to a development net gain of at least 3 and no held-out net loss, after the old rule accepted a 3 to 2 noise result (this change).
- [x] (2026-10-04) Milestone 4, first part: `flywheel-gate.mjs` splits kept questions 70/30 by a hash of the anchor id, compares two offline runs per question (relevant shown or not), and accepts only when held-out shows no significant loss (two-sided sign test) and development shows a gain; `flywheel-run.mjs` produces a run for one configuration (dense on or off, enrichment store or off, judged pool) on a copied snapshot (this change). First real use on 2026-10-04 (production against dense off, 78 questions): the gate rejected both directions because the set shows no development gain either way; see the accuracy log. The set shares too much wording with the anchors to detect the dense gain, so the acceptance criterion is not met yet.
- [x] (2026-10-04) Milestone 4, harder set, code: a generated question whose character-bigram share with the anchor body exceeds 0.5 is asked again once with the previous wording named, and dropped as `too_similar` if still above; the share is recorded per line and the report prints its median (this change). The known-good and known-bad check repeats on the first night after release.
- [x] (2026-10-05) Milestone 5: second grader in the night for shown records outside the relevant set (#1717). First run on 2026-10-05 23:25 graded 52 pairs, 38 relevant by both graders; the night's relevant shown rose from 36 to 47 of 60.
- [x] (2026-10-06) Milestone 6, code: real kiosk questions from the receipts join the set with two-grader labels (`flywheel-real.mjs`, phase 4 of the runner, `real-YYYY-MM-DD.jsonl`, the gate's real rule and the report's real block) (this change). First night pending.
- [x] (2026-10-06) Milestone 7, code: `flywheel-learn.mjs` and phase 5 of the runner propose learned queries from development failures (`not_in_pool`, `judge_rejected`), compare the held-out and real rows of the last three nights without and with the candidates, and activate them only when neither loses; active queries reach the lexical ranking as a per-record list and the dense text through the enrichment queries, with `HERMES_FLYWHEEL_LEARNED_ENABLED=false` as the kill switch (this change). First night pending.

## Surprises & Discoveries

- (2026-10-07) Real questions that only name a department or a period (3 of the first night's 8) are now scored on their filters: the shown records must satisfy the plan's `eq`/`in` filters, follow the recent order, and match the count; other operators and sorts are reported as unsupported. The gate counts them next to content questions.
- (2026-10-07) The runner now holds `runtime/flywheel/runner.lock` (pid and time) for the whole start; a second start logs `already_running` and exits; a lock whose process is gone or older than two hours is taken over. This follows the overlap of 2026-10-06.

- (2026-10-07) First full night: 73 kept synthetic questions, 65 answered with a relevant record (89%), dense retrieval available on 72 of 73; 8 real questions, the 5 content ones all answered, the 2 切粉 failures of 2026-10-05 among them; 14 learned queries activated after a 0/0 held-out check. Two runner processes overlapped during the evening API swap (learn phase at 22:08 while generation ran until 22:22); a lock in the runner is the next small fix.

- (2026-10-06) The gate rejected both candidate changes of the day: the content-span lexical query (loses 3 development questions per night) and the enrichment text in the BM25 corpus (loses 2 to 3; production had never included it because of a stale corpus in `applyEnrichment`, and the offline harness had). Learned queries (Milestone 7) therefore attach to the lexical corpus as a short per-record list, separate from the enrichment text, and to the dense text through the enrichment queries.

- (2026-10-06) A real kiosk exchange on 2026-10-05 22:44 failed twice (「切粉起因の不適合２件。両工場」, then a rephrasing). Receipts show `vectorStatus: timeout` at the day budget during the DGX backup upload, so only lexical ran, and its top 30 held none of the 36 records that mention 切粉: the whole question is the lexical query, and 両工場, ２件 and 起因 outweigh 切粉. Offline with dense on, both questions show 2 relevant records (16 and 14 of the top 30 mention 切粉). The second turn also carried the first turn's semantic query although the wording was new. Both questions enter the real set on the first Milestone 6 night. Follow-ups: move the DGX backup off the evening (owner decision, Control Plane), and use the planner's content span, without count expressions, as the lexical and dense query (to be judged by the gate).

- (2026-10-05, night) The two-phase runner did not remove the dense fallbacks (47 of 60). The cause is the network, not the business LLM: measured at 22:37, the embedding on the DGX takes 0.03 s, but a request from the Pi 5 to the DGX gateway takes 1.7 to 4.3 s with 0.5 to 1.7 s in the TCP connect alone, while `dgx-control-backup.timer` (restic to Google Drive, started 21:30) uploads from the DGX. The day budget of 1.5 s then fails most queries. The night scorer now waits up to 10 s for the embedding (`NIGHT_VECTOR_BUDGET_MS`), which measures retrieval rather than the backup's bandwidth.

- (2026-10-05) Night-time live scoring interleaved with generation made the DGX query embedding time out on 48 of 64 questions (the day budget is 1.5 s; the day median is 0.3 s), so the first night's live numbers measured a lexical fallback, not the day pipeline. Harder questions (anchor overlap below 0.35) were answered 10 of 29 times, easier ones 24 of 35.

- (2026-10-04) The first gate run found that dense retrieval on or off makes no net difference on the synthetic set (development 37 and 37 of 52, held-out 20 and 18 of 26), while hand-written paraphrases showed a clear dense gain. The generated questions keep too much of the record's wording (median bigram share 0.44). Questions with a share below 0.5 were answered 26 of 42 times, above 0.5 30 of 36.

- (2026-10-03) A normal Pi 5 release ignores Hermes flags. `HERMES_FLYWHEEL_ENABLED=true` on `update-all-clients.sh --limit raspberrypi5` succeeded and delivered nothing; the flag reaches the API only through the trial or `--hermes-search-trial-maintenance on` paths. The maintenance path with `on` added the one line and kept every other value. A fail-fast for this is tracked separately.


- Observation: the production relevance judge (JEV) is lenient. Grading the same 419 question-record pairs with the DGX business LLM (Qwen3.8 Flash-Next) agreed within one grade on 94% (Cohen's kappa 0.78 on "relevant"), but of 1,715 pairs JEV called relevant, Qwen agreed on 58%. A blind reading of 118 disputed development pairs sided with Qwen in 67% of them.
  Evidence: `docs/plans/hermes-retrieval-accuracy-log.md`, entries of 2026-10-02 and 2026-10-03.
- Observation: the contrastive keep rule ("B must be grade 1 or lower") kept 5 of 37 valid questions, although both graders confirmed A for 36. Near misses are usually relevant too: among kept questions under the new rule, B was grade 3 for both graders in 17, split in 23, and low for both in 5.
  Evidence: trial of 2026-10-03, 69 pairs, private file `work/flywheel/m2-results.jsonl`.
- Observation: the copy guard rejected 25 of 62 questions. Most copied a phrase, but terse questions that listed the record's own terms (「スケールカバー 取付忘れ 不適合」) failed only because the check joined the words. Checked word by word, 16 were rejected and 45 of 62 generated questions were kept (73%), 30 of them terse.
  Evidence: same trial. Kept questions had a median length of 16 characters, the same as the real kiosk questions seen so far.
- Observation: the business LLM slowed from about ten questions a minute to one during the day trial, and seven generation calls in a row timed out. The owner stopped the run; ending the local ssh session did not stop the process in the container, which was stopped from the Pi 5 host with kill by process id.
  Evidence: 2026-10-03 17:40 to 18:00 JST.
- Observation: questions that name only a department or a period ("三島工場機械課の最近の不適合を教えて") have no content condition, so relevance grading does not apply to them. They caused many grader disagreements and must be scored on filters instead.

## Decision Log

- Decision: the gate accepts only a development net gain of at least 3 questions with no held-out net loss; the sign test is reported, not required.
  Rationale: on 2026-10-05 the old rule (any development gain, held-out not significantly worse) accepted dense off over dense on with 3 gained and 2 lost on development and 1 gained and 2 lost on held-out. Significance is out of reach at 50 to 80 questions, so a margin replaces it.
  Date/Author: 2026-10-05, Claude under the owner's standing permission.
- Decision: label the shown records outside a question's known relevant set before comparing configurations.
  Rationale: paraphrased questions match several records; counting only the anchor and the confirmed near miss made a configuration that shows another correct record look like a loss. With labels, dense on gains 3 and loses 0 on the 2026-10-04 development set; without them it gained 2 and lost 3.
  Date/Author: 2026-10-05, Claude.

- Decision: bound the whole-question overlap with the anchor at 0.5 bigram share, with one retry.
  Rationale: the first gate run (2026-10-04) showed the set cannot detect the dense gain because kept questions share a median 0.44 of their bigrams with the anchor (terse 0.56). The per-token copy guard catches quoted phrases but not a question assembled from the record's own nouns. A retry that names the previous wording keeps more pairs than dropping at once.
  Date/Author: 2026-10-04, Claude under the owner's standing permission to choose the next step.

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

- Decision: keep a question when both graders give the anchor A grade 3; record B's grades instead of requiring them to be low.
  Rationale: see Surprises. B stays useful as a labelled hard candidate.
  Date/Author: 2026-10-03, owner and Claude.
- Decision: the copy guard checks runs inside each word separated by spaces or punctuation, and applies the bigram share only to sentence-length words (15 characters or more).
  Rationale: people type the record's own terms in short queries; the curse-of-knowledge risk is copied phrases, not shared nouns.
  Date/Author: 2026-10-03, Claude.
- Decision: wrap the business LLM call in a guard that stops after three slow (over 15 s) or failed calls in a row, and leaves the rest for the next night.
  Rationale: the business LLM also serves daytime consultations; the day trial slowed tenfold.
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

Milestone 2 adds the filter and labels. `flywheel-filter.mjs` grades A and B for each generated question with JEV (`createJevPairGrader`, reusing `gradeBatch` from `graded-labels.mjs`) and with the DGX business LLM (`createDgxGrader`, the grading prompt used on 2026-10-02). It keeps a question when both graders give A grade 3, and records B's grades. For kept questions it runs the live pipeline once, pools the top 30 candidates, and grades the pool with both graders, so every kept question carries consensus labels for later scoring. Offline acceptance compares a few hundred generated questions with the hand-written development sets: their length distribution (KL divergence against the real kiosk questions in the receipts), the share kept, and the loss-stage counts.

Milestone 3 runs it nightly. `flywheel-runner.mjs` is started by the API process like the enrichment runner when `HERMES_FLYWHEEL_ENABLED=true`, inside the existing night window, with a nightly budget `HERMES_FLYWHEEL_MAX_QUESTIONS` (default 100) and concurrency 1. It writes `runtime/flywheel/questions-YYYY-MM-DD.jsonl` (question, seed, A and B ids, consensus labels, live result ids, loss stage, no record text) and `flywheel-status.json`. The release path forwards the two variables the same way `standard-ansible-release.py` forwards the enrichment ones. `flywheel-report.mjs` reads a copied night file on the Mac and prints the summary shown in the Purpose section.

Milestone 4 turns the set into a gate. The offline run (`flywheel-run.mjs`) reuses the runner's live scorer, so a configuration is expressed by the same environment the Pi 5 uses: dense provider and store, enrichment flag and store, and the judged pool; the gate (`flywheel-gate.mjs`) reads two run files and prints development and held-out counts, the paired changes, and the decision. Questions are assigned to development or held-out by a hash of their id (70/30), so the implementing agent reads only development questions. A retrieval change is accepted only when, on the same night's held-out questions, the paired sign test over questions where the two configurations differ does not show a loss and the development set shows a gain. Real kiosk questions from the receipts join the set with the same two-grader labels; synthetic questions are down-weighted as real ones accumulate (CASTLE moved from 10:1 toward parity).

Milestone 5 adds the second grader to the night. After live scoring, the runner grades the records that `other_shown` answers showed outside a question's known relevant set, with both the DGX business LLM and JEV, under a nightly budget (`HERMES_FLYWHEEL_LABEL_BUDGET`, default 60 pairs). Labels go to `runtime/flywheel/labels.json` as `{anchor: {record: {g, dgx, jev, night}}}`, where `g` is 3 only when both graders give 3. A labelled relevant record turns the row's loss into a shown answer, so the morning report and the gate count production fairly without a daytime labelling pass on the Mac. The offline labels of 2026-10-05 (JEV only) stay as a separate file.

Milestone 6 mixes real kiosk questions into the set. Each night the runner reads the receipts of the previous and the current day, takes content questions (those with a semantic query) that are not yet in the set, up to `HERMES_FLYWHEEL_REAL_BUDGET` (default 20), answers each with the night scorer to get its judged candidates, and grades the top candidates and the day's shown records with both graders. Records with consensus grade 3 become the question's relevant set. Rows go to `runtime/flywheel/real-YYYY-MM-DD.jsonl` with `source: "real"`, a stable id from a hash of the question, the day's outcome and shown ids, the split by that hash, the labels, and the live result. The gate and the report read real rows next to synthetic ones and print them separately; a real question with no consensus-relevant record stays in the file but is not scored. Question text already leaves the kiosk for JEV and the DGX during the day, so this adds no new recipient. The synthetic set is down-weighted as real questions accumulate, the way CASTLE moved from 10:1 toward parity; the first version reports the two sets side by side and requires the real set not to lose.

Milestone 7 closes the loop. Development rows (synthetic and real) whose loss stage is `not_in_pool` or `judge_rejected` propose the question wording as a learned query for the relevant record, into `runtime/flywheel/learned-queries.jsonl` with `state: "candidate"`. The runner then answers the held-out rows and the real rows of the last three nights twice, without and with the candidates attached as extra enrichment queries, and activates the candidates only when held-out and real show no net loss; otherwise they stay candidates and the morning report says so. Active learned queries are attached at corpus refresh next to the enrichment store (a separate file, so they can be removed as a whole), and the dense index re-embeds the changed records in its 04:00 to 06:00 window. Learning from development rows and judging on held-out rows keeps a learned wording from passing on the question it came from. Milestone 7 depends on Milestone 6: without real questions the held-out check only measures synthetic wording.

## Concrete Steps

Run tests from `scripts/hermes-search`:

    node --test retrieval/

Expected after Milestone 1: the previous count plus the new flywheel tests, all passing. Offline generation for Milestone 2 runs on the Pi 5 only after Milestone 3 is released; before that, the owner runs one prepared command in a terminal, as on 2026-10-02 for grading, because the implementing session may not execute code inside production containers.

## Validation and Acceptance

Milestone 1 is accepted when the unit tests pass and a fixed random seed yields the same seeds and pairs twice. Milestone 2 is accepted when, on 200 generated questions, at least half are kept, the length distribution of kept questions is closer to the real kiosk questions than the hand-written paraphrase sets are, and a blind reading of 30 kept development questions finds A relevant in at least 25. Milestone 3 is accepted when a released Pi 5 with the flag on writes a night file and a status file, the report prints the summary, kiosk answers during the day are unaffected (receipt latency unchanged), and no request goes to any host other than the DGX gateway and TypeSafe. Milestone 4 is accepted when a known-good change (the 2026-10-02 move from 15 to 30 candidates) passes the gate and a known-bad change (dense retrieval off, which the 2026-09-24 measurement showed to lose paraphrased questions) fails it.

## Idempotence and Recovery

Generation and grading append to dated files and skip pairs already processed, so a stopped night continues the next night. Turning `HERMES_FLYWHEEL_ENABLED` off stops the runner without touching answers. Deleting the `runtime/flywheel/` directory only removes the test set. Nothing in this plan changes how questions are answered.

## Artifacts and Notes

Research summary that shaped the design (2026-10-03): CASTLE (Airbnb, arXiv 2605.21812) for seeds, contrastive pairs, separate generator and judge, daily generation and cold-to-warm mixing; "Beyond Benchmark Scores" (arXiv 2609.14579) for the synthetic and real distribution gap; "The Curse of Knowledge in LLM Query Simulation" (arXiv 2608.25245) for answer-word leakage; "LLM-based relevance assessment still can't replace human relevance assessment" (arXiv 2412.17156) for judge circularity and leniency; JaCWIR for Japanese LLM-generated retrieval questions.

## Interfaces and Dependencies

In `scripts/hermes-search/retrieval/flywheel-seeds.mjs`, define `export function sampleSeeds({ count, random })` returning `[{ intent, style, role }]`. In `flywheel-pairs.mjs`, define `export function samplePairs({ records, denseEntries, count, random })` returning `[{ a, b, similarity }]` with record ids. In `flywheel-generate.mjs`, define `export async function generateQuestion({ pair, seed, facts, chat })` returning `{ ok: true, question } | { ok: false, reason }`, where `chat` is an injected function with the same contract as the DGX request in `enrichment-dgx.mjs`. In `flywheel-filter.mjs`, define `export async function filterAndLabel({ items, gradeJev, gradeDgx, runPipeline })`. No new npm dependency is needed.
