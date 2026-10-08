# Hermes retrieval accuracy log

- Status: living log, one entry per measured change
- Scope: nonconformity retrieval quality in business Hermes Chat on the Pi 5

This log records each accuracy change that was measured, including the ones that were rejected, so a later change does not repeat a failed attempt. Design decisions stay in their ADR or ExecPlan. This file keeps the measurement, the numbers, and the reason for keeping or dropping the change.

## How to measure

The gold sets, stores, and run files are private and stay in `~/Documents/hermes-retrieval-private` on the owner's Mac. They are never committed.

- `gold/stage-v1.json`: 50 cases (content_same 10, content_para 16, filter 10, mixed 6, out_of_scope 4, owner 4).
- `gold/stage-aspect-v1.json`: cases that ask for a countermeasure or disposition instead of a phenomenon (8 added 2026-09-28, a09 from a kiosk miss on 2026-09-29).
- Held-out sets, written on 2026-09-24 by a supervising agent and not read by the implementing agent: `gold/heldout-supervisor.json` (6), `gold/heldout-supervisor-v2.json` (14 since 2026-09-30), `gold/heldout-paraphrase-subset.json` (12), `gold/heldout-paraphrase-hard.json` (12). Report only summary numbers from them. A case the implementing agent has read moves to `gold/dev-seen-heldout-*.json`.
- `snapshots/nonconformity-snapshot-20260929.json`: all 8,242 records, exported read-only on the Pi 5 with `scripts/hermes-search/hermes-qmd-snapshot-export.mjs` (request line `{"type":"request","requestId":"snap-1"}` on stdin, run in the API container). Keep snapshots in this private folder, not in a worktree: the earlier copy lived in a worktree and was lost when that worktree was cleaned up. Numbers before 2026-09-29 used an 8,209-record snapshot, so compare a change only with a baseline on the same snapshot.

Run from `scripts/hermes-search`:

    node retrieval/evaluate.mjs --gold <gold> --snapshot <snapshot> --retriever <lexical|hybrid> --stage-dump [--enrichment <store>|--no-enrichment] --now 2026-09-24 --out <run>
    node retrieval/stage-score.mjs --gold <gold> --run <run> [--run <run> ...]

Hybrid runs need `HERMES_RETRIEVAL_DENSE_PROVIDER=dgx`, `HERMES_RETRIEVAL_DENSE_BASE_URL=http://127.0.0.1:38110` through the owner's SSH tunnel, and `TYPESAFE_API_KEY` for the JEV planner and judge. Compare a change against a baseline run of the current `main` on the same day and settings; JEV answers drift by about one case between runs.

Real use is recorded on the Pi 5 since 2026-09-29: every answer appends its receipt, the shown record ids, and the session id to `/app/storage/hermes-search/runtime/receipts/receipts-YYYY-MM-DD.jsonl` (Tokyo day, kept 90 days, no record text). Copy a day to the private folder and summarize it:

    ssh denkon5sd02@100.106.158.2 'c=$(docker ps --format "{{.Names}}" | grep -E "^bluegreen-api-(blue|green)-1$" | head -1); docker exec "$c" cat /app/storage/hermes-search/runtime/receipts/receipts-2026-09-30.jsonl' > ~/Documents/hermes-retrieval-private/receipts/receipts-2026-09-30.jsonl
    node retrieval/receipt-report.mjs ~/Documents/hermes-retrieval-private/receipts/receipts-*.jsonl

The `review` list holds content questions that returned nothing or lost meaning-based search. Those are the candidates for new gold cases.

A change is kept only if the held-out sets do not get worse on the same day and settings. A development-set gain of one case is within the run-to-run drift; repeat the run or add cases before counting it.

Graded relevance labels (since 2026-10-02) score a run against every relevant record, not only the gold targets. Run `evaluate.mjs` with `--stage-dump`, then pool and grade the candidates, then score:

    node retrieval/graded-labels.mjs --set <name:gold:run[,run]> [--set ...] --snapshot <snapshot> --labels ~/Documents/hermes-retrieval-private/labels/graded-v1.json
    node retrieval/graded-score.mjs --set <name:gold:run[,run]> [--set ...] --labels <labels> --judged <15|30>

`graded-labels.mjs` pools the gold targets, the shown records, and the top 30 candidates of each run. JEV grades each question-record pair from 0 to 3 with a rubric worded differently from the production judge. Pairs already in the label file are skipped, so a new run only adds its new candidates. Grade 3 counts as relevant. `graded-score.mjs` reports the shown records by grade and, for each answer case that showed nothing, the stage that lost it: answered in another form, no relevant record labelled, relevant records outside the judged candidates, or rejected by the judge. Pass `--judged` the number of candidates the judge read in that run.

The production judge and the grader are both JEV, so the grades of shown records partly measure JEV against itself. Read a sample blind after a rubric or model change. On 2026-10-02 a blind reading of 34 pairs agreed within one grade on 32.

Columns used below: status (answered in the right form), r15 and r50 (a target within the top 15 or 50 candidates), prec (shown records that were targets), hit (a shown record was a target).

## Entries

### 2026-09-24: hybrid retrieval with enrichment aliases (kept)

Hybrid RRF of lexical and dense ranks with Grok enrichment aliases. Paraphrase r15 moved from 0.00 (lexical) to 0.69 with Qwen3-Embedding-0.6B. See ADR-20260924. The enrichment covered a 1,000-record subset that contained the targets, so these numbers are biased upward.

### 2026-09-27: DGX business-LLM enrichment instead of Grok (kept)

Grok and DGX enrichment on the same 930 records, hybrid, stage-v1. Paraphrase status 0.69 for both, r15 0.44 (Grok) and 0.50 (DGX), hit 0.31 and 0.38. DGX matches Grok within noise with far fewer aliases, so enrichment is produced on the Pi 5. Details are in `hermes-dgx-retrieval-enrichment.md`.

### 2026-09-28: relevance judge on the content condition only (kept)

Trigger: on the kiosk, 「ハンディライトが対策の不適合３件」 returned no result although the lexical rank-1 candidate contained 「ハンディライトを用いて確認」. A direct judge probe accepted the record at 0.92 for 「ハンディライトが対策」 and rejected it once 「の不適合」 or 「の３件」 was attached.

Change: the judge receives the content condition only. Counts, period and structural words, punctuation, a standalone source name from `source-labels.json`, and tokens that match an applied filter value are removed. When nothing is left, the judge is skipped.

