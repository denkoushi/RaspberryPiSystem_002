# Hermes DGX retrieval enrichment

- Status: implemented locally, not merged, not released
- Scope: offline per-record enrichment for Hermes retrieval on the business Pi 5

## Context

Paraphrased shop-floor questions miss records whose text uses different words. Enrichment is precomputed with the DGX that the consultation path already uses, then attached as extra searchable text. Query time does not call DGX.

## Decision

Reuse the consultation principal already bound as `HERMES_INFERENCE_TOKEN` (`business_hermes_chat_dgx_token`) and POST `/v1/chat/completions` through `HERMES_INFERENCE_EGRESS` (`business-hermes-chat-egress`). No new principal, token, or workload id is introduced. The runner does not switch the active model profile. The stored profile label defaults to `business_qwen36_27b_nvfp4`, which is the existing business profile, not a control-plane request.

`HERMES_RETRIEVAL_ENRICHMENT_ENABLED` defaults off. `true` or `false` is forwarded; omission preserves the current line; any other value is a usage error. The pilot cap, concurrency (`1` or `2`), and optional `HH-HH` window follow the same omission rule.

## Runtime

The API process that already reloads the live corpus starts `scripts/hermes-search/retrieval/enrichment-runner.mjs` at low priority, separate from the answering worker. Failures back off and do not change chat answers. The store is `/app/storage/hermes-search/runtime/retrieval-enrichment.jsonl`. Counts and timings are in `retrieval-enrichment-status.json` and one count-only log line.

Failures are split into content failures (`invalid_json`, `schema_mismatch`, `truncated` when the answer stops at the token cap, and `rule_violation`) and DGX failures (`timeout`, `transport`, `http`). Only DGX failures count toward backoff. Content failures go to `retrieval-enrichment-failures.json` beside the store with an attempt count, untried records run first, and a record is set aside after three content failures until its text or the prompt changes. The status file carries `failureCounts`, `failureDetails` (fixed schema messages only, never answer text), `gaveUp`, and `aliasesRejected`.

When the aliases fail the two-expanded-queries rule, the runner keeps the summary, facets, and queries as a schema v1 row without aliases instead of discarding the record. The offline ingest keeps the strict rule. The first overnight pilot (2026-09-25) stored only 14 of 1,000 records because three content failures ended each pass and the next pass retried the same records first.

The second overnight pilot (2026-09-26) stored 930 of 1,000 records. All 78 content failures were `truncated` at the 800-token cap, so the cap is now 1,200 tokens. Of the stored rows, 134 kept aliases (schema v2) and 796 had none (schema v1). Rows now record `metrics.aliasesRejected`, so later runs can tell a rejected alias set from a model that returned no aliases.

The runner starts only after the retrieval worker is ready, and the worker starts on the first Chat request after an API restart. After a release, one Chat question is needed before the overnight window.

The retrieval worker, when that file exists, sets `record.enrichment = { summary, queries, tags }`. `tags` are the flattened facet values plus any kept alias alternatives.

## Validation

Unit tests cover schema checks, evidence drops, alias drops, incremental skip, atomic store writes, and flag parsing. Deploy syntax is checked with the example vault password.

Do not release this feature branch. The order is: pull request, merge to `main`, a normal fleet release of that merged revision, then the maintenance flags. `HERMES_RETRIEVAL_ENRICHMENT_ENABLED` stays off until that maintenance step.

## Measured decision

The offline Grok experiment kept the `aliases` field. Terms that are not in the record are dropped, and alternatives that already appear in the record are dropped. At least two of the three to five queries must use a kept alternative.

The business LLM output was compared with the Grok stores on 2026-09-27. The comparison used the private 50-case stage set, hybrid retrieval with DGX Qwen3-Embedding-0.6B through the owner's tunnel, `--now 2026-09-24`, and `stage-score.mjs`. Grok was also cut to the same 930 records (c930), so the DGX-to-Grok difference is the enrichment quality alone. Re-running the 2026-09-25 Grok arm gave the same scores.

| Arm | Enrichment | Paraphrase status | Paraphrase r15 | Paraphrase r50 | Paraphrase hit | All status | All r15 | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a lexical | none | 0.38 | 0.06 | 0.19 | 0.00 | 0.80 | 0.62 | 700 |
| b hybrid | none | 0.63 | 0.25 | 0.44 | 0.19 | 0.88 | 0.69 | 1330 |
| c930 hybrid | Grok, 930 records | 0.69 | 0.44 | 0.69 | 0.31 | 0.90 | 0.76 | 942 |
| d hybrid | DGX business LLM, 930 records | 0.69 | 0.50 | 0.56 | 0.38 | 0.90 | 0.78 | 885 |

The paraphrase set has 16 cases, so a 0.06 difference is one case. DGX enrichment matches Grok within that noise, although only 134 of its 930 rows kept aliases against 957 of 1,000 for Grok. The summary and queries carry most of the gain. The business LLM is therefore good enough to produce enrichment on the Pi 5. Extending it past the 1,000-record pilot is a separate decision. At about 20 s per record, the rest of the corpus takes about a week of overnight windows.

## Open Items

The chat egress inactivity cap is 60 seconds. The client timeout stays at most 55 seconds. A silent DGX response longer than the cap fails and is retried on a later pass.

Copying the store to a Mac uses the same on-host export style as `export-business-hermes-answer-sources.ts`. This repository has no authorized pull path for that private file.
