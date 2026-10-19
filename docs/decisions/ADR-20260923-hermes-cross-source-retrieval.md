---
title: "ADR-20260923: Hermes cross-source record retrieval architecture"
status: accepted
date: 2026-09-23
deciders: [project owner, supervising agent]
tags: [hermes, jev, retrieval, source-catalog, query-plan, evaluation, latency]
related:
  - ../plans/hermes-cross-source-retrieval-execplan.md
  - ../plans/hermes-jev-search-handoff-20260923.md
  - ./ADR-20260907-hermes-business-butler-design-policy-v1.md
---

# ADR-20260923: Hermes cross-source record retrieval architecture

## Status

**accepted** as the direction for the floating-Chat record search. The
query planner is TypeSafe JEV (decision 7, updated 2026-09-24).
No implementation, deployment, or production change is claimed by this ADR.

## Context

The floating Chat `JEV記録` mode answers natural-language questions about
nonconformity records and shows the original record text. The owner now
requires three things beyond the current slice:

- **Multiple, differently shaped sources** will be added later, and a question
  may need records from several of them at once (cross-source retrieval).
- **A complete answer on screen within 5 seconds.**
- **Scalability**: adding a source must not require rewriting the search core.

Evidence about the current path, as of 2026-09-23:

- Eight real screen utterances returned `completed` with `searchPlan.mode`
  `exact`, and the worker-side `elapsedMs` was 632-968 ms including the external
  JEV call. Speed of the exact branch is not the bottleneck. Screen-complete
  time and the semantic branch were not measured.
- The semantic branch reads only saved per-record JEV classifications. 2,764
  judgments exist for roughly 8,200 current records (about one third);
  classification is OFF and reclassification was out of scope. Unclassified
  records are invisible to semantic questions.
- `scripts/hermes-search/hermes-jev-record-classifier.mjs` (about 1,900 lines)
  hard-codes nonconformity-specific taxonomy groups, display requests, stop
  words, and organization units. The generic source definition
  (`scripts/hermes-search/hermes-sources/nonconformity.json`) exists but is
  largely unused by that classifier.
- Conversation edits are modelled as many small JEV decisions (operation type,
  removal target, field-versus-value, display intent, equivalence proofs).
  About thirty PRs between 2026-09-20 and 2026-09-23 repaired individual captured
  utterances in this area, each requiring PR, CI, release, Pi5 deploy, and a
  real-screen check.
- Earlier alternatives also missed the goal: the Hermes native agent loop with
  MCP tools took 20-60 seconds per answer, and the QMD lexical+vector search
  with BGE reranking (revision r10) left unresolved accuracy failures.

## Decision

1. **Source catalog.** Every source is declared by a versioned catalog entry
   that extends the existing `hermes-source-definition/v1`: fields with type and
   role (identifier, facet, organization, date, body text), which fields are
   filterable, where valid filter values come from, display labels, and the
   code-owned read adapter. Model output never selects a database connection
   or an unlisted field. Source-specific knowledge lives only in the catalog
   and its adapter, not in the planner or the Chat.
2. **Ingest-time indexing instead of per-record LLM classification.** Each
   source is normalized into a common document shape (source id, record id,
   facets, body segments with original-text offsets) and indexed incrementally
   with lexical and embedding indexes, reusing the existing QMD index and the
   EmbeddingGemma inference path on DGX. No new per-record LLM taxonomy is
   created for new sources. The existing v4 classification store is kept as-is
   for the frozen path.
3. **One planner call per turn producing a full `QueryPlan`.** The planner
   receives the question, the previous validated plan, and a compact catalog
   summary, and returns a complete plan: target sources, filters expressed only
   with catalog fields and values, the free-text semantic query, sort, limit,
   and display fields. Code validates every element against the catalog and
   value indexes; anything unresolved becomes a clarification. The next turn
   replaces the whole plan instead of applying typed operation deltas.
4. **Code-owned execution.** For each target source, in parallel: exact filters
   through the existing authorized read services, then hybrid lexical+vector
   retrieval within the filtered set, optional reranking, then a merge that
   keeps the source label on every result. Answers show original text only.
5. **Latency budget.** Screen-complete p95 at most 5 seconds on the business
   Pi5 kiosk browser; planning at most 1.5 s, retrieval at most 0.5 s per source
   (in parallel), and reranking at most 1 s.
6. **Offline evaluation is a required gate.** A gold set (question, optional
   prior turns, expected plan, expected record ids) per source and across
   sources is evaluated locally without deployment. Gold sets containing
   business text stay outside Git; Git holds only schemas and synthetic
   fixtures. This lifts the earlier prohibition on adding verification
   infrastructure, by owner decision on 2026-09-23.
7. **JEV is the planner.** One JEV call per turn chooses among code-generated
   candidates. The DGX business LLM is not used for planning, because its
   answers have taken over a minute and it can be preempted by Private
   workloads (owner decision 2026-09-24). The per-question query embedding must
   not depend on DGX availability either; DGX is used for bulk indexing only.
8. **Freeze the current JEV path.** It stays deployed and usable with
   classification OFF, definition v4, and saved judgments unchanged. Only
   security or outage fixes are allowed; per-utterance behavior repairs stop.
   It is retired only after the new path passes its acceptance.

## Alternatives

- **Continue the per-record JEV classification path.** Rejected: taxonomy per
  source, LLM cost linear in records, one-third coverage after days, and a
  growing operation-decision surface.
- **Hermes native agent loop with MCP tools.** Rejected for this slice:
  measured 20-60 s and unstable tool arguments. It remains the consultation
  route governed by ADR-20260907.
- **Pure vector retrieval without structured filters.** Rejected: cannot
  express organization, date, count, or sort conditions reliably, which the
  exact-branch evidence shows are common.
- **A dedicated classifier per source.** Rejected: multiplies the current
  maintenance cost by the number of sources.

## Consequences

- Adding a source means a catalog entry, a read adapter, an ingest job, and
  gold-set cases, without editing the planner or the Chat.
- Semantic coverage becomes all indexed records instead of classified ones.
- Retrieval accuracy on Japanese manufacturing text remains the main risk,
  because r10 already showed failures; it is measured before any UI work.
- Two paths coexist until acceptance, which costs some operational attention.
- Business question text continues to be sent to the external TypeSafe
  service, and JEV availability becomes a dependency of every answer. Each new
  source needs an explicit egress approval before its questions are sent.

## Validation

The linked ExecPlan defines the gold-set format, metrics, promotion thresholds,
and the screen-level 5-second measurement. This ADR is revisited if JEV cannot meet the
planning budget and plan accuracy together, or if hybrid retrieval cannot reach the recall threshold.

## Relationship To Other Decisions

This ADR covers the read-only record retrieval capability. It does not replace
the consultation behavior policy in ADR-20260907 (purpose understanding,
case continuity, learning); that workflow may later call this retrieval
capability as one of its tools.

## Local Notes JA

- 要件（オーナー 2026-09-23）: 不適合以外の異なるデータも将来対象、横断取得、5秒以内、スケーラブル。
- 決定（オーナー 2026-09-23）: 手元評価基盤を許可、JEVとDGXは比較して選定、現行JEV経路は凍結、ADRとExecPlanを先に確定。
- 決定（オーナー 2026-09-24）: 検索計画はJEVのみ。DGX Sparkは回答に1分以上かかった実績があるため比較対象から外す。
- 決定（オーナー 2026-09-24）: Phase 1 は不適合情報のみで完成させる。仕組みはソース非依存で作り、2つ目のソース接続と横断統合は後続フェーズ。