| Run (same day) | aspect status | stage-v1 status | stage-v1 r15 | stage-v1 prec | paraphrase hit |
| --- | --- | --- | --- | --- | --- |
| lexical, main | 4/8 | 0.80 | 0.62 | 0.72 | 0.00 |
| lexical, this change | 6/8 | 0.80 | 0.62 | 0.70 | 0.00 |
| hybrid + DGX enrichment, main | 6/8 | 0.88 | 0.76 | 0.72 | 0.31 |
| hybrid + DGX enrichment, this change | 7/8 | 0.88 | 0.78 | 0.71 | 0.38 |

Open: aspect case 「処置が修理不可だった不適合」 lost its single shown record in the hybrid run. Query embedding still times out at 800 ms on some questions and falls back to lexical.

### 2026-09-28: widen the judge wording to cause, countermeasure, and disposition (rejected)

The judge asks whether the record states the requested phenomenon. Widening it to 「現象・原因・対策・処置のうち質問が指定するもの」 did not fix any aspect case by itself (lexical 4/8 before and after). Combined with the content-only query it raised stage-v1 status to 0.84 but dropped prec from 0.72 to 0.63 and mixed-case prec from 0.52 to 0.34, because the judge accepted loosely related records. Showing wrong records is worse than a safe no-result, so the wording stays phenomenon-only.

### 2026-09-29: judge only the body field a question asks about (rejected, two variants)

Trigger: on the kiosk, 「ハンディライトを是正にした案件はほかにある？」 returned no result. A judge probe on record 00007986 accepted 「ハンディライトを是正にした案件」 (0.69) and rejected 「ハンディライトを是正にした」, so the judge looked unstable for countermeasure questions.

Idea: when a question asks about one body field (個別是正内容, 処置内容), ask the judge whether that field alone states what the question asks for. A probe with a decoy record (the term only in 不適合内容) accepted the target for four wordings (0.63 to 0.91) and rejected the decoy.

Variant A picked the field from a list of cue words per field. Variant B let the JEV planner pick the field from the catalog's body field labels, with no word list. Lexical, new 8,242-record snapshot, same day as `main`:

| Run | aspect cases answered (of 16) | stage-v1 status |
| --- | --- | --- |
| main | 14 | 0.80 |
| variant B, planner picks the field | 13 | 0.80 |

Variant A on the first 9 aspect cases matched `main` (7 of 9) and lost one stage-v1 case (0.80 to 0.78). Four wordings of the ハンディライト question (a09 to a12) were already answered by `main`: the 2026-09-28 content-only judge query had removed most of the wording sensitivity. The kiosk miss came from 「ほかにある」, a request for records other than the ones already shown, not from the field. Neither variant is kept. The cases a03 (インタロック, targets outside the top 50 lexical candidates) and a08 (修理不可, targets at 35 to 40 while the judge reads the top 15) fail before the judge and are ranking problems.

Test runner note from the same day: `node --test retrieval/` loads `retrieval/index.js`, which imported a hand-kept list. `enrichment.test.mjs`, `enrichment-batch.test.mjs`, and `entity-link.test.mjs` were missing, so CI never ran them. `index.js` now imports every `*.test.mjs` in the directory.

### 2026-09-29: requests for records other than the ones already shown (kept)

Trigger: after 「製造課の最近の不適合情報を２けん」 showed 00007986, the kiosk question 「ハンディライトを是正にした案件はほかにある？」 returned 「一致する記録は見つかりませんでした」. 00007986 is the only record that mentions ハンディライト, so the right answer was that nothing else matches.

Change: the conversation now keeps the ids of the records it has shown (session `shownIds`, up to 200). On a follow-up, the JEV planner is asked whether the request asks to leave out the records already shown; the intent is judged by JEV, not by a list of wordings such as ほかに or それ以外. When it does, the search runs as usual and the shown records are removed after ranking and judging. If nothing is left, the answer is 「さきほど示したN件のほかに、条件に合う記録は見つかりませんでした。」 and the receipt outcome is `no_other`.

The first wording (「これまでに示した記録とは別の記録を求めているか」) also fired on scope and count changes (「組立課は？」, 「全部門で」, 「新しいのを5件」, 「テーブルの部品のもの」), which would hide records the person still wanted. The kept wording asks whether the request asks to leave out the shown records themselves and says that scope, condition, and count changes do not. Short requests scored just under the usual 0.6 cut (「他にはある？」 0.52, 「ほかには？」 0.56) while scope and count changes scored 0.14 to 0.44, so this question accepts at 0.5; a wrong exclusion only hides records already seen and says so.

Dialogue set (19 dialogues, 39 turns, two runs each, new 8,242-record snapshot): `main` 36/39; kept version 36/39 with exclusion on exactly the three follow-ups that ask for other records (d16 to d18) and on none of the others, including the negative case d19. The three remaining failures (d06, d07, d11) are the same as on `main`. `dialogue-eval.mjs` now scores `excludeShown` from the full plan and assumes a follow-up's previous answer showed records.

### 2026-09-29: the planner picks the content part of a question for the judge (kept)

Trigger: after #1537 was deployed, the kiosk dialogue 「製造課の最近の不適合情報を２けん」 → 「ハンディライトを是正にした案件はほかにある？」 still answered 「一致する記録は見つかりませんでした」. The receipt, now kept on the Pi 5, showed the exclusion intent was chosen (0.65) and meaning-based search worked (520 ms), but the judge query still read 「ハンディライトを是正にした案件はほかにある」, and the judge rejects 00007986 whenever 「…はほかにある」 is attached. Telling the judge to ignore exclusion wording did not change that. (The first turn also picked 仙台工場製造部製造課 at 0.77 because both factories have a 製造課; that is a separate ambiguity.)

Change: code cuts the question at the topic particle は and punctuation (not が or も, which sit inside a condition such as 「割れが出た」). When that gives two or more parts, the planner asks JEV which part states the content condition; the parts and the whole question are the only choices, so no wording list is kept. The chosen part goes to the relevance judge; lexical and meaning-based retrieval still use the whole question.

| Run (same day, lexical, 8,242-record snapshot) | aspect cases answered (of 17) | stage-v1 status | dialogue turns (of 39) |
| --- | --- | --- | --- |
| main | 14 | 0.80 | 36 |
| content part for the judge | 15 | 0.80 | 37 |

The new aspect case a17 is the kiosk question on its own; it now returns 00007986. The other aspect and stage-v1 cases are unchanged. The dialogue difference is d06, which passes and fails between runs on `main` too. TypeSafe connection failures stopped several evaluation runs on this day; each number above is from a complete run.

### 2026-09-30: first held-out check since 2026-09-24, and held-out scoring (kept)

Trigger: every kept change from 2026-09-28 on was judged on development sets only (stage-v1, stage-aspect-v1, dialogue-v1), and two of them were fixed on the kiosk question that had been added to the same set (a09, a17). The held-out sets had not been run since 2026-09-24.

