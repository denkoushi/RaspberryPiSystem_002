# ドキュメント索引

> **注意**: このINDEX.mdは、各種ドキュメント（docs/）の「入口」として機能します。
> - プロジェクト管理ドキュメント（EXEC_PLAN.md）は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照してください。
> - ドキュメント体系の基本思想については [README.md](../README.md) の「ドキュメント体系の基本思想」セクションを参照してください。

---

## 🎯 目的別インデックス

### 🆕 最新アップデート（2025-12-13）

- **✅ Phase 9 セキュリティ強化完了**: インターネット接続時の追加防御機能を実装完了。管理画面IP制限、アラート外部通知、DockerイメージTrivyスキャン、レート制限再導入、ログ長期保持（52週）、インシデント対応手順の明文化を完了。CIでの脆弱性スキャンも統合済み。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) / [security/incident-response.md](./security/incident-response.md) を参照。

### 🆕 最新アップデート（2025-12-13）

- **✅ サイネージデザイン改善（レイアウト/座標再調整）**: サーバー側レンダラーで余白を最小化しつつ、右ペインのタイトル・ファイル名とPDF表示領域の重なりを解消。外枠余白を極小化、タイトル・ファイル名のベースラインオフセットを揃え、PDFの黒地を拡大。詳細は [modules/signage/README.md](./modules/signage/README.md) / [knowledge-base/infrastructure.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない](./knowledge-base/infrastructure.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない) を参照。

