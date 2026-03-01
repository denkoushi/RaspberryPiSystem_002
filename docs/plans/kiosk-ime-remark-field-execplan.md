# キオスク備考欄 IME 調査・実装 ExecPlan

このExecPlanは生きたドキュメントであり、作業の進行に合わせて `Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を常に更新しなければならない。.agent/PLANS.md に従って維持すること。

## Purpose / Big Picture

キオスク生産スケジュール備考欄で「日本語入力モードになるが、キー入力のたびに ibus-ui ウィンドウが出現しスムーズに入力できない」不具合を、診断の自動化と最小変更（gsettings/mozc）による対策で解消する。

## Progress

- [x] (2026-03-01) **診断スクリプトの作成**: `scripts/kiosk/diagnose-ime.sh` を新設。`pgrep`、`ibus engine`、`gsettings`、`XDG_SESSION_TYPE`、`kiosk-launch.sh` の `--ozone-platform` 確認を出力。
- [x] (2026-03-01) **Ansible 診断タスクの追加**: `infrastructure/ansible/roles/kiosk/tasks/diagnose-ime.yml` を新設。`manage_kiosk_browser` が真のとき実行、失敗時はデプロイ継続（`failed_when: false`）。
- [x] (2026-03-01) **main.yml の更新**: `diagnose-ime.yml` を ibus.yml の後に import。
- [x] (2026-03-01) **KB調査ドキュメントの更新**: `KB-investigation-kiosk-schedule-regression-20260301.md` に診断結果記録セクションを追加。
- [ ] **実機診断の実行**: デプロイ後、Ansible 出力から診断結果を取得し、KB調査ドキュメントに記録。
- [ ] **原因分析と対策**: 診断結果に基づき、二重起動/設定未反映/ibus-ui-gtk3 のいずれかを特定し、gsettings/mozc で対策を実施。

## Surprises & Discoveries

- （実機診断後に記録）

## Decision Log

- **Decision**: 診断タスクは `failed_when: false` でデプロイを継続しない。
- **Rationale**: 診断失敗（例: DBus 未起動時）でもデプロイを止めない。警告のみ出力。
- **Date/Author**: 2026-03-01

- **Decision**: 対策は「最小変更（gsettings/mozc）」に限定。WM ルールや fcitx5 移行は本計画の範囲外。
- **Rationale**: 影響範囲を最小化し、既存 KB-276/ADR-20260228 の延長で対応する。
- **Date/Author**: 2026-03-01

## Outcomes & Retrospective

- **達成**: 診断スクリプトと Ansible タスクを実装し、デプロイ時に IBus 状態がログに記録される構成を整えた。
- **未完了**: 実機診断後の原因分析と対策の実施は、次のデプロイ後に実施する。

## Context and Orientation

- **現状**: 備考欄の日本語入力で、ibus-ui ウィンドウがキー入力ごとに出現し、入力が不安定になる事象が報告されている。KB-276 で `--replace --single --panel=disable` を適用済みだが、再発の可能性あり。
- **関連ファイル**:
  - `scripts/kiosk/diagnose-ime.sh`: IME 診断スクリプト
  - `infrastructure/ansible/roles/kiosk/tasks/diagnose-ime.yml`: 診断 Ansible タスク
  - `docs/knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md`: 診断結果記録セクション
  - `docs/runbooks/kiosk-ime-diagnosis.md`: 診断 Runbook

## Next Steps

1. デプロイを実行し、kiosk ホストで診断タスクの出力を確認する。
2. 診断結果を `KB-investigation-kiosk-schedule-regression-20260301.md` に記録する。
3. 原因（二重起動/設定未反映/ibus-ui-gtk3）に応じて、gsettings または mozc 設定を調整する。
4. 実機で備考欄の日本語入力を検証し、ibus-ui ウィンドウが出現しないことを確認する。
