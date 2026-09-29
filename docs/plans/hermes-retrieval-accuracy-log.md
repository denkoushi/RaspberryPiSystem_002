# Hermes retrieval accuracy log

- Status: living log, one entry per measured change
- Scope: nonconformity retrieval quality in business Hermes Chat on the Pi 5

This log records each accuracy change that was measured, including the ones that were rejected, so a later change does not repeat a failed attempt. Design decisions stay in their ADR or ExecPlan. This file keeps the measurement, the numbers, and the reason for keeping or dropping the change.

## How to measure

The gold sets, stores, and run files are private and stay in `~/Documents/hermes-retrieval-private` on the owner's Mac. They are never committed.

- `gold/stage-v1.json`: 50 cases (content_same 10, content_para 16, filter 10, mixed 6, out_of_scope 4, owner 4).
- `gold/stage-aspect-v1.json`: cases that ask for a countermeasure or disposition instead of a phenomenon (8 added 2026-09-28, a09 from a kiosk miss on 2026-09-29).
- `snapshots/nonconformity-snapshot-20260929.json`: all 8,242 records, exported read-only on the Pi 5 with `scripts/hermes-search/hermes-qmd-snapshot-export.mjs` (request line `{"type":"request","requestId":"snap-1"}` on stdin, run in the API container). Keep snapshots in this private folder, not in a worktree: the earlier copy lived in a worktree and was lost when that worktree was cleaned up. Numbers before 2026-09-29 used an 8,209-record snapshot, so compare a change only with a baseline on the same snapshot.

Run from `scripts/hermes-search`:

    node retrieval/evaluate.mjs --gold <gold> --snapshot <snapshot> --retriever <lexical|hybrid> --stage-dump [--enrichment <store>|--no-enrichment] --now 2026-09-24 --out <run>
    node retrieval/stage-score.mjs --gold <gold> --run <run> [--run <run> ...]

Hybrid runs need `HERMES_RETRIEVAL_DENSE_PROVIDER=dgx`, `HERMES_RETRIEVAL_DENSE_BASE_URL=http://127.0.0.1:38110` through the owner's SSH tunnel, and `TYPESAFE_API_KEY` for the JEV planner and judge. Compare a change against a baseline run of the current `main` on the same day and settings; JEV answers drift by about one case between runs.

Real use is recorded on the Pi 5 since 2026-09-29: every answer appends its receipt, the shown record ids, and the session id to `/app/storage/hermes-search/runtime/receipts/receipts-YYYY-MM-DD.jsonl` (Tokyo day, kept 90 days, no record text). Copy a day to the private folder and summarize it:

    ssh denkon5sd02@100.106.158.2 'c=$(docker ps --format "{{.Names}}" | grep -E "^bluegreen-api-(blue|green)-1$" | head -1); docker exec "$c" cat /app/storage/hermes-search/runtime/receipts/receipts-2026-09-30.jsonl' > ~/Documents/hermes-retrieval-private/receipts/receipts-2026-09-30.jsonl
    node retrieval/receipt-report.mjs ~/Documents/hermes-retrieval-private/receipts/receipts-*.jsonl

The `review` list holds content questions that returned nothing or lost meaning-based search. Those are the candidates for new gold cases.

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