Scoring fix: `evaluate.mjs` could not score the held-out forms. It searched the placeholder `__any__` as text, ignored `deptAnyOf`, rejected `clarification_or_answer` and the `{ cases: [...] }` file form, and had no target-id measure. A first lexical run therefore reported seven supervisor-v2 answers as showing unrelated records. All seven showed only records of the requested department. The script now treats `__any__` as any text, requires a listed department in an `organization` field when `deptAnyOf` is set, accepts either form for `clarification_or_answer`, reads `{ cases }`, and reports `targetsShown` per case and `casesTargetShown` for cases with `targetId` or `targetIds`.

`main` at c21d1be9 (retrieval code unchanged at 250bc6a1), 8,242-record snapshot, `--now 2026-09-24`, no enrichment, hybrid with DGX Qwen3-Embedding-0.6B:

| Set | Cases | status | all shown relevant | target shown |
| --- | --- | --- | --- | --- |
| stage-v1 (development) | 50 | 0.88 | - | paraphrase hit 3/16 |
| stage-aspect-v1 (development) | 17 | 17/17 | - | - |
| heldout-supervisor | 6 | 6/6 | 4/6 | - |
| heldout-supervisor-v2 | 14 | 12/14 | 12/14 | - |
| heldout-paraphrase-subset | 12 | 12/12 | - | 6/12 |
| heldout-paraphrase-hard | 12 | 5/12 | - | 1/12 |

Held-out paraphrase (6/12) is not below the development paraphrase cases (3/16), so the meaning-based search is not fitted to the development set. A lexical run of supervisor-v2 at each merge since 2026-09-24 showed that #1520 (judge the content condition only) turned two department questions from no result into answers with correct records. That change also helps held-out cases.

The two supervisor-v2 cases the implementing agent read to check this (d3, d6) moved to `gold/dev-seen-heldout-20260930.json`. The paraphrase held-out sets carry one target record per case and no keywords, so `all shown relevant` does not apply to them.


### 2026-09-30: follow-up turns decide each previous condition on its own (kept)

Trigger: on the kiosk, 「三島組立課の不適合２件」 → 「組立１課の不適合２件」 searched both departments, and 「塗装が剥がれる類似不適合を３件」 → 「同様の案件が機械課でもあるか調べて」 searched three departments with the literal question as content and returned nothing. The planner labelled a whole follow-up as `new_search` or `refine` (confidence 0.05 to 0.35 on these turns). A refine kept and added every previous filter, and it kept the previous content only when the request had no content of its own.

Change: the `turn` question is gone. For each previous filter, code checks whether the request names a value for the same field. If it does, the previous value is replaced unless JEV says the request adds to it (`add_i`, yes/no). If it does not, the previous condition is kept unless JEV says the request drops it (`drop_i`, yes/no). When the previous plan has content, `contentCarry` asks whether the request states new content or reuses the previous one, which replaces the content yes/no question on that turn. The compact plan now carries `contentSpan`, so reused content is judged on the same text. The receipt `turn` reads `followup`, and the question version is `planner-questions-2026-09-30`.

New private development set `gold/dialogue-slots-dev.json`: 10 dialogues, 11 scored turns, covering replace, add, drop, period replace, content reuse, and new content. It includes the two kiosk dialogues. `dialogue-eval.mjs` gained `contentFrom: previous|own`, which compares a turn's content with the previous turn's. Lexical plans, same day, two runs each:

| Run | dialogue-v1 turns (of 39) | dialogue-slots-dev turns (of 11) |
| --- | --- | --- |
| main | 36, 36 | 7, 6 |
| three-way keep/replace/add choice per condition (rejected) | 33 | 7 |
| yes/no drop and add, code decides replace (kept) | 36, 36 | 8, 8 |
| kept version, previous content named in the contentCarry question (rejected) | 36, 35 | 8, 8 |

The three-way choice kept the previous department for 「組立１課の不適合２件」 (keep 0.66) and 「部署を問わずに」 (keep 0.67), and its "no content" option took 「三島工場資材課に限定して」 (0.54), so dialogue-v1 dropped to 33. The kept version fixes both kiosk dialogues and the period replace case. dialogue-v1 dialogues fully passed rose from 16 to 17.

Still failing: 「部署を問わずに」 (drop 0.44, below the 0.6 cut, left unchanged so as not to tune the cut on one case), 「組立課では？」 after a content question (contentCarry chose new at 0.58), and 「同じ部署で傷の不適合」 after 「仙台工場資材課の最近の不適合」, where the first turn already took the department wording as content (the same first-turn miss as dialogue-v1 d07).

Held-out: first turns ask the same questions as before, so the single-turn held-out sets are unaffected by construction. There is no held-out dialogue set yet, so this change is judged on development dialogues only. A held-out dialogue set written by someone other than the implementing agent is the next measurement gap.

### 2026-10-02: full-corpus DGX enrichment measured against no enrichment (no gain; production unchanged)

Trigger: the overnight enrichment reached 8,248 of 8,252 records on 2026-10-01 (2,286 rows with aliases). Earlier enrichment numbers came from a 1,000-record subset that contained the targets, so they were biased upward (see 2026-09-24).

Method: the store and the production dense store (`retrieval-dense-dgx.bin`) were copied read-only from the Pi 5 to the private folder with the owner's approval. `evaluate.mjs` reused 8,230 of 8,242 stored vectors, so the DGX embedded only 12 records during the day. `main` at 0659ead2, hybrid, 8,242-record snapshot, `--now 2026-09-24`, same day.

| Set | No enrichment | Full enrichment |
| --- | --- | --- |
| stage-v1 (development, 50): status / r15 / hit | 0.88 / 0.64 / 0.60 | 0.90 / 0.69 / 0.58 |
| stage-v1 paraphrase (16): r15 / hit | 0.25 / 0.19 | 0.31 / 0.19 |
| stage-aspect-v1 (development, 17): r15 / hit | 0.94 / 0.76 | 0.82 / 0.71 |
| heldout-supervisor (6): status / all shown relevant | 5 / 4 | 5 / 4 |
| heldout-supervisor-v2 (14): status / all shown relevant | 12 / 12 | 12 / 12 |
| heldout-paraphrase-subset (12): target shown | 6 | 4, 4 |
| heldout-paraphrase-hard (12): target shown | 1 | 1, 1 |
| stage-v1 total p95 | 1,619 ms | 2,067 ms |

Full enrichment does not improve paraphrase questions. It loses two held-out paraphrase cases in both runs, and adds about 0.4 s at p95. The 0.69 paraphrase r15 of 2026-09-24 does not hold when every record is enriched.

