---
title: "ADR-20260907: Hermes business butler design policy v1"
status: accepted
date: 2026-09-07
deciders: [project owner, Hermes gate review]
tags: [hermes, business-butler, consultation-case, memory, mcp, security]
related:
  - ../plans/business-hermes-butler-phase1-execplan.md
  - ../plans/business-hermes-butler-gate-execplan.md
---

# ADR-20260907: Hermes business butler design policy v1

## Status

**accepted** as the durable design policy. The technical gate is still in
progress and has not passed. This ADR does not claim mixed natural-dialogue
acceptance, application implementation, commit, pull request, deployment, or
production change. A separate Pi5-approved read-only synthetic DGX probe is
recorded as capability evidence only.

## Context

The business assistant should help a person understand a work problem and
decide what to do next. The person may begin with a natural-language problem,
an existing photo or document reference, a part number, or no identifier at
all. The assistant must understand the counterpart's difficulty and the
business evidence before presenting a conclusion.

The current route is a bounded classify -> API search -> chat flow:
`apps/api/src/routes/assembly/business-hermes.ts` calls
`apps/api/src/services/assembly/business-hermes-chat.service.ts`, which uses
`apps/api/src/services/assembly/business-hermes.service.ts`. The current UI
keeps a twelve-message request window and has no durable business consultation
case. The policy must preserve existing JWT roles, `clientKey` authentication,
imports, publication rules, active photo boundaries, lightweight Pi4 behavior,
and the existing DGX runtime.

## Decision

### Six behavior principles

1. **Purpose understanding:** understand what the counterpart is struggling
   with, what decision they need to make, and what outcome they need.
2. **Business-background understanding:** relate items, photos, document text,
   identifiers, and relationships while naming the source of truth.
3. **Autonomous exploration:** select the next authorized read-only search from
   the result just received and change the search when the situation changes.
4. **Necessary dialogue and correction:** ask only for the missing fact needed
   to proceed, make ambiguity and conflict explicit, and apply corrections to
   the ongoing consultation.
5. **Confirmed/unresolved continuity:** keep what is confirmed, what remains
   unresolved, and what must be followed up so an authorized person can resume
   the consultation later.
6. **Learning from experience:** retain reviewable outcomes and corrections as
   bounded operational knowledge so future procedures can improve; v1 does not
   self-train or write business data automatically.

This is a behavior-first policy. RAG, embeddings, MCP, prompt layout, and
storage are implementation choices; the behavior and authorization boundaries
are defined before choosing among them.

### Responsibility separation

| Responsibility | Meaning in v1 |
| --- | --- |
| **SOUL** | Personality, conversational stance, humility, and how Hermes asks, explains, and acknowledges correction. |
| **Context** | Current business background: item, existing photo/document reference, relationship, source-of-truth status, and decision under consideration. |
| **Memory** | The official Hermes Memory capability is for continuing facts exposed by the Hermes runtime. It is not the application's authorization boundary or case database. |
| **Skills** | Reusable procedures for understanding purpose, exploring, comparing candidates, citing evidence, clarifying, correcting, and resuming. |
| **Tools / MCP** | Authorized exploration means. They expose bounded business capabilities and never credentials, unrestricted SQL, or business writes. |

The application's own database stores consultation history and state separately
from official Hermes Memory: messages, source references, confirmed facts,
unresolved items, corrections, summary, and title. A Hermes session
ID is a conversation scope, not a principal or an authorization namespace.

### Independent consultation cases

Each consultation has an opaque application case ID and an authorized caller.
It is independent of a part number, manufacturing order,
nonconformity number, work session, and Hermes session at creation. These may be
relationships discovered or corrected later. A title or relationship
correction is reviewable and must not silently merge cases.

Case A and case B must not share conversation history, unresolved items,
corrections, or summaries. The same latest active
nonconformity snapshot, published work-instruction pointer/text, or authorized
photo may be referenced by both cases; shared source evidence is normal and is
not a case-state leak.

Existing authentication and read visibility remain the source of truth. This
policy does not introduce a new principal/case/row ACL model. The application
continues to enforce existing JWT roles and `clientKey` access, publication
conditions, active asset rules, bounded counts, and authenticated asset URLs.

### Initial scope

The small start is limited to nonconformity and work-instruction photo/text
activity. It is not limited to part-number lookup or a scripted conversation.
Initial read-only capabilities may explain an authorized concept, search
condition/description text, and retrieve bounded detail with public version,
edited content, active photo asset ID, source version date, and provenance.

