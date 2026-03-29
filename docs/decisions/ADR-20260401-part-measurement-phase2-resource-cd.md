# ADR-20260401: 部品測定 Phase2（resourceCd キー・状態拡張・キオスク主導線）

## Status

accepted

## Context

- Phase1 はテンプレートキーを `fhincd + processGroup` とし、現場の **資源CDをキーに含めない** 方針だった（[ADR-20260329-part-measurement-kiosk-record.md](./ADR-20260329-part-measurement-kiosk-record.md)）。
- 運用上、同一品番でも **資源（設備）ごとに測定項目が異なる** ケースがあり、生産スケジュール行単位で記録を分けたい。
- 下書き一覧・確定閲覧・CSV・編集ロック・取消/無効化をキオスクから一貫利用する必要がある。

## Decision

1. **テンプレートの一意キー**を `fhincd + processGroup + resourceCd + version` とし、有効版は `(fhincd, processGroup, resourceCd)` ごとに1件とする。
2. **記録シートの業務キー**を `製造order番号 + processGroup + resourceCd`（スナップショット列）とし、DRAFT/FINALIZED の一意制御をサーバーで保証する。
3. **状態**に `CANCELLED` / `INVALIDATED` を追加し、監査・ロック列を持つ。
4. **主導線**を生産スケジュール（および手動順番下ペイン）の行から `find-or-open` で開く。テンプレ未登録時はキオスクでテンプレ作成へ遷移する。
5. 移行済みデータの `resourceCd` 欠損はマイグレーションでプレースホルダ（例: `__LEGACY__`）を埋め、読み取り・参照用として区別する。

## Alternatives

- **資源CDをキーに含めず UI だけで絞る**: 実装は単純だが、DB 一意制約で競合・誤結合が防げない。
- **管理画面のみテンプレ運用**: 現場オペレーションの待ち時間が増えるため却下。

## Consequences

- 良い: 設備別テンプレ・記録の整合性、現場フローの完結性。
- 悪い: Phase1 ADR との文言差分が生じるため、索引・KB・Runbook の更新が必要。既存データは legacy キー扱いが混在しうる。

## Verification（本番）

- **自動**: `./scripts/deploy/verify-phase12-real.sh` — **PASS 37 / WARN 0 / FAIL 0**（2026-03-29、Pi5 + Pi4 キオスク 4 台反映後・Mac / Tailscale）。`POST /api/part-measurement/resolve-ticket` の `candidates` と無キー **401** を含む。
- **手動**: 各キオスクで実移動票の照会・下書き・自動保存・確定を目視（Runbook）。

## References

- Runbook: [kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
- KB: [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md)
- Phase1 ADR: [ADR-20260329-part-measurement-kiosk-record.md](./ADR-20260329-part-measurement-kiosk-record.md)
