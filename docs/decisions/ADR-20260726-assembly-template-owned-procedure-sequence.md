# ADR-20260726: Assembly Template-Owned Procedure Sequence

- Status: accepted
- Date: 2026-07-26
- Scope: assembly template editor, template versioning, work-session procedure sequence
- Supersedes (partial):
  - [ADR-20260707 assembly procedure order library scope](./ADR-20260707-assembly-procedure-order-library-scope.md)
  - [ADR-20260708 assembly page-level markers and publish gate](./ADR-20260708-assembly-page-level-markers-and-publish-gate.md)
- Related plan: [assembly unified template editor ExecPlan](../plans/assembly-unified-template-editor-execplan.md)

## Context

機種名別の`AssemblyProcedureOrderSet`と版管理された`AssemblyTemplate`が別々に保存され、テンプレートエディターは前者を表示候補に使うだけだった。作業セッションも最新の機種名別順を再読込するため、同一template版の表示内容が後から変化し、閲覧順から外した文書上のマーカーが到達不能になり得た。

## Decision

1. 新しい`AssemblyTemplateProcedureItem`を追加し、順序付き文書列をtemplate版の一部として保存する。
2. template作成・改版は、文書列、工程、締付/チェックマーカーを一transactionで保存する。
3. 作業セッションはtemplate所有列を優先する。列がない既存templateだけ機種名別order、その後primary documentへfallbackする。
4. 新形式保存は共有2520パスワードを要求する。旧payloadと旧order APIはローリング互換用に残す。
5. 既存templateは一括backfillせず、次回改版時に新形式へ固定する。
6. 新規追加元は公開済みの`AssemblyProcedureDocument`に限定し、既存`KioskDocument`参照は互換表示・改版を維持する。

## Consequences

- template版に紐づく作業手順は再現可能になる。
- 旧templateは改版まで従来fallbackを使うため、構造化ログで残存を観測する。
- `procedureDocumentId`は互換用に維持し、文書列で最初に現れる組立手順書と一致させる。
- 独立した閲覧順編集UIは廃止するが、APIとDBはこのreleaseでは削除しない。
