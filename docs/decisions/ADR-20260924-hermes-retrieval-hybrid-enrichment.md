---
title: "ADR-20260924: Hermes retrieval hybrid ranking and enrichment aliases"
status: accepted
date: 2026-09-24
deciders: [project owner, supervising agent]
tags: [hermes, retrieval, hybrid, enrichment, embedding]
related:
  - ../plans/hermes-cross-source-retrieval-execplan.md
  - ./ADR-20260923-hermes-cross-source-retrieval.md
---

# ADR-20260924: Hermes retrieval hybrid ranking and enrichment aliases

## Status

accepted for the retrieval method. No production deploy is claimed.

## Context

Stage metrics, not per-question patches, compare planner slots and candidate lists. A private 50-case stage set showed missing period slots, a sort that preferred recency too often, and weak paraphrase recall for lexical search alone.

Query-time DGX text embedding is now allowed. The production model named for that path is Qwen3-Embedding-0.6B. Its service contract is not defined, and the Control Plane change comes later.

The Pi5 image installs `scripts/hermes-search` with `npm ci --omit=dev` (`infrastructure/docker/Dockerfile.api`). A local ONNX runtime must not be a production dependency.

## Decision

1. Keep the period slot and the sort rule: relevance for content questions, recent only for recency wording or filter-only questions.
2. Hybrid retrieval is reciprocal-rank fusion (k=60) of lexical and dense ranks. Enrichment summary, queries, tags, and aliases feed both sides.
3. Query embedding is a port. Implementations now are `local-onnx` (evaluation only) and `none`. Production default is lexical retrieval and embedding `none`. Hybrid runs only when a provider is configured. A provider failure or timeout (default 800 ms) falls back to lexical and records `vectorStatus`. No remote adapter until the contract exists.
4. `@huggingface/transformers` is a devDependency. The worker does not import the local ONNX runtime. Variant C rerank-replace and entity-link stay evaluation-only.
5. Scope choice is worded from the source catalog description. After tokens consumed by applied filters, periods, and structural words are removed, an empty remainder forces content false.

## Alternatives

- Keep `@huggingface/transformers` in production dependencies. Rejected because the Pi5 image would install the ONNX runtime.
- Delete variant C and entity-link. Rejected; leaving them on the evaluation command is the smaller change.
- Add a DGX embedding client now. Rejected; the contract is not defined.

## Consequences

- Production answers stay lexical until a provider is configured. No new environment flag is added. `HERMES_RETRIEVAL_V2_ENABLED` is unchanged.
- Paraphrase top-15 rates on 16 cases: lexical 0.00; hybrid e5-base 0.38; hybrid e5 plus enrichment aliases 0.44; hybrid ruri-v3-310m plus aliases 0.62; hybrid Qwen3-Embedding-0.6B plus aliases 0.69.
- Whole 50-case status correctness moved from 0.74 to 0.86 with period/sort, hybrid, and aliases. Mac p95 stayed at or under 2.4 s.
- Enrichment was attached only on a 1,000-record subset that contained the targets, so the hybrid rates are biased upward.

## Validation

`node --test retrieval/` uses synthetic fixtures. Stage comparison stays on the private set. Production install evidence is `npm ci --omit=dev` omitting the ONNX package.

## Supersedes / Superseded By

Supersedes the 2026-09-24 decision that query embedding must not depend on DGX, only for the query-time embedding allowance. The planner remains JEV.

## References

- `docs/plans/hermes-cross-source-retrieval-execplan.md`
- `scripts/hermes-search/retrieval/query-embedding.mjs`
