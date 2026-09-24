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

The retrieval worker, when that file exists, sets `record.enrichment = { summary, queries, tags }`. `tags` are the flattened facet values plus any kept alias alternatives.

## Validation

Unit tests cover schema checks, evidence drops, alias drops, incremental skip, atomic store writes, and flag parsing. Deploy syntax is checked with the example vault password.

Do not release this feature branch. The order is: pull request, merge to `main`, a normal fleet release of that merged revision, then the maintenance flags. `HERMES_RETRIEVAL_ENRICHMENT_ENABLED` stays off until that maintenance step.

## Measured decision

The offline Grok experiment kept the `aliases` field. Terms that are not in the record are dropped, and alternatives that already appear in the record are dropped. At least two of the three to five queries must use a kept alternative.

The next validation is to run the same 1,000-record subset through the business LLM on the Pi 5 and compare that output with the Grok stores offline. That run waits until the merged revision is on the Pi 5 through the normal release.

## Open Items

The chat egress inactivity cap is 60 seconds. The client timeout stays at most 55 seconds. A silent DGX response longer than the cap fails and is retried on a later pass.

Copying the store to a Mac uses the same on-host export style as `export-business-hermes-answer-sources.ts`. This repository has no authorized pull path for that private file.
