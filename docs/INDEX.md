# ドキュメント索引

> **注意**: このINDEX.mdは、各種ドキュメント（docs/）の「入口」として機能します。
> - プロジェクト管理ドキュメント（EXEC_PLAN.md）は [EXEC_PLAN.md](../EXEC_PLAN.md) を参照してください。
> - ドキュメント体系の基本思想については [README.md](../README.md) の「ドキュメント体系の基本思想」セクションを参照してください。

---

## 🎯 目的別インデックス

### 🆕 最新アップデート（2025-12-31）

- **✅ CSVインポートUI改善・計測機器・吊具対応完了**: USBメモリ経由のCSVインポートUIを4つのフォーム（従業員・工具・計測機器・吊具）に分割し、各データタイプを個別にアップロードできるように改善。新APIエンドポイント`POST /api/imports/master/:type`を追加し、単一データタイプ対応のインポート機能を実装。共通コンポーネント`ImportForm`を作成し、コードの重複を削減。各フォームで`replaceExisting`を個別に設定可能。CI通過確認済み。詳細は [knowledge-base/api.md#kb-117](./knowledge-base/api.md#kb-117-csvインポートapiの単一データタイプ対応エンドポイント追加) / [knowledge-base/frontend.md#kb-117](./knowledge-base/frontend.md#kb-117-csvインポートuiの4フォーム分割実装) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ CSVフォーマット仕様実装・従業員編集フォーム改善完了**: 従業員CSVインポートの新フォーマット（`lastName`/`firstName`）を実装し、従業員編集フォームを`lastName`と`firstName`の個別フィールドに変更。`displayName`は自動生成されるように改善。データベーススキーマに`lastName`/`firstName`フィールドを追加し、APIとフロントエンドを更新。既存データの`displayName`から`lastName`/`firstName`への分割ロジックも実装。実機検証でCSVインポート成功、`displayName`自動生成、一覧表示、編集画面の動作をすべて確認済み。詳細は [guides/verification-checklist.md#62-従業員csvインポート新フォーマット](./guides/verification-checklist.md#62-従業員csvインポート新フォーマット) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2025-12-30）

- **✅ CSVインポート実機検証完了・UI改善**: CSVインポートスケジュールページのフォーム状態管理を改善し、削除後や編集から新規作成への切り替え時にフォームが正しくリセットされるように修正。手動実行時のリトライスキップ機能を実装し、即座に結果を確認できるように改善（自動実行は従来通りリトライあり）。実機検証でターゲット追加機能、データタイプ選択、プロバイダー選択、Gmail件名パターン管理、スケジュールCRUD、削除機能、手動実行、スケジュール表示の人間可読形式をすべて確認済み。詳細は [knowledge-base/frontend.md#kb-116](./knowledge-base/frontend.md#kb-116-csvインポートスケジュールページのフォーム状態管理改善) / [knowledge-base/api.md#kb-116](./knowledge-base/api.md#kb-116-csvインポート手動実行時のリトライスキップ機能) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

### 🆕 最新アップデート（2026-01-XX）

- **✅ CI YAML責務分離リファクタ完了**: GitHub Actions CIワークフローを品質レビューに適した構成に改善。巨大な`lint-and-test`ジョブを`static-quality`、`api-tests`、`scripts-verification`、`security`に分割し、失敗原因の特定を容易に。PostgreSQLを`services:`化し、ポート衝突と後片付けの問題を解消。共通基盤を整備（`runs-on: ubuntu-24.04`固定、`concurrency`追加、`defaults.run.shell: bash -euo pipefail`設定）。成果物を標準化（Vitest JUnit/JSON/coverage、Trivy SARIF、Playwright reportをartifact化）。`pnpm audit`をnon-blocking化し、失敗してもCIを落とさず結果をログ/レポートとして残す方針に変更。詳細は [knowledge-base/ci-cd.md#kb-027](./knowledge-base/ci-cd.md#kb-027-ci-yaml責務分離リファクタ品質レビュー強化) / [guides/ci-troubleshooting.md](./guides/ci-troubleshooting.md) を参照。

### 🆕 最新アップデート（2026-01-05）

- **✅ WebRTCビデオ通話機能 実装・実機検証完了**: キオスク通話（`/kiosk/call`）でPi4↔Macの音声通話・ビデオ通話の実機検証を完了し、機能が完成。**音声通話**：双方向発信/受話、マイク無し端末でのrecvonlyモード対応、60秒以上の通話維持を確認。**ビデオ通話**：片側のみビデオON、両側ビデオON、ビデオON/OFFの切り替えを確認。**長時間接続**：WebSocket keepalive（30秒ping/pong）により5分以上の通話を安定維持。実装過程で発生した問題と解決策をナレッジベースに詳細記録（KB-132〜141）。詳細は [guides/webrtc-verification.md](./guides/webrtc-verification.md) / [knowledge-base/api.md#kb-132](./knowledge-base/api.md#kb-132-webrtcシグナリングルートのダブルプレフィックス問題) / [knowledge-base/frontend.md#kb-136](./knowledge-base/frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題) / [knowledge-base/infrastructure/docker-caddy.md#kb-141](./knowledge-base/infrastructure/docker-caddy.md#kb-141-caddyがすべてのapi要求にwebsocketアップグレードヘッダーを強制する問題) を参照。

### 🆕 最新アップデート（2026-01-04）

- **✅ WebRTC通話（音声）実機検証・安定化**: キオスク通話（`/kiosk/call`）でPi4↔Macの音声通話の実機検証を実施。WebSocketシグナリング、offer/answer/ICE交換、接続維持を確認。マイク権限周りの切断問題に対して、マイク未接続端末でも受信専用（recvonly）で接続を継続するフォールバックを追加。手順は [guides/webrtc-verification.md](./guides/webrtc-verification.md) を参照。

- **✅ Pi5ストレージ経時劣化対策（10年運用対応）完了**: Pi5のストレージ使用量が27%（約270GB）と異常に高い問題を調査・解決。Docker Build Cache（237.2GB）とsignage-renderedの履歴画像（約6.2GB）を削除し、ディスク使用量を249GB→23GB（約226GB削減、27%→3%）に改善。さらに、10年運用を見据えた自動メンテナンス機能を実装。`storage-maintenance.sh`スクリプトを追加し、systemd timerで毎日実行（signage履歴画像削除、月1回build cache削除）。`monitor.sh`のディスク閾値を段階化（50%警告、70%警告、80%アラート、90%クリティカル）。`signage-render-storage.ts`を修正し、履歴画像をデフォルトで生成しないように変更（`SIGNAGE_RENDER_KEEP_HISTORY=1`で有効化可能）。Ansibleで`storage-maintenance.service/timer`を管理化。実機検証完了（APIコンテナ正常動作、storage-maintenance.timer有効化、ストレージ使用量3%維持を確認）。詳細は [knowledge-base/infrastructure/miscellaneous.md#kb-130](./knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) / [knowledge-base/api.md#kb-131](./knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題) / [guides/operation-manual.md](./guides/operation-manual.md) を参照。

- **✅ APIコンテナ再起動ループ問題修正完了**: APIコンテナが`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`環境変数の空文字でZodバリデーションエラーを起こし、再起動ループに陥っていた問題を修正。`docker-compose.server.yml`の`${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}`により未設定時でも空文字が注入されるため、`z.preprocess`で空文字を`undefined`に変換してからURL検証するように変更。実機検証完了（APIコンテナが正常起動、ヘルスチェック200、サイネージ画像取得正常を確認）。詳細は [knowledge-base/api.md#kb-131](./knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題) を参照。

- **✅ Pi5サーバー側のstatus-agent設定をAnsible管理化完了**: Pi5サーバー側のstatus-agent設定が手動設定のままで、設定のドリフトが発生していた問題を解決。Pi5に`status_agent_client_id`、`status_agent_client_key`などのホスト変数を追加（`inventory.yml`）。Pi5用vaultに`vault_status_agent_client_key`を追加（`host_vars/raspberrypi5/vault.yml`）。serverロールに`status-agent.yml`タスクを追加（設定ファイル配布、systemdユニット配布、タイマー有効化）。`main.yml`から`status-agent.yml`をインポート。Ansible実行時に自動的に設定ファイルが更新されるように改善。設定のドリフトを防止し、自動更新が可能になった。実機検証完了（設定ファイルが正しく生成、systemdサービスが正常動作、データベースに最新データが記録されることを確認）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-129](./knowledge-base/infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま) / [guides/status-agent.md](./guides/status-agent.md) を参照。

### 🆕 最新アップデート（2026-01-03）

- **✅ Pi3サイネージ正常化作業完了**: Pi3のサイネージ画面が旧デザイン（「工具管理データ」タイトル、温度表示なし）のままだった問題を解決。Pi5のTSソース（`signage.renderer.ts`）が旧い実装のままだったため、正しい実装（「持出中アイテム」＋`getClientSystemMetricsText()`）を反映し、APIコンテナを`--no-cache`で再ビルドして正常化完了。DEBUG MODEのNDJSONログでrepo/コンテナの不一致を検出し、修正前後のログ比較で正常化を確認。Pi3のサイネージ画面で「持出中アイテム」タイトルと温度表示（`CPU xx% Temp yy.y°C`）が正常に表示されることを確認済み。詳細は [knowledge-base/infrastructure/signage.md#kb-127](./knowledge-base/infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) / [investigation/temperature-display-investigation.md](./investigation/temperature-display-investigation.md) を参照。

- **✅ キオスク・サイネージUIで自端末の温度表示機能追加・実機検証完了**: キオスクUI（Pi4）とサイネージUI（Pi3）で自端末の温度を表示する機能を実装し、実機検証を完了。`ClientDevice.statusClientId`フィールドを追加し、`x-client-key`と`status-agent`の`clientId`を紐づけ。`GET /api/kiosk/config`エンドポイントを拡張し、`clientStatus`を返却。サイネージレンダラーで`getClientSystemMetricsText()`を実装し、Pi3の温度を取得して画像に埋め込む。サイネージ左ペインのタイトルを「工具管理データ」→「持出中アイテム」に変更。実機検証でPi4のキオスクUIで自端末の温度が正しく表示されることを確認済み。詳細は [knowledge-base/api.md#kb-126](./knowledge-base/api.md#kb-126-キオスクuiで自端末の温度表示機能追加) / [knowledge-base/infrastructure/signage.md#kb-127](./knowledge-base/infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) / [investigation/temperature-display-investigation.md](./investigation/temperature-display-investigation.md) を参照。

- **✅ APIエンドポイントのHTTPS化・デプロイ標準手順のブラッシュアップ完了**: APIエンドポイントをHTTPS経由（Caddy経由）に変更し、デプロイ標準手順をブラッシュアップ。`group_vars/all.yml`の`api_base_url`を`http://{{ server_ip }}:8080/api`から`https://{{ server_ip }}/api`に変更。クライアント（Pi3/Pi4）のエージェントがCaddy経由（HTTPS 443）でAPIにアクセスするように統一。ポート8080は外部公開されていない（Docker内部ネットワークでのみアクセス可能）ことを明記。デプロイドキュメントを更新し、HTTPS経由での確認方法を追加。セキュリティ強度が向上（HTTPS化、8080非公開の維持）。詳細は [knowledge-base/infrastructure/ansible-deployment.md#kb-128](./knowledge-base/infrastructure/ansible-deployment.md#kb-128-apiエンドポイントのhttps化caddy経由) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ キオスクお問い合わせフォームのデザイン変更・実機検証完了**: キオスクUIのお問い合わせフォームを改善し、実機検証を完了。送信者を社員名簿から選択するドロップダウンに変更し、依頼内容を「現場まで来てください。」のドロップダウンに変更。打合せ日時の選択フィールド（日付・時刻）を追加し、デフォルト値として現在の日時を設定。キオスク専用の従業員リスト取得エンドポイント（`/api/kiosk/employees`）を追加し、`x-client-key`認証のみでアクセス可能に。実機検証でフォームの各フィールドが正常に動作することを確認済み。詳細は [knowledge-base/api.md#kb-125](./knowledge-base/api.md#kb-125-キオスク専用従業員リスト取得エンドポイント追加) / [knowledge-base/frontend.md#kb-125](./knowledge-base/frontend.md#kb-125-キオスクお問い合わせフォームのデザイン変更) / [guides/verification-checklist.md#69-キオスクサポート機能slack通知](./guides/verification-checklist.md#69-キオスクサポート機能slack通知) を参照。

- **✅ キオスクSlackサポート機能実装・実機検証完了**: キオスクUIから管理者への問い合わせ機能（Slack通知）を実装し、実機検証を完了。キオスク画面ヘッダーに「お問い合わせ」ボタンを追加し、モーダルから問い合わせ内容を送信可能に。Slack Incoming Webhookを使用して通知を送信し、同時に既存のクライアントログとして保存。レート制限（1分に3件）とセキュリティ対策（Webhook URLの秘匿、タイムアウト処理）を実装。実機検証でSlack通知送信、ClientLog記録、APIログの正常動作をすべて確認済み。詳細は [knowledge-base/api.md#kb-124](./knowledge-base/api.md#kb-124-キオスクslackサポート機能の実装と実機検証完了) / [guides/verification-checklist.md#69-キオスクサポート機能slack通知](./guides/verification-checklist.md#69-キオスクサポート機能slack通知) / [guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md) を参照。

- **✅ Gmail経由CSV取り込み（手動実行）の実機検証完了**: Gmail経由でのCSVファイル自動取り込み機能の手動実行での実機検証を完了。Gmail検索・取得処理、CSVインポート処理、エラーハンドリングがすべて正常に動作することを確認。`GmailStorageProvider`が仕様通りに動作し、メールのアーカイブ処理も正常に機能。PowerAutomate設定後、スケジュール実行でのE2E検証を実施予定。詳細は [knowledge-base/api.md#kb-123](./knowledge-base/api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了) / [guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証](./guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証) を参照。

- **✅ 計測機器管理画面の部署表示・編集機能の実機検証完了**: 計測機器管理画面に`department`列と選択式編集機能を追加し、実機検証を完了。一覧表への部署列表示、新規作成フォームでの部署選択フィールド表示、部署候補の動的取得、部署の保存・更新がすべて正常に動作することを確認。詳細は [knowledge-base/api.md#kb-121](./knowledge-base/api.md#kb-121-部署一覧取得エンドポイント追加とprisma-where句の重複プロパティエラー修正) / [knowledge-base/frontend.md#kb-122](./knowledge-base/frontend.md#kb-122-計測機器管理画面にdepartment表示編集機能を追加) / [guides/verification-checklist.md#662-計測機器管理画面](./guides/verification-checklist.md#662-計測機器管理画面admintoolsmeasuring-instruments) を参照。

### 🆕 最新アップデート（2025-01-XX）

- **✅ 吊具CSVインポート検証完了・レイアウト改善**: 吊具CSVインポート（新フィールド`usableYears`）の検証を完了し、すべて正常に動作することを確認。吊具管理画面のレイアウトを改善し、一覧表と編集フォームが重ならないように修正。編集フォームを別のCardとして分離し、縦配置に変更。編集フォーム内のフィールドを2列のグリッドレイアウトに変更し、より使いやすく改善。実機検証でCSVインポート成功、`usableYears`フィールドの保存・表示・編集をすべて確認済み。詳細は [knowledge-base/frontend.md#kb-120](./knowledge-base/frontend.md#kb-120-吊具管理画面のレイアウト改善一覧表と編集フォームの重なり解消) / [guides/verification-checklist.md#64-吊具csvインポート新フィールド](./guides/verification-checklist.md#64-吊具csvインポート新フィールド) / [guides/verification-checklist.md#663-吊具管理画面](./guides/verification-checklist.md#663-吊具管理画面admintoolsrigging-gears) を参照。

- **✅ 計測機器UID編集時のバグ修正完了**: 計測機器のUIDを手動編集しても反映されない問題を修正。根本原因は1つの計測機器に複数の`MeasuringInstrumentTag`が紐づいていたこと。APIの`update`メソッドで既存タグをすべて削除してから新しいタグを1つ作成するように修正し、1対1の関係を保つように改善。フロントエンドでは`useRef`を使用して手動編集フラグを追加し、ユーザーの手動編集を`useEffect`の自動更新で上書きしないように修正。デバッグモードでランタイム証拠を収集し、根本原因を正確に特定。実機検証でUID編集が正常に反映されることを確認済み。詳細は [knowledge-base/api.md#kb-118](./knowledge-base/api.md#kb-118-計測機器uid編集時の複数タグ問題の修正) / [knowledge-base/frontend.md#kb-119](./knowledge-base/frontend.md#kb-119-計測機器uid編集時の手動編集フラグ管理) / [guides/verification-checklist.md#63-計測機器csvインポート新フィールド](./guides/verification-checklist.md#63-計測機器csvインポート新フィールド) を参照。

- **✅ CSVインポート構造改善と計測機器・吊具対応完了（CSV Import Scalingプラン完了）**: CSVインポート機能をレジストリ・ファクトリパターンでモジュール化し、計測機器・吊具のCSVインポートに対応。新しいデータタイプの追加が容易になり、コードの重複を削減。スケジュール設定を`targets`配列形式に拡張し、複数のデータタイプを1つのスケジュールで処理可能に。後方互換性を確保（旧`employeesPath`/`itemsPath`形式もサポート）。`replaceExisting=true`時の安全性を確保（参照がある個体は削除しない）。Gmail件名パターンを管理コンソールから編集できる機能を実装し、設定ファイル（`backup.json`）に保存されるように変更。**プラン完了日**: 2025-12-29（全6To-do完了）。詳細は [guides/csv-import-export.md](./guides/csv-import-export.md) / [knowledge-base/frontend.md#kb-112](./knowledge-base/frontend.md#kb-112-csvインポート構造改善と計測機器吊具対応) / [knowledge-base/frontend.md#kb-113](./knowledge-base/frontend.md#kb-113-gmail件名パターンの管理コンソール編集機能) / [knowledge-base/api.md#kb-114](./knowledge-base/api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) / [knowledge-base/api.md#kb-115](./knowledge-base/api.md#kb-115-gmail件名パターンの設定ファイル管理) を参照。

### 🆕 最新アップデート（2025-12-29）

- **✅ CSVインポートスケジュールページのUI統一・表示改善完了**: CSVインポートスケジュールページの日付指定UIをバックアップペイン（`BackupTargetForm.tsx`）と同じUIに統一。時刻入力（`type="time"`）と曜日選択ボタンを使用し、UI形式からcron形式への変換関数を実装。スケジュール表示を人間が読みやすい形式に変更（cron形式 `0 4 * * 1,2,3` → 「毎週月曜日、火曜日、水曜日の午前4時」）。デプロイ標準手順の遵守を徹底し、現在のブランチを使用するように修正。詳細は [knowledge-base/frontend.md#kb-109](./knowledge-base/frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) / [knowledge-base/frontend.md#kb-111](./knowledge-base/frontend.md#kb-111-csvインポートスケジュールの表示を人間が読みやすい形式に変更) / [knowledge-base/infrastructure/ansible-deployment.md#kb-110](./knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた) / [guides/deployment.md](./guides/deployment.md) を参照。

- **✅ Gmailデータ取得機能実装完了**: PowerAutomateからGmail経由でCSVファイルやJPEGファイルをPi5に送信し、自動的にインポートする機能を実装完了。OAuth 2.0認証によるセキュアな認証フローを実装し、管理画面からGmail設定を管理できるUIを実装。Tailscale DNSをオフにした場合の`/etc/hosts`設定スクリプトを作成し、Gmail OAuth認証が正常に完了（refresh token取得済み）。GmailとDropboxのトークンリフレッシュの違いを明確化（Gmailは自動リフレッシュ、Dropboxは手動リフレッシュ）。詳細は [plans/gmail-data-acquisition-execplan.md](./plans/gmail-data-acquisition-execplan.md) / [guides/gmail-setup-guide.md](./guides/gmail-setup-guide.md) / [knowledge-base/infrastructure/backup-restore.md#kb-108](./knowledge-base/infrastructure/backup-restore.md#kb-108-gmail-oauth認証時のtailscale-dns解決問題とetchosts設定) を参照。

### 🆕 最新アップデート（2025-12-29）

- **✅ バックアップエラーハンドリング改善完了**: Dropboxストレージプロバイダーの`download`と`delete`メソッドに、レート制限エラー（429）とネットワークエラー時のリトライ機能を追加。指数バックオフによるリトライロジック（最大5回、最大30秒）を実装。レート制限エラーや一時的なネットワークエラーが発生した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上。詳細は [guides/backup-error-handling-improvements.md](./guides/backup-error-handling-improvements.md) / [knowledge-base/infrastructure/backup-restore.md#kb-107](./knowledge-base/infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善) を参照。

- **✅ バックアップスクリプトとの整合性確認完了**: `scripts/server/backup.sh`スクリプトと管理コンソールのバックアップ機能の整合性を確認。`/api/backup/internal`エンドポイントが存在し、localhostからのアクセスのみ許可されていることを確認。バックアップスクリプトが使用する`kind`と`source`の組み合わせが管理コンソールと一致していることを確認。両方の方法で同じ設定ファイル（`backup.json`）が使用され、バックアップ履歴が正しく記録されることを確認。詳細は [guides/backup-script-integration-verification.md](./guides/backup-script-integration-verification.md) / [knowledge-base/infrastructure/backup-restore.md#kb-106](./knowledge-base/infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認) を参照。

- **✅ 実機検証完了（画像バックアップ・items.csv）**: 画像バックアップのリストア検証を完了。`tar.gz`形式のバックアップを正常に展開・復元することを確認。items.csvのバックアップ・リストア検証も完了。バリデーションエラーはデータの問題（`ITEM-XXX`形式が`TOXXXX`形式に適合しない）であり、リストア機能自体は正常動作していることを確認。詳細は [guides/backup-restore-verification-results.md](./guides/backup-restore-verification-results.md) / [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) を参照。

### 🆕 最新アップデート（2025-12-19）

- **✅ バックアップロジックのアーキテクチャ改善完了**: Factoryパターンとレジストリパターンを実装し、コード重複を完全に解消。新しいバックアップターゲット追加時の修正箇所が7箇所から2箇所に削減（約71%削減）。`BackupTargetFactory`と`StorageProviderFactory`を追加し、リストアロジックを各ターゲットに分離。設定ファイルによるパスマッピング管理を実装。`backup-scheduler.ts`に`client-file`ケースを追加して設定と実装の整合性を確保。リンター0エラー、ユニットテスト16/16成功。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md#phase-7-バックアップロジックのアーキテクチャ改善--完了) / [guides/backup-configuration.md](./guides/backup-configuration.md) を参照。

- **✅ Ansibleによるクライアント端末バックアップ機能実装完了**: クライアント端末（Pi4、Pi3など）のファイルは物理的に別マシン上に存在するため、Pi5（サーバー）のAPIから直接アクセスできない問題を解決するため、Ansibleを使用してクライアント端末のファイルをPi5に取得してバックアップする機能を実装完了。Ansibleのinventoryでクライアント端末を管理し、スケーラブルに対応。実装時にAnsibleとTailscaleの連携で問題が発生したが、`hosts: "{{ client_host }}"`への変更とSSH鍵のマウントにより解決。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) / [knowledge-base/infrastructure/backup-restore.md#kb-102](./knowledge-base/infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照。

- **✅ 画像バックアップリストア処理追加**: 画像バックアップは`tar.gz`形式で保存されるが、リストア時に展開処理がなかった問題を修正。`/api/backup/restore/from-dropbox`と`/api/backup/restore`エンドポイントに画像バックアップのリストア処理を追加。`tar.gz`を展開して写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元。既存ディレクトリの自動バックアップ機能も追加。ドキュメントを更新して画像バックアップのリストア手順を明記。詳細は [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) / [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) を参照。

### 🆕 最新アップデート（2025-12-18）

- **✅ バックアップ対象管理UI実装完了**: 管理コンソールの「バックアップ」タブからバックアップ対象（`targets`）を管理できる機能を実装完了。バックアップ対象の追加・編集・削除、有効/無効切り替え、手動バックアップ実行が可能。`backup.sh`スクリプトと管理コンソールの機能が整合性を保ち、設定ファイル（`backup.json`）の変更が即座に反映される。統合テスト・E2Eテストも実装済み。詳細は [requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md) / [guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md) / [guides/backup-and-restore.md](./guides/backup-and-restore.md) / [guides/backup-configuration.md](./guides/backup-configuration.md) を参照。

- **✅ 標準セキュリティチェックリスト監査完了**: IPA「安全なウェブサイトの作り方」、OWASP Top 10 2021、CISベンチマークに基づく監査を実施。主要なセキュリティ対策がほぼ完了していることを確認。未実施項目（CSRF対策、PostgreSQLのSSL/TLS接続強制、パスワードポリシー強化など）と必要性を評価。詳細は [security/standard-security-checklist-audit.md](./security/standard-security-checklist-audit.md) を参照。

- **✅ ポートセキュリティ強化完了**: Docker Composeのポートマッピング削除により、PostgreSQL（5432）とAPI（8080）のポートをDocker内部ネットワークでのみアクセス可能に。UFWに依存せず、Dockerレベルでポートがブロックされる。実機検証完了。インターネット接続状態での本番運用が可能であることを確認。詳細は [security/port-security-audit.md](./security/port-security-audit.md) / [security/port-security-verification-results.md](./security/port-security-verification-results.md) を参照。

### 🆕 最新アップデート（2025-12-17）

- **✅ UI視認性向上カラーテーマ実装完了（Phase 1-8）**: 工場現場での視認性を向上させるため、提案3（工場現場特化・高視認性テーマ）を採用し、管理コンソール、サイネージ、キオスクのカラーテーマを改善完了。主要ページ（統合一覧、アイテム一覧、キオスク返却画面、サイネージレンダラー、管理コンソール全ページ、工具管理全ページ）に提案3カラーパレットを適用。コントラスト比約21:1（WCAG AAA準拠）を達成。詳細は [requirements/ui-visibility-color-theme.md](./requirements/ui-visibility-color-theme.md) / [modules/tools/README.md](./modules/tools/README.md) / [modules/measuring-instruments/ui.md](./modules/measuring-instruments/ui.md) / [modules/signage/README.md](./modules/signage/README.md) を参照。

- **✅ Dropbox CSVインポート Phase 3完全検証・ベストプラクティス実装完了**: Phase 3の必須検証（実際のデータファイルを使用したエンドツーエンドテスト、エラーハンドリングテスト）を完了。ベストプラクティス実装（バックアップ履歴の記録機能、リストアAPIのパス処理改善）も完了。すべての検証項目が正常に動作することを確認し、本番運用可能な状態に到達。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/phase3-complete-verification-summary.md](./guides/phase3-complete-verification-summary.md) / [guides/phase3-mandatory-verification-results.md](./guides/phase3-mandatory-verification-results.md) / [guides/phase3-error-handling-test-results.md](./guides/phase3-error-handling-test-results.md) / [guides/phase3-next-tasks.md](./guides/phase3-next-tasks.md) を参照。

### 🆕 最新アップデート（2025-12-16）

- **✅ Dropbox CSVインポート Phase 3実装完了**: CSVインポート後の自動バックアップ機能、Dropboxからの自動リストア機能、バックアップ・リストア履歴機能を実装完了。`BackupHistory`モデル追加、`BackupHistoryService`実装、`BackupVerifier`による整合性検証機能、バックアップ履歴APIエンドポイント追加を完了。CIテストもすべて成功（BackupVerifier 12件、自動バックアップ機能 21件、バックアップAPI統合テストすべて成功）。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/csv-import-export.md](./guides/csv-import-export.md) を参照。

- **✅ Dropbox CSVインポート Phase 1/2補完タスク完了**: Phase 1補完として認可設定確認（mustBeAdmin適用、rateLimit設定）、大規模CSV性能テスト（1000行・10000行）、テスト独立性の問題修正を完了。Phase 2補完としてPowerAutomate側仕様のドキュメント化（`docs/guides/powerautomate-dropbox-integration.md`）、PowerAutomate未配置時のリトライ/アラート確認テスト追加、履歴APIフィルタ/ページング機能実装を完了。CIテストもすべて成功（192 passed, 21 passed, 14 passed, 18 passed, 24 passed, 4 passed）。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/powerautomate-dropbox-integration.md](./guides/powerautomate-dropbox-integration.md) を参照。

- **✅ Dropbox CSVインポート Phase 2 実機検証完了**: Phase 2の実機検証を完了。スケジュールAPI（CRUD）、手動実行API、CsvImportScheduler、ImportHistoryService（履歴記録）、ImportAlertService（アラート生成）のすべてが正常に動作することを確認。Dockerfile.apiにscriptsディレクトリを追加し、アラート生成機能も正常動作を確認。KB-101としてPi5へのSSH接続不可問題（force pushの影響）も記録。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [knowledge-base/infrastructure/ansible-deployment.md#kb-101](./knowledge-base/infrastructure/ansible-deployment.md#kb-101-pi5へのssh接続不可問題の原因と解決) を参照。

### 🆕 最新アップデート（2025-12-15）

- **✅ Dropbox CSVインポート Phase 2 実装完了**: Phase 2のスケジュール実行機能の実装とCI統合が完了。csv-import-scheduler（10件）、imports-schedule（13件）、import-alert（4件）の合計27件のテストがCIで実行され、すべて成功。ImportHistoryServiceの有効化とPrismaマイグレーション実行も完了（ローカル・実機の両方）。CsvImportHistoryテーブルが作成され、インポート履歴の記録機能が利用可能に。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/csv-import-history-migration.md](./guides/csv-import-history-migration.md) を参照。

- **✅ Dropbox CSVインポート Phase 1 実装完了**: DropboxからCSVファイルをダウンロードしてインポートする機能を実装完了。パストラバーサル防止、バリデーション強化、ログ出力、エラーハンドリング、追加テスト（13件すべてパス）を実装。CI必須化（`continue-on-error`削除）とブランチ保護設定ガイドも作成。詳細は [analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md) / [guides/ci-branch-protection.md](./guides/ci-branch-protection.md) を参照。

- **✅ Dropbox OAuth 2.0フローとリフレッシュトークン自動更新機能実装・実機検証完了**: OAuth 2.0認証フロー、リフレッシュトークンによる自動アクセストークン更新機能を実装完了し、実機検証も完了。401エラー（`expired_access_token`）時に自動的にリフレッシュし、設定ファイルを自動更新。テストも実装済み（10件すべてパス）。実機検証では、Docker Composeのconfigボリューム読み書き権限問題（KB-099）を解決し、OAuth認証フロー、リフレッシュトークン更新、ファイルバックアップの動作を確認済み。詳細は [plans/backup-modularization-execplan.md](./plans/backup-modularization-execplan.md) / [guides/dropbox-oauth-setup-guide.md](./guides/dropbox-oauth-setup-guide.md) / [guides/dropbox-oauth-verification-checklist.md](./guides/dropbox-oauth-verification-checklist.md) / [knowledge-base/infrastructure/backup-restore.md#kb-099](./knowledge-base/infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題) を参照。

### 🆕 最新アップデート（2025-12-14）

- **✅ Phase 9/10 セキュリティ強化完了**: インターネット接続時の追加防御（Phase 9）と認証・監視強化（Phase 10）を実装完了。管理画面IP制限、Webhookアラート通知、セキュリティヘッダー（Strict-Transport-Security含む）、DDoS/ブルートフォース緩和（レート制限）、MFA（多要素認証）、リアルタイム監視強化、権限監査を実装。実機テストも完了し、ローカルネットワークとインターネットの両環境で安全に運用可能。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) / [security/phase9-10-specifications.md](./security/phase9-10-specifications.md) / [security/implementation-assessment.md](./security/implementation-assessment.md) を参照。

- **📊 外部インシデント評価と追加対策**: アスクル社ランサムウェア事故を踏まえた対応可否と推奨対策（MFA、リアルタイム監視、権限監査）を実装完了。詳細は [security/implementation-assessment.md](./security/implementation-assessment.md) を参照。

### 🆕 最新アップデート（2025-12-13）

- **✅ サイネージデザイン改善（レイアウト/座標再調整）**: サーバー側レンダラーで余白を最小化しつつ、右ペインのタイトル・ファイル名とPDF表示領域の重なりを解消。外枠余白を極小化、タイトル・ファイル名のベースラインオフセットを揃え、PDFの黒地を拡大。詳細は [modules/signage/README.md](./modules/signage/README.md) / [knowledge-base/infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない](./knowledge-base/infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない) を参照。

- **✅ サイネージタブ内にPDFアップロード機能を統合**: 管理コンソールの「サイネージ」タブ（`/admin/signage/schedules`）にPDFアップロード・管理機能を追加。スケジュール設定画面と同じページでPDFをアップロード・管理できるようになり、ワークフローが改善されました。`SignagePdfManager`コンポーネントを新規作成して共通化し、サイネージタブとクライアント端末管理ページの両方で使用可能に。詳細は [modules/signage/README.md](./modules/signage/README.md) を参照。

### 🆕 最新アップデート（2025-12-12）

- **✅ Ansibleデプロイのブランチ指定機能追加**: `scripts/update-all-clients.sh`とAnsibleの`deploy.yml`でブランチを指定可能に。デフォルトは`main`ブランチ。開発ブランチ（`feature/production-deployment-management`）のハードコードを削除し、環境変数`ANSIBLE_REPO_VERSION`または引数でブランチを指定可能に。`scripts/update-all-clients.sh [ブランチ名]`で全デバイス（Pi5 + Pi3/Pi4）を更新可能。詳細は [guides/deployment.md](./guides/deployment.md) / [guides/quick-start-deployment.md](./guides/quick-start-deployment.md) を参照。

- **✅ デプロイメントベストプラクティスの明確化**: 開発時（Pi5のみ）は`scripts/server/deploy.sh <ブランチ>`、運用時（全デバイス）は`scripts/update-all-clients.sh [ブランチ]`を使用する使い分けをドキュメント化。デフォルトは`main`ブランチで、開発ブランチをハードコードしない設計に統一。詳細は [guides/deployment.md](./guides/deployment.md) を参照。

- **🆕 network_mode戻り・ローカルIP変動への対策**: git syncで`network_mode`が`local`へ戻る事象（KB-094）を踏まえ、デプロイ前だけでなくヘルスチェック前にも再確認する運用を追加。ローカルIPは毎回`hostname -I`で取得し`group_vars/all.yml`を更新するよう明記。キオスク向けヘルスチェックから`signage-lite`チェックを除外。詳細: [guides/deployment.md](./guides/deployment.md), [knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題](./knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題), [infrastructure/ansible/playbooks/health-check.yml](../infrastructure/ansible/playbooks/health-check.yml)

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
- **Phase 7 セキュリティ検証完了**: IPアドレス切替、Tailscale経路、UFW/HTTPS、fail2ban、暗号化バックアップ復元、ClamAV/Trivy/rkhunterスキャンを一通り手動検証しました。`alerts/alert-20251205-182352.json`（fail2ban）と `alert-20251205-184324.json`（rkhunter）を生成し、監視ルートの動作も確認済み。複数ローカルネットワーク環境（会社/自宅）でのVNC接続設定も対応済み。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) および [docs/security/requirements.md](./security/requirements.md) を参照してください。ナレッジベース: [KB-078](./knowledge-base/infrastructure/security.md#kb-078-複数ローカルネットワーク環境でのvnc接続設定), [KB-079](./knowledge-base/infrastructure/security.md#kb-079-phase7セキュリティテストの実施結果と検証ポイント)
- **Phase 6 セキュリティ監視・アラート実装完了**: fail2banのBanイベントとマルウェアスキャン結果を自動監視し、管理画面でアラート表示する仕組みを実装しました。`security-monitor.sh`がsystemd timer（15分間隔）で実行され、fail2banログを監視して侵入試行を検知します。ClamAV/Trivy/rkhunterのスキャン結果も自動でアラート化され、感染検知やスキャンエラー時に即座に通知されます。詳細は [plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md) を参照してください。ナレッジベース: [KB-076](./knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー), [KB-077](./knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化)
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
- **NFCエージェントキュー処理改善**: 工具スキャンが二重登録される問題を解決。オンライン時にイベントを即座に配信し、配信成功したイベントはキューから即時削除するように変更。詳細は [knowledge-base/infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善](./knowledge-base/infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) を参照してください。
- **ナレッジベース更新**: [knowledge-base/index.md](./knowledge-base/index.md) の登録件数が 74件になり、fail2ban連携のセキュリティ監視タイマー（KB-076）とマルウェアスキャン結果の自動アラート化（KB-077）を追加しました。
- **Raspberry Pi status-agent**: クライアント端末が1分毎にメトリクスを送信する `status-agent.py`（systemd timer 同梱）を追加。ガイドは [guides/status-agent.md](./guides/status-agent.md)、ソースは `clients/status-agent/` を参照してください。
- **ローカル環境対応の通知機能**: 管理画面でのアラート表示とファイルベースの通知機能を実装しました。Ansible更新失敗時に自動的にアラートファイルを生成し、管理画面で確認できます。ガイドは [guides/local-alerts.md](./guides/local-alerts.md) を参照してください。
- **Ansible堅牢化・安定化の実装**: `git clean`による設定ファイル削除問題を解決し、システム設定ファイル（polkit設定など）をAnsibleで管理する仕組みを実装しました。バックアップ・ロールバック機能も追加。詳細は [plans/ansible-improvement-plan.md](./plans/ansible-improvement-plan.md) を参照してください。ガイド: [Ansibleで管理すべき設定ファイル一覧](./guides/ansible-managed-files.md)、ナレッジベース: [KB-061](./knowledge-base/infrastructure/ansible-deployment.md#kb-061-ansible実装後の設定ファイル削除問題と堅牢化対策)
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
| **Dropbox CSV統合機能の現状を把握したい** | **[analysis/dropbox-csv-integration-status.md](./analysis/dropbox-csv-integration-status.md)** |

### デプロイ・運用する

| やりたいこと | ドキュメント |
|-------------|-------------|
| 本番環境にデプロイしたい | [guides/deployment.md](./guides/deployment.md) |
| **デプロイメントモジュール（原因分析・設計・テスト計画）を確認したい** | **[architecture/deployment-modules.md](./architecture/deployment-modules.md)** |
| 本番環境をセットアップしたい | [guides/production-setup.md](./guides/production-setup.md) |
| バックアップ・リストアしたい | [guides/backup-and-restore.md](./guides/backup-and-restore.md) |
| **バックアップ設定を変更したい** | **[guides/backup-configuration.md](./guides/backup-configuration.md)** |
| **バックアップ対象を管理したい** | **[guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md)** / **[requirements/backup-target-management-ui.md](./requirements/backup-target-management-ui.md)** |
| **バックアップ機能を実機検証したい** | **[guides/backup-target-management-verification.md](./guides/backup-target-management-verification.md)** |
| **Dropbox OAuth 2.0を設定したい** | **[guides/dropbox-oauth-setup-guide.md](./guides/dropbox-oauth-setup-guide.md)** |
| **Dropbox OAuth 2.0を実機検証したい** | **[guides/dropbox-oauth-verification-checklist.md](./guides/dropbox-oauth-verification-checklist.md)** |
| **Slack Webhookを設定したい** | **[guides/slack-webhook-setup.md](./guides/slack-webhook-setup.md)** |
| **CI必須化とブランチ保護設定** | **[guides/ci-branch-protection.md](./guides/ci-branch-protection.md)** |
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
| **CSVフォーマット仕様実装を検証したい** | **[guides/verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31](./guides/verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)** |
| USBインポートを検証したい | [guides/validation-7-usb-import.md](./guides/validation-7-usb-import.md) |
| デジタルサイネージ機能を検証したい | [guides/signage-test-plan.md](./guides/signage-test-plan.md) |
| システム安定性向上機能を検証したい | [guides/stability-improvement-test.md](./guides/stability-improvement-test.md) |
| セキュリティを検証したい | [security/validation-review.md](./security/validation-review.md) |
| **セキュリティ要件を確認したい** | **[security/requirements.md](./security/requirements.md)** |
| **セキュリティ強化の実装計画を確認したい** | **[plans/security-hardening-execplan.md](./plans/security-hardening-execplan.md)** |
| **Phase 9/10 セキュリティ機能の詳細仕様を確認したい** | **[security/phase9-10-specifications.md](./security/phase9-10-specifications.md)** |
| **セキュリティ強化のテスト計画を確認したい** | **[guides/security-test-plan.md](./guides/security-test-plan.md)** |
| **インシデント対応手順を確認したい** | **[security/incident-response.md](./security/incident-response.md)** |
| **外部インシデント評価と追加対策** | **[security/implementation-assessment.md](./security/implementation-assessment.md)** |
| **システム担当者向けセキュリティプレゼン資料** | **[presentations/security-measures-presentation.md](./presentations/security-measures-presentation.md)** |
| **IPアドレス管理の変数化について知りたい** | **[knowledge-base/infrastructure/ansible-deployment.md#kb-069](./knowledge-base/infrastructure/ansible-deployment.md#kb-069)** |
| **運用モード可視化について知りたい** | **[knowledge-base/infrastructure/miscellaneous.md#kb-070](./knowledge-base/infrastructure/miscellaneous.md#kb-070)** |
| **Tailscale導入について知りたい** | **[knowledge-base/infrastructure/security.md#kb-071](./knowledge-base/infrastructure/security.md#kb-071)** |
| **ファイアウォール/HTTPS強化について知りたい** | **[knowledge-base/infrastructure/security.md#kb-072](./knowledge-base/infrastructure/security.md#kb-072)** |
| **fail2ban設定について知りたい** | **[knowledge-base/infrastructure/security.md#kb-073](./knowledge-base/infrastructure/security.md#kb-073)** |
| **Pi5のマルウェア対策を確認したい** | **[knowledge-base/infrastructure/security.md#kb-074](./knowledge-base/infrastructure/security.md#kb-074)** |
| **Pi4キオスクの軽量マルウェア対策を確認したい** | **[knowledge-base/infrastructure/security.md#kb-075](./knowledge-base/infrastructure/security.md#kb-075)** |
| **fail2ban連携のセキュリティ監視を確認したい** | **[knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー](./knowledge-base/infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー)** |
| **マルウェア検知アラート化について知りたい** | **[knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化](./knowledge-base/infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化)** |

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
| **Dropbox OAuth設定でエラーが発生した** | **[knowledge-base/infrastructure/backup-restore.md#kb-099](./knowledge-base/infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題)** |
| **CIテストが失敗してもマージできてしまう** | **[knowledge-base/infrastructure/ansible-deployment.md#kb-100](./knowledge-base/infrastructure/ansible-deployment.md#kb-100-ciテストが失敗してもマージが進んでしまう問題再発)** / **[.github/BRANCH_PROTECTION_SETUP.md](../.github/BRANCH_PROTECTION_SETUP.md)** |

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
| [port-security-audit.md](./security/port-security-audit.md) | **ポートセキュリティ監査レポート**（ポート公開状況の監査と修正内容、2025-12-18） |
| [port-security-verification.md](./security/port-security-verification.md) | **ポートセキュリティ修正後の動作確認手順**（ポートマッピング削除後の動作確認手順、2025-12-18） |
| [port-security-verification-results.md](./security/port-security-verification-results.md) | **ポートセキュリティ修正後の実機検証結果**（実機検証結果と評価、2025-12-18） |
| [standard-security-checklist-audit.md](./security/standard-security-checklist-audit.md) | **標準セキュリティチェックリスト監査レポート**（IPA、OWASP、CISベンチマークに基づく監査結果、2025-12-18） |
| [postgresql-password-policy-implementation.md](./security/postgresql-password-policy-implementation.md) | **PostgreSQLパスワードポリシー強化の実装**（環境変数によるパスワード管理の実装手順、2025-12-18完了） |

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