- **✅ サイネージタブ内にPDFアップロード機能を統合**: 管理コンソールの「サイネージ」タブ（`/admin/signage/schedules`）にPDFアップロード・管理機能を追加。スケジュール設定画面と同じページでPDFをアップロード・管理できるようになり、ワークフローが改善されました。`SignagePdfManager`コンポーネントを新規作成して共通化し、サイネージタブとクライアント端末管理ページの両方で使用可能に。詳細は [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2025-12-12）

- **✅ Ansibleデプロイのブランチ指定機能追加**: `scripts/update-all-clients.sh`とAnsibleの`deploy.yml`でブランチを指定可能に。デフォルトは`main`ブランチ。開発ブランチ（`feature/production-deployment-management`）のハードコードを削除し、環境変数`ANSIBLE_REPO_VERSION`または引数でブランチを指定可能に。`scripts/update-all-clients.sh [ブランチ名]`で全デバイス（Pi5 + Pi3/Pi4）を更新可能。詳細は [guides/deployment.md](./guides/deployment.md) / [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) を参照。

- **✅ デプロイメントベストプラクティスの明確化**: 開発時（Pi5のみ）は`scripts/server/deploy.sh <ブランチ>`、運用時（全デバイス）は`scripts/update-all-clients.sh [ブランチ]`を使用する使い分けをドキュメント化。デフォルトは`main`ブランチで、開発ブランチをハードコードしない設計に統一。詳細は [guides/deployment.md](./guides/deployment.md) を参照。

- **🆕 network_mode戻り・ローカルIP変動への対策**: git syncで`network_mode`が`local`へ戻る事象（KB-094）を踏まえ、デプロイ前だけでなくヘルスチェック前にも再確認する運用を追加。ローカルIPは毎回`hostname -I`で取得し`group_vars/all.yml`を更新するよう明記。キオスク向けヘルスチェックから`signage-lite`チェックを除外。詳細: [guides/deployment.md](./guides/deployment.md), [knowledge-base/infrastructure.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題](./knowledge-base/infrastructure.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題), [infrastructure/ansible/playbooks/health-check.yml](../infrastructure/ansible/playbooks/health-check.yml)

- **✅ 吊具管理モジュール 1stリリース**: Prismaスキーマ/CRUD/API/管理コンソール/キオスクを追加。吊具タグ→従業員タグで持出登録し、成功時は`defaultMode`に従い自動遷移（計測機器と同等UX）。管理コンソールでUID登録・編集・削除（空文字で削除指示）、点検記録の簡易登録、一覧にUID列を追加。UIを横幅拡大・非折返しに調整。詳細は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照。

- **✅ NFC/UIDハンドリングの共通化**: 管理コンソール（計測機器・吊具）でNFCスキャン自動入力を復旧し、UID入力欄を空にして保存するとタグ紐付けを削除する仕様に統一。計測機器タブのスキャン不能/削除不可事象を解消。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ キオスク→管理コンソール遷移の強制ログイン**: キオスクヘッダーの「管理コンソール」ボタンを`/login?force=1`遷移に変更し、既ログインでも必ず再認証を実施。戻り先は`/admin`を維持。関連: `KioskLayout.tsx` / `LoginPage.tsx`。

### 🆕 最新アップデート（2025-12-11）

- **✅ 管理コンソール: 計測機器のNFCタグ登録欄を追加**: 計測機器の登録/編集フォームに「NFC/RFIDタグUID」入力欄を追加し、保存時にタグ紐付けを同時登録（重複UIDは409で拒否）。既存のRFIDタグ管理ページも併用可能。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ キオスクUI簡素化: 返却タブ削除**: 機能重複のため「返却」「計測機器 返却」の2タブを削除し、「持出」「計測機器 持出」の2タブ構成に統一。持出画面の持出一覧から工具・計測機器の両方を返却可能。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ サイネージ左ペインの計測機器表示改善**: Pi3サイネージの工具データ左ペインで、計測機器の持出アイテムを藍系背景で表示し、管理番号を上段・名称を下段に2行表示。工具と計測機器を視覚的に識別可能に。バックエンド（`signage.service.ts`）とレンダラー（`signage.renderer.ts`）を修正。詳細は [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **✅ 持出一覧キオスクUI改善**: 計測機器は「管理番号＋名称」を2行表示し、背景色を藍系に変更して工具と識別。写真持出は「写真撮影モード」を表示し、「アイテム情報なし」は非表示。詳細は [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) / [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md) を参照。

- **✅ 計測機器持出: エラー時の無限ループ修正とメッセージ改善**: エラー発生時に持出登録ボタンが無限ループ動作する問題を修正。エラー時に氏名タグをクリアして自動再送を防止し、APIエラーメッセージを短縮・ユーザーフレンドリーに改善（「タグ未登録（計測機器）」「タグ未登録（社員）」「既に貸出中です」など）。詳細は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題9-エラー時に持出登録ボタンが無限ループ動作する) を参照。

- **✅ NFC/カメラ入力のスコープ分離: 実装完了**: 計測機器モードでの氏名タグスキャン直後にPHOTOモードが誤発火する問題を解決。`useNfcStream`フックに`enabled`フラグと`enabledAt`タイムスタンプを追加し、ページ遷移前のイベントを無視。各キオスクページで`useMatch`を使用して、アクティブなページの時のみNFC購読を有効化。詳細は [plans/nfc-stream-isolation-plan.md](./plans/nfc-stream-isolation-plan.md) を参照。

- **計測機器キオスク: ドロップダウン→氏名タグで自動送信を復旧**: JWT失敗時でも`x-client-key`フォールバック後にHTTP 200へ戻すようAPIを修正し（`apps/api/src/routes/measuring-instruments/index.ts`）、Pi4キオスクで「てこ式ダイヤルゲージ」がドロップダウンに復活。さらに、タグ未登録でもドロップダウン選択＋氏名タグスキャンで自動送信されるようUI条件を緩和（`apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`）。経緯と手順は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題8-ドロップダウン選択時に氏名タグ自動送信されない) と [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **計測機器キオスク: エラーメッセージ/リセット修正**: 古いフロントビルドが配信されていたため最新文言が未反映・リセット不可だった問題を解消。未登録タグ時に「タグ未登録（アイテム/社員）」を表示し、リセットはF5リロードで初期化。手順と原因は [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題6-エラーメッセージが古いリセットが効かない) を参照。
- **計測機器キオスク実機検証トラブル対応**: Pi4の`kiosk-launch.sh`が空URLで起動しカメラ/APIが動かない問題を修正。原因と対処・再発防止を [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md#問題5-キオスクブラウザ起動が空urlでカメラapiが動かない) に追記。

- **計測機器管理システム Phase 1-3 実装完了**: データベーススキーマ、バックエンドAPI（CRUD、持ち出し/返却API）、フロントエンドAPI統合、管理コンソールUI（計測機器・点検項目・RFIDタグ・点検記録のCRUDページ）、キオスク持出・返却ページ（手入力対応）を実装完了。TS100統合と点検項目表示・NGボタン機能は未実装。詳細は [modules/measuring-instruments/README.md](./modules/measuring-instruments/README.md) / [requirements/measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) を参照。

- **Lint統合 Phase 8 完了**: 契約テスト（API/Web）と破壊的変更検知スナップショットを追加。`pnpm lint --max-warnings=0`/e2e-smoke/e2e-tests/docker-build がCIで成功（run #641）。import/order違反ナレッジをガイドに追加。詳細は [plans/lint-integration-plan.md](./plans/lint-integration-plan.md) / [guides/lint.md](./guides/lint.md) / [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) を参照。

- **デプロイメントモジュール設計**: Tailscale/セキュリティ機能実装後に発生したサイネージ・キオスク機能不全の根本原因を分析し、設定変更を自動検知・影響範囲を自動判定してデプロイする「堅剛なロジック」を設計。4つの独立モジュール（config-detector, impact-analyzer, deploy-executor, verifier）を標準入出力（JSON）で連携する疎結合・モジュール化アーキテクチャ。テスト項目を明確化し、単体・統合・E2Eテストの計画を策定。詳細は [architecture/deployment-modules.md](./architecture/deployment-modules.md) を参照。
- **サイネージUI最終調整**: 左ペインTOOLSを3列化しサムネイルを最大化。右ペインの更新文言を削除。Pi3で再デプロイ済み（`signage-lite`再起動）。
- **キオスクUI統一**: 返却（持出）一覧を5列＋ボタン縦並びに統一。APIキー初期値を管理コンソールと同一に強制し、設定カードを非表示化。Pi4で再起動済み。
- **Phase 8 継続**: サイネージ／キオスク回帰対応を進行中。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) と [KB-080〜085](./knowledge-base/infrastructure.md) を参照。
- **Phase 7 セキュリティ検証完了**: IPアドレス切替、Tailscale経路、UFW/HTTPS、fail2ban、暗号化バックアップ復元、ClamAV/Trivy/rkhunterスキャンを一通り手動検証しました。`alerts/alert-20251205-182352.json`（fail2ban）と `alert-20251205-184324.json`（rkhunter）を生成し、監視ルートの動作も確認済み。複数ローカルネットワーク環境（会社/自宅）でのVNC接続設定も対応済み。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) および [docs/security/requirements.md](./security/requirements.md) を参照してください。ナレッジベース: [KB-078](./knowledge-base/infrastructure.md#kb-078-複数ローカルネットワーク環境でのvnc接続設定), [KB-079](./knowledge-base/infrastructure.md#kb-079-phase7セキュリティテストの実施結果と検証ポイント)
- **Phase 6 セキュリティ監視・アラート実装完了**: fail2banのBanイベントとマルウェアスキャン結果を自動監視し、管理画面でアラート表示する仕組みを実装しました。`security-monitor.sh`がsystemd timer（15分間隔）で実行され、fail2banログを監視して侵入試行を検知します。ClamAV/Trivy/rkhunterのスキャン結果も自動でアラート化され、感染検知やスキャンエラー時に即座に通知されます。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) を参照してください。ナレッジベース: [KB-076](./knowledge-base/infrastructure.md#kb-076-fail2ban連携のセキュリティ監視タイマー), [KB-077](./knowledge-base/infrastructure.md#kb-077-マルウェアスキャン結果の自動アラート化)
- **Ansibleロール化 & 新`deploy.yml`**: `common/server/client/kiosk/signage` ロールを導入し、メインプレイブックを `playbooks/deploy.yml` に刷新しました。既存の `update-clients.yml` は互換ラッパーとして残しつつ、今後は `ansible-playbook infrastructure/ansible/playbooks/deploy.yml` の利用を推奨します。詳細は [plans/ansible-phase9-role-execplan.md](./plans/ansible-phase9-role-execplan.md) を参照してください。

- **Phase 2.4 実機テスト完了**: クライアント状態可視化とデバッグ支援システムの実機テストを完了しました。Raspberry Pi 5上でstatus-agentを設定・実行し、systemd timerで1分ごとに自動実行されることを確認。管理画面で稼働状況カードが正しく表示され、CPU/メモリ/温度などのメトリクスが更新されることを確認。詳細は [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) を参照してください。
- **システム安定性向上の実装完了**: エラーハンドリングとログ出力の最適化を実装しました。エラーメッセージの詳細化、エラーログの構造化、ログレベルの環境変数制御、Dockerログローテーション設定を完了。詳細は [plans/stability-improvement-plan.md](./plans/stability-improvement-plan.md) を参照してください。ガイドドキュメント: [エラーハンドリングガイド](./guides/error-handling.md), [ログ出力ガイド](./guides/logging.md)
- **サイネージ持出中アイテム表示の改善**: 借用日時を日本標準時（JST）で表示し、12時間超のアイテムを赤色で強調してリストの先頭に配置するように改善しました。アイテムコードのフォントサイズも日時と同じサイズに調整しました。
- **Raspberry Pi 4再起動時のサービス起動ガイド**: [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) を追加。開発中に自動起動を無効化している場合の手動起動手順、Docker Compose推奨方法、Poetry直接起動の問題点と改善案を記載しました。
- **サイネージ自動レンダリングの安定化**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) と [guides/signage-test-plan.md](./guides/signage-test-plan.md) に、`SignageRenderScheduler` の自動実行・管理画面からの手動再レンダリング手順・`SIGNAGE_RENDER_DIR` の設定方法を追記しました。
- **PDFスライド & 工具サムネイル改善**: サイネージの分割表示で PDF スライドショーが必ずページ送りされるようになり、工具サムネイルは 4:3 のまま大型表示に統一されました。詳細は [knowledge-base/api.md](./knowledge-base/api.md#kb-051-サイネージのpdfスライドショーが切り替わらない) / [knowledge-base/api.md#kb-052-sharpのcompositeエラーimage-to-composite-must-have-same-dimensions-or-smaller) を参照してください。
- **軽量クライアントTLS/Troubleshooting**: [modules/signage/signage-lite.md](./modules/signage/signage-lite.md) に自己署名証明書環境での `curl -k` 設定や初回キャッシュ待機ロジック、`setup-signage-lite.sh` の改善点を追加しました。
- **CPU/温度モニタリング**: 画像レンダリング時に `/proc/stat` と `/sys/class/thermal` を取得し、サイネージヘッダー右上に `CPU xx% / Temp yy.y°C` を表示するようにしました。
- **PDFトリミング問題の解消**: `fit: 'contain'` + 背景色でレターボックス表示に変更し、PDFの縦横比にかかわらず全体が映るようになりました。詳細は [knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される](./knowledge-base/api.md#kb-055-サイネージpdfがトリミングされて表示される) を参照してください。
- **NFCエージェントキュー処理改善**: 工具スキャンが二重登録される問題を解決。オンライン時にイベントを即座に配信し、配信成功したイベントはキューから即時削除するように変更。詳細は [knowledge-base/infrastructure.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善](./knowledge-base/infrastructure.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) を参照してください。
- **ナレッジベース更新**: [knowledge-base/index.md](./knowledge-base/index.md) の登録件数が 74件になり、fail2ban連携のセキュリティ監視タイマー（KB-076）とマルウェアスキャン結果の自動アラート化（KB-077）を追加しました。
- **Raspberry Pi status-agent**: クライアント端末が1分毎にメトリクスを送信する `status-agent.py`（systemd timer 同梱）を追加。ガイドは [guides/status-agent.md](./guides/status-agent.md)、ソースは `clients/status-agent/` を参照してください。
- **ローカル環境対応の通知機能**: 管理画面でのアラート表示とファイルベースの通知機能を実装しました。Ansible更新失敗時に自動的にアラートファイルを生成し、管理画面で確認できます。ガイドは [guides/local-alerts.md](./guides/local-alerts.md) を参照してください。
- **Ansible堅牢化・安定化の実装**: `git clean`による設定ファイル削除問題を解決し、システム設定ファイル（polkit設定など）をAnsibleで管理する仕組みを実装しました。バックアップ・ロールバック機能も追加。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。ガイド: [Ansibleで管理すべき設定ファイル一覧](./guides/ansible-managed-files.md)、ナレッジベース: [KB-061](./knowledge-base/infrastructure.md#kb-061-ansible実装後の設定ファイル削除問題と堅牢化対策)
- **Ansible設定ファイル管理化の実装**: systemdサービスファイル（kiosk-browser.service、signage-lite.service）とアプリケーション設定ファイル（.env）のAnsible管理化を実装しました。実用段階に到達。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。

### 初めて参加する

| やりたいこと | ドキュメント |
|-------------|-------------|
| プロジェクトの概要を理解したい | [README.md](../README.md) |
| システムアーキテクチャを理解したい | [architecture/overview.md](./architecture/overview.md) |
| 開発環境をセットアップしたい | [guides/development.md](./guides/development.md) |
| **AIアシスタントとして引き継ぐ** | **[guides/ai-handoff.md](./guides/ai-handoff.md)** |

### 開発する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 新機能を追加したい | [guides/development.md](./guides/development.md), [modules/](./modules/) |
| **計測機器管理システムを理解したい** | **[modules/measuring-instruments/README.md](./modules/measuring-instruments/README.md)**, **[requirements/measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md)** |
| **Ansibleロールを追加・修正したい** | **[guides/ansible-role-development.md](./guides/ansible-role-development.md)** |
| APIを理解したい | [api/overview.md](./api/overview.md), [api/auth.md](./api/auth.md) |
| **APIキー統一の方針とフィルタリングロジック** | [guides/api-key-policy.md](./guides/api-key-policy.md) |
| モジュール構造を理解したい | [decisions/001-module-structure.md](./decisions/001-module-structure.md) |
| サービス層を理解したい | [decisions/002-service-layer.md](./decisions/002-service-layer.md) |
| CSVインポート・エクスポートを理解したい | [guides/csv-import-export.md](./guides/csv-import-export.md) |

### デプロイ・運用する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 本番環境にデプロイしたい | [guides/deployment.md](./guides/deployment.md) |
| **デプロイメントモジュール（原因分析・設計・テスト計画）を確認したい** | **[architecture/deployment-modules.md](./architecture/deployment-modules.md)** |
| 本番環境をセットアップしたい | [guides/production-setup.md](./guides/production-setup.md) |
| バックアップ・リストアしたい | [guides/backup-and-restore.md](./guides/backup-and-restore.md) |
| 監視・アラートを設定したい | [guides/monitoring.md](./guides/monitoring.md) |
| デジタルサイネージ機能をデプロイしたい | [guides/signage-deployment.md](./guides/signage-deployment.md) |
| デジタルサイネージクライアント端末をセットアップしたい | [guides/signage-client-setup.md](./guides/signage-client-setup.md)（Chromiumモード / `setup-signage-lite.sh` 軽量モード） |
| クライアント端末を一括更新したい | [plans/production-deployment-management-plan.md](./plans/production-deployment-management-plan.md#phase-1-一括更新システムssh--ansible) |
| Ansibleの堅牢化・安定化を実施したい | [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) |
| Ansibleで管理すべき設定ファイルを確認したい | [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) |
| Ansibleエラーハンドリングを確認したい | [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) |
| Ansibleベストプラクティスを確認したい | [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) |
| git cleanの安全な使用方法を確認したい | [guides/git-clean-safety.md](./guides/git-clean-safety.md) |
| クライアント状態監視のExecPlanを確認したい | [plans/production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) |
| Raspberry Pi クライアントにSSH鍵を配布したい | [guides/ssh-setup.md](./guides/ssh-setup.md) |
| **Raspberry Pi 4 再起動時のサービス起動** | [guides/raspberry-pi4-restart-commands.md](./guides/raspberry-pi4-restart-commands.md) |
| Raspberry Pi status-agentを導入したい | [guides/status-agent.md](./guides/status-agent.md) |
| **クライアント一括更新と監視のクイックスタート** | [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) |
| **ローカル環境対応の通知機能** | [guides/local-alerts.md](./guides/local-alerts.md) |
|| **新規クライアント端末の初期設定** | [guides/client-initial-setup.md](./guides/client-initial-setup.md) |
|| **MacからRaspberry Pi 5へのSSH接続** | [guides/mac-ssh-access.md](./guides/mac-ssh-access.md) |
|| **Ansible SSH接続アーキテクチャの説明** | [guides/ansible-ssh-architecture.md](./guides/ansible-ssh-architecture.md) |
|| **環境構築ガイド（ローカルネットワーク変更時）** | [guides/environment-setup.md](./guides/environment-setup.md) |
|| **システム自動起動の現状と設定** | [guides/auto-startup-status.md](./guides/auto-startup-status.md) |
|| **クライアント端末のstatus-agent設定（実機テスト用）** | [guides/setup-clients-status-agent.md](./guides/setup-clients-status-agent.md) |

### 検証する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 計測機器キオスク実機検証 | [guides/measuring-instruments-verification.md](./guides/measuring-instruments-verification.md) |
| 機能を検証したい | [guides/verification-checklist.md](./guides/verification-checklist.md) |
| USBインポートを検証したい | [guides/validation-7-usb-import.md](./guides/validation-7-usb-import.md) |
| デジタルサイネージ機能を検証したい | [guides/signage-test-plan.md](./guides/signage-test-plan.md) |
| システム安定性向上機能を検証したい | [guides/stability-improvement-test.md](./guides/stability-improvement-test.md) |
| セキュリティを検証したい | [security/validation-review.md](./security/validation-review.md) |
| **セキュリティ要件を確認したい** | **[security/requirements.md](./security/requirements.md)** |
| **セキュリティ強化の実装計画を確認したい** | **[plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md)** |
| **セキュリティ強化のテスト計画を確認したい** | **[guides/security-test-plan.md](./guides/security-test-plan.md)** |
| **インシデント対応手順を確認したい** | **[security/incident-response.md](./security/incident-response.md)** |
| **システム担当者向けセキュリティプレゼン資料** | **[presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md)** |
| **IPアドレス管理の変数化について知りたい** | **[knowledge-base/infrastructure.md#kb-069](./knowledge-base/infrastructure.md#kb-069)** |
| **運用モード可視化について知りたい** | **[knowledge-base/infrastructure.md#kb-070](./knowledge-base/infrastructure.md#kb-070)** |
| **Tailscale導入について知りたい** | **[knowledge-base/infrastructure.md#kb-071](./knowledge-base/infrastructure.md#kb-071)** |
| **ファイアウォール/HTTPS強化について知りたい** | **[knowledge-base/infrastructure.md#kb-072](./knowledge-base/infrastructure.md#kb-072)** |
| **fail2ban設定について知りたい** | **[knowledge-base/infrastructure.md#kb-073](./knowledge-base/infrastructure.md#kb-073)** |
| **Pi5のマルウェア対策を確認したい** | **[knowledge-base/infrastructure.md#kb-074](./knowledge-base/infrastructure.md#kb-074)** |
| **Pi4キオスクの軽量マルウェア対策を確認したい** | **[knowledge-base/infrastructure.md#kb-075](./knowledge-base/infrastructure.md#kb-075)** |
| **fail2ban連携のセキュリティ監視を確認したい** | **[knowledge-base/infrastructure.md#kb-076-fail2ban連携のセキュリティ監視タイマー](./knowledge-base/infrastructure.md#kb-076-fail2ban連携のセキュリティ監視タイマー)** |
| **マルウェア検知アラート化について知りたい** | **[knowledge-base/infrastructure.md#kb-077-マルウェアスキャン結果の自動アラート化](./knowledge-base/infrastructure.md#kb-077-マルウェアスキャン結果の自動アラート化)** |

### エラーを解決する

| やりたいこと | ドキュメント |
|-------------|-------------|
| セキュリティインシデントに対応したい | [security/incident-response.md](./security/incident-response.md) |
| トラブルシューティングしたい | [knowledge-base/troubleshooting-knowledge.md](./knowledge-base/troubleshooting-knowledge.md) |
| CI/CDの問題を解決したい | [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) |
| NFCリーダーの問題を解決したい | [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) |
| **工具管理システムのデータ整合性を確認したい** | **[modules/tools/operations.md](./modules/tools/operations.md)** |
| **工具管理システムの復旧手順を知りたい** | **[modules/tools/operations.md](./modules/tools/operations.md)** |
| **エラーハンドリングを理解したい** | **[guides/error-handling.md](./guides/error-handling.md)** |
| **ログ出力を理解したい** | **[guides/logging.md](./guides/logging.md)** |

---

## 👥 対象者別インデックス

### 新規参加者

| ドキュメント | 説明 |
|-------------|------|
| [README.md](../README.md) | プロジェクトの概要 |
| [architecture/overview.md](./architecture/overview.md) | システムアーキテクチャ |
| [guides/development.md](./guides/development.md) | 開発環境セットアップ |
| [requirements/system-requirements.md](./requirements/system-requirements.md) | 要件定義 |

### 開発者

| ドキュメント | 説明 |
|-------------|------|
| [guides/development.md](./guides/development.md) | 開発環境・ワークフロー |
| [api/overview.md](./api/overview.md) | API概要 |
| [api/auth.md](./api/auth.md) | 認証API |
| [modules/tools/README.md](./modules/tools/README.md) | 工具管理モジュール |
| [modules/tools/api.md](./modules/tools/api.md) | 工具管理API |
| [modules/tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [modules/tools/operations.md](./modules/tools/operations.md) | 工具管理運用・保守ガイド |
| [decisions/001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [decisions/002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |
| [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) | Ansibleで管理すべき設定ファイル一覧 |
| [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) | Ansibleエラーハンドリングガイド |
| [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) | Ansibleベストプラクティス |

### 運用者

| ドキュメント | 説明 |
|-------------|------|
| [guides/deployment.md](./guides/deployment.md) | デプロイ手順 |
| [guides/production-setup.md](./guides/production-setup.md) | 本番環境セットアップ（HTTPS設定含む） |
| [guides/backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [guides/monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [guides/operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [modules/tools/operations.md](./modules/tools/operations.md) | **工具管理運用・保守ガイド**（データ整合性、復旧手順、エラーハンドリング） |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [guides/error-handling.md](./guides/error-handling.md) | エラーハンドリングガイド |
| [guides/logging.md](./guides/logging.md) | ログ出力ガイド |
| [guides/ansible-managed-files.md](./guides/ansible-managed-files.md) | Ansibleで管理すべき設定ファイル一覧 |
| [guides/ansible-error-handling.md](./guides/ansible-error-handling.md) | Ansibleエラーハンドリングガイド |

### システム担当者・経営層

| ドキュメント | 説明 |
|-------------|------|
| [presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md) | **セキュリティ対策プレゼンテーション資料**（アサヒビールのランサムウェア被害を踏まえた対策と評価） |
| [security/requirements.md](./security/requirements.md) | **セキュリティ要件定義**（メンテナンス時のセキュリティ、IPアドレス管理、ランサムウェア対策など） |
| [security/implementation-assessment.md](./security/implementation-assessment.md) | **セキュリティ実装の妥当性評価**（現状の評価と残タスク） |
| [guides/ansible-best-practices.md](./guides/ansible-best-practices.md) | Ansibleベストプラクティス |

### アーキテクト

| ドキュメント | 説明 |
|-------------|------|
| [architecture/overview.md](./architecture/overview.md) | システムアーキテクチャ |
| [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) | インフラ基盤 |
| [decisions/](./decisions/) | アーキテクチャ決定記録（ADR） |
| [requirements/system-requirements.md](./requirements/system-requirements.md) | 要件定義 |

---

## 📁 カテゴリ別インデックス

### アーキテクチャ（architecture/）

システム全体の設計・構造に関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [overview.md](./architecture/overview.md) | システム全体のアーキテクチャ（クライアントデバイス統合含む） |
| [infrastructure-base.md](./architecture/infrastructure-base.md) | **インフラ基盤**（スケール性、データ永続化、ネットワーク構成） |
| [signage-module-architecture.md](./architecture/signage-module-architecture.md) | **デジタルサイネージモジュール アーキテクチャ**（モジュール化、コンフリクト確認、スケーラビリティ） |
| [deployment-modules.md](./architecture/deployment-modules.md) | **デプロイメントモジュール**（原因分析・設計・テスト計画統合、疎結合・モジュール化アーキテクチャ） |

### 設計決定（decisions/）

アーキテクチャ決定記録（ADR）。

| ファイル | 説明 |
|---------|------|
| [001-module-structure.md](./decisions/001-module-structure.md) | モジュール構造の設計決定 |
| [002-service-layer.md](./decisions/002-service-layer.md) | サービス層の設計決定 |
| [003-camera-module.md](./decisions/003-camera-module.md) | **カメラ機能のモジュール化**（写真撮影持出機能） |

### モジュール仕様（modules/）

機能別のモジュール仕様。

| ファイル | 説明 |
|---------|------|
| [tools/README.md](./modules/tools/README.md) | 工具管理モジュール概要 |
| [tools/operations.md](./modules/tools/operations.md) | 工具管理運用・保守ガイド |
| [tools/api.md](./modules/tools/api.md) | 工具管理API |
| [tools/services.md](./modules/tools/services.md) | 工具管理サービス層 |
| [tools/photo-loan.md](./modules/tools/photo-loan.md) | **写真撮影持出機能**（FR-009） |
| [measuring-instruments/README.md](./modules/measuring-instruments/README.md) | **計測機器管理モジュール概要** |
| [measuring-instruments/api.md](./modules/measuring-instruments/api.md) | **計測機器管理API仕様** |
| [measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) | **計測機器管理UI設計メモ** |
| [signage/README.md](./modules/signage/README.md) | **デジタルサイネージモジュール** |
| [signage/signage-lite.md](./modules/signage/signage-lite.md) | **デジタルサイネージ軽量モード計画** |
| [documents/README.md](./modules/documents/README.md) | ドキュメントモジュール（将来実装予定） |
| [logistics/README.md](./modules/logistics/README.md) | 物流モジュール（将来実装予定） |

### APIリファレンス（api/）

APIの概要と詳細。

| ファイル | 説明 |
|---------|------|
| [overview.md](./api/overview.md) | API概要 |
| [auth.md](./api/auth.md) | 認証API |

### 要件定義（requirements/）

システム要件と仕様。

| ファイル | 説明 |
|---------|------|
| [system-requirements.md](./requirements/system-requirements.md) | システム要件定義 |
| [measuring-instruments-requirements.md](./requirements/measuring-instruments-requirements.md) | **計測機器管理システム要件定義** |

### 実装計画（plans/）

機能実装の計画と進捗。

| ファイル | 説明 |
|---------|------|
| [production-deployment-management-plan.md](./plans/production-deployment-management-plan.md) | プロダクション環境デプロイメント・更新・デバッグ管理計画 |
| [production-deployment-phase2-execplan.md](./plans/production-deployment-phase2-execplan.md) | クライアント状態可視化とデバッグ支援システム実行計画 |
| [stability-improvement-plan.md](./plans/stability-improvement-plan.md) | システム安定性向上計画 |
| [ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) | **Ansible安定性・堅牢化・柔軟性向上計画** |
| [ansible-phase9-role-execplan.md](./plans/ansible-phase9-role-execplan.md) | **Ansible Phase 9（ロール化）実行計画** |
| [tool-management-debug-execplan.md](./plans/tool-management-debug-execplan.md) | **キオスク工具スキャン重複＆黒画像対策 ExecPlan** |
| [ts100-integration-plan.md](./plans/ts100-integration-plan.md) | **TS100 RFIDリーダー統合計画**（計測機器管理システム用） |

### 実践ガイド（guides/）

開発・デプロイ・運用の手順。

| ファイル | 説明 |
|---------|------|
| [development.md](./guides/development.md) | 開発環境セットアップ |
| [deployment.md](./guides/deployment.md) | デプロイ手順 |
| [production-setup.md](./guides/production-setup.md) | 本番環境セットアップ |
| [backup-and-restore.md](./guides/backup-and-restore.md) | バックアップ・リストア |
| [monitoring.md](./guides/monitoring.md) | 監視・アラート |
| [csv-import-export.md](./guides/csv-import-export.md) | CSVインポート・エクスポート |
| [verification-checklist.md](./guides/verification-checklist.md) | 検証チェックリスト |
| [photo-loan-test-plan.md](./guides/photo-loan-test-plan.md) | **写真撮影持出機能 テスト計画**（FR-009） |
| [validation-7-usb-import.md](./guides/validation-7-usb-import.md) | USBインポート検証 |
| [signage-test-plan.md](./guides/signage-test-plan.md) | **デジタルサイネージ機能 テスト計画** |
| [signage-deployment.md](./guides/signage-deployment.md) | **デジタルサイネージ機能 デプロイメントガイド** |
| [signage-client-setup.md](./guides/signage-client-setup.md) | **デジタルサイネージクライアント端末セットアップガイド** |
| [ci-troubleshooting.md](./guides/ci-troubleshooting.md) | CI/CDトラブルシューティング |
| [operation-manual.md](./guides/operation-manual.md) | **運用マニュアル**（日常運用・トラブル対応・メンテナンス） |
| [ai-handoff.md](./guides/ai-handoff.md) | **AI引き継ぎガイド**（別AIへの引き継ぎ時） |
|| [client-initial-setup.md](./guides/client-initial-setup.md) | **新規クライアント端末の初期設定手順** |
|| [mac-ssh-access.md](./guides/mac-ssh-access.md) | **MacからRaspberry Pi 5へのSSH接続ガイド** |
|| [auto-startup-status.md](./guides/auto-startup-status.md) | **システム自動起動の現状と設定手順** |
|| [ai-ssh-access.md](./guides/ai-ssh-access.md) | **AIアシスタントのSSHアクセスについて** |
|| [setup-clients-status-agent.md](./guides/setup-clients-status-agent.md) | **クライアント端末のstatus-agent設定手順（実機テスト用）** |
| [status-agent.md](./guides/status-agent.md) | Raspberry Pi クライアント状態送信エージェント |
| [quick-start-deployment.md](./guides/quick-start-deployment.md) | **クライアント一括更新と監視のクイックスタート** |
| [local-alerts.md](./guides/local-alerts.md) | **ローカル環境対応の通知機能ガイド** |
| [local-alerts-verification.md](./guides/local-alerts-verification.md) | **ローカル環境対応の通知機能 実機検証手順** |
| [ssd-migration.md](./guides/ssd-migration.md) | **SDカードからSSDへの移行手順** |
| [ansible-managed-files.md](./guides/ansible-managed-files.md) | **Ansibleで管理すべき設定ファイル一覧** |
| [ansible-error-handling.md](./guides/ansible-error-handling.md) | **Ansibleエラーハンドリングガイド** |
| [ansible-best-practices.md](./guides/ansible-best-practices.md) | **Ansibleベストプラクティス** |
| [git-clean-safety.md](./guides/git-clean-safety.md) | **git cleanの安全な使用方法** |

### トラブルシューティング（knowledge-base/, troubleshooting/）

問題解決のナレッジベース。**カテゴリ別に分割されています。**

| ファイル | 説明 |
|---------|------|
| [knowledge-base/index.md](./knowledge-base/index.md) | 📋 **ナレッジベース索引**（全65件の一覧） |
| [knowledge-base/api.md](./knowledge-base/api.md) | API関連（16件） |
| [knowledge-base/database.md](./knowledge-base/database.md) | データベース関連（3件） |
| [knowledge-base/ci-cd.md](./knowledge-base/ci-cd.md) | CI/CD関連（4件） |
| [knowledge-base/frontend.md](./knowledge-base/frontend.md) | フロントエンド関連（15件） |
| [knowledge-base/infrastructure.md](./knowledge-base/infrastructure.md) | インフラ関連（25件） |
| [troubleshooting/nfc-reader-issues.md](./troubleshooting/nfc-reader-issues.md) | NFCリーダー固有の問題 |

### セキュリティ（security/）

セキュリティに関するドキュメント。

| ファイル | 説明 |
|---------|------|
| [requirements.md](./security/requirements.md) | **セキュリティ要件定義**（メンテナンス時のセキュリティ、IPアドレス管理、ランサムウェア対策など） |
| [validation-review.md](./security/validation-review.md) | バリデーションレビュー |
| [implementation-assessment.md](./security/implementation-assessment.md) | **セキュリティ実装の妥当性評価**（現状の評価と残タスク） |
| [incident-response.md](./security/incident-response.md) | **インシデント対応手順**（侵入・マルウェア検知時の初動・封じ込め・復旧手順） |

### プレゼンテーション（presentations/）

システム担当者・経営層向けのプレゼンテーション資料。

| ファイル | 説明 |
|---------|------|
| [security-measures-presentation.md](./presentations/security-measures-presentation.md) | **セキュリティ対策プレゼンテーション資料**（アサヒビールのランサムウェア被害を踏まえた対策と評価） |

---

## 🔗 コードとの対応関係

### 工具管理モジュール（tools）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/tools/README.md](./modules/tools/README.md), [modules/tools/operations.md](./modules/tools/operations.md) |
| **APIルート** | `apps/api/src/routes/tools/` |
| **サービス層** | `apps/api/src/services/tools/` |
| **Webページ** | `apps/web/src/pages/tools/` |
| **共通型** | `packages/shared-types/src/` |

### ドキュメントモジュール（documents）- 将来実装予定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/documents/README.md](./modules/documents/README.md) |
| **APIルート** | `apps/api/src/routes/documents/` |
| **サービス層** | `apps/api/src/services/documents/` |
| **Webページ** | `apps/web/src/pages/documents/` |

### デジタルサイネージモジュール（signage）

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/signage/README.md](./modules/signage/README.md) |
| **アーキテクチャ** | [architecture/signage-module-architecture.md](./architecture/signage-module-architecture.md) |
| **APIルート** | `apps/api/src/routes/signage/` |
| **サービス層** | `apps/api/src/services/signage/` |
| **Webページ** | `apps/web/src/pages/signage/`, `apps/web/src/pages/admin/Signage*.tsx` |

### 物流モジュール（logistics）- 将来実装予定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [modules/logistics/README.md](./modules/logistics/README.md) |
| **APIルート** | `apps/api/src/routes/logistics/` |
| **サービス層** | `apps/api/src/services/logistics/` |
| **Webページ** | `apps/web/src/pages/logistics/` |

### インフラ設定

| 種別 | 場所 |
|------|------|
| **ドキュメント** | [architecture/infrastructure-base.md](./architecture/infrastructure-base.md) |
| **Docker設定** | `infrastructure/docker/` |
| **デプロイスクリプト** | `scripts/server/deploy.sh` |
| **バックアップスクリプト** | `scripts/server/backup.sh` |
| **リストアスクリプト** | `scripts/server/restore.sh` |
| **監視スクリプト** | `scripts/server/monitor.sh` |

---

## 📊 ドキュメント統計

| カテゴリ | ファイル数 |
|---------|-----------|
| アーキテクチャ | 4 |
| 設計決定 | 3 |
| モジュール仕様 | 6 |
| APIリファレンス | 2 |
| 要件定義 | 1 |
| 実装計画 | 7 |
| 実践ガイド | 31 |
| トラブルシューティング | 6 |
| セキュリティ | 3 |
| プレゼンテーション | 1 |
| **合計** | **56** |

---

## 📝 関連ドキュメント

- [EXEC_PLAN.md](../EXEC_PLAN.md): プロジェクト管理ドキュメント
- [README.md](../README.md): プロジェクト概要、ドキュメント体系の基本思想
- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md): ドキュメントリファクタリング計画

---

## 📅 更新履歴

- 2025-11-27: 初版作成
- 2025-12-01: ローカルアラートシステム関連ドキュメント追加、ナレッジベースKB-059追加、統計更新
- 2025-12-01: 工具管理システム運用・保守ガイド追加、NFCリーダートラブルシューティング追加、ナレッジベースKB-060追加、統計更新（58件）
- 2025-12-04: 工具スキャン重複対策（KB-067）と黒画像対策（KB-068）を実装完了、ナレッジベース更新（65件）
- 2025-12-01: Ansible堅牢化・安定化計画追加、Ansibleで管理すべき設定ファイル一覧追加、ナレッジベースKB-061追加、統計更新（59件、実装計画セクション追加）
- 2025-12-01: Ansible設定ファイル管理化実装完了（systemdサービス・アプリケーション設定）、ナレッジベースKB-062追加、統計更新（60件、インフラ関連26件、実装計画5件）

