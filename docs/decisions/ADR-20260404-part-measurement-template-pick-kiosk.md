# ADR-20260404: キオスク部品測定のテンプレ候補選択と別資源テンプレ借用

## Status

accepted

## Context

- テンプレートは従来 **`FHINCD` × `processGroup` × `resourceCd`** で一意に選ばれ、`POST /part-measurement/sheets` では **テンプレの資源CDと `resourceCdSnapshot` の一致**が必須だった。
- 現場では **表用・裏用で資源とテンプレが分かれる**一方、**同じ部品を1資源だけで測る**場合に、別資源向けに登録したテンプレの項目セットを流用したい要件がある。
- 記録上の「どの機で測ったか」は **生産スケジュール由来の `resourceCdSnapshot`** を正としたい。

## Decision

1. **`GET /api/part-measurement/templates/candidates`**  
   キオスク用に **登録スコープ別**に候補を束ねる。正本は `templateScope=THREE_KEY`（`FHINCD`×`processGroup`×`resourceCd`）。2要素候補は `FHINCD_RESOURCE`（照合: `FHINCD`+`resourceCd`、工程は日程側）。1要素候補は `FHINMEI_ONLY` でテンプレ側の **`candidateFhinmei`** と日程 **`fhinmei`** を照合する（**2026-04-05**: 双方を NFKC+lower+空白正規化したうえで、**日程文字列が候補キーを `includes` する部分一致**。候補キーは **正規化後 2 文字以上**（誤ヒット抑制）。同 `matchKind` 内の並びは **正規化後キー長の降順**でタイブレーク。別品番からの `name` 検索は廃止のまま）。  
   `matchKind` は表示・並び用（`exact_resource` → `two_key_fhincd_resource` → `one_key_fhinmei`）。**`selectable` は常に true**（非 exact は複製APIで日程3要素へ着地してから記録する）。
2. **`POST /api/part-measurement/sheets` に `allowAlternateResourceTemplate`（任意）**  
   - 省略または `false`: 従来どおり **テンプレ資源 = スナップショット資源** が必須。  
   - `true`: **`FHINCD` と `processGroup` のみ**テンプレと一致すればよく、**資源CD不一致を許容**する。`resourceCdSnapshot` はリクエストの日程資源のまま保存する。
3. **`matchKind === one_key_fhinmei`（`FHINMEI_ONLY` 候補）** も **選択可能**。選択後は下記 **複製API** で日程の `FHINCD + 工程 + 資源CD` にテンプレを自動作成してから記録する（正本は常に日程側の3要素）。
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
- **悪い**: 1要素候補は **同一FHINMEI表記の部品混同**リスクがありうる。登録時は `candidateFhinmei` を明確にし、現場は図面・候補説明で確認する。複製で正本テンプレが増えるため、管理画面での整理が必要になりうる。
- **悪い（レガシー）**: `allowAlternateResourceTemplate: true` を使う経路は引き続き監査対象。

## Verification

- **2026-04-04（`feat/kiosk-part-measurement-template-auto-clone` 本番反映後）**: Pi5 → Pi4×4 を順次デプロイ（Detach Run ID は [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) Phase12 節）。Mac / Tailscale から `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 91s）。部品測定 API スモーク（`resolve-ticket`・`templates/candidates` 認可）に加え、キオスクは checklist §6.6.9 の手動で複製→記録を推奨。
- **2026-04-05（`feat/part-measurement-fhinmei-partial-match` 本番反映後）**: 同上デプロイ方針（Pi3 除外）。`verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（約 132s・Pi3 サイネージ WARN は運用上スキップ可）。`FHINMEI_ONLY` の **部分一致・最短長・タイブレーク**の手動確認は checklist §6.6.9・[KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) を参照。

## References

- [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md)
- 静的UI参考: [kiosk-part-measurement-template-picker.html](../design-previews/kiosk-part-measurement-template-picker.html)
