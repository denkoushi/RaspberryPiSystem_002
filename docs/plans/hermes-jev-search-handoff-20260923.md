---
id: hermes-jev-search-handoff-20260923
title: Hermes/JEV record-search handoff and completion boundary
status: in-progress
last_verified: 2026-09-23
---

# Hermes/JEV record-search handoff

> **Frozen 2026-09-23:** by owner decision this path receives only security or
> outage fixes. New retrieval work follows
> [ADR-20260923](../decisions/ADR-20260923-hermes-cross-source-retrieval.md) and its
> [ExecPlan](./hermes-cross-source-retrieval-execplan.md).

## Outcome and boundary

The requested user outcome is to ask the existing floating Chat in natural
language, retrieve the appropriate authorized business record, and show its
original text without rewriting it. For this workstream, the connected source
is the latest valid nonconformity data. JEV makes bounded semantic judgments;
code owns authorization, exact conditions, candidate sets, state transitions,
retrieval, and display. Do not add question-, department-, factory-, or
record-specific exceptions to make an acceptance phrase pass.
TypeSafe Choice selects one interpretation, not one factory or one record.
Same-meaning candidates can remain a search set; an unknown or genuinely
scope-changing interpretation needs clarification. A well-defined search
returning zero rows is not an interpretation failure. Source-field meanings
stay in the existing source definition/adapter, not a second Chat dictionary.

This is one read-only search slice, not completion of the broader business
Hermes consultation workflow. The latter has a separate accepted behavior
policy in [ADR-20260907](../decisions/ADR-20260907-hermes-business-butler-design-policy-v1.md)
and its own [phase-1 plan](./business-hermes-butler-phase1-execplan.md).
That policy includes purpose understanding, authorized exploration, dialogue
and correction, case continuity, and reviewable learning. Passing the search
trial cannot by itself certify those behaviors. The previous handoff repeatedly
treated a count of accepted search utterances as product completion; do not
repeat that inference.

## Implemented path and relevant history

The current merged search path is: floating Chat `JEV記録` -> authenticated
`POST /assembly/hermes-search-trial/answer` -> API service -> Node 24 worker ->
JEV query judgments and code-owned organization/condition resolution ->
validated `SearchDelta` and session `SearchState` -> either the existing live
PostgreSQL/read service for exact plans or the saved-classification reader for
semantic plans -> original-text response. The main modules are
[`hermes-jev-record-classifier.mjs`](../../scripts/hermes-search/hermes-jev-record-classifier.mjs),
[`hermes-resolution-policy.mjs`](../../scripts/hermes-search/hermes-resolution-policy.mjs),
[`hermes-search-state.mjs`](../../scripts/hermes-search/hermes-search-state.mjs),
and [`hermes-search-trial.service.ts`](../../apps/api/src/services/assembly/hermes-search-trial.service.ts).

Relevant merged milestones, in order:

