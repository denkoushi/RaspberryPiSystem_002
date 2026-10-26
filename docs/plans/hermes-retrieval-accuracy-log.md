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

Since 2026-10-21 each case in an `evaluate.mjs` run also has `volume`: JEV calls (plan and relevance separately), the characters sent to and received from JEV (`JSON.stringify` length of the request and the reply, so prompts plus framing), and `answerChars`/`answerRecords` for the answer text a user would get, built with the worker's own formatting. The summary gives mean, p50 and p95 of each, and `stage-score.mjs` adds the p50 columns `jevIn` and `ans` (`-` for older runs). Read them next to latency: a change that keeps precision but sends more to JEV is slower and costs more.

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

### 2026-10-09: sixth night, a drop explained by the planner and judge service, not by retrieval (measurement basis)

Night of 2026-10-08 (22:02 to 22:16, labels 22:19, learn decision 22:21), the first after the rank-only request and the procedure material source (#1846) and the structured cards (#1858) reached the worker. Neither change touched the planner, the judge, the dense path or the flywheel files.

- Synthetic: 114 pairs tried, 82 valid, 69 kept, median anchor overlap 0.38. Dropped: 21 copies, 10 anchors not confirmed, 6 copied words, 3 ungraded, 3 too similar, 2 `http_429` (rate limited). Dense retrieval was available on 64 of 69 (5 unrecorded). Production showed a relevant record for 50 of 69 (72%; 11 known only through the second grader), other records for 8 (all graded not relevant by both graders), nothing for 10, and one run failed outright. The 10 break down as: 3 `unavailable` (the relevance judge returned an error or timed out; this outcome exists only on that path, `executor.mjs` `unavailableResult`), 4 clarifications whose plan has an empty semantic query with a content span (the planner's shape when JEV left a term unresolved), 2 targets outside the judged candidates, 1 rejected by the judge. Live scoring took a median 1.2 s, the fastest night so far.
- The three new outcome kinds (`unavailable`, `failed`, clarification with an unresolved term) had not appeared on 2026-10-05 to 10-07 apart from one clarification each night. Together with the two `http_429` drops in generation they point to the JEV planner and judge service answering slowly or with errors for part of the 14-minute window, not to retrieval: the two targets outside the candidates and the one judge rejection are in line with earlier nights.
- Real: 4 kiosk questions of 2026-10-08. Three content questions got consensus-relevant records (1, 2 and 2) and production showed a relevant record for all three. The fourth (「川上さんの最近の訓練結果」) asks for training results, which is a different source, and was answered out of scope by day and at night; it has no relevant records and does not count.
- Learned queries: no candidate (the two `not_in_pool` failures were not repeated across nights). 15 active after the 2026-10-08 decision, 1 rejected.

Caveats: the API container was replaced by the 23:32 release of #1879, so the night's API log is gone for the second night running; the flywheel's live scoring writes no receipts, so the judge errors behind `unavailable` cannot be read back. If the API log is wanted after a release night, the runner should write its own per-night log file. Not a measured change in retrieval; nothing accepted or rejected.

Private files: `work/flywheel/questions-2026-10-08.jsonl`, `real-2026-10-08.jsonl`, `learned-queries.jsonl`, `labels.json`.

### 2026-10-10: seventh night, back to 93% with the judge service answering normally (measurement basis)

Night of 2026-10-09 (22:03 to 22:18, learn decision in the same run), the first after #1889 (judge failure reasons recorded, one retry on 429/5xx/timeout, a per-night runner log). The retry path had nothing to retry: no `unavailable` or `failed` outcome, no batch needed a second attempt, and `reason` is null on all 54 live rows.

- Synthetic: 100 pairs tried, 64 valid, 54 kept, median anchor overlap 0.33. Dropped: 30 copies, 10 anchors not confirmed, 3 too similar, 2 copied words, 1 `dgx_busy` (two short pauses at 22:04 and 22:09). Dense retrieval was available on 54 of 54. Production showed a relevant record for 50 of 54 (93%; 12 known only through the second grader), other records for 3 (all graded not relevant by both graders), nothing for 1 (target outside the judged candidates). Live scoring took a median 1.2 s, max 1.8 s.
- Against the sixth night (72%), the whole gap was the JEV planner and judge path: no judge error, no clarification with an unresolved term, no failed run. Retrieval-stage losses (1 outside candidates, 3 other records shown) are in line with 2026-10-05 to 10-08.
- Real: 1 kiosk question of 2026-10-09, a filter question (department and period). Day and night both answered with the same record; the filter check passed.
- Learned queries: no candidate. 15 active, 1 rejected.

Caveats: the first night with the runner's own log file, so the API-container log no longer matters for this check. The runner writes one status line every 5 minutes while idle (about 350 lines a night); the log should only record state changes. Not a measured change in retrieval; nothing accepted or rejected.

Private files: `work/flywheel/questions-2026-10-09.jsonl`, `real-2026-10-09.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-09.log`.

### 2026-10-10: learned queries on versus off, offline over three nights (kept, no change)

Question: the 15 active learned queries (phrasings proposed from development failures and activated when the held-out and real checks showed no loss, see 2026-10-07) have been on in production since 2026-10-07. Do they still earn their place? Offline run of the kiosk pipeline (`flywheel-run.mjs`, snapshot and dense store of 2026-10-04, enrichment store on, pool 30, JEV through TypeSafe, embeddings through the DGX tunnel) over the kept synthetic questions of the nights of 2026-10-07, 10-08 and 10-09 (179 questions: 134 development, 45 held-out), once with `--learned off` and once with the active rows, then `flywheel-gate.mjs` with the consensus labels.

| Split | n | relevant shown, off | relevant shown, on | gained | lost | p |
| --- | --- | --- | --- | --- | --- | --- |
| development | 134 | 115 | 117 | 3 | 1 | 0.625 |
| held-out | 45 | 36 | 36 | 0 | 0 | 1.000 |

Reading: a small positive effect on development questions and none on held-out, so the learned queries neither help nor harm in a measurable way. As a new change the gate would reject it (development net gain 2 is below the threshold of 3), but the criterion for keeping something already on is no loss on held-out and real questions, and that holds. Decision: keep the 15 active rows and the nightly proposal path; measure again after more nights with questions that postdate the last activation. The absolute rates here (66% offline) are not comparable with the nightly report's rates, because the offline run counts only consensus-labelled records and uses the 2026-10-04 snapshot.

Private files: `runs/flywheel/n1007-09-all-hybrid-learned-{off,on}-20261010.json` and `.log`, `work/flywheel/learned-queries.jsonl`.

### 2026-10-10: pg_trgm candidate recall on the flywheel questions with consensus labels (rejected)

Follow-up to 2026-10-04, where the pg_trgm replacement of the in-process bigram BM25 was held because most candidates were unlabelled. The prototype (`prototypes/pg-trgm-recall.mjs`) now reads the nightly question files and the consensus labels (`--questions`, labels schema `hermes-flywheel-labels/v1`; the anchor record counts as relevant with the grade-3 pooled records). Same snapshot (2026-10-04, 8,209 records), same queries (question text only), PostgreSQL 15 with pg_trgm 1.6 in a throwaway container on the Mac.

| Method | top30 (179) | top200 (179) | dev top30 (134) | held-out top30 (45) | p50 ms | p95 ms |
| --- | --- | --- | --- | --- | ---: | ---: |
| bigram BM25 (current) | 139 (77.7%) | 170 (95.0%) | 104 | 35 | 44 | 58 |
| pg_trgm similarity | 83 (46.4%) | 140 (78.2%) | 63 | 20 | 99 | 113 |
| pg_trgm word_similarity | 82 (45.8%) | 132 (73.7%) | 58 | 24 | 115 | 137 |

Paired against BM25 at top30: similarity gained 13 questions and lost 69; word_similarity gained 6 and lost 63. Both plans stay `Seq Scan` (the GIN index is not used by a full `ORDER BY`), as on 2026-10-04.

Reading: on the hand-written questions of 2026-10-04 the three methods were within a few questions of each other; on the synthetic questions pg_trgm loses by about 30 points. The generator rejects questions that copy the record (no 8-character run, bigram share at most 0.5), so character-trigram set similarity has little to match, while the IDF-weighted bigram BM25 still finds the rare terms. Real kiosk questions are short and paraphrased in the same way. Decision: pg_trgm as the first-stage candidate source is rejected; the cross-source plan keeps candidate generation in process. Private files: `runs/pg-trgm-recall-flywheel-20261010.json`; draft `prototypes/pg-trgm-recall-20261010.md`.

### 2026-10-11: eighth night, 79% with five ask-backs, and the first ten synthetic filter questions (measurement basis)

Night of 2026-10-10 (22:04 to 22:18), the first with #1920 (synthetic filter questions) and the first full night with #1918 (readiness probe, quiet idle log). The Pi5 release of #1920 finished at 22:00:19, and the runner used the new code from its first pass.

- Synthetic content: 100 pairs tried, 71 generated, 66 kept (median 16 chars, anchor overlap 0.33). Dropped: 25 copied runs, 4 anchors not confirmed, 3 copied words, 1 ungraded, 1 too similar; one `dgx_busy` pause at 22:04. Production showed a relevant record for 52 of 66 (79%; 14 known only through the second grader), other records for 5, nothing for 9: 3 outside the judged candidates, 1 rejected by the judge, 5 ask-backs. All five ask-backs came back in about 0.3 s with no filter and no content query, spread over the night (22:09 to 22:14), four of them terse questions ending in 「不適合」 (「設計漏れ ターミナル 穴あけ 不適合」, 「変更部 継手 数え漏れ 不適合」, 「モータ取付面 ス 発生」, 「外注側 付帯部材 発注忘 不適合」) and one colloquial. The live row does not record which term the planner could not resolve, so the cause (value linking that asked for a choice, or an unanswered planner question) is open; the seventh night had none. Without the ask-backs the rate is 52 of 61 (85%), still below the seventh night's 93%.
- Synthetic filter: 10 questions (3 `count5`/`count3`, 4 `last_month`, 1 `short`, 1 `colloquial`), 7 ok, 1 mismatch, 2 unsupported, no ask-back, no failure.
  - Mismatch 「三島工場管理部生産管理課(製造) 最近 不適合」: the planner kept a content query although nothing but the department and generic words remained, so the executor ran the relevance judge, which dropped the fifth-newest record and showed the sixth. Filters and count were right.
  - Unsupported 「…の先月の不適合」 ×2: same cause, the planner kept the question as a content query with relevance sort, while the other two `last_month` questions were planned as filter-only with the date sort. Both answers were in fact right (no record of September 2026 for those departments), but the checker cannot confirm a relevance-sorted plan.
- Real: no kiosk question on 2026-10-10.
- Learned queries: 3 proposals from the three `not_in_pool` losses, activated (held-out and real checks had nothing to lose); 18 active, 1 rejected.
- Runner log: `outside_window` passes are quiet since #1918 (1 line after the night), but `budget_reached` passes still wrote 92 identical lines, because the quiet rule counts the night's totals rebuilt from the files as work done.

Follow-ups in the same PR as this entry: a deterministic planner guard that turns a question into filter-only when only resolved filter values and generic words remain, the checker accepting a filter-only plan with relevance sort (the executor orders it by date), and the quiet rule comparing the final line with the previous one. Not a measured change in retrieval; the planner guard is measured on the next nights' filter questions.

Private files: `work/flywheel/questions-2026-10-10.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-10.log`.

### 2026-10-12: ninth night, 86% with one ask-back, synthetic filter questions 10 of 10 (measurement basis)

Night of 2026-10-11 (22:02 to 22:13), the first with #1922 (planner residual guard, relevance-sort filter check, quiet repeated runner lines; Pi5 release at 06:37 that morning).

- Synthetic content: 100 pairs tried, 77 generated, 65 kept (median 17 chars, anchor overlap 0.33). Dropped: 18 copied runs, 12 anchors not confirmed, 4 copied words, 1 too similar. The business LLM answered 503 at 22:02 (`dgx_not_ready`), so generation started at 22:12. Production showed a relevant record for 56 of 65 (86%; 13 known only through the second grader), other records for 5, nothing for 4: 2 outside the judged candidates, 1 rejected by the judge, 1 ask-back. The eighth night's five ask-backs did not repeat (one this night), so they were not a lasting regression; the cause stays open until the live row records the unresolved term.
- Synthetic filter: 10 questions, 10 ok, no mismatch, no unsupported, no ask-back, no failure (eighth night 7 ok, 1 mismatch, 2 unsupported). The planner guard did not fire (`residualOverride` absent in all rows): the LLM planned all ten as filter-only itself, so the guard is still unmeasured on a case it would change.
- Real: no kiosk question on 2026-10-11.
- Learned queries: no new proposal; 20 active, 1 rejected.
- Runner log: 5 final lines for the night instead of the eighth night's 367 (2 `budget_reached`, the rest `outside_window` and `dgx_not_ready`); the quiet rule works.

No change to retrieval. Private files: `work/flywheel/questions-2026-10-11.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-11.log`.

### 2026-10-13: tenth night, 76% with four ask-backs now explained, and a placeholder department in the filter questions (measurement basis)

Night of 2026-10-12 (22:07 to 22:22), the first with #1930 (unresolved terms recorded on ask-backs; Pi5 release at 08:43 that morning).

- Synthetic content: 100 pairs tried, 69 generated, 62 kept (median 17 chars, anchor overlap 0.33). Dropped: 21 copied runs, 7 anchors not confirmed, 6 copied words, 4 too similar. One `dgx_not_ready` pass at 22:02. Production showed a relevant record for 47 of 62 (76%; 12 known only through the second grader), other records for 5, nothing for 10: 3 outside the judged candidates, 3 rejected by the judge, 4 ask-backs.
- Ask-backs, now with the unresolved term in the row: 3 on `originDepartmentName` (「設計課 干渉見落とし 原因」, 「設計課が図面書き写す時、継手の型番を修正し忘れて…」, 「マニホールド 設計ミス 穴 過剰」) and 1 on `partName` (「台乗せ落下 傷 作り直し」). The entity linker matched 「設計課」 and 「設計」 to several department values and 「台」 to several part names, and the planner asked for a choice instead of searching. This is the same mechanism as the eighth night's five ask-backs (four of them terse questions with a department-like word). A content question that names a department which exists in several factories should search with the content rather than ask; that is the next change to measure.
- Synthetic filter: 10 questions, 9 ok, 1 mismatch: 「門 最近 不適合」, the `short` template applied to the placeholder value 「*未設定部門」 (short form 「門」). Not a retrieval failure; the generator now skips placeholder values and one-character short forms (this PR).
- Real: no kiosk question on 2026-10-12.
- Learned queries: 3 activated (held-out 1/1, real none); 23 active, 1 rejected.
- Runner log: 5 final lines.

No change to retrieval. Private files: `work/flywheel/questions-2026-10-12.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-12.log`.

### 2026-10-14: eleventh night, 86% with four ask-backs of the same kind; ambiguous linked terms now give way to the content search (change)

Night of 2026-10-13 (22:0x to 22:18), the first with #1958 (placeholder department values skipped in the filter questions; Pi5 release at 09:08 that morning).

- Synthetic content: 100 pairs tried, 70 generated, 63 kept (median 19 chars, anchor overlap 0.33). Dropped: 19 copied runs, 7 anchors not confirmed, 6 too similar, 5 copied words. Production showed a relevant record for 54 of 63 (86%; 11 known only through the second grader), other records for 0, nothing for 9: 4 outside the judged candidates, 1 rejected by the judge, 4 ask-backs.
- Ask-backs: 3 on `partName` (「Y軸LMガイドの傷、組立時の違和感から発見した類似事例ありますか？」, 「キーブラケットの穴がなかったやつって前にもあった？」, 「ベース面 厚み 削り過ぎ 不適合」) and 1 on `machineName` (「ヘリサート 奥行き 誤り 不適合」). Same mechanism as the eighth and tenth nights (13 ask-backs over three nights): a word in a content question links to several enumerated values and the planner asks for a choice. Three of the four carried a content span; the fourth (「キーブラケットの穴が…」) had no content decision recorded, so it would still ask back under the change below.
- Synthetic filter: 10 questions, 10 ok (no placeholder values after #1958).
- Real: one kiosk question on 2026-10-13, 「タグをかざしても反応しない」, no result. It is about the kiosk tag reader, not a nonconformity record; the judge rejecting every candidate is the right outcome.
- Learned queries: 1 activated (held-out 1/1); 24 active, 1 rejected.
- Runner log: 5 final lines.

Change in this PR (planner): when the content decision is true and a linked field (department, part, machine) has an ambiguous value (entity-link `clarify`, or the planner's `clarify` / `low` answer), the planner no longer puts the field into `unresolved`. It drops that filter, keeps the whole question as the content query, and records the field and its candidates in `diagnostics.ambiguousDropped`; the worker's compact plan carries it and the morning report prints `ambiguous filter dropped for content search: partName n`. With the content decision false or missing, the field stays unresolved and the ask-back is unchanged, so pure filter questions still ask. Expected effect: the 3 of 4 ask-backs on this night and the 4 on the tenth night become content searches; whether they then show the relevant record is measured from the night of 2026-10-14 (Codex `gpt-6-astra` / `high` for the planner change and its three tests; Claude for the plan, report and log).

Private files: `work/flywheel/questions-2026-10-13.jsonl`, `real-2026-10-13.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-13.log`.

### 2026-10-15: twelfth night, 89% and no ask-back; a short department name no longer keeps a content search (change)

Night of 2026-10-14 (22:0x), the first with #1996 (ambiguous linked terms give way to the content search; Pi5 release the evening before).

- Synthetic content: 100 pairs tried, 61 generated, 56 kept (median 18 chars, anchor overlap 0.38). Dropped: 22 copied runs, 13 too similar, 4 copied words, 4 anchors not confirmed, 1 ungraded. Production showed a relevant record for 50 of 56 (89%; 9 known only through the second grader), other records for 1, nothing for 4 (all outside the judged candidates, none rejected by the judge), and 1 failed (TypeSafe API HTTP 400, one dense fallback).
- Ask-backs: 0, the first night without one. No row carried `ambiguousDropped`, so the change in #1996 was not exercised on this night; the four ask-back terms of the previous nights did not recur in the sample. Its effect is still to be measured.
- Synthetic filter: 10 questions, 9 ok, 1 mismatch: 「機構設計2課(製造) 最近 不適合」 (template `short`). The filter resolved to the right department and the sort was recent, but the planner kept the content search: the short name is not a listed term, so 「機構設計2課」 and 「製造」 survived as residual tokens, the content judge dropped two of the newest records, and two older ones filled the five. The same department asked with its full name (「…機構設計2課(製造)の不適合を3件」, one second later) went filter-only and matched. Every `short` question of the previous night was a department without 「部」, so this was the first real short form since #1958.
- Real: 0 questions; receipts of 2026-10-14 and 2026-10-15 empty, so no operation-inquiry route yet.
- Learned queries: 2 activated (held-out 1/0 each); 26 active, 1 rejected.
- Runner log: 178 lines, 6 final lines (completed, budget_reached, 2 dgx_busy, 2 outside_window).

Change in this PR (planner): a residual token that is contained in a selected filter value no longer counts as content. 「機構設計2課(製造) 最近 不適合」 now has an empty residual and becomes filter-only with the recent sort, like the full name; 「機構設計2課(製造)の錆の不適合」 keeps 「錆」 and stays a content search. Three tests in `planner-jev.test.mjs` (Claude directly; 344 tests pass). Measured on the next nights' `short` filter questions.

Private files: `work/flywheel/questions-2026-10-14.jsonl`, `real-2026-10-14.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-14.log`, `receipts-2026-10-14.jsonl`, `receipts-2026-10-15.jsonl`.

### 2026-10-15: JEV image reranking of the material shelf「✦ 意味で探す」, offline (held: promising, sample too small)

Scope: the procedure-material shelf search (`POST /api/assembly/procedure-materials/semantic-search`), not nonconformity Chat. The nonconformity gold sets have no image-centric target (all targets are text records), so the rerank was measured on the material shelf instead. Read-only copy of the 71 photo materials (photo, DGX image description, file name, text) from the Pi 5 into a temporary folder, deleted after the run; 16 calls to the production search for the current order.

Questions: 16 written by the agent from the photos (not by the user): 10 photo questions (grinding step photos, a 3D bolt screenshot), 4 text questions (pages of the sample procedure PDF), 2 with no matching material (「溶接ビードの外観検査」, 「塗装ブースのフィルター交換」). Two photo questions were dropped because their target was outside the queried state list (the service's placed/unplaced state is not `documentId IS NOT NULL`), leaving 8 photo, 4 text, 2 none. Rerank: each of the top 10 candidates sent as one JPEG (long side at most 1568 px, `TypeSafe-Danger-Zone-Images: true`) with the request, `jev-1.13.0`, choice `match`/`not_match`; sorted by P(match), ties by the current order.

| Set | n | current top1 | current top3 | JEV top1 | JEV top3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| photo | 8 | 4 | 7 | 8 | 8 |
| text (PDF pages) | 4 | 4 | 4 | 4 | 4 |

- Gains: targets at current rank 7, 3, 2 and 2 moved to rank 1. No question got worse.
- No matching material: the highest P(match) in the top 10 was 0.02 and 0.00, while every answerable question had a target at 0.66 or higher (median about 0.93). A floor around 0.5 would have shown 「近い素材が無い」 for both and kept every target. Non-targets reached 0.80 (txt06) and 0.64 (img10), so the floor hides the empty case but does not trim every unrelated item.
- Time: median 0.45 s per pair, about 4.5 s for 10 pairs in sequence; in parallel it is about the slowest pair (0.5 to 1.1 s), on top of the current search (about 1 s).
- Cost: 136 pairs, 554,472 input tokens (3,600 per photo pair, 5,000 per PDF page pair). At the rate seen in the T51 page-boundary run (about $0.0004 per 9,500 tokens) that is about $0.023 (about ¥3.5) for the run, about ¥0.25 per search of 10 candidates.
- Failure: one material (176 x 132 px) was refused with HTTP 400 「Invalid image dimensions」 in all 4 questions that had it as a candidate; none was a target. A production version must upscale small images or keep their current position.

Reading: on this small set JEV fixes every photo question that the current order missed at top1 and gives a clean signal for 「近い素材が無い」. The questions were written by the same agent that looked at the photos and the image descriptions, so they may be easier than real kiosk wording, and the none set is 2 questions. Decision: held, not adopted yet. Next: collect real 素材棚 queries (or have a second writer who has not seen the descriptions write 20 more), rerun with the same script, and then decide on a production change (parallel calls, a P floor for 「近い素材が無い」, a cache per query and material). Scripts and results were kept only in the session scratchpad; no private file kept.

### 2026-10-16: thirteenth night, 88% and no ask-back; the short department name went filter-only, and ambiguous linked terms gave way for the first time (measurement basis)

Night of 2026-10-15 (22:0x), the first with #2023 (a residual token contained in a selected filter value is not content; Pi5 release the morning before).

- Synthetic content: 100 pairs tried, 74 generated, 69 kept (median 17 chars, anchor overlap 0.38). Dropped: 16 copied runs, 6 copied words, 5 anchors not confirmed, 4 too similar. Production showed a relevant record for 61 of 69 (88%; 10 known only through the second grader), other records for 10 (12 of the night's shown lists still await the second grader's label, so this count may fall), nothing for 8 (all outside the judged candidates, none rejected by the judge), and 0 failed. The "outside the judged candidates" share doubled from 4 to 8; the misses are terse part-and-process queries (「万力サイズ選定 指導」, 「架台 一体加工 不適合」, 「サドル 分解 破損 不適合」) and two colloquial sentences.
- Ask-backs: 0, the second night in a row. `ambiguousDropped` appeared for the first time, on 6 rows (department name 4, part name 2): 5 of them showed a relevant record and 1 showed other records, so #1996 turned what would have been six ask-backs into five hits. Measured.
- Synthetic filter: 10 questions, 9 ok, 0 mismatch, 1 unsupported (「営業部 営業2課(販管)」 with `count5`, a department with no record in the period). The one `short` question (「…課 最近 不適合」 form) went filter-only with the recent sort and matched all five expected records (203 matched), so the change in #2023 did what it was meant to on its first live case. More `short` nights are needed before calling it settled.
- Real: 0 questions; receipts of 2026-10-15 and 2026-10-16 empty, so no operation-inquiry route.
- Learned queries: 7 activated (held-out 1/0 on the last decision); 33 active, 1 rejected.
- Runner log: 195 lines, 4 final lines (completed, budget_reached, 2 outside_window); no dgx_busy.

No code change. Next candidate: the misses outside the judged candidates (4 to 8 per night) are now the largest loss; options are a larger candidate pool for terse queries or learned terms for the recurring part names, to be compared through the gate before any change.

Private files: `work/flywheel/questions-2026-10-15.jsonl`, `real-2026-10-15.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-15.log`, `receipts-2026-10-15.jsonl`, `receipts-2026-10-16.jsonl`.

### 2026-10-17: fourteenth night, 90% and no ask-back; three short department names all filter-only, and the first real follow-up asking for "all 43" (measurement basis)

Night of 2026-10-16 (22:0x), the second with #2023.

- Synthetic content: 100 pairs tried, 77 generated, 68 kept (median 20 chars, anchor overlap 0.35). Dropped: 17 copied runs, 9 anchors not confirmed, 5 copied words, 1 too similar. Production showed a relevant record for 61 of 68 (90%; 10 known only through the second grader), other records for 10 (25 shown lists still await the second grader's label, more than usual, so this count may fall), nothing for 7 (all outside the judged candidates, none rejected by the judge), and 0 failed. The misses are again terse part-and-process queries (「看板 取付部 穴数 不足」, 「ワーク 固定 甘く 増圧弁 追加」) and colloquial sentences about a specific incident (sensor dog, panel mounted without a base).
- Ask-backs: 0, the third night in a row. `ambiguousDropped` on 4 rows (department name 3, part name 1): 3 showed a relevant record, 1 fell outside the candidates (「台なしでパネル直付けしたの、設計側のミス？」), so #1996 again turned ask-backs into hits.
- Synthetic filter: 10 of 10 ok, the three `short` questions included (first night with more than one short form; all filter-only with the right sort), so #2023 holds.
- Real: 3 questions. 「今年の機械課での不適合を教えて」 was a filter question, scored correct (5 shown). The follow-up 「４３件すべて」 (the answer had said 43 records) showed 20 other records: the kiosk caps a list at 20, so "show me all" cannot be satisfied today; this is the first real request for the whole set and is recorded as an open item, not a retrieval loss. 「(個人名)の最近の訓練結果」 was out of scope (training results are not nonconformity records), correctly refused. Receipts of 2026-10-16 (3 rows, the same three) carried no operation-inquiry route; 2026-10-17 empty.
- Learned queries: 1 activated, 4 rejected (held-out 0/1), 34 active, 5 rejected in all. The rejected candidates are the night's not-in-pool queries, as designed.
- Runner log: 275 lines, 6 final lines (completed, budget_reached, 2 dgx_busy after a DGX HTTP 503 at 22:02, 2 outside_window); the night completed at 22:29.

No code change. Three nights at 88 to 90% with no ask-back; the remaining loss is the 7 or 8 queries a night outside the judged candidates, and the learned-term path rejects them (they do not generalise to the held-out set). The next candidate is therefore the candidate pool for terse queries, measured through the gate. Separate open item: a real "show all N" follow-up meets the 20-record cap.

Private files: `work/flywheel/questions-2026-10-16.jsonl`, `real-2026-10-16.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-16.log`, `receipts-2026-10-16.jsonl`, `receipts-2026-10-17.jsonl`.

### 2026-10-17: the "all 43" follow-up answered by a breakdown instead of a longer list (change, not a measurement)

Decision on the open item of the fourteenth night. The 20-record cap stays. When the total exceeds the records shown, the kiosk answer now leads with the count, offers a breakdown by department and by month (buckets with counts, computed over every matching record, not only the 20 shown), shows each record as one line that expands on tap, and ends with 「他にも N 件あります。○で絞ってください。」 plus the chips of the other axis. A chip sends a structured `refine` (axis, field, value) to the same endpoint; the worker adds that filter to the stored plan and re-executes without calling the planner, so the step costs no JEV call and cannot be misread. An expired session falls back to normal planning on the chip text. Five records or fewer keep the card layout.

Not changed: the plain-text answer and `formatCoverageNotice` wording that the nightly evaluation reads; the receipt records `refine` so chip turns can be told apart. Groups are emitted only when the total is known (filter-only or counted paths); relevance-capped answers keep today's notice.

Second step, not in this PR: a 「要因で分ける」 axis. The cause lives in the existing 不適合内容 column (`condition`), free text with about 5,200 distinct values over 8,209 rows, so it needs JEV to sort each record into a small fixed set of cause categories, computed off the query path and cached by content hash. 処置内容 (`disposition`) has 4,583 distinct values and 2,233 empty rows; it is not near-categorical, so the proposed 処置内容 axis is dropped.

### 2026-10-17: 「要因で分ける」 axis from JEV classification of 不適合内容 (change, not a measurement)

Phase 2 adds a third breakdown axis, 「要因」, from the free-text `condition` field: 8,209 records, 5,839 non-empty, about 5,230 distinct texts, p50 40 characters, p90 95, maximum 395. JEV classifies normalized text off the query path, ten texts per call with one choice question per text. Results are cached by text SHA-256 with a prompt hash, never as searchable record fields. Prompt wording changes trigger reclassification. Empty or not-yet-classified records appear as 「未分類」; the axis is absent when none of the matching records has a classification. Cause chips stack with department/month filters; a natural-language follow-up drops the cause filter.

Fixed taxonomy, in order: 確認・検査の漏れ、思い込み・勘違い、図面・設計の誤り、加工・組立・段取りのミス、測定・検査方法の誤り、手配・発注・出図の漏れ、材料・外注・支給品の不良、取扱い・保管・運搬での破損、手順・教育・情報伝達の不足、不明・記載なし。

The pilot covered 120 sampled texts, ten per call, about 250 ms per call, with 100% answered and sensible assignments. This is a pilot result, not a new retrieval accuracy measurement. While `HERMES_RETRIEVAL_CAUSE_ENABLED=true`, the runner starts on each corpus refresh, at most 600 distinct texts per run by default; the first full pass takes about ten refreshes. Content failures stop retrying after three attempts per text; transport failures stop the run with backoff and do not consume attempts. The saved store remains usable with the runner disabled.

Unchanged: planner prompt and catalog, lexical/dense text, plain answer text and `formatCoverageNotice`, the 20-record cap, and nightly evaluation. Runtime settings are listed in [the enrichment operations reference](hermes-dgx-retrieval-enrichment.md#cause-classification-runtime).

### 2026-10-18: fifteenth night, 93% and no ask-back for the fourth night; the cause axis is live and fully classified (measurement basis)

Night of 2026-10-17 (22:0x), the first with #2076 (count and breakdown chips) and #2078 (cause axis) in production. Neither changes the plain answer text that the night reads, so the numbers are comparable.

- Synthetic content: 100 pairs tried, 71 generated, 61 kept (median 22 chars, anchor overlap 0.33). Dropped: 23 copied runs, 9 anchors not confirmed, 4 too similar, 2 copied words, 1 ungraded. Production showed a relevant record for 57 of 61 (93%), other records for 1 (「凸凹部品 見間違い 不適合」), nothing for 3 (1 outside the judged candidates, 2 rejected by the judge: 「測定治具取付穴 未展開 不適合」 and a colloquial question about an appearance standard), and 0 failed. The two judge rejections are the first in several nights; both had candidates, so the loss moved one stage later than the usual terse-query miss.
- Ask-backs: 0, the fourth night in a row. `ambiguousDropped` on 2 rows (part name 1, department name 1), both answered.
- Synthetic filter: 10 of 10 ok.
- Real: 2 questions, both answered. One filter question (correct), one content question with a relevant record shown. Receipts of 2026-10-17: 2 rows, no review items; 2026-10-18 empty by noon.
- Learned queries: 3 activated on 2026-10-17, 37 active, 5 rejected in all.
- Runner log: 190 lines, 5 final lines (dgx_busy at 22:07 after a DGX 503, completed, budget_reached, 2 outside_window); the night completed at 22:24.

Cause classification (#2078), rollout result: the Pi 5 release of 896f9861 needed three runs. The first (20261017-043810-86b783) failed because the new version and `--hermes-search-trial-maintenance on` were sent together; the maintenance path requires the same version to be running already, so the release rolled back by itself and production stayed healthy. The second run (20261017-044447-39a851) was a plain release and the third (20261017-045105-4ed2f4) applied the maintenance path with `HERMES_RETRIEVAL_CAUSE_ENABLED=true`. The first runner pass started 04:53 UTC and classified 600 of 5,299 distinct texts in 26 seconds (60 calls, mean 374 ms, 0 failed). By 2026-10-18 03:49 UTC every text was classified: 5,299 classified, 0 pending, 0 failed, and the runner now reports `nothing_to_do` on each refresh. This is a coverage result, not an accuracy measurement; the kiosk check of the 「要因で分ける」 chips is still open.

Operating note: when a release both ships a new version and changes a Hermes flag, run it as two releases, a plain one first and the maintenance one second. Recorded in [the enrichment operations reference](hermes-dgx-retrieval-enrichment.md#cause-classification-runtime).

No retrieval change. Next candidates stay as before: the planner using cause categories as a filter condition, and answering count questions (「今年多い要因は？」) from the saved classification without a model call.

Private files: `work/flywheel/questions-2026-10-17.jsonl`, `real-2026-10-17.jsonl`, `learned-queries.jsonl`, `labels.json`, `runner-2026-10-17.log`, `runner-2026-10-18.log`, `receipts-2026-10-17.jsonl`.

### 2026-10-19: sixteenth night, 85%; the first user-reported retrieval bug, a chip refining the wrong answer, fixed the same day (measurement and fix)

Night of 2026-10-18 (22:0x–22:14), the first with cause classification fully populated. Neither #2123 nor #2125 (below) changes the plain answer text that the night reads, and both landed after the night ran.

- Synthetic content: 100 pairs tried, 70 generated, 61 kept (median 20 chars, anchor overlap 0.35). Dropped: 22 copied runs, 9 anchors not confirmed, 6 copied words, 2 too similar. Production showed a relevant record for 52 of 61 (85%, down from 93%), other records for 4, nothing for 4 (all 4 outside the judged candidates, 0 rejected by the judge, 0 ask-backs), and 1 failed (TypeSafe HTTP 422 on one question). The four misses and four other-record rows are the usual terse-query shape (「軸数変更に伴う封止材未配」, 「コマの押付け力 ベースの動き 過大 理由」) plus two long colloquial questions about a casting shape and a lifting-hole plug; no single new failure mode. One night at 85 after four at 90–93 is within the range seen before the learned-query change (nights 7–11); it is a watch item, not a regression call.
- Ask-backs: 0, the fifth night in a row. `ambiguousDropped` on 3 rows (machine 1, part 1, department 1), all answered.
- Synthetic filter: 10 of 10 ok.
- Real: 0 questions in the night window (no `real-2026-10-18.jsonl`). Receipts 2026-10-18 and 2026-10-19 (11 rows up to 09:26 JST): 9 answer, 2 no_result, no review items; the no_result rows are the chip bug below.
- Learned queries: 3 candidates on 2026-10-18, all rejected (the held-out check lost 2 of 55 and gained 0); 37 active, 8 rejected in all.
- Runner log: 187 lines; completed at 22:14 JST, then budget_reached and outside_window.

Chip scoping bug, found by the user on the kiosk (2026-10-19 08:19 JST): on a 「要因で分ける」 breakdown of an older answer (department, all periods), the chip 「図面・設計の誤り 1」 returned 「見つかりませんでした」 although the count said 1. Receipts show why: the chip refined `session.previousPlan`, which by then was the latest answer (same department, July, 確認・検査の漏れ), so the cause filter was stacked on the July plan and the real count for that plan was 0. Fix (#2123, main 147fb627, Pi 5 release 20261018-235022-4e0ba5, rollback floor 0c7d6eaa): every executed plan gets a `planId`, the session keeps the last 8 plans, each answer carries its `planId` to the kiosk, and a chip sends it back so the refine applies to the plan the chip was counted against. Unknown or expired ids fall back to the latest plan; restricted principals cannot refine a plan they could not see. Receipts now record `refine` (axis, field, value, planId) on all outcomes including no_result. Verified on the kiosk by the user: the same chip now shows the 1 record. The same PR removed the yellow JEV記録 notice at the top of the tab at the user's request.

Answer text: 「見つかった件数は、指定された件数より少ないです。」 (shown when results < plan limit) is removed from answers in #2125 (open at the time of writing; merge and release are recorded in the next entry). The user read it as unintelligible without context; the `insufficient` flag stays in receipts and coverage. `formatCoverageNotice` is unchanged.

No retrieval ranking change. Next candidates: the planner using cause categories as a filter condition (「図面の誤りで先月」 in one turn), and answering count questions (「今年多い要因は？」) from the saved classification without a model call.

Private files: `work/flywheel/questions-2026-10-18.jsonl`, `runner-2026-10-18.log`, `learned-queries.jsonl`, `receipts-2026-10-19.jsonl`.

### 2026-10-19: the planner uses the cause category as a filter condition (change, not a measurement)

First of the two candidates named in the sixteenth-night entry. The planner gets one more choice question, `cause`, with the ten categories and `none`, answered in the same single JEV call; a chosen category becomes `causeCategory` on the plan and counts as a hard filter, so 「図面の誤りで先月の不適合」 is answered in one turn with no relevance stage. The cause label words are stripped from the residual tokens so they do not force a content search, a `drop_cause` choice lets a follow-up remove an inherited cause, and the receipt records `causeDecision`. The executor keeps a record only when the saved classification matches; a source without a cause store is never narrowed by a cause condition, and an empty store keeps the planned condition closed (`causeFilterDropped: 'store_empty'`). A cause heard in a question scoped to another source is dropped (found in review: it had turned into 「見つかりませんでした」 on 要領書 questions). Two nightly filter templates (`cause_recent`, `cause_last_month`) exercise the path; the planner question version moved to `planner-questions-2026-10-19`, which changed the JEV input digest in `source-compatibility.test.mjs` while the results and catalog digests stayed the same.

PR #2130, merged as a1299deb, Pi 5 release 20261019-011707-531d41 (10:17–10:23 JST). The night of 2026-10-19 is the first comparison against the 85% of the sixteenth night.

### 2026-10-19: count questions answered from the saved classification (change, not a measurement)

Second candidate. The planner's single call now also chooses an `intent`: records, or a breakdown by cause, by department, or by month. A breakdown plan skips the relevance stage, forces the content decision to false, keeps the hard filters and cause condition, and is valid only for the nonconformity source; it is not carried into chips or into the previous-plan summary, so a follow-up starts from a plain records plan. The executor builds the groups for a breakdown over the full filtered set even when it is small or empty, with the asked axis first so the kiosk preselects it; records are still returned so the kiosk shows the count, the axis tabs and the chips as today. The plain answer lists the conditions and the per-bucket counts (「全期間・全部署の不適合 N 件の要因の内訳: …」). When the cause store is empty, a cause breakdown falls back to the newest filtered records and the receipt records `breakdownDropped: 'store_empty'`; the receipt also records `intentDecision`. The nightly filter check judges a cause breakdown by bucket values and counts recomputed from the corpus (`bucketsOk`), with two new templates (`breakdown_cause_year`, also per department, and `breakdown_cause_last_month`); only bucket values and counts are kept for checking, never record text. Planner question version `planner-questions-2026-10-19b`; the JEV input digest changed again, results and catalog digests unchanged. 426 retrieval tests pass.

Measurement plan: the seventeenth and eighteenth nights are read as the comparison nights for the cause filter alone, so this change is released to the Pi 5 only after those nights are aggregated, and the `breakdown_*` templates are reported separately from the other filter templates on their first night.

### 2026-10-21: seventeenth and eighteenth nights, 84% and 84%; the cause condition was gating content searches and cost about two questions a night (measurement and finding)

Nights of 2026-10-19 (22:0x–22:1x) and 2026-10-20, the first two with #2130 (cause category as a planner filter) on the Pi 5. The breakdown change (#2137) was held back from the Pi 5 on purpose so that these nights measure #2130 alone against the 85% of the sixteenth night.

- Night 17, synthetic content: 100 pairs, 75 generated, 64 kept (median 16 chars, overlap 0.36). Relevant shown 54 of 64 (84%), other records 7, nothing 3 (all 3 outside the judged candidates). Ask-backs 0 (sixth night). Synthetic filter 10 of 10, among them 6 `cause_recent` rows, all ok.
- Night 18, synthetic content: 100 pairs, 69 generated, 61 kept (median 16 chars, overlap 0.33). Relevant shown 51 of 61 (84%), other records 5, nothing 5 (all outside the judged candidates). Ask-backs 0 (seventh night). Dense fallbacks 1; `ambiguousDropped` on 3 rows. Synthetic filter 9 of 10: the `count5` row for a department whose name carries a parenthetical suffix was planned as out of scope with no filters (`unsupported`, not a wrong answer; an observation, not fixed here). 2 `cause_recent` rows, both ok.
- Real: 6 receipts on 2026-10-19 (1 filter, 5 content). The one no-result among them was the chip bug fixed in #2123 that morning, replayed correctly at night. No real questions on 2026-10-20.
- Learned queries: no activation on either night.

Finding. The planner's new `cause` question also answers on ordinary content questions: a synthetic question that describes a drawing mistake or a missed check in its own words is given `causeCategory`, and because the category is a hard filter, the content search then runs only over records that JEV classified into that category. Over the two nights 30 of 125 content rows carried a cause; checked against the saved classification of the two source records, the chosen category matched neither record for 12 of the 30, and 5 of those 12 were lost (3 nothing shown on night 17, 2 other records on night 18), against 2 lost among the 18 that matched (both nothing shown, night 18). On night 17 every nothing-shown row was such a mismatch. One row had chosen `unknown` (不明・記載なし), which can never be what a question means. The classification is one model pass over free text and the two records of a pair often disagree with each other (check/drawing, machining/measure), so it is too noisy to gate a content search; it is fine as a filter when the question is only a cause and a period, which was the case #2130 was built for. Without those 5 losses the nights would have read at most 89% and 87%; the fix is the next entry.

Private files: `work/flywheel/questions-2026-10-19.jsonl`, `questions-2026-10-20.jsonl`, `runner-2026-10-19.log`, `runner-2026-10-20.log`, `real-2026-10-19.jsonl`, `receipts-2026-10-19.jsonl`, `stores/retrieval-cause-2026-10-21.jsonl` (hashes and categories only).

### 2026-10-21: a cause heard in a content question no longer narrows the content search (change, not a measurement)

Planner change on top of #2130. A cause chosen from the current question becomes `causeCategory` only when the plan has no content search (`contentDecision.jev` false: cause-and-period questions, breakdowns). When the content search runs, the heard cause is dropped and the receipt records `causeDecision: { chosen: null, dropped: 'content_search', heard: <id> }`; the cause words stay in the question text that the content search uses. A cause inherited from a chip or a previous plan is kept as before, since the user chose it explicitly, also when the follow-up names a different cause. The nightly question rows now keep `causeDecision` (ids only) so that the dropped rows can be counted. `unknown` is no longer offered as a choice in the planner question (it stays a breakdown bucket). Planner question version `planner-questions-2026-10-21`; the JEV input digest changed, results and catalog digests unchanged.

Reading the nineteenth night: report content rows with `causeDecision.dropped === 'content_search'` and their nothing-shown count separately, the `breakdown_*` templates separately from the other filter templates (first night with #2137), and the headline percentage against 85%.

### 2026-10-21: evaluation also records how much text goes to JEV and back to the user (harness change, not a measurement)

`evaluate.mjs` now records per-case JEV call counts, characters sent and received, and answer characters; `stage-score.mjs` shows `jevIn` and `ans`. Search behaviour and the text sent to JEV are unchanged (the worker only exports its formatting functions). The first baseline with these columns is still to be run on `main` with the usual sets; record it here when it is.

### 2026-10-22: nineteenth night, 56%; the new answer-kind question routed one content question in three to a cause breakdown (measurement and finding)

Night of 2026-10-21 (first night with #2137 and #2208 live). Of 61 live content rows, 34 matched a target (56%, against 52/61, 54/64 and 51/61 the three nights before). The 39 further rows in the file are generated candidates dropped before execution (copied run 19, too similar 7, anchor not confirmed 6, copied words 7), not empty answers; `no_result` was 4 and ask-backs 4 (one unresolved term each). Filter questions 10/10.

The loss is one thing: JEV answered the new intent question with `breakdown_cause` on 21 live rows (19 content, 2 filter), although none of them asked for counts: they asked why one nonconformity happened (「〜の原因は？」「〜はなぜ」) or were bare keyword strings with no count word at all. A breakdown plan runs no content search and sorts by date, so all 19 content rows lost (`other_shown` 14, `status` 4, `not_in_pool` 1). Without those 19 the night is 34/42 (81%), with the remaining losses `other_shown` 5, `not_in_pool` 2, `judge_rejected` 1. No real kiosk question of 10/21 or 10/22 was routed to a breakdown (9 receipts).

The #2208 change behaved as intended: a cause heard in a content question was dropped from the plan on 7 rows (5 matched, 2 `other_shown`), and a chosen cause stayed only on breakdown plans.

Private files: `work/flywheel/questions-2026-10-21.jsonl`, `runner-2026-10-21.log`, `receipts-2026-10-21.jsonl`, `receipts-2026-10-22.jsonl`.

### 2026-10-22: a breakdown is accepted only when the question talks about counts (change, not a measurement)

Planner change on top of #2137. The answer-kind options now say that the cause, reason or handling of one nonconformity is `records`, and that the three breakdowns are counts per category rather than records. In addition, a breakdown answer is applied only when the question contains a count or distribution cue (件数, 何件, 多い, 内訳, ごと, 部署別/月別/要因別, 分布, 割合, ランキング, 傾向, 上位, 集計, 一番, 最も, どの要因, 頻度 and the like); otherwise the plan falls back to `records` and the receipt records `intentDecision: { chosen: 'records', gated: 'no_count_cue', heard: <intent> }`. Checked offline against the nightly files: none of the 21 misrouted questions passes the cue, and the real breakdown question of 10/22 (「今年多い要因は?」) and the count questions of earlier nights do. A missed breakdown still returns records, so the gate errs towards records. The nightly rows now also keep `intentDecision`. Planner question version `planner-questions-2026-10-22`; the JEV input digest changed, results and catalog digests unchanged. Night 20 is the check.

### 2026-10-23: twentieth night did not run; the readiness probe mistook the new business model's reasoning text for an outage (finding and harness fix)

Night of 2026-10-22 ran only the 10 filter questions (10/10) and one real question; no content question was generated. The runner's readiness probe asks the business LLM for `OK` with 8 tokens; the model switched to GLM at 21:16 that evening, and GLM writes a short reasoning text even with thinking off, so every probe from 22:00 to 23:58 ended `truncated` (29 probes) and from 00:03 to 05:58 `timeout` (69 probes, overlapping a six-hour backup on the DGX and a business request that never finished; that part is followed on the business-LLM side). Nothing of this measures retrieval, so #2234 is still unchecked.

Harness change: the probe now sends 64 tokens and treats a truncated reply as ready, since an HTTP 200 with a cut-off answer proves the model is up. Generation and labelling keep their 200-token budget; if truncated replies rise there, raise it. Night 21 is the first check of #2234.

### 2026-10-23: record answers now show the part number and part name (change, not a measurement)

Reported from a kiosk check: a records answer listed three nonconformities by number, date, department and body only, so the reader could not see which part each one was about. Record answers were built from the fields with the roles identifier, date, organization and body; part number, part name and machine name are facets and were left out. A source definition may now declare `answerFields` (facet keys shown in record answers after the identifier); the nonconformity source declares part number and part name, so a record reads 不適合番号, 品番, 品名, 発見日, 起因部署, then the body fields. Other sources are unchanged. Planner inputs and catalog digests unchanged; the results digest changed because answers carry two more fields. Not a retrieval change, so no effect on the match rate is expected.

### 2026-10-24: twenty-first night, 76% floor; no content question was routed to a breakdown any more (measurement)

Night of 2026-10-23 (first night with #2234 and #2249 live, business LLM on GLM). The whole night ran between 22:00 and 22:28 JST: the readiness probe passed on the second attempt (one `dgx not ready reason=timeout` at 22:02), then 79 questions were generated and the budget was reached. Of 87 live content rows, 66 matched a target (76%, against 34/61 on night 19 and 52/61, 54/64, 51/61 before). The 22 further rows are generated candidates dropped before execution (copied run 10, anchor not confirmed 7, truncated 2, too similar 2, copied words 1). `no_result` 4, ask-backs 0, filter questions 10/10. Median answer time 1.2 s.

The #2234 finding is settled: `intentDecision.chosen` was `records` on all 87 rows and the count-cue gate did not have to fire once (`gated` 0), so the reworded option texts alone stopped JEV from choosing a breakdown for questions about one nonconformity. No real kiosk question of 10/23 was routed to a breakdown (3 receipts).

The 76% is a floor, not the final figure: 17 rows are `other_shown`, and all 78 records shown on them are still unlabelled (`labelPending=78`) because the night's 60-pair labelling budget was spent on the backlog from 10/21 (37 pairs) before this night's pairs. On nights 15 to 18, labelling turned most `other_shown` rows into matches or confirmed misses within the same night; here that step is pending, so the true match rate is between 66 and 83 of 87. The remaining losses are `not_in_pool` 2 and `judge_rejected` 2.

Private files: `work/flywheel/questions-2026-10-23.jsonl`, `runner-2026-10-23.log`, `labels.json`, `receipts-2026-10-23.jsonl`.

### 2026-10-26: a factory or division named in a question now filters on every department beneath it (change, not a measurement)

Reported from a kiosk check on 10/26 (4 receipts, one session): after a records answer filtered on one section, the follow-ups 「〜工場では類例ない？」 and 「〜工場の類例だよ。」 returned the same records again. The receipts show why: the department question offers one option per indexed value, and no value is the factory itself, so JEV chose `none` (0.61 and 0.53 against 0.19 and 0.29 for the closest section), the previous content condition was carried, and nothing changed. The same session also asked 「他に何件ある？」 after a content answer and got one more record instead of a count; that is a separate gap (content searches have no count path) and is not addressed here.

Change: for fields with the organization role, `value-index.mjs` derives hierarchy prefixes from the indexed values by cutting each name at its organization suffixes (工場, 事業所, 本部, 事業部, センター, 部, 課, 室, 係 and the like); a prefix of three or more characters that covers two or more values becomes a choice. On the live index that is 35 departments and 8 prefixes (2 factories with 18 and 14 departments, 3 divisions under each). The planner offers these as extra options (`h<i>`, text 「<prefix>（配下のN部署すべて）」) next to the values; a chosen prefix becomes one `in` filter over every department beneath it, the prefix text is stripped from the content query like a value, and a prefix chosen next to one of its own narrower departments is dropped so naming a section never widens to its factory. The field instruction says to pick a 配下すべて option only when the utterance names that level and nothing narrower. Planner question version `planner-questions-2026-10-26`; the JEV input digest changes for organization questions, results and catalog digests unchanged. Tests: prefix derivation, the kiosk follow-up as a replaced `in` filter, and the section-next-to-factory collision. Effect on the nightly match rate is expected to be neutral (the generated questions name sections); the check is the real kiosk follow-ups, which the next step brings into the nightly files.

### 2026-10-26: real kiosk conversations are replayed as conversations at night (change, not a measurement)

The 10/26 kiosk bug (a count question and a 「〜工場では類例ない？」 follow-up answered as if they were fresh questions) could not have been caught by the nightly real-question replay, even though all four receipts of that session were on disk. `readReceiptQuestions` read every receipt as a standalone question (no previous plan, no shown records) and deduplicated by question text, so 「他に何件ある？」 would have been scored once, out of context, and never again. The morning report showed only aggregate real counts.

Change (`flywheel-real.mjs`, `flywheel-live.mjs`, `flywheel-runner.mjs`, `flywheel-report.mjs`):

- Receipts sharing a `sessionId` are ordered by time and replayed as one conversation. Every turn after the first carries the previous turn's plan (sources, filters, semanticQuery, sort, limit; `causeCategory` is not in the day receipt, so it is not carried), the records shown so far in the session (prefixed ids, accumulated the way the kiosk's `withShown` does), and the earlier question texts. The night scorer passes them to `answer()` as the session, so the planner sees `previous_plan` and `shownCount` as it did on the day.
- The kiosk carries a turn's plan forward whatever its outcome, so a clarification turn is not replayed but its plan is what the next turn follows. A follow-up joins the set without conditions of its own.
- Ids: a first turn keeps `realId(question)`; a follow-up is `realId(question, previousPlan)`, so the same words after different searches are different questions and are replayed once each.
- Graders read a follow-up together with the earlier questions of its session (joined by newline), since 「他に何件ある？」 alone says nothing about relevance.
- The real summary counts follow-up turns apart: `follow-up turns N, with relevant, relevant shown, lost <stages>, filter mismatch` as a third line, only when there are any.

Checked against the Pi5 receipts of 10/23 to 10/26 (counts only): 7 questions, 3 first turns, 4 follow-ups; the 10/26 session is one conversation of 4 turns with 3 follow-ups, ids unique. Tests: `node --test scripts/hermes-search/retrieval/*.test.mjs` 438 pass (new: session grouping incl. out-of-order receipts and a clarification turn, planner receives `previous_plan`, runner row and grader text for a follow-up, follow-up line in the report).

Left out: receipts whose day outcome was `clarification` or `out_of_scope` are still not replayed (same rule as before); a count follow-up is scored on relevance labels like any content question, so a wrong count with the right records shown reads as `relevant shown`. Both are separate changes.

Private files: `work/flywheel/real-<night>.jsonl` (now with `turn`, and `previousPlan`, `previousShown`, `context` on follow-ups).
