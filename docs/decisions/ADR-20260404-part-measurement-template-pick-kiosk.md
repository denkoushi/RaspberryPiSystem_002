# ADR-20260404: キオスク部品測定のテンプレ候補選択と別資源テンプレ借用

## Status

accepted

## Context

- テンプレートは従来 **`FHINCD` × `processGroup` × `resourceCd`** で一意に選ばれ、`POST /part-measurement/sheets` では **テンプレの資源CDと `resourceCdSnapshot` の一致**が必須だった。
- 現場では **表用・裏用で資源とテンプレが分かれる**一方、**同じ部品を1資源だけで測る**場合に、別資源向けに登録したテンプレの項目セットを流用したい要件がある。
- 記録上の「どの機で測ったか」は **生産スケジュール由来の `resourceCdSnapshot`** を正としたい。

## Decision

1. **`GET /api/part-measurement/templates/candidates`**  
   キオスク用に、同一品番・別資源・（任意）品名ヒントによる類似テンプレを返す。`matchKind` で並び替え、**`selectable` は常に true**（非 exact は複製APIで日程3要素へ着地してから記録する）。
2. **`POST /api/part-measurement/sheets` に `allowAlternateResourceTemplate`（任意）**  
   - 省略または `false`: 従来どおり **テンプレ資源 = スナップショット資源** が必須。  
   - `true`: **`FHINCD` と `processGroup` のみ**テンプレと一致すればよく、**資源CD不一致を許容**する。`resourceCdSnapshot` はリクエストの日程資源のまま保存する。
3. **`matchKind === fhinmei_similar`（品番相違）** も **選択可能**（v2）。選択後は下記 **複製API** で日程の `FHINCD + 工程 + 資源CD` にテンプレを自動作成してから記録する（正本は常に日程側の品番）。
4. **`POST /api/part-measurement/templates/clone-for-schedule-key`（キオスク書込可）**  
   参照テンプレ（active）の **項目・図面（visual 参照）** をコピーし、リクエストの **日程3要素** で新しい active テンプレを `createTemplateVersion` 相当で作る。同一キーに既に active がある場合は **新規作成せず既存を返す**。
5. **キオスク `/template/pick` の記録開始**は `exact_resource` のみ **そのまま** `POST …/sheets`。それ以外の候補は **先に clone** し、得た `templateId` で **`allowAlternateResourceTemplate` なし**に `POST …/sheets` する。
6. **`allowAlternateResourceTemplate`**（`POST …/sheets`）は **互換のため維持**（管理・外部クライアントが明示する経路）。キオスク候補選択の主経路では使わない。

## Alternatives

- **スキーマでテンプレに複数資源を持たせる**: 柔軟だがマイグレーションと管理UIが大きい。
- **候補APIのみで常に資源一致のみ選択可能**: 実装は小さいが、1資源での表裏テンプレ流用要件を満たさない。

## Consequences

- **良い**: 記録表に載る業務テンプレは **常に日程の資源CDと一致**し、借用のまま残らない。品名類似からの流用も **日程品番へ着地**する。
- **良い（継続）**: 既存の `POST …/sheets` 厳格一致はデフォルト維持（OCP）。
- **悪い**: `fhinmei_similar` 選択は **類似品への誤コピー**リスクがある。現場は図面・候補説明で確認する。複製でテンプレが増えるため、管理画面での整理が必要になりうる。
- **悪い（レガシー）**: `allowAlternateResourceTemplate: true` を使う経路は引き続き監査対象。

## References

- [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md)
- 静的UI参考: [kiosk-part-measurement-template-picker.html](../design-previews/kiosk-part-measurement-template-picker.html)