The initial intake supports natural language, an unknown number, or a known part
number and existing authorized references. Cards are built by the server from
authorized results; a model-written URL or path is not evidence.

### Runtime and safety boundary

The first protocol gate uses the fixed official Hermes image, official
`/v1/responses`, and a disposable read-only MCP fixture in an isolated local
harness. This is a deliberate phase1 test of the official/native tool loop; it
does not contradict the policy that MCP must not be selected before the desired
behavior is understood, and it does not make MCP the permanent retrieval
architecture by itself.

Hermes owns its native model/tool/result loop. The application owns existing
authentication, case identity, consultation history, trusted card projection,
timeouts, cancellation, and audit metadata. The gate must also verify the
existing DGX capability boundary, card provenance, case-state separation, and
recovery before later implementation begins.

Keep Raspberry Pi 4 work lightweight and the existing DGX runtime. Do not add a
new data source, business write, cron job, unauthorized image upgrade, or custom
application-side agent loop. If the gate fails, stop and return the evidence to
the supervising reviewer before later implementation.

## Alternatives considered

### Choose RAG or MCP before defining behavior

Rejected. A retrieval mechanism cannot decide how to understand the decision,
handle ambiguity, reflect corrections, or continue a case. The phase1 fixture
uses MCP only because the fixed-image protocol gate needs a bounded read-only
tool surface.

### Limit v1 to part-number lookup and scripted conversation

Rejected. That would fail unknown-number intake and evidence-driven exploration.

### Treat Hermes Memory or session IDs as the application case database

Rejected. Official Memory is a runtime continuity capability, and a session ID
is a conversation scope. Application history, authorization, unresolved state,
and handoff require an application-owned case.

### Prohibit the same source from appearing in multiple cases

Rejected. Published business evidence may legitimately support several
consultations. The isolation requirement applies to case state, not shared
public source records.

## Consequences

The assistant can start before an identifier is known, adapt its exploration,
show evidence provenance, and resume an authorized consultation after a
handoff. The server remains the authority for access, publication, assets,
history, corrections, and case separation.

The implementation needs an application case record and a bounded read-only
adapter. Search quality remains constrained by existing records and document
representations until observed behavior justifies a separate retrieval decision.

## Validation

The linked [phase1 ExecPlan](../plans/business-hermes-butler-phase1-execplan.md)
defines the implementation sequence, and the linked [technical gate plan](../plans/business-hermes-butler-gate-execplan.md)
defines the initial fixed-image fixture. The gate is currently **in progress and
not passed**. Required later behaviors include unknown-number intake,
part-only search, cross-source checking, correction, explicit no-result/
multiple/contradictory handling, next-day handoff, case-state isolation,
failed/canceled recovery, natural dialogue, and measured lightweight Pi4
operation. These are requirements, not claimed results.

## Local Notes JA

### Hermes業務執事・設計方針 v1

目的理解（相手が困り判断したいこと）、業務背景理解（項目/写真/相互関係/正本）、自主探索（取得結果に応じ調べ方変更）、必要な対話と訂正反映、案件の確認済未解決の継続、経験から改善を中核とする。

公式の責務分離は、SOUL=人格/対話、Context=業務背景、Memory=Hermes公式の継続事実、Skills=手順、Tools/MCP=探索手段。案件の会話履歴・確認済/未解決・訂正・要約・担当はアプリDBで別管理し、Hermes公式Memoryやsession IDを認証境界にしない。

RAG/MCPを先に決めず振る舞いを軸にする。ただしphase1の技術ゲートでは、固定Hermes imageの公式`/v1/responses`とread-only MCP fixtureを隔離localで検証する。小さな開始範囲は不適合と要領書の写真/本文に限定するが、品番検索や定型会話だけに限定しない。公開資料は複数案件から参照でき、案件A/Bで混ぜないのは会話履歴・途中状態・確認済/未解決・訂正・要約・担当である。

## References

- [Hermes business butler phase1 ExecPlan](../plans/business-hermes-butler-phase1-execplan.md)
- [Hermes business butler technical gate plan](../plans/business-hermes-butler-gate-execplan.md)
- [Current business Hermes route](../../apps/api/src/routes/assembly/business-hermes.ts)
- [Current business Hermes chat service](../../apps/api/src/services/assembly/business-hermes-chat.service.ts)
- [Current business Hermes upstream service](../../apps/api/src/services/assembly/business-hermes.service.ts)
- [Work-instruction manifest](../../apps/api/src/services/work-instructions/domain/manifest.ts)