Where the held-out paraphrase cases are lost (target rank among candidates, 12 cases): without enrichment 6 targets are in the top 15 and 9 in the top 50. With enrichment 4 are in the top 15 and 9 in the top 50. Every target in the top 15 was shown in both arms, so the judge is not the loss. Enrichment text on every record moved two targets from ranks 13 and 6 to 27 and 17, outside the 15 candidates the judge reads. In both arms, five more targets sit between ranks 16 and 30.

Not changed: production still attaches enrichment. Next measurements, each against both arms on the same day: let the judge read 30 candidates instead of 15 (cost: more JEV judgments per question), and decide after that whether enrichment stays attached. The rank positions above were read from the held-out paraphrase subset, so that set now counts as seen for ranking-window tuning; the window change must be judged on other held-out cases as well.

### 2026-10-02: the judge reads 30 candidates instead of 15 (kept)

Trigger: the entry above. Targets of paraphrase questions sit between ranks 16 and 30, and the judge accepted every target it saw.

Change: `executor.mjs` takes the top `RELEVANCE_POOL_DEFAULT` (30) ranked candidates for relevance-sorted content questions (lexical, dense, and hybrid). `relevance-jev.mjs` judges them in parallel JEV calls of 15, so each call is the same size as before. `HERMES_RETRIEVAL_RELEVANCE_POOL` (15 to 60) overrides the default. The recent-content path and the reranker path are unchanged.

Hybrid, same day as the entry above, 8,242-record snapshot:

| Set | 15, no enrichment | 15, enrichment | 30, no enrichment | 30, enrichment |
| --- | --- | --- | --- | --- |
| heldout-paraphrase-subset (12): target shown | 6 | 4 | 9 | 9 |
| heldout-paraphrase-hard (12): target shown | 1 | 1 | 3 | 3 |
| stage-v1 paraphrase (16): hit | 0.19 | 0.19 | 0.31 | 0.25 |
| stage-v1 (50): hit / prec | 0.60 / 0.59 | 0.58 / 0.62 | 0.64 / 0.59 | 0.62 / 0.61 |
| stage-aspect-v1 (17): hit | 0.76 | 0.71 | 0.76 | 0.82 |
| heldout-supervisor-v2 (14): status / all shown relevant | 12 / 12 | 12 / 12 | 12 / 12 | 12 / 12 |
| heldout-supervisor (6): all shown relevant | 4 | 4 | 3 | 3 |
| stage-v1 total p95 | 1,619 ms | 2,067 ms | 2,222 ms | 2,516 ms |

Kept because the held-out paraphrase gain (3 to 5 cases) is larger than the run-to-run drift, and it also appears on the hard set, whose ranks were not inspected beforehand. Costs: about 0.5 s more at p95, and one held-out supervisor case gained a shown record without the keyword.

Enrichment makes no difference at 30 candidates either (9 against 9, 3 against 3) and costs about 0.3 s. Whether it stays attached is decided after the next step.

This widens what the judge sees; it does not improve ranking. Next: measure first-stage recall at 15, 30, and 50 per stage with graded labels on pooled candidates, then compare a Japanese embedding model (ruri-v3-310m, JMTEB retrieval 81.89 against 72.81 reported for Qwen3-Embedding-0.6B) and morphological tokens with normalization against the current character bigrams.

### 2026-10-02: first-stage comparison of embedding models and tokenizers (no change)

Trigger: a survey of established practice. JMTEB reports retrieval 81.89 for ruri-v3-310m against 72.81 for Qwen3-Embedding-0.6B, and Japanese BM25 is usually built on morphological tokens with normalization (Sudachi), not character bigrams.

Method: offline on the owner's Mac, no production change. 73 content questions with targets (stage-v1 content_same, content_para, mixed; stage-aspect-v1; both held-out paraphrase sets) against 7,864 records, whole corpus, no filters, the question as the query. Qwen3 used the stored production vectors and query embeddings from the DGX. ruri-v3-310m ran locally with its 検索クエリ/検索文書 prefixes and 512 tokens. BM25 used the same parameters for character bigrams and for Sudachi normalized content words. Fusion is RRF with k=60. The count is cases with a target in the top 15 / 30 / 50.

| Arm | All (73) | Paraphrase-type (40) | stage-aspect-v1 (17) |
| --- | --- | --- | --- |
| Qwen3 only | 36 / 49 / 53 | 13 / 23 / 26 | 9 / 11 / 12 |
| ruri-v3-310m only | 39 / 42 / 51 | 20 / 22 / 27 | 6 / 6 / 9 |
| BM25 bigram only | 38 / 43 / 45 | 6 / 11 / 12 | 17 / 17 / 17 |
| BM25 Sudachi only | 36 / 41 / 43 | 7 / 10 / 11 | 15 / 16 / 16 |
| bigram + Qwen3 (current) | 48 / 53 / 57 | 17 / 22 / 25 | 16 / 16 / 17 |
| bigram + ruri-v3-310m | 52 / 55 / 60 | 21 / 24 / 27 | 16 / 16 / 17 |
| Sudachi + Qwen3 | 41 / 48 / 52 | 12 / 18 / 21 | 14 / 15 / 16 |
| Sudachi + ruri-v3-310m | 45 / 53 / 57 | 16 / 22 / 26 | 14 / 16 / 16 |

ruri-v3-310m ranks paraphrase targets higher inside the top 15 (20 against 13 alone) but reaches the same number by rank 30 and 50, and it is weaker on the aspect questions. Fused with bigrams it gains 4 / 2 / 3 cases of 73 over the current pair. With the judge reading 30 candidates that is 55 against 53, inside the noise of these sets. The benchmark gap does not carry over to these records.

Sudachi tokens are worse than character bigrams in every pairing (rejected). Part names and technical compounds in short records match better as bigrams.

In every arm, 13 of the 40 paraphrase-type cases have no target in the top 50. Those sets carry one target record per case, so other valid records may be counted as misses. Next: graded relevance labels on the pooled top candidates of all arms, so recall and precision are measured against every relevant record. Model and tokenizer swaps are judged again on that basis. No swap of the DGX embedding model is proposed from this run.

### 2026-10-02: graded relevance labels on pooled candidates (measurement basis)

Trigger: the entry above. Single-target gold cases count other valid records as misses.

Method: for the same 73 questions, the top 20 of each single arm, the top 30 of the two bigram fusions, and the gold targets were pooled (5,389 question-record pairs, median 74 per question). JEV graded each pair with a rubric worded differently from the production judge: 3 the event asked for, 2 the same kind of event with a different part or situation, 1 shared words only, 0 unrelated. Labels hold ids and grades and stay in the private folder.

Checks on the labels: the 99 gold targets got grade 3 (91) or 2 (8), none lower. The implementing agent graded 34 development pairs blind: 23 exact, 32 within one grade. Of 14 pairs JEV graded 3, the blind grade was 2 or more for 13. Of 10 pairs JEV graded 2, the blind grade was 2 or more for 5. Grade 3 is therefore used as "relevant"; grade 2 is too noisy. Grade 3 is lenient: it includes similar cases, not only the exact event.