| PR | What it established or repaired |
| --- | --- |
| [#1440](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1440), [#1453](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1453), [#1456](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1456) | Initial JEV record pilot, earlier organization-scope repair, and explicit classification-OFF operation. |
| [#1459](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1459) | Shared organization candidate sets, ambiguity impact, `SearchState`/Delta, and live exact-search handoff. |
| [#1460](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1460), [#1461](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1461) | Preserve approved trial settings during standard Deploy and restore the entry through the regular maintenance path. |
| [#1462](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1462), [#1463](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1463) | Select only the condition being removed; distinguish a source-field heading from a condition value. |
| [#1464](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1464), [#1465](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1465) | Return bounded JEV/code operation diagnostics; support a display-only operation without changing search predicates. |
| [#1467](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1467), [#1471](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1471) | Separate condition mention, real change, and conflict; allow different operation readings only when their normalized resulting searches are provably equivalent. |

The earlier 503 investigation is separate from search semantics; see
[#1469](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1469).
The merged/deployed search head checked for this handoff was
`f68becb95b07cfdde4c9166cbb11e57d07e3aebe` (#1471). Recheck the active
API and worker version before any later acceptance attempt; a past container
identity is not proof of the current one. No search code, JEV question,
threshold, classification definition, or Deploy setting changes are part of
this handoff.

## Evidence and limits as of 2026-09-23

- Eight successive utterances from the previously agreed conversation were
  submitted in one new `JEV記録` screen session. Their actual authenticated API
  response JSONs were saved and reread. State revisions and before/after
  fingerprints formed a continuous chain. All eight returned `completed`.
- **All eight plans were `exact`.** Ordered record IDs and returned original
  text matched independent read-only queries against the then-current valid
  PostgreSQL data. The multi-factory OR plus department AND case completed and
  agreed with the database. This proves that exact branch for these cases; it
  does **not** prove the classified/semantic branch or general natural-language
  correctness.
- The response contract did not expose explicit request/session UUIDs. A
  Network response row, question hash, timestamps, and SearchState continuity
  linked the saved responses to the screen conversation. Do not present this
  as a recovered UUID or as the lost raw judgment from an older request.
- Before and after those eight utterances, the classification gate was OFF,
  definition v4 held 2,764 saved judgments, and the classification-store hash
  matched. A pre-Deploy store hash was not captured; no pre/post-Deploy equality
  claim is possible.
- The remaining previously fixed three-turn case that exercises meaning-based
  search/correction, and a separate-session Exact case, were **not run** in
  this acceptance attempt. Do not count them as pass or fail. Their **exact
  screen wording** is in the earlier #1471 screen-acceptance record in local
  Codex task `01a0cd41-5bd7-7960-81cf-6ca9fc8c5055` (host `local`), not in
  the [search follow-up plan](./hermes-background-worker.md). The next agent
  must read that task before submitting anything; if it is unavailable, stop
  rather than infer wording from shorthand or change the case. The wording is
  intentionally not copied to public GitHub because it contains business
  terms. The fixed transitions, stated without those terms, are:

  | Turn | Expected search-state/result behavior |
  | --- | --- |
  | 1 | New meaning-based search for a process plus two requested original-text fields; retain the positive process condition. |
  | 2 | Add the specified facility while retaining the process condition. |
  | 3 | Treat corrective feedback as a correction; retain the process and facility as positive conditions, not exclusions. |
  | Separate Exact | Start a fresh session; return the latest two authorized records under its explicit facility condition. |
- The current semantic reader skips records without saved classifications;
  exact plans use the existing live read service and include valid unclassified
  records. This is the current, explicitly bounded source behavior, not proof
  that every natural-language semantic query covers all current records. Full
  reclassification, new sources, and a new retrieval framework were excluded
  from this workstream.

Private response files are intentionally **outside Git** at
`/Users/tsudatakashi/Documents/Codex/2026-09-23/hermes-or-diagnosis/private-evidence/`:
`sequence-run3-01.json` through `sequence-run3-08.json` and
`pre-validation-store.json`. Their directory/file modes were `0700`/`0600`.
They include business text; never commit, paste into a PR/CI log, or publish
them. The live API response itself must be used for subsequent decisions; a
screen paragraph or server log is not an equivalent substitute.

## Current block and safety note

The prior acceptance stopped while preparing the remaining cases. A separate
browser's accessibility output unexpectedly included credential-like material;
an earlier browser inspection also exposed an authentication header in tool
output. Do not repeat those values, read more credential-bearing headers, or
copy them into this repository. Credential review/rotation belongs to the
authorized operator and is separate from search logic. The previously working
Safari Network-response capture was no longer bound to the automation
surface, so no remaining JEV prompt was submitted. Do not claim an acceptance
failure from that tooling interruption.

## Next agent: decision sequence, not a new backlog

1. Start from the user outcome and the accepted business-Hermes policy above.
   State separately whether the requested decision is **this nonconformity
   search slice** or the broader consultation workflow. Do not call one the
   other. Read the current active code/PR head, not an old worktree.
2. For the bounded search slice, recover a safe capture of the existing
   authenticated screen request/response without storing auth headers or
   creating a second search/diagnostic path. Recheck the active API/worker and
   classification gate/store hash. If safe capture is unavailable, report a
   validation blocker instead of speculatively editing search code.
3. Read the cited Codex task to recover the exact original screen wording,
   then run only those fixed remaining utterances in the original order; the
   independent Exact request needs a fresh session. For each same
   response, inspect JEV judgments, code acceptance/rejection,
   `SearchDelta`/`SearchState`, plan mode, unresolved conditions, ordered IDs,
   and raw-text equality against the corresponding current source/DB.
   A clarification is judged against its fixed expectation; do not drop an
   unresolved condition or change the wording to force success.
4. If a real failure exposes a shared-rule defect, identify the exact decision
   boundary and propose the smallest change through normal PR/CI/review/Deploy.
   If no defect is demonstrated, do not add one. Report a bounded search
   acceptance outcome separately from the broader business-Hermes product
   readiness and from the credential incident.

The original user prohibited new OSS/SDKs, verification infrastructure,
question-specific exceptions, threshold relaxation, reclassification, direct
environment overwrite, force-kill, and bypassing safety gates. Preserve
classification OFF, definition v4, the saved judgments, Node 24,
authorization, and original-text display unless a future explicitly scoped
request changes them.
