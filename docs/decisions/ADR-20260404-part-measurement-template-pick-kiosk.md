# ADR-20260404: キオスク部品測定のテンプレ候補選択と別資源テンプレ借用

## Status

accepted

## Context

- テンプレートは従来 **`FHINCD` × `processGroup` × `resourceCd`** で一意に選ばれ、`POST /part-measurement/sheets` では **テンプレの資源CDと `resourceCdSnapshot` の一致**が必須だった。
- 現場では **表用・裏用で資源とテンプレが分かれる**一方、**同じ部品を1資源だけで測る**場合に、別資源向けに登録したテンプレの項目セットを流用したい要件がある。
- 記録上の「どの機で測ったか」は **生産スケジュール由来の `resourceCdSnapshot`** を正としたい。

## Decision

1. **`GET /api/part-measurement/templates/candidates`**  
   キオスク用に、同一品番・別資源・（任意）品名ヒントによる類似テンプレを返す。`matchKind` と `selectable` で並び替え・選択可否を明示する。
2. **`POST /api/part-measurement/sheets` に `allowAlternateResourceTemplate`（任意）**  
   - 省略または `false`: 従来どおり **テンプレ資源 = スナップショット資源** が必須。  
   - `true`: **`FHINCD` と `processGroup` のみ**テンプレと一致すればよく、**資源CD不一致を許容**する。`resourceCdSnapshot` はリクエストの日程資源のまま保存する。
3. **`matchKind === fhinmei_similar`（品番相違）** は **記録表作成不可**（`selectable: false`）。誤った品番への記録を防ぐ。

## Alternatives

- **スキーマでテンプレに複数資源を持たせる**: 柔軟だがマイグレーションと管理UIが大きい。
- **候補APIのみで常に資源一致のみ選択可能**: 実装は小さいが、1資源での表裏テンプレ流用要件を満たさない。

## Consequences

- **良い**: 現場の「機＝スナップショット」「項目セット＝テンプレ借用」を分離できる。既存の厳格経路はデフォルト維持（OCP）。
- **悪い**: `allowAlternateResourceTemplate: true` の監査・運用説明が必要。キオスククライアントが意図せずフラグを付けると別資源テンプレが載る（`fhincd` / 工程は依然チェック）。

## References

- [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md)
- 静的UI参考: [kiosk-part-measurement-template-picker.html](../design-previews/kiosk-part-measurement-template-picker.html)
