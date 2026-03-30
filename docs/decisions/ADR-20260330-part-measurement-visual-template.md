# ADR-20260330: 部品測定 visual template（図面再利用・部位番号）

## Status

accepted

## Context

- キオスク部品測定の業務テンプレートは `FIHNCD + processGroup + resourceCd` で一意の有効版を解決する（Phase2）。
- 現場では **図面付き** の測定画面に慣れており、図中の番号と測定項目の対応を示したい。
- 似た部品では **FIHNCD が変わっても同じ図面** を使い回したい。
- 同一品番でも **表面/裏面** など **資源CDが異なるオペレータ** が別図面で入力するケースがある（PowerApps と同様に図面を分ける）。

## Decision

1. **業務テンプレート**（`PartMeasurementTemplate`）は既存どおり `FIHNCD + processGroup + resourceCd` を正とし、解決ロジックを変更しない。
2. **visual template**（`PartMeasurementVisualTemplate`）を別エンティティとし、**図面画像1枚**と表示用メタのみを保持する。`FIHNCD` に紐づけない。
3. 業務テンプレートは任意で `visualTemplateId` を参照する。未設定なら従来どおり表のみ UI。
4. 測定項目の **図番号表示**は `measurementPoint` に混ぜず、専用列 **`displayMarker`**（任意）で保持する。
5. 図面ファイルは **既存ストレージ配下**に保存し、`/api/storage/part-measurement-drawings/...` で配信する。認可は写真配信と同様 **JWT または有効な `x-client-key`**。
6. キオスクから **既存 visual template を選択**して業務テンプレートを新規作成できる導線を用意する（管理画面でも同様に選択可能とする）。

## Alternatives

- **図面を業務テンプレートに直接埋め込むだけ**: FIHNCD をまたいだ再利用が難しく、表面/裏面の差分もテンプレ複製で冗長になる。
- **番号を `measurementLabel` に埋め込む**: 表示と計測意味が混ざり、CSV・将来拡張で壊れやすい。

## Consequences

- 良い: 責務分離（業務キー vs 見たせ）、図面の再利用、表面/裏面は資源CD別テンプレ＋別 visual で表現可能。
- 悪い: Prisma マイグレーションと API・画面の追加が必要。`<img src>` では `x-client-key` を付けられないため、**Blob URL 取得**などクライアント側の取り回しが必要。

## References

- Phase1/2 ADR: [ADR-20260329-part-measurement-kiosk-record.md](./ADR-20260329-part-measurement-kiosk-record.md), [ADR-20260401-part-measurement-phase2-resource-cd.md](./ADR-20260401-part-measurement-phase2-resource-cd.md)
- Runbook: [../runbooks/kiosk-part-measurement.md](../runbooks/kiosk-part-measurement.md)
