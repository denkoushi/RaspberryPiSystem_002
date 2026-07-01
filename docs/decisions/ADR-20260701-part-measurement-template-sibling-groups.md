# ADR-20260701: 検査図面テンプレ兄弟グループ

## Status

accepted

## Context

- 現仕様では `PartMeasurementTemplate` は `fhincd + processGroup + resourceCd + version` を正本キーとし、記録表・自主検査も資源CD単位でテンプレートを解決する。
- 検査図面の新規作成では、同じ図面・測定点・公差を複数資源CDへ同時に登録したい。
- 一方で、1資源だけ測定内容が変わる場合は個別改版でき、以後のまとめて改版で上書きされない必要がある。
- 図面ライブラリでは、同時作成した複数資源テンプレを1まとまりとして表示し、一覧のアイテム数増加と横幅の無駄を抑えたい。

## Decision

1. `PartMeasurementTemplate` に複数資源CDを直接持たせない。従来どおり **資源CDごとに1テンプレ実体**を作る。
2. 同時作成・まとめて改版対象を表すため、`PartMeasurementTemplateSiblingGroup` を追加し、`PartMeasurementTemplate.siblingGroupId` で任意に紐づける。既存テンプレは `null` のまま互換動作する。
3. 兄弟グループは `displayName`, `fhincd`, `processGroup` を持ち、表示名とグループ対象の境界だけを管理する。資源CD・版履歴・測定点・図面参照は引き続き各 `PartMeasurementTemplate` が保持する。
4. 複数資源作成・まとめて改版・資源追加は、対象資源CDを昇順に処理して既存 lineage advisory lock を資源CDごとに取得する。
5. 個別改版は `detachFromSiblingGroup: true` を明示し、新バージョンの `siblingGroupId` を `null` にする。以後のグループ改版対象には含めない。

## Alternatives

| 案 | 却下理由 |
|----|----------|
| 1テンプレに複数資源CD配列を持たせる | 記録表・自主検査の既存解決が資源CD単位であり、検索・一意制約・履歴管理の変更範囲が大きい |
| UIだけで複数テンプレを束ねる | API から兄弟関係を復元できず、まとめて改版・資源追加・個別分離の境界が不安定になる |
| 個別改版後もグループに残す | まとめて改版で資源固有の変更を上書きする危険がある |

## Consequences

- 良い: 記録表・自主検査の資源CD単位解決を壊さず、複数資源への一括作成とまとめて改版を追加できる。
- 良い: 既存テンプレは `siblingGroupId = null` のまま動作し、移行時に既存データの意味を変えない。
- 良い: 図面ライブラリは兄弟グループを1カードに集約でき、資源CDはチップで表示できる。
- 悪い: 同じ図面・測定点のテンプレ行は資源数ぶん増える。API DTO と一覧 UI はグループ要約を返して表示密度を保つ。

## Verification

- 一時 Postgres `pgvector/pgvector:pg15` に migration を適用し、API integration test `part-measurement.integration.test.ts` を実行する。
- `PartMeasurementTemplate.siblingGroupId + isActive` と既存 `fhincd + processGroup + resourceCd` の検索が index scan になることを `EXPLAIN` で確認する。
- 検証後は一時 Postgres コンテナを削除し、既存DB・既存コンテナには書き込まない。

## References

- [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-複数資源兄弟グループ-2026-07-01)
- [Runbook](../runbooks/kiosk-part-measurement.md#検査図面-複数資源兄弟グループ-2026-07-01)
- [ADR-20260401: 部品測定 Phase2](./ADR-20260401-part-measurement-phase2-resource-cd.md)
- [ADR-20260404: テンプレ候補選択と別資源テンプレ借用](./ADR-20260404-part-measurement-template-pick-kiosk.md)
