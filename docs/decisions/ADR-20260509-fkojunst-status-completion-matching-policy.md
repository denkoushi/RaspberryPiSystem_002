# ADR-20260509: FKOJUNST_Status から本体生産日程への完了反映—照合キー・正規化・優先順位

- **Status**: accepted
- **Context**:
  - `FKOJUNST_Status`（メール CSV）と本体 `ProductionSchedule_Mishima_Grinding` は **別ソース**であり、特に **`FKOJUNST='C'` 行**は **本体 winner 行の論理キーと交わらない**ケースが多い（事実経緯は [KB-373](../knowledge-base/KB-373-fkojunst-status-c-key-domain-mismatch.md)）。
  - それでも **双方が揃う行については**、メール由来の工順 ST・完了状態を **一貫したルール**で反映したい。
- **Decision**:
  1. **反映粒度（完了・工順 ST の上書き対象）**: **`ProductNo` + 資源 CD（本体 `FSIGENCD` ↔ Status `FKOTEICD`）+ `FKOJUN`** が **厳密一致**した winner 行にのみ反映する（**部分一致・製番単位の推測付与はしない**）。
  2. **キー正規化**: 照合前に **trim + 大文字化（uppercase）** を適用する（各キー成分に対し同一ルール）。
  3. **再計算タイミング**: **`FKOJUNST_Status` 取込時**と **本体生産日程 CSV 取込時**の **両方**で、当該マッチングに基づく **`fkmail` / 外部完了**の整合を再計算する（どちらか一方に閉じない）。
  4. **衝突解決（同一キーに複数のステータス更新）**: **`FUPDTEDT` が最も新しい行を勝者**とする。**新しい行が `C` でない**なら、**古い `C` でも上書きされ得る**（**完了の取り消し**を許容）。
  5. **未マッチ `C`**: **本体に対応行が無い `C` は無視**する（**一覧に出さない・件数にも載せない**）。幽霊完了として扱わない。
- **Alternatives**:
  - **A**: `C` のみ **製番（ProductNo）単位**で全工程完了扱いにする — **誤完了リスク**が高く、キー空間不一致の根本原因を隠す。
  - **B**: `FKOJUN` を無視し資源 CD のみでマッチ — **別工程の誤結合**リスク。
- **Consequences**:
  - **良**: 反映範囲が説明可能で、**誤グレーアウト**を抑えられる。
  - **悪**: 上流が **別キー空間で `C` を出し続ける限り**、`fkmail` 上 **`C` が増えない**現象は続きうる。必要なら **上流 CSV の定義変更**または **別インテグレーション設計**が別 ADR になる。
- **References**:
  - [KB-373](../knowledge-base/KB-373-fkojunst-status-c-key-domain-mismatch.md)
  - [ADR-20260508-fkojunst-status-sole-source](./ADR-20260508-fkojunst-status-sole-source.md)
  - [`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts)
