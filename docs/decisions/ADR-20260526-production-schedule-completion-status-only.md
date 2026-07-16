# ADR-20260526: 生産日程の完了正本を手動完了と FKOJUNST_Status C/X に限定する

- **Status**: accepted
- **Context**:
  - キオスク順位ボードのグレーアウトは `ProductionScheduleProgress.isCompleted` と `ProductionScheduleExternalCompletion.isExternallyCompleted` の実効完了で決まる。
  - 2026-05-25 以前は、外部完了に **FKOJUNST_Status C/X** と **生産日程CSV差分消失** の2系統が含まれていた。
  - BA1S6202 / 資源CD 035 の調査で、Status が `R` または欠落している期間でも、過去の差分消失フラグにより現場残存行が完了グレーになることを確認した。
- **Decision**:
  - 実効完了の正本は **手動完了** と **FKOJUNST_Status の `C` / `X`** のみにする。
  - 生産日程CSV差分消失は完了判定に使わない。
  - `ProductionScheduleExternalCompletion.externallyCompletedFromScheduleCsvDisappeared` は後方互換・監査のため列を残すが、新規同期では true にせず、既存 true は false へ収束させる。
  - `ProductionScheduleExternalCompletion.isExternallyCompleted` は後方互換の集計・検索用に残し、`externallyCompletedFromFkojunstMailStatus` と同じ意味へ同期する。
- **Alternatives**:
  - **A: 差分消失を継続** — Status `R` と完了グレーが両立し、現場認識と表示が乖離するため却下。
  - **B: 差分消失に追加ガードを入れる** — 一部誤判定は減るが、完了正本が二重のまま残り説明性が低い。
  - **C: DB列も即削除** — 公開契約と過去調査の参照を急に壊すため見送り。
- **Consequences**:
  - **良**: `R` / `S` は未完、`C` / `X` は完了という説明に戻る。現場残存行が差分だけでグレーになる再発を防ぐ。
  - **良**: 順位ボード行、資源CDフッタチップ、納期管理、製番進捗が同じ完了意味を共有できる。
  - **悪**: 本当に生産日程から消えたが Status が `C` / `X` にならない行は自動完了しない。上流 Status の是正または手動完了で扱う。
## Implementation（2026-05-26 本番）

- **ブランチ**: **`fix/kiosk-completion-status-only`**（実装 **`a970e795`**）
- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 **`skipping: no hosts matched`**）
- **Detach Run ID**: **`20260526-121604-8450`**（`ok=134` `changed=4` `failed=0`）
- **マイグレーション**: **`20260526030000_disable_schedule_csv_disappearance_completion`** 適用済
- **Phase12**: **43/0/0**（約 **30s**）
- **事後 DB**: **`externallyCompletedFromScheduleCsvDisappeared=true` は 0 件**
- **記録**: [deployment.md §2026-05-26](../archive/deployments/2026-05.md#kiosk-completion-status-only-2026-05-26)

- **References**:
  - [KB-370 生産スケジュール「実効完了」](../knowledge-base/KB-370-production-schedule-external-completion-triple-source.md)
  - [KB-375 順位ボード・生産日程の完了整合](../knowledge-base/KB-375-kiosk-leaderboard-completion-integrity.md)
  - [ADR-20260508 FKOJUNST_Status 唯一正本](./ADR-20260508-fkojunst-status-sole-source.md)
  - [`fkojunst-external-completion-sync.repository.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts)
