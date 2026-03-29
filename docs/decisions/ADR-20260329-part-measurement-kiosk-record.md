# ADR-20260329: キオスク部品測定記録ドメイン（テンプレキーと記録単位）

## Status

accepted

## Context

- 工場キオスクで、移動票バーコードと生産スケジュール（CSV ダッシュボード）を参照しながら、部品ごとの測定値を記録したい。
- 計測機器点検など既存の「計測」系機能とは目的が異なるため、ドメインを分離する必要がある。
- 生産スケジュール上の `FSIGENCD`（資源CD）は現場表記と乖離しやすく、API 公開契約にそのまま載せるとクライアントがポリシー実装に引きずり込まれる。

## Decision

1. **独立ドメイン `part-measurement`**  
   Prisma モデル・API ルート・Web の `features/part-measurement` を新設し、既存の measuring-instruments とは共有しない。

2. **テンプレート選択キーは `fhincd`（FIHNCD / 品番）+ `processGroup`**  
   - 公開 API の `processGroup` は **`cutting` | `grinding`** のみとする。  
   - DB 内部は `PartMeasurementProcessGroup`（`CUTTING` / `GRINDING`）で保持し、境界（ルート層）で変換する。  
   - 資源CDから工程区分を決めるロジックは **既存の resource category ポリシー** に寄せ、adapter に閉じ込める。

3. **記録のヘッダ単位は製番 `FSEIBAN`（スナップショット）**  
   票解決時に生産スケジュール行から `productNo` / `fseiban` / `fhincd` / `fhinmei` / `machineName` 等を解決し、シート作成時にスナップショットとして保存する。後からマスタが変わっても当時の表記を残す。

4. **保存フローは下書き自動保存 → 確定**  
   `PartMeasurementSheet.status` を `DRAFT` / `FINALIZED` で表し、キオスクは PATCH で随時保存、finalize で確定する。

## Alternatives

- **テンプレキーを `fhincd` のみにする**: 切削/研削で測定項目が異なるため、工程グループをキーに含める方が運用に合う。
- **記録単位を `ProductNo` のみにする**: 現場の票・トレーサビリティは製番単位が主であるため `FSEIBAN` を正とする。
- **`FSIGENCD` を API に露出**: クライアント重複と誤判定の温床になるため却下。

## Consequences

- **良い**: 契約が単純（`cutting`/`grinding`）、テンプレと現場工程の対応が明確、既存スケジュール参照と疎結合。
- **悪い**: テンプレとマスタの組み合わせが増えるため、管理画面でのテンプレ登録・有効版切替の運用が必要。
- **移行**: 新規マイグレーション `PartMeasurement*` テーブル追加。既存データへの影響なし。

## Verification（本番・2026-03-29）

- **デプロイ**: カナリアとして Pi5 → `raspi4-kensaku-stonebase01` のみを [deployment.md](../guides/deployment.md) の `update-all-clients.sh` + `--limit` 順次で反映（Pi3 は別手順のため今回対象外）。
- **自動**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 37 / WARN 0 / FAIL 0**。`resolve-ticket` がキオスク `x-client-key` で 200・JSON に `candidates`、無キー POST が **401**。
- **手動（残）**: 現場キオスクでのスキャン・下書き・確定の目視。テンプレ未登録時の画面メッセージは [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) を参照。

## References

- 実装: `apps/api/src/services/part-measurement/`, `apps/api/src/routes/part-measurement/`, `apps/web/src/pages/kiosk/KioskPartMeasurementPage.tsx`
- Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
- KB: [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md)