Relevant records per question (grade 3): 7 to 21 on average by set. The paraphrase sets with one target per case were far from complete.

First stage against grade 3, cases with a relevant record in the top 15 / 30 (73 cases):

| Arm | All (73) | Held-out paraphrase (24) | nDCG@10 (all) |
| --- | --- | --- | --- |
| bigram + Qwen3 (current) | 65 / 68 | 22 / 23 | 0.469 |
| bigram + ruri-v3-310m | 68 / 70 | 22 / 23 | 0.476 |
| Qwen3 only | 59 / 63 | 20 / 22 | 0.394 |
| BM25 bigram only | 59 / 62 | 17 / 19 | 0.389 |

The first stage is not the weak part: the current pair puts a relevant record in the top 30 for 68 of 73 questions. The earlier reading ("paraphrase targets are outside the top 15") came from the single-target gold.

Shown records of the same-day hybrid runs, scored with the labels:

| Run | Dev content (49): answered / with a relevant record / no result | Held-out paraphrase (24): answered / with a relevant record / no result | Shown records graded 3 / 2 / lower / unjudged (all 73) |
| --- | --- | --- | --- |
| 15 candidates, no enrichment | 43 / 42 / 6 | 16 / 16 / 8 | 171 / 10 / 1 / 10 |
| 15 candidates, enrichment | 44 / 42 / 5 | 18 / 16 / 6 | 175 / 7 / 1 / 32 |
| 30 candidates, no enrichment | 43 / 42 / 6 | 20 / 20 / 4 | 192 / 14 / 1 / 15 |
| 30 candidates, enrichment | 44 / 42 / 5 | 21 / 19 / 3 | 190 / 7 / 1 / 42 |

Caveat: the production judge and the labels both come from JEV, so the share of shown records graded 3 partly measures JEV against itself. The blind check above is the independent part.

The 30-candidate change halves no-result answers on the held-out paraphrase cases (8 to 4). The ten remaining no-result cases at 30 candidates split into: no relevant record in the judged 30 (5, one of them with no relevant record in the pool at all, so no result is right), the judge rejected the only relevant candidate (3), and the planner asked back (2).

### 2026-10-02: enrichment turned off (kept: off)

Correction first: the entries above read "enrichment makes no difference" from target counts and from label counts that left many shown records of the enrichment runs unjudged. With every shown record labelled (`graded-score.mjs`, 86 answer cases, hybrid, 30 candidates):

| Run | A relevant record shown | Nothing shown | Relevant records shown | Relevant among the top 15 candidates (average) |
| --- | --- | --- | --- | --- |
| No enrichment | 72 | 10 | 247 | 5.1 |
| Full enrichment | 73 | 8 | 266 | 5.6 |

Enrichment has a small positive effect: about 8% more relevant records shown and one or two more answered cases, which is inside the noise of these sets. It costs about 0.3 s at p95 and overnight DGX time for every new record.

