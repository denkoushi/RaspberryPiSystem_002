# 電源機能SOLIDリファクタ ExecPlan

このExecPlanは生きたドキュメントであり、作業の進行に合わせて `Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を常に更新しなければならない。.agent/PLANS.md に従って維持すること。

## Purpose / Big Picture

複数Pi4キオスク環境で、電源ボタン（再起動/シャットダウン）が正しい端末を対象に動作するよう、clientKey解決ロジックを責務分離・テスト容易化する。KB-investigation-kiosk-ime-and-power-regression で特定された「raspi4-robodrill01 から client-key-raspberrypi4-kiosk1 が送信され、誤った端末をターゲットにする」問題を根本解決する。

## Progress

- [x] (2026-03-01) **ClientKeyResolverモジュール新設**: `apps/web/src/lib/client-key/` に types, config, sources, resolver, power-validator, index を追加。責務を「取得元（URL/localStorage/build）」「解決」「電源操作用バリデーション」に分離。
- [x] (2026-03-01) **KioskHeaderの電源操作修正**: `resolveClientKeyForPower(clientKey)` を使用し、未解決時はアラート表示。`postKioskPower` に明示的な clientKey を渡す。
- [x] (2026-03-01) **他コンポーネントの getResolvedClientKey 統一**: KioskSupportModal, KioskBorrowPage, KioskInstrumentBorrowPage, KioskPhotoBorrowPage, KioskReturnPage, KioskRiggingBorrowPage を `getResolvedClientKey()` に統一。
- [x] (2026-03-01) **ローカルテスト・CI成功・デプロイ完了・実機検証完了**: 全テストパス、lint・build成功。Pi5＋raspi4-robodrill01 へデプロイ成功。実機で電源操作が正常動作することを確認。
- [x] (2026-03-01) **電源操作遅延の原因特定**: ボタン押下から約20秒（poweroff）/約85秒（reboot）かかる事象を調査。Pi4→Pi5 API→dispatcher→Ansible SSH→Pi4 の多段構成に起因することを特定。KB-285 に記録。

## Surprises & Discoveries

- **電源操作の遅延**: 実機検証で「ボタン押して20秒後に発動」が報告された。ロジックは正常だが、Pi4 kiosk → Pi5 API → path unit → dispatcher service → ansible-playbook → Pi4 SSH の多段構成により、poweroff で約21秒、reboot で約85秒かかることが判明。Ansible inventory パース（vault 復号含む）、SSH 接続確立、`ansible.builtin.reboot` の復帰待ちが主因。
- **連打防止のベストプラクティス**: 不可逆操作かつ応答遅延がある場合、ボタン押下直後に連打防止画面を出すのが UX のベストプラクティス。現状は `isPowerProcessing` でボタン無効化しているが、専用の「処理中」オーバーレイを検討する余地あり。

## Decision Log

- **Decision**: clientKey 解決を専用モジュール（`client-key`）に集約し、電源操作は `resolveClientKeyForPower` で取得したキーのみを使用する。
- **Rationale**: 電源操作は端末を特定する clientKey が必須。DEFAULT_CLIENT_KEY へのフォールバックが複数キオスク環境で誤動作を招いていたため、電源専用の解決ロジックを分離し、未解決時は実行しない方針とした。
- **Date/Author**: 2026-03-01

- **Decision**: 電源操作の遅延（約20秒）は現アーキテクチャでは避けられない。連打防止画面の追加を Next Steps として検討する。
- **Rationale**: 多段構成（API→dispatcher→Ansible→SSH）のため短縮は困難。不可逆操作の UX 改善として、処理中表示の強化が有効。
- **Date/Author**: 2026-03-01

## Outcomes & Retrospective

- **達成**: clientKey 解決の責務分離、電源操作の明示的 clientKey 渡し、複数キオスク環境での正しい端末ターゲット化を実現。実機検証で正常動作を確認。
- **残課題**: 電源操作の応答遅延（約20秒）に対する UX 改善（連打防止画面の強化）は未実装。Next Steps に記載。

## Context and Orientation

- **現状**: `KioskHeader` の電源ボタンは `postKioskPower({ action })` を呼び、clientKey を明示渡していなかった。`api.defaults.headers.common['x-client-key']` は `getResolvedClientKey()` で設定されるが、複数キオスクでは DEFAULT_CLIENT_KEY にフォールバックし、誤った端末をターゲットにしていた。
- **関連ファイル**:
  - `apps/web/src/lib/client-key/`: 新規モジュール（types, config, sources, resolver, power-validator, index）
  - `apps/web/src/api/client.ts`: `postKioskPower` に clientKey オプション追加、`getResolvedClientKey` は client-key モジュールを利用
  - `apps/web/src/components/kiosk/KioskHeader.tsx`: `resolveClientKeyForPower` 使用、未解決時アラート
  - `infrastructure/ansible/inventory.yml`: `kiosk_url` に `?clientKey={{ status_agent_client_key }}` 付与

## Plan of Work（完了済み）

1. `apps/web/src/lib/client-key/` に types, config, sources, resolver, power-validator を実装
2. `resolveClientKeyForPower` を export し、電源操作専用の解決ロジックを提供
3. `KioskHeader` で `resolveClientKeyForPower` を使用し、未解決時はアラート表示
4. `postKioskPower` に明示的な clientKey を渡す
5. 他コンポーネントを `getResolvedClientKey()` に統一
6. ローカルテスト・CI・デプロイ・実機検証

## Next Steps

- **電源操作の連打防止画面**: ボタン押下直後に「処理中です。しばらくお待ちください。」等のオーバーレイを表示し、応答遅延（約20秒）中の連打を防止する UX 改善を検討する。不可逆操作のベストプラクティスとして推奨。
