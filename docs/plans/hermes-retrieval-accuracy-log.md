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