A dual index was tested offline with the existing store (ruri-v3-310m embeddings on the owner's Mac, 73 questions, graded labels): generated queries embedded on their own and fused as a third list, as in Doc2Query++. nDCG@10 was 0.456 with no enrichment, 0.536 with enrichment appended to the record, and 0.537 with the dual index; the average number of relevant records in the top 15 was 4.3, 5.5, and 5.2. The dual index avoids the drop in single-target ranks that appending causes (target in the top 15: 52 none, 47 appended, 49 dual) but is not better on graded relevance, and it needs about 39,000 more vectors on the Pi 5 and five times the overnight embedding. Not adopted. Dropping the 30% of generated queries least similar to their own record (Doc2Query--) did not help (nDCG@10 0.476).

Decision (owner, 2026-10-02): turn enrichment off. The gain is too small to notice in answered questions, and the simpler path is faster and leaves the night for other work.

Change: the retrieval worker attaches the stored enrichment only while `HERMES_RETRIEVAL_ENRICHMENT_ENABLED=true`. Before, it attached the store whenever the file existed, so the flag stopped only the overnight runner. The release for this change passes `HERMES_RETRIEVAL_ENRICHMENT_ENABLED=false`. The store file stays on the Pi 5, and `true` restores the previous behaviour.

After the release, record text no longer includes enrichment, so every dense vector is recomputed in the next bulk window. Until a record is recomputed its previous vector is used.

### 2026-10-03: a second grader (DGX business LLM) and consensus labels (measurement basis)

Trigger: the production judge and the graded labels were both JEV, which research on LLM relevance judgments calls circular and lenient.

Method: the DGX business LLM (Qwen3.8 Flash-Next) graded question-record pairs with the same 0 to 3 rubric, called once per pair from the Pi 5 API container through the consultation egress, the route the enrichment runner uses. The owner ran the prepared commands; nothing was written in the container. First 419 pairs (the 99 gold targets plus 80 pairs for each JEV grade), then every remaining pair JEV graded 3 (1,544 pairs).

Agreement on 419 pairs: exact 71%, within one grade 94%, Cohen's kappa 0.78 on "grade 3". Gold targets got 3 from Qwen in 85 of 99 and 2 in 11. Qwen is stricter: of 1,715 pairs JEV graded 3, Qwen gave 3 to 1,003 (58%), 2 to 406, and 1 or 0 to 306. A blind reading by the implementing agent of 150 disputed development pairs (118 after removing questions with no content condition) sided with Qwen on grade 3 in 67% of them; where Qwen gave 2, the reading gave 3 in 44%. The true relevant share of JEV's grade 3 is therefore about 70%, between the two labels.

Consensus labels (both graders give 3) on the same-day runs of 2026-10-02, 86 answer cases:

| Run | A relevant record shown (JEV only, consensus) | Nothing shown | Consensus share of shown records |
| --- | --- | --- | --- |
| 15 candidates, enrichment (production before #1642) | 70, 63 | 11 | 71% |
| 30 candidates, no enrichment | 72, 65 | 10 | 70% |
| 30 candidates, enrichment (production after #1642) | 73, 68 | 8 | 72% |

Paired comparisons on consensus labels (cases gained / lost, two-sided sign test): 15 to 30 candidates with enrichment 5 / 0 (p = 0.06); enrichment on at 30 candidates 3 / 0 (p = 0.25); the planned "30, enrichment off" against production 4 / 2 (p = 0.69). No difference is significant with 86 cases. Enrichment was kept on: it lost nothing against production, and turning it off gave up three cases.

Questions that name only a department or a period have no content condition; relevance grading does not apply to them and they produced many grader disagreements. They are to be scored on filters.

Next: `hermes-synthetic-question-flywheel-execplan.md`, which builds a larger, realistic test set from the records every night so that differences of this size can be tested.

### 2026-10-04: first synthetic night set and the acceptance gate's first use (measurement basis)

The flywheel's first night on the Pi 5 (2026-10-03, 22:05 to 22:28) tried 100 contrastive pairs, produced 80 valid questions, and kept 78 (both graders gave the anchor grade 3): terse 50, colloquial 14, typo 8, kana 6; median length 17 characters. Twenty were dropped as copies of the record text, which hit the colloquial and kana styles hardest (keep rates 64% and 40% against 94% for terse); the graders were not the reason. Questions that the seed asked to write in kana came out as ordinary Japanese, so the kana style is not yet exercised.

The 78 questions were split 70/30 by a hash of the anchor id (development 52, held-out 26) and answered on the Mac with the kiosk pipeline (`flywheel-run.mjs`, snapshot and stores copied from the Pi 5 on 2026-10-04, JEV through TypeSafe, embedding through a tunnel to the DGX) in two configurations. A question counts when the anchor, or the near miss when both graders also gave it grade 3, is shown.

| Configuration | Development: relevant shown / 52 | Held-out: relevant shown / 26 | Development loss stages |
| --- | --- | --- | --- |
| Production (hybrid, enrichment, judge 30) | 37 | 20 | other records shown 8, asked back 3, outside judged candidates 3, rejected by judge 1 |
| Dense off (lexical, enrichment, judge 30) | 37 | 18 | other records shown 6, outside judged candidates 6, asked back 2, rejected by judge 1 |

Paired: production against dense off gains 2 and loses 2 on development (p = 1.0) and gains 3 and loses 1 on held-out (p = 0.63). The gate (`flywheel-gate.mjs`) rejects both directions, because neither shows a development gain. This is the mechanics working, but the known-good change did not pass, so the acceptance criterion of Milestone 4 is not met yet.

Why: the synthetic questions share much wording with their anchor. The median share of a kept question's character bigrams found in the anchor body is 0.44 (terse 0.56, colloquial 0.32). Questions with a share of 0.5 or more were answered 30 of 36 times, those below 0.5 only 26 of 42. Lexical search alone finds most of them, so this set under-detects the gain from dense retrieval that the hand-written paraphrase sets showed on 2026-09-24 and 2026-10-02. The set must get harder before it can gate retrieval changes: more paraphrase pressure in the generator (reject questions whose bigram share with the anchor exceeds a bound, keep the styles that lower it), and real kiosk questions from the receipts mixed in with the same two-grader labels. About 0.6 s per question, so a full two-configuration comparison of a night takes under five minutes.

Also noted: the planner asked back on 3 development questions in one run and 2 in the other, with the same questions and the same planner; JEV answers vary between runs, which adds noise of about one question per 50 to any paired comparison.

Private files: `runs/flywheel/*-20261004.json` and `.log` (ids and stages, no record text), `work/flywheel/questions-2026-10-03.jsonl`, `snapshots/nonconformity-snapshot-pi5-20261004.json`, `stores/dense-pi5-20261004.bin`, `stores/enrichment-pi5-20261004.jsonl`.

### 2026-10-04: candidate recall of PostgreSQL pg_trgm against the in-process bigram BM25 (measurement basis, migration held)

Trigger: the cross-source foundation plan (`hermes-cross-source-foundation-execplan.md`, Milestone 2) proposed moving the lexical index out of the 384 MB worker into PostgreSQL. Before designing that, the first-stage candidate recall of `pg_trgm` had to be shown equal to the current character-bigram BM25.

Method: `scripts/hermes-search/retrieval/prototypes/pg-trgm-recall.mjs` (Codex gpt-6.1-sol wrote it; Claude ran and reviewed). Questions: stage-v1 (50) and stage-aspect-v1 (17), question text as the query, no planner, no filters, no enrichment, no JEV. Records: the 2026-10-04 Pi 5 snapshot, 8,209 nonconformities, body fields only. PostgreSQL 15 (`pgvector/pgvector:pg15`, pg_trgm 1.6) in a throwaway container on the Mac, `ORDER BY similarity(body, $1)` and `word_similarity` with LIMIT 200 and a GIN `gin_trgm_ops` index. Relevant = grade 3 in `labels/graded-v1.json`; unlabeled candidates are counted separately, not as hits or misses.

| Method | relevant in top 30 / 67 | relevant in top 200 / 67 | unlabeled in top 200 (sum) | p50 ms | p95 ms |
| --- | --- | --- | --- | --- | --- |
| current bigram BM25 | 42 (62.7%) | 50 (74.6%) | 10,958 | 43.5 | 53.2 |
| pg_trgm similarity | 44 (65.7%) | 53 (79.1%) | 11,770 | 96.2 | 105.3 |
| pg_trgm word_similarity | 47 (70.1%) | 51 (76.1%) | 11,898 | 106.0 | 123.1 |

Paired against BM25 at top 30: word_similarity gains 10 and loses 5; similarity at top 200 gains 4 and loses 1. Seven questions have no grade-3 record in the labels and cannot be judged by this comparison. 82 to 89 percent of the top-200 candidates are unlabeled, so neither recall nor equivalence is established; the labels only cover records that earlier configurations put in their top 30.

Latency: both PostgreSQL orderings ran as a sequential scan with sort (`Aggregate > Limit > Sort > Seq Scan`); the GIN index is not used by an unthresholded `ORDER BY similarity`, as the PostgreSQL 15 documentation states. p95 was 2.0 to 2.3 times the in-process BM25.

Decision: the pg_trgm replacement is held. Recall is not worse, possibly slightly better, but it is not shown equal on labeled data, and it is slower without an index path. Milestone 2 is re-planned so that candidate generation stays in process and the memory problem is solved by not holding record bodies in the worker (bodies fetched by id from the API after ranking) and by per-source loading. Re-measurement is only worth doing after the shown-but-unlabeled candidates are graded (the flywheel plan's pooled top-30 labelling).

Private files: `/tmp/hermes-pg-trgm-recall-20261004.json` on the Mac at run time (per-question hits, unlabeled counts, timings, plan shapes; no record text). Rerun: `scripts/hermes-search/retrieval/prototypes/README.md`.

### 2026-10-05: second night, the gate with labels for shown records, and a stricter rule (measurement basis; gate accepted)

Second night (2026-10-04, with #1673 and #1677): 100 pairs, 76 valid questions, 64 kept, median anchor overlap 0.36 (first night 0.44). Dropped: 20 copies, 12 anchors the graders did not confirm, 4 still too similar after the retry. The night's live scoring is not usable as a day measurement: 48 of 64 live runs fell back to lexical because the query embedding timed out while the business LLM generated questions on the same DGX (#1690 moves scoring after generation).

Offline, on the Mac, the 64 questions were answered in both configurations (development 47, held-out 17). Counting only the anchor and the confirmed near miss as relevant, dense on and off were level again (development 27 and 28, held-out 9 and 8), and the gate's old rule accepted dense off with 3 gained and 2 lost on development.

Then the shown records outside each question's known relevant set were graded with JEV (`flywheel-shown-labels.mjs`, same rubric as the pooled labels; 495 pairs over both nights, grade 3 for 414, grade 2 for 78). With these labels:

| Set | Configuration | Development: relevant shown | Held-out: relevant shown | Paired (dense on against dense off) |
| --- | --- | --- | --- | --- |
| 2026-10-04 (64) | dense off | 36 / 47 | 14 / 17 | development gained 3, lost 0 (p = 0.25); held-out gained 1, lost 0 |
| 2026-10-04 (64) | dense on (production) | 39 / 47 | 15 / 17 | gate: accept |
| 2026-10-03 (78) | dense off | 43 / 52 | 24 / 26 | development gained 3, lost 1 (p = 0.63); held-out 0 and 0 |
| 2026-10-03 (78) | dense on (production) | 45 / 52 | 24 / 26 | gate: reject, net gain 2 below 3 |

The known-good change passes the gate on the harder set and the known-bad change (the reverse) is rejected, so the Milestone 4 criterion is met there. The 2026-10-03 set points the same way but below the margin. Most "other records shown" were relevant: production shows a relevant record for 39 of 47 development questions, not 27.

Rule change: accept only a development net gain of at least 3 with no held-out net loss. The sign test is printed but not required; at 50 to 80 questions it cannot reach significance for real gains of this size.

Caveats: the shown-record labels come from JEV alone (the production judge is also JEV), so the second grader is still to be added for these; the planner varies by about one question per 50 between runs. Private files: `labels/flywheel-shown-v1.json`, `runs/flywheel/n1004-*.json`, `work/flywheel/questions-2026-10-04.jsonl`.

### 2026-10-06: third night, the second grader in production, and a real failure explained (measurement basis)

Third night (2026-10-05, with #1690 and #1677): 100 pairs, 67 valid, 60 kept, median anchor overlap 0.36, 21 retries. Live scoring still fell back to lexical on 47 of 60 (the two-phase runner did not help): measured at 22:37, the embedding on the DGX takes 0.03 s but the Pi 5 to DGX request 1.7 to 4.3 s while `dgx-control-backup.timer` uploads from 21:30; #1716 gives the night scorer a 10 s budget from the next night.

The second grader (#1717) ran for the first time at 23:25 after the release: 52 shown records outside the relevant sets graded by the DGX business LLM and JEV, 38 relevant by both. The night's relevant shown rose from 36 to 47 of 60 (78%); the remaining losses were outside judged candidates 7, asked back 4, rejected by judge 1, other record 1.

A real kiosk exchange the same evening (22:44, two turns about 切粉) returned nothing twice. Receipts show the dense query timed out at the day budget and the lexical top 30 held none of the 36 records mentioning 切粉, because the whole question (両工場, ２件, 起因) is the lexical query. Offline with dense on, both turns show two relevant records. The failure is the backup congestion plus a weak lexical fallback, not the judge.

Private files: `work/flywheel/questions-2026-10-05.jsonl`, `work/flywheel/labels-pi5.json`.

### 2026-10-06: two candidate changes rejected by the gate (lexical query from the content span; enrichment in the lexical corpus)

Both were answered offline on the Mac with the night scorer (dense on through the tunnel, enrichment store of 2026-10-04, judge 30) on the 2026-10-04 (64) and 2026-10-05 (60) synthetic sets, with the shown-record labels, against the production configuration.

| Candidate | 2026-10-04 development / held-out | 2026-10-05 development / held-out | Gate |
| --- | --- | --- | --- |
| Lexical and dense query = planner's content span without count expressions | 39 to 36 (0 gained, 3 lost) / 15 to 15 | 30 to 27 (0, 3) / 18 to 17 (0, 1) | reject |
| Lexical corpus rebuilt from enriched records (enrichment queries, tags and summary in BM25) | 39 to 37 (0, 2) / 15 to 13 (0, 2) | 30 to 27 (0, 3) / 18 to 17 (0, 1) | reject |

The first was the proposed remedy for the 切粉 failure of 2026-10-05 (the whole question as the lexical query buried 切粉 under 両工場 and ２件); it fixes that case but loses three development questions on each night, so the remedy stays with moving the DGX backup and keeping dense retrieval available.

The second came from a code reading during Milestone 7: `applyEnrichment` in `worker.mjs` attaches the enrichment to the records but keeps the lexical passages prepared before, so in production the enrichment reaches the dense index and the judge, not the BM25 ranking. The offline harness (`evaluate.mjs`) attaches the enrichment before preparing the corpus, so the 2026-10-02 enrichment measurements included a lexical effect that production never had. Putting the enrichment text into BM25 loses questions on both nights; the summaries and tags dilute the record's own terms. Production stays as it is, now on purpose. Consequence for Milestone 7: learned queries must reach the lexical ranking on their own, as a short list per record, not through the enrichment text.

### 2026-10-07: fourth night, the first with every loop stage and the backup moved (measurement basis)

Night of 2026-10-06 (22:05 to 22:33), the first with the second grader, the real questions, the learned queries (#1717, #1720, #1721) and the DGX backup moved to 00:00 (Control Plane #353):

- Synthetic: 100 pairs, 77 valid, 73 kept, median anchor overlap 0.35. Dense retrieval answered 72 of 73 live runs (one clarification); on the two nights before, 47 of 60 had fallen back to lexical. Production showed a relevant record for 65 of 73 (89%; 12 of them known only through the second grader's labels), other records for 4, nothing for 4 (outside judged candidates 2, rejected by judge 1, asked back 1). Harder questions (overlap below 0.35) were answered 32 of 36 times, easier ones 33 of 37, so the dense path has closed the gap seen on 2026-10-05.
- Real: 8 kiosk questions from the receipts of 2026-10-05 and 10-06. Five are content questions and got consensus-relevant records (2 to 5 each); production showed a relevant record for all five at night, including the two 切粉 questions that returned nothing on 2026-10-05 22:44 under the backup congestion. The other three name only a department or a period (「仙台工場FA組立課の不適合２件」, 「最近の不適合を２件」), have no content condition, and stay unscored; they are the filter-only cases still to be scored on filters.
- Learned queries: 14 candidates from development failures of the last three nights were checked on 41 held-out questions (0 gained, 0 lost; no real held-out rows existed yet at that moment) and activated. Their effect can only show on later nights' development questions and real questions; the morning report lists them.

Caveats: the learn phase ran at 22:08 to 22:11 while generation was still writing until 22:22, which points to two runner processes during the evening API swap; the files are consistent, but the runner should hold a lock. Live scoring took a median 2.6 s per question at night against 0.6 s on the Mac by day.

Private files: `work/flywheel/questions-2026-10-06.jsonl`, `real-2026-10-06.jsonl`, `learned-queries.jsonl`, `labels.json`.

### 2026-10-07: EmbeddingGemma 2 as the dense model (no change)

Trigger: Google released EmbeddingGemma 2 (`google/embeddinggemma-2`, Apache 2.0, 768 dimensions with Matryoshka truncation, 8,192-token context, text, image, audio and video in one space; the card reports MTEB multilingual 61.36 and no Japanese score).

Method: offline on the owner's Mac, no production change, the same arrangement as the first-stage comparison of 2026-10-02: 73 content questions, 7,864 records, whole corpus, the question as the query, character-bigram BM25, RRF with k=60, the stored Qwen3 ranks and the 2026-10-02 ruri-v3-310m lists. EmbeddingGemma 2 ran text-only with sentence-transformers 6.1.0, documents with the `Document` prompt and no truncation (records are a median of 97 tokens), questions with the `SearchQuery` prompt and, as a second arm, the `QuestionAnswering` prompt. The recomputed current arm matched the 2026-10-02 lists on all 73 questions.

| Arm | Gold target in the top 15 / 30 / 50 (73) | Grade-3 record in the top 15 / 30 (73) | Held-out paraphrase (24), top 15 / 30 |
| --- | --- | --- | --- |
| Qwen3 only | 36 / 49 / 53 | 59 / 63 | 20 / 22 |
| ruri-v3-310m only | 39 / 42 / 51 | 62 / 65 | 21 / 21 |
| EmbeddingGemma 2 only, SearchQuery | 27 / 32 / 40 | 55 / 61 | 18 / 22 |
| EmbeddingGemma 2 only, QuestionAnswering | 35 / 41 / 48 | 59 / 63 | 21 / 21 |
| bigram + Qwen3 (current) | 48 / 53 / 57 | 65 / 68 | 22 / 23 |
| bigram + EmbeddingGemma 2, SearchQuery | 44 / 54 / 57 | 67 / 68 | 22 / 23 |
| bigram + EmbeddingGemma 2, QuestionAnswering | 48 / 58 / 58 | 68 / 69 | 22 / 23 |
| bigram + EmbeddingGemma 2 at 512 / 256 dimensions, SearchQuery | 43 / 52 / 57 and 42 / 49 / 56 | 67 / 68 and 67 / 67 | 22 / 23 and 22 / 22 |

On its own the model is behind Qwen3 on the gold targets with either prompt. Fused with bigrams the best arm (QuestionAnswering) gains 5 targets at rank 30 and 3 questions with a grade-3 record in the top 15; the SearchQuery arm loses 4 targets at rank 15. Paired on a grade-3 record in the top 15, the SearchQuery fusion gains 4 questions and loses 2 against the current pair. These are the size of the differences that the ruri-v3-310m swap showed and that were read as noise. The prompt was chosen after seeing both results, which favours the better arm.

nDCG@10 is not comparable for the new arms: the graded labels were pooled from the earlier arms, and 48% (SearchQuery) or 39% (QuestionAnswering) of the model's own top 10 are unjudged and count as zero; in the fusions 9% are unjudged (0.455 and 0.461 against 0.472 for the current pair, a lower bound).

Cost on the Mac (MPS): 296 s for the 7,864 records, 9 ms per question. On the DGX the model would need a new service, because the card lists only sentence-transformers and transformers and the present embedding service is a llama-server; every stored vector would be recomputed.

Decision: no swap of the DGX embedding model. Three embedding models now land within a few questions of each other on these records, so the first-stage model is not where the remaining losses are. The multimodal side of the model (image and text in one space) is a separate question for the photo-loan similarity gallery, which still uses CLIP ViT-B/32, and is not measured here.

Private files: `work/eg2/text-bench.py`, `work/eg2/lists-eg2.json`, `work/eg2/summary-eg2.json`, `work/eg2/eg2-docs.npy`, `models/embeddinggemma-2`.
### 2026-10-08: fifth night, the first with the runner lock and filter scoring (measurement basis)

Night of 2026-10-07 (22:00 to 22:25, learn decision 22:33), the first after the runner lock, the deterministic filter scoring of department and period questions, and the ten-second wait for the dense index (#1748 and the 2026-10-07 changes):

- Synthetic: 100 pairs, 67 valid, 56 kept, median anchor overlap 0.33 (the hardest set so far). Dropped: 20 copies of the record text, 11 anchors not confirmed by the graders, 6 `http_503` from the business LLM in the first three minutes (22:00:58 to 22:03:07, while the DGX model was still loading), 4 copied words, 2 too similar, 1 busy-guard trip at 22:15. Dense retrieval was available on 54 of 56 live runs (one `failed`, one unrecorded status), so the night fell back to lexical once. Production showed a relevant record for 53 of 56 (95%; 12 of them known only through the second grader's labels), other records for 0, nothing for 3: two targets outside the judged candidates (「M10 誤手配 不適合」, 「ロボット 架台 銘板取付穴 欠落 不適合」) and one asked back (the 軸の窓 drawing question, overlap 0.28). Live scoring took a median 2.3 s per question.
- Real: 3 kiosk questions from the receipts of 2026-10-07, all filter-only (one department and a count, one department, one department with two records). All three were scored on their filters for the first time and passed: filters, recent order and count correct, 123 and 201 matching records behind the one and two shown. No content question arrived that day, so the real content rule did not fire.
- Learned queries: 1 candidate from the night's development failures (「ロボット 架台 銘板取付穴 欠落 不適合」) was checked on 62 held-out and 1 real row and rejected (held-out 0 gained, 1 lost). The 14 queries activated on 2026-10-06 stay active; their effect on this night cannot be separated from the harder set without the offline comparison planned for a later morning.

Caveats: the API container was replaced by the morning release at 09:55, so the night's API log (and with it the `already_running` check of the new lock) is gone; the files show one runner only (generation 22:00 to 22:25, learn decision at 22:33, no overlap as on 2026-10-06). The status file reports `outside_window` for the day, as designed. The 95% on 56 questions and the 89% on 73 the night before are within a few questions of each other and should not be read as a gain; the set was smaller and harder.

Private files: `work/flywheel/questions-2026-10-07.jsonl`, `real-2026-10-07.jsonl`, `learned-queries.jsonl`, `labels.json`, `flywheel-status.json`.
