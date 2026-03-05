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
- [x] (2026-03-01) **電源操作の連打防止オーバーレイ実装・実機検証完了**: API 受理直後に黒画面オーバーレイを表示し、応答遅延中の連打を防止。FullScreenOverlay（createPortal で document.body にレンダリング）、PowerDebounceOverlay、KioskHeader 統合。前回失敗（bae3802）の原因（backdrop-blur 親の影響で position: fixed がビューポート基準にならず）を React Portal で解決。KB-286 に記録。

## Surprises & Discoveries

- **電源操作の遅延**: 実機検証で「ボタン押して20秒後に発動」が報告された。ロジックは正常だが、Pi4 kiosk → Pi5 API → path unit → dispatcher service → ansible-playbook → Pi4 SSH の多段構成により、poweroff で約21秒、reboot で約85秒かかることが判明。Ansible inventory パース（vault 復号含む）、SSH 接続確立、`ansible.builtin.reboot` の復帰待ちが主因。
- **連打防止のベストプラクティス**: 不可逆操作かつ応答遅延がある場合、ボタン押下直後に連打防止画面を出すのが UX のベストプラクティス。現状は `isPowerProcessing` でボタン無効化しているが、専用の「処理中」オーバーレイを検討する余地あり。
- **連打防止オーバーレイの前回失敗原因**: bae3802 でオーバーレイを KioskHeader 内に直接レンダリングしたが、親要素（`backdrop-blur` を持つ `<header>`）の影響で `position: fixed` がビューポート基準にならず全画面表示に失敗。KB-239 と同様の事象。React Portal（`createPortal` で `document.body`）で解決。

## Decision Log

- **Decision**: clientKey 解決を専用モジュール（`client-key`）に集約し、電源操作は `resolveClientKeyForPower` で取得したキーのみを使用する。
- **Rationale**: 電源操作は端末を特定する clientKey が必須。DEFAULT_CLIENT_KEY へのフォールバックが複数キオスク環境で誤動作を招いていたため、電源専用の解決ロジックを分離し、未解決時は実行しない方針とした。
- **Date/Author**: 2026-03-01

- **Decision**: 電源操作の遅延（約20秒）は現アーキテクチャでは避けられない。連打防止画面の追加を Next Steps として検討する。
- **Rationale**: 多段構成（API→dispatcher→Ansible→SSH）のため短縮は困難。不可逆操作の UX 改善として、処理中表示の強化が有効。
- **Date/Author**: 2026-03-01

- **Decision**: 連打防止オーバーレイは React Portal（createPortal で document.body）を使用する。
- **Rationale**: KioskHeader 内に直接レンダリングすると、親要素の backdrop-blur により position: fixed がビューポート基準にならず表示失敗する（KB-239 と同様）。汎用 FullScreenOverlay と電源専用 PowerDebounceOverlay に責務分離。
- **Date/Author**: 2026-03-01

## Outcomes & Retrospective

- **達成**: clientKey 解決の責務分離、電源操作の明示的 clientKey 渡し、複数キオスク環境での正しい端末ターゲット化を実現。実機検証で正常動作を確認。
- **達成**: 電源操作の連打防止オーバーレイを実装。API 受理直後に黒画面・白文字の全画面オーバーレイを表示し、応答遅延中の連打を防止。実機検証で正常表示を確認。

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

- **電源操作の連打防止画面**: 完了（2026-03-01）。FullScreenOverlay / PowerDebounceOverlay を実装し、実機検証で正常動作を確認。
- **Pi4 復帰後の電源・連打防止実機検証**: 完了（2026-03-05）。研削メイン（raspberrypi4）・raspi4-robodrill01 とも電源操作・連打防止オーバーレイが正常動作することを確認。
