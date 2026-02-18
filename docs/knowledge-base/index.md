---
title: トラブルシューティングナレッジベース - 索引
tags: [トラブルシューティング, ナレッジベース, 索引]
audience: [開発者, 運用者]
last-verified: 2026-02-17
related: [api.md, database.md, ci-cd.md, frontend.md, infrastructure.md]
category: knowledge-base
update-frequency: high
---

# トラブルシューティングナレッジベース - 索引

このドキュメントは、トラブルシューティングナレッジの索引です。各課題はカテゴリ別に分割されたファイルに記録されています。

**EXEC_PLAN.mdとの連携**: 各課題はEXEC_PLAN.mdの「課題」セクションまたは「Surprises & Discoveries」セクションと対応しています。課題ID（KB-XXX）で参照してください。

---

## 📁 カテゴリ別ファイル

| カテゴリ | ファイル | 件数 | 説明 |
|---------|---------|------|------|
| キオスク貸出（調査報告） | [kb-kiosk-rigging-return-cancel-investigation.md](./kb-kiosk-rigging-return-cancel-investigation.md) | 1件 | 吊具持出し・返却の仕様と「使用中」判定／返却後に再スキャンで使用中アラートが出る事象の調査（取消との混在有無） |
| API関連 | [api.md](./api.md) | 54件 | APIエラー、レート制限、認証、履歴、サイネージ、キオスクサポート、温度表示、環境変数バリデーション、WebRTCシグナリング、WebRTC通話IDの統一、CSVインポートエラーハンドリング、CSVインポートスケジュール間隔設定、FSEIBANバリデーション修正、生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側）、生産スケジュールAPI拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）、生産スケジュール検索状態の全キオスク間共有化、生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正、生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入）、Gmail認証切れ時のSlack通知機能追加、Gmail認証切れの実機調査と回復、生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化、history-progressエンドポイント追加と製番進捗集計サービス、Gmailゴミ箱自動削除機能（深夜バッチ）、生産スケジュール資源CDボタン表示の遅延問題（式インデックス追加による高速化）、未点検加工機サイネージ可視化データソースの追加、`kiosk`/`clients` ルート分割とサービス層抽出、加工機点検状況サイネージの集計一致と2列表示最適化（未点検は終端）、`backup`/`imports`ルート分割とサービス層移設、コード品質改善フェーズ2（Ratchet）〜フェーズ4第五弾（5本実装）、加工機点検状況サイネージのカードレイアウト変更と背景色改善、Gmail APIレート制限エラー（429）の対処方法 |
| フロントエンド関連 | [frontend.md](./frontend.md) | 44件 | キオスク接続、XState、UI、カメラ連携、サイネージ、NFCスコープ分離、CSVインポートUI統一、スケジュール表示改善（分のリスト形式対応）、WebRTC通話、通話IDの表示統一、バックアップ履歴用途列追加、WebRTCビデオ通話機能のclientKey/clientId未設定問題、サイネージプレビュー機能、CSVインポートスケジュール実行ボタンの競合防止、生産スケジュール画面のパフォーマンス最適化と検索機能改善（フロントエンド側）、生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード）、生産スケジュールUI改良（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）、生産スケジュール備考のモーダル編集化と処理列追加、キオスク入力フィールド保護ルールの実装と実機検証、キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入）、モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化、WebRTCビデオ通話の常時接続と着信自動切り替え機能、生産スケジュール登録製番削除ボタンの進捗連動UI改善、Pi4キオスクの備考欄に日本語入力状態インジケーターを追加、生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化、カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応）、未点検加工機サイネージ設定導線の実装、吊具持出画面に吊具情報表示を追加 |
| データベース関連 | [database.md](./database.md) | 3件 | P2002エラー、削除機能、シードデータ |
| CI/CD関連 | [ci-cd.md](./ci-cd.md) | 6件 | CIテスト失敗、E2Eテスト、バックアップ/リストア、依存監査（pnpm audit） |
| インフラ関連 | [infrastructure.md](./infrastructure.md) | 72件（サブカテゴリ別に分割） | Docker、Caddy、HTTPS設定、オフライン耐性、バックアップ、Ansible、NFCリーダー、Tailscale、IPアドレス管理、ファイアウォール、マルウェア対策、監視、サイネージSVGレンダラー、Dropbox OAuth 2.0、CI必須化、SSH接続、DropboxリストアUI改善、デプロイ標準手順、APIエンドポイントHTTPS化、サイネージ温度表示、WebSocketプロキシ、Slack通知チャンネル分離、Pi4デプロイ時のメンテナンス画面表示、デプロイ検証強化（DBゲート追加・fail-fast化）、デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能 |
| ├─ Docker/Caddy関連 | [infrastructure/docker-caddy.md](./infrastructure/docker-caddy.md) | 9件 | Docker ComposeとCaddyリバースプロキシ、WebSocketプロキシ設定 |
| ├─ バックアップ・リストア関連 | [infrastructure/backup-restore.md](./infrastructure/backup-restore.md) | 30件 | バックアップとリストア機能、Gmail連携、client-directory追加、Gmail/Dropboxトークン分離、provider別名前空間化、衝突・ドリフト検出の自動化、Dropbox basePath分離、git clean削除問題、backup.json復元方法、Gmail OAuth設定復元、旧キーと新構造の衝突解決、Dropbox証明書ピニング問題、バックアップ対象の追加、UI表示問題の修正、Dropbox 409 Conflictエラー（labelサニタイズ未実施によるパス不正）、旧キー自動削除機能の実装（backup.json保存時の自動クリーンアップ）、Dropbox選択削除（purge-selective）のパス正規化不整合、retention.maxBackupsがdays無しで効かない（仕様/実装差）、証明書ディレクトリのバックアップターゲット追加スクリプト作成とDockerコンテナ内実行時の注意点 |
| ├─ Ansible/デプロイ関連 | [infrastructure/ansible-deployment.md](./infrastructure/ansible-deployment.md) | 43件 | Ansibleとデプロイメント、APIエンドポイントHTTPS化、環境変数管理、Dropbox設定管理、backup.json保護、Gmail設定健全性チェック、status-agent.timer無効化、マルチサイト対応、inventory引数必須化、inventory/playbookパス相対パス修正、デプロイ安定化機能、Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善、Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了、Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了、Slack通知チャンネル分離デプロイトラブルシューティング、Pi4デプロイ検証結果、Pi4デプロイ時のメンテナンス画面表示機能、デプロイ検証強化（DBゲート追加・fail-fast化）、デプロイ標準手順のタイムアウト・コンテナ未起動問題の調査と改善実装（down後回し、中断時復旧、ログ永続化）、デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能、Pi3デプロイ時のpost_tasksでunreachable=1が発生するがサービスは正常動作している、デプロイプロセスのコード変更検知とDocker再ビルド確実化、Docker build時のtsbuildinfo問題、SSH接続失敗の原因（fail2banによるIP Ban）、Pi5のGit権限問題（.gitディレクトリがroot所有）、NodeSourceリポジトリのGPG署名キー問題（SHA1が2026-02-01以降拒否される）、デプロイ時のinventory混同問題（inventory-talkplaza.ymlとinventory.ymlの混同）、デプロイ時のマイグレーション未適用問題、デプロイ方針の見直し（Pi5+Pi4以上は`--detach --follow`必須）、Web bundleデプロイ修正（コード更新時のDocker再ビルド確実化）、Docker build最適化（変更ファイルに基づくbuild判定）、Pi4キオスクの再起動/シャットダウンボタンが機能しない問題（Jinja2テンプレート展開・systemd実行ユーザー・ディレクトリ所有権の問題）、update-all-clients.shでraspberrypi5対象時にRASPI_SERVER_HOST必須チェックを追加、Ansibleテンプレート内の`&#123;&#123;`混入によるSyntax error in template、Pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とIBus設定の永続化、Pi5のみデプロイ時にメンテナンスフラグが残存する問題 |
| ├─ Ansible/デプロイ性能（調査） | [infrastructure/ansible-deployment-performance.md](./infrastructure/ansible-deployment-performance.md) | 1件 | デプロイ性能の調査（段階展開: カナリア→ロールアウト、Pi4並行/Pi3単独、重複タスク排除、Tailscale/pnpmの実態差分の是正、計測導線） |
| ├─ セキュリティ関連 | [infrastructure/security.md](./infrastructure/security.md) | 16件 | セキュリティ対策と監視、Tailscale ACL grants形式でのポート指定エラー、Tailscaleハードニング段階導入完了（横移動面削減）、NFCストリーム端末分離の実装完了（ACL維持・横漏れ防止） |
| ├─ サイネージ関連 | [infrastructure/signage.md](./infrastructure/signage.md) | 15件 | デジタルサイネージ機能、温度表示、デザイン変更、CSVダッシュボード可視化、複数スケジュール順番切り替え、生産スケジュールサイネージデザイン修正、生産スケジュールサイネージアイテム高さの最適化（20件表示対応） |
| ├─ NFC/ハードウェア関連 | [infrastructure/hardware-nfc.md](./infrastructure/hardware-nfc.md) | 3件 | NFCリーダーとハードウェア |
| └─ その他 | [infrastructure/miscellaneous.md](./infrastructure/miscellaneous.md) | 21件 | その他のインフラ関連（ストレージ管理、macOS対応、Wi-Fi認証ダイアログ抑制、Chromium警告メッセージ抑制、Cursorチャットログ削除含む） |

---

## 📋 課題一覧（ID順）

### API関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-001](./api.md#kb-001-429エラーレート制限エラーが発生する) | 429エラー（レート制限エラー）が発生する | ✅ 解決済み |
| [KB-002](./api.md#kb-002-404エラーが発生する) | 404エラーが発生する | ✅ 解決済み |
| [KB-007](./api.md#kb-007-ログインが失敗する) | ログインが失敗する | ✅ 解決済み |
| [KB-008](./api.md#kb-008-履歴の精度が低い) | 履歴の精度が低い | ✅ 解決済み |
| [KB-010](./api.md#kb-010-client-key未設定で401エラーが発生する) | client-key未設定で401エラーが発生する | ✅ 解決済み |
| [KB-011](./api.md#kb-011-同じアイテムが未返却のまま再借用できない) | 同じアイテムが未返却のまま再借用できない | ✅ 解決済み |
| [KB-012](./api.md#kb-012-管理uiの履歴画面に日付フィルタcsvエクスポートがない) | 管理UIの履歴画面に日付フィルタ/CSVエクスポートがない | ✅ 解決済み |
| [KB-017](./api.md#kb-017-fastify-swaggerが存在しない) | fastify-swaggerが存在しない | ✅ 解決済み |
| [KB-044](./api.md#kb-044-pdfアップロード時のmultipart処理エラーpart-is-not-async-iterable) | PDFアップロード時のmultipart処理エラー（part is not async iterable） | ✅ 解決済み |
| [KB-045](./api.md#kb-045-サイネージが常に工具表示になる問題タイムゾーン問題) | サイネージが常に工具表示になる問題（タイムゾーン問題） | ✅ 解決済み |
| [KB-046](./api.md#kb-046-サイネージで工具管理がダミーデータのみ表示される問題) | サイネージで工具管理がダミーデータのみ表示される問題 | ✅ 解決済み |
| [KB-051](./api.md#kb-051-サイネージのpdfスライドショーが切り替わらない) | サイネージのPDFスライドショーが切り替わらない | ✅ 解決済み |
| [KB-052](./api.md#kb-052-sharpのcompositeエラーimage-to-composite-must-have-same-dimensions-or-smaller) | sharpのcompositeエラー（Image to composite must have same dimensions or smaller） | ✅ 解決済み |
| [KB-054](./api.md#kb-054-サイネージ工具表示で日本語が文字化けする問題) | サイネージ工具表示で日本語が文字化けする問題 | ✅ 解決済み |
| [KB-055](./api.md#kb-055-サイネージpdfがトリミングされて表示される) | サイネージPDFがトリミングされて表示される | ✅ 解決済み |
| [KB-090](./api.md#kb-090-キオスクから計測機器一覧を取得できない問題client-key認証追加) | キオスクから計測機器一覧を取得できない問題（client-key認証追加） | ✅ 解決済み |
| [KB-090](./api.md#kb-090-キオスクから計測機器一覧を取得できない問題client-key認証追加) | キオスクから計測機器一覧を取得できない問題（client-key認証追加） | ✅ 解決済み |
| [KB-094](./api.md#kb-094-サイネージ左ペインで計測機器と工具を視覚的に識別できない) | サイネージ左ペインで計測機器と工具を視覚的に識別できない | ✅ 解決済み |
| [KB-114](./api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) | CSVインポート構造改善（レジストリ・ファクトリパターン） | ✅ 解決済み |
| [KB-115](./api.md#kb-115-gmail件名パターンの設定ファイル管理) | Gmail件名パターンの設定ファイル管理 | ✅ 解決済み |
| [KB-116](./api.md#kb-116-csvインポート手動実行時のリトライスキップ機能) | CSVインポート手動実行時のリトライスキップ機能 | ✅ 解決済み |
| [KB-117](./api.md#kb-117-csvインポートapiの単一データタイプ対応エンドポイント追加) | CSVインポートAPIの単一データタイプ対応エンドポイント追加 | ✅ 解決済み |
| [KB-118](./api.md#kb-118-計測機器uid編集時の複数タグ問題の修正) | 計測機器UID編集時の複数タグ問題の修正 | ✅ 解決済み |
| [KB-121](./api.md#kb-121-部署一覧取得エンドポイント追加とprisma-where句の重複プロパティエラー修正) | 部署一覧取得エンドポイント追加とPrisma where句の重複プロパティエラー修正 | ✅ 解決済み |
| [KB-123](./api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了) | Gmail経由CSV取り込み（手動実行）の実機検証完了 | ✅ 解決済み |
| [KB-124](./api.md#kb-124-キオスクslackサポート機能の実装と実機検証完了) | キオスクSlackサポート機能の実装と実機検証完了 | ✅ 解決済み |
| [KB-125](./api.md#kb-125-キオスク専用従業員リスト取得エンドポイント追加) | キオスク専用従業員リスト取得エンドポイント追加 | ✅ 解決済み |
| [KB-126](./api.md#kb-126-キオスクuiで自端末の温度表示機能追加) | キオスクUIで自端末の温度表示機能追加 | ✅ 解決済み |
| [KB-132](./api.md#kb-132-webrtcシグナリングルートのダブルプレフィックス問題) | WebRTCシグナリングルートのダブルプレフィックス問題 | ✅ 解決済み |
| [KB-133](./api.md#kb-133-fastifywebsocketのconnectionsocketがundefinedになる問題) | @fastify/websocketのconnection.socketがundefinedになる問題 | ✅ 解決済み |
| [KB-134](./api.md#kb-134-websocket接続の5分タイムアウト問題とkeepalive対策) | WebSocket接続の5分タイムアウト問題とkeepalive対策 | ✅ 解決済み |
| [KB-135](./api.md#kb-135-キオスク通話候補取得用apiエンドポイント追加) | キオスク通話候補取得用APIエンドポイント追加 | ✅ 解決済み |
| [KB-185](./api.md#kb-185-csvダッシュボードのgmailsubjectpattern設定ui改善) | CSVダッシュボードのgmailSubjectPattern設定UI改善 | ✅ 解決済み |
| [KB-186](./api.md#kb-186-csvimportsubjectpatternモデル追加による設計統一マスターデータインポートの件名パターンdb化) | CsvImportSubjectPatternモデル追加による設計統一（マスターデータインポートの件名パターンDB化） | ✅ 解決済み |
| [KB-187](./api.md#kb-187-csvインポートスケジュール作成時のid自動生成とnomatchingmessageerrorハンドリング改善) | CSVインポートスケジュール作成時のID自動生成とNoMatchingMessageErrorハンドリング改善 | ✅ 解決済み |
| [KB-188](./api.md#kb-188-csvインポート実行エンドポイントでのapierror-statuscode尊重) | CSVインポート実行エンドポイントでのApiError statusCode尊重 | ✅ 解決済み |
| [KB-189](./api.md#kb-189-gmailに同件名メールが溜まる場合のcsvダッシュボード取り込み仕様どの添付を取るか) | Gmailに同件名メールが溜まる場合のCSVダッシュボード取り込み仕様（どの添付を取るか） | ✅ 解決済み |
| [KB-190](./api.md#kb-190-gmail-oauthのinvalid_grantでcsv取り込みが500になる) | Gmail OAuthのinvalid_grantでCSV取り込みが500になる | ✅ 解決済み |
| [KB-191](./api.md#kb-191-csvインポートスケジュールの間隔設定機能実装10分ごと等の細かい頻度設定) | CSVインポートスケジュールの間隔設定機能実装（10分ごと等の細かい頻度設定） | ✅ 解決済み |
| [KB-201](./api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) | 生産スケジュールCSVダッシュボードの差分ロジック改善とバリデーション追加 | ✅ 解決済み |
| [KB-204](./frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング) | CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング | ✅ 解決済み |
| [KB-205](./api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側) | 生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側） | ✅ 解決済み |
| [KB-208](./api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索) | 生産スケジュールAPI拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索） | ✅ 解決済み |
| [KB-209](./api.md#kb-209-生産スケジュール検索状態の全キオスク間共有化) | 生産スケジュール検索状態の全キオスク間共有化 | ✅ 解決済み |
| [KB-210](./api.md#kb-210-生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正) | 生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正 | ✅ 解決済み |
| [KB-211](./api.md#kb-211-生産スケジュール検索登録製番の削除追加が巻き戻る競合問題cas導入) | 生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入） | ✅ 解決済み |
| [KB-212](./api.md#kb-212-生産スケジュール行ごとの備考欄追加機能) | 生産スケジュール行ごとの備考欄追加機能 | ✅ 解決済み |
| [KB-215](./api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ) | Gmail OAuthリフレッシュトークンの7日間制限問題（未検証アプリ） | 🔄 検証リクエスト中 |
| [KB-216](./api.md#kb-216-gmail-apiレート制限エラー429の対処方法) | Gmail APIレート制限エラー（429）の対処方法 | ✅ 解決済み・復旧完了 |
| [KB-221](./frontend.md#kb-221-生産スケジュール納期日機能のui改善カスタムカレンダーui実装) | 生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装） | ✅ 解決済み |
| [KB-229](./api.md#kb-229-gmail認証切れ時のslack通知機能追加) | Gmail認証切れ時のSlack通知機能追加 | ✅ 解決済み |
| [KB-230](./api.md#kb-230-gmail認証切れの実機調査と回復) | Gmail認証切れの実機調査と回復 | ✅ 解決済み |
| [KB-231](./api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) | 生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化 | ✅ 解決済み |
| [KB-246](./api.md#kb-246-gmailゴミ箱自動削除機能深夜バッチ) | Gmailゴミ箱自動削除機能（深夜バッチ） | ✅ 解決済み |
| [KB-248](./api.md#kb-248-生産スケジュール資源cdボタン表示の遅延問題式インデックス追加による高速化) | 生産スケジュール資源CDボタン表示の遅延問題（式インデックス追加による高速化） | ✅ 解決済み |
| [KB-249](./api.md#kb-249-csvダッシュボードの日付パースでタイムゾーン変換の二重適用問題) | CSVダッシュボードの日付パースでタイムゾーン変換の二重適用問題 | ✅ 解決済み |
| [KB-250](./frontend.md#kb-249-加工機マスターデータのcsvインポートと未点検加工機抽出機能の実装) | 加工機マスターデータのCSVインポートと未点検加工機抽出機能の実装 | ✅ 実装完了・実機検証完了 |
| [KB-251](./api.md#kb-251-未点検加工機サイネージ可視化データソースの追加) | 未点検加工機サイネージ可視化データソースの追加 | ✅ 解決済み |
| [KB-253](./api.md#kb-253-加工機csvインポートのデフォルト列定義とdb設定不整合問題) | 加工機CSVインポートのデフォルト列定義とDB設定不整合問題 | ✅ 解決済み |
| [KB-255](./api.md#kb-255-apikiosk-と-apiclients-のルート分割サービス層抽出互換維持での実機検証) | `/api/kiosk` と `/api/clients` のルート分割・サービス層抽出（互換維持での実機検証） | ✅ 解決済み |
| [KB-256](./api.md#kb-256-加工機点検状況サイネージの集計一致と2列表示最適化未点検は終端) | 加工機点検状況サイネージの集計一致と2列表示最適化（未点検は終端） | ✅ 解決済み |
| [KB-257](./api.md#kb-257-backupimportsルート分割と実行ロジックのサービス層移設) | backup/importsルート分割と実行ロジックのサービス層移設 | ✅ 解決済み |
| [KB-258](./api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張) | コード品質改善フェーズ2（Ratchet）〜フェーズ4第五弾（5本実装）+ B対応（coverage安定化と`test-exclude>glob`維持判断） | ✅ 解決済み |
| [KB-262](./api.md#kb-262-加工機点検状況サイネージのカードレイアウト変更と背景色改善) | 加工機点検状況サイネージのカードレイアウト変更と背景色改善 | ✅ 解決済み |

### データベース関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-003](./database.md#kb-003-p2002エラーnfctaguidの重複が発生する) | P2002エラー（nfcTagUidの重複）が発生する | ✅ 解決済み |
| [KB-004](./database.md#kb-004-削除機能が動作しない) | 削除機能が動作しない | ✅ 解決済み |
| [KB-013](./database.md#kb-013-実機uidとseedデータが不一致) | 実機UIDとseedデータが不一致 | ✅ 解決済み |

### CI/CD関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-005](./ci-cd.md#kb-005-ciテストが失敗する) | CIテストが失敗する | 🔄 進行中 |
| [KB-227](./ci-cd.md#kb-227-pnpm-audit-のhighでciが失敗するfastify脆弱性--fastify-v5移行の影響範囲調査) | `pnpm audit` のhighでCIが失敗する（fastify脆弱性 / Fastify v5移行の影響範囲調査） | 🔄 進行中 |
| [KB-009](./ci-cd.md#kb-009-e2eテストのログイン成功後のリダイレクトがci環境で失敗する) | E2Eテストのログイン成功後のリダイレクトがCI環境で失敗する | ✅ 解決済み |
| [KB-023](./ci-cd.md#kb-023-ciでバックアップリストアテストが失敗する) | CIでバックアップ・リストアテストが失敗する | 🔄 進行中 |
| [KB-024](./ci-cd.md#kb-024-ciテストアーキテクチャの設計不足) | CI/テストアーキテクチャの設計不足 | 🔄 進行中 |
| [KB-025](./ci-cd.md#kb-025-e2eスモークkioskがナビゲーション不可視で失敗する) | E2Eスモーク（kiosk）がナビゲーション不可視で失敗する | ✅ 解決済み |
| [KB-026](./ci-cd.md#kb-026-cursor内の編集ツールが大きなyamlファイルで失敗する) | Cursor内の編集ツールが大きなYAMLファイルで失敗する | ✅ 解決済み |

### フロントエンド関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-006](./frontend.md#kb-006-キオスクの接続が不安定) | キオスクの接続が不安定 | ✅ 解決済み |
| [KB-016](./frontend.md#kb-016-xstate-v5のassignの誤用) | XState v5のassignの誤用 | ✅ 解決済み |
| [KB-022](./frontend.md#kb-022-キオスクがラズパイ5に接続できない) | キオスクがラズパイ5に接続できない | ✅ 解決済み |
| [KB-026](./frontend.md#kb-026-キオスク画面のリダイレクトが設定変更時に反映されない) | キオスク画面のリダイレクトが設定変更時に反映されない | ✅ 解決済み |
| [KB-027](./frontend.md#kb-027-nfcイベントが重複発火して持出一覧に自動追加が止まらない) | NFCイベントが重複発火して持出一覧に自動追加が止まらない | ✅ 解決済み |
| [KB-028](./frontend.md#kb-028-デバッグログの環境変数制御) | デバッグログの環境変数制御 | ✅ 解決済み |
| [KB-029](./frontend.md#kb-029-従業員編集画面でバリデーションエラーメッセージが表示されない) | 従業員編集画面でバリデーションエラーメッセージが表示されない | ✅ 解決済み |
| [KB-035](./frontend.md#kb-035-useeffectの依存配列にiscapturingを含めていた問題重複処理) | useEffectの依存配列にisCapturingを含めていた問題（重複処理） | ✅ 解決済み |
| [KB-036](./frontend.md#kb-036-履歴画面の画像表示で認証エラーwindowopenでの新しいタブ) | 履歴画面の画像表示で認証エラー（window.openでの新しいタブ） | ✅ 解決済み |
| [KB-037](./frontend.md#kb-037-カメラプレビューのcpu負荷問題常時プレビュー削除) | カメラプレビューのCPU負荷問題（常時プレビュー削除） | ✅ 解決済み |
| [KB-038](./frontend.md#kb-038-カメラ撮影時のcpu100問題video要素のクリーンアップ) | カメラ撮影時のCPU100%問題（video要素のクリーンアップ） | ✅ 解決済み |
| [KB-040](./frontend.md#kb-040-返却一覧の自動更新が不要だった問題cpu負荷軽減) | 返却一覧の自動更新が不要だった問題（CPU負荷軽減） | ✅ 解決済み |
| [KB-043](./frontend.md#kb-043-kioskredirectがadminパスでも動作してしまい管理画面にアクセスできない問題) | KioskRedirectが/adminパスでも動作してしまい、管理画面にアクセスできない問題 | ✅ 解決済み |
| [KB-045](./frontend.md#kb-045-分割表示でpdfがスライドしない問題) | 分割表示でPDFがスライドしない問題 | ✅ 解決済み |
| [KB-046](./frontend.md#kb-046-サイネージのサムネイルアスペクト比がおかしい問題) | サイネージのサムネイルアスペクト比がおかしい問題 | ✅ 解決済み |
| [KB-091](./frontend.md#kb-091-キオスク持出フローの改善選択-or-タグuid点検項目なしでも送信) | キオスク持出フローの改善（選択 or タグUID、点検項目なしでも送信） | ✅ 解決済み |
| [KB-091](./frontend.md#kb-091-キオスク持出フローの改善選択-or-タグuid点検項目なしでも送信) | キオスク持出フローの改善（選択 or タグUID、点検項目なしでも送信） | ✅ 解決済み |
| [KB-095](./frontend.md#kb-095-計測機器タグスキャン時の自動遷移機能) | 計測機器タグスキャン時の自動遷移機能 | ✅ 解決済み |
| [KB-096](./frontend.md#kb-096-クライアントログ取得のベストプラクティスpostclientlogsへの統一) | クライアントログ取得のベストプラクティス（postClientLogsへの統一） | ✅ 解決済み |
| [KB-109](./frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) | CSVインポートスケジュールページのUI統一（バックアップペインと同じUI） | ✅ 解決済み |
| [KB-111](./frontend.md#kb-111-csvインポートスケジュールの表示を人間が読みやすい形式に変更) | CSVインポートスケジュールの表示を人間が読みやすい形式に変更 | ✅ 解決済み |
| [KB-125](./frontend.md#kb-125-キオスクお問い合わせフォームのデザイン変更) | キオスクお問い合わせフォームのデザイン変更 | ✅ 解決済み |
| [KB-136](./frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題) | WebRTC useWebRTCフックのcleanup関数が早期実行される問題 | ✅ 解決済み |
| [KB-137](./frontend.md#kb-137-マイク未接続端末でのrecvonlyフォールバック実装) | マイク未接続端末でのrecvonlyフォールバック実装 | ✅ 解決済み |
| [KB-138](./frontend.md#kb-138-ビデオ通話時のdom要素へのsrcobjectバインディング問題) | ビデオ通話時のDOM要素へのsrcObjectバインディング問題 | ✅ 解決済み |
| [KB-139](./frontend.md#kb-139-webrtcシグナリングのwebsocket接続管理重複接続防止) | WebRTCシグナリングのWebSocket接続管理（重複接続防止） | ✅ 解決済み |
| [KB-140](./frontend.md#kb-140-uselocalstorageとの互換性のためのjsonstringify対応) | useLocalStorageとの互換性のためのJSON.stringify対応 | ✅ 解決済み |
| [KB-149](./frontend.md#kb-149-バックアップ履歴ページに用途列を追加ui改善) | バックアップ履歴ページに用途列を追加（UI改善） | ✅ 解決済み |
| [KB-171](./frontend.md#kb-171-webrtcビデオ通話機能が動作しないkioskcallpageでのclientkeyclientid未設定) | WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定、着信自動切替・Pi3除外の追記） | ✅ 解決済み |
| [KB-184](./frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能) | 生産スケジュールキオスクページ実装と完了ボタンのグレーアウト・トグル機能 | ✅ 解決済み |
| [KB-192](./frontend.md#kb-192-管理コンソールのサイネージプレビュー機能実装とjwt認証問題) | 管理コンソールのサイネージプレビュー機能実装とJWT認証問題 | ✅ 解決済み |
| [KB-202](./frontend.md#kb-202-生産スケジュールキオスクページの列名変更とfseiban全文表示) | 生産スケジュールキオスクページの列名変更とFSEIBAN全文表示 | ✅ 解決済み |
| [KB-204](./frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング) | CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング | ✅ 解決済み |
| [KB-206](./frontend.md#kb-206-生産スケジュール画面のパフォーマンス最適化と検索機能改善フロントエンド側) | 生産スケジュール画面のパフォーマンス最適化と検索機能改善（フロントエンド側） | ✅ 解決済み |
| [KB-207](./frontend.md#kb-207-生産スケジュールui改善チェック配色or検索ソフトキーボード) | 生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード） | ✅ 解決済み |
| [KB-208](./frontend.md#kb-208-生産スケジュールui改良資源cdfilter加工順序割当検索状態同期and検索) | 生産スケジュールUI改良（資源CDフィルタ・加工順序割当・検索状態同期・AND検索） | ✅ 解決済み |
| [KB-212](./frontend.md#kb-212-生産スケジュール行ごとの備考欄追加機能) | 生産スケジュール行ごとの備考欄追加機能 | ✅ 解決済み |
| [KB-211](./frontend.md#kb-211-キオスク持出タブの持出中アイテムが端末間で共有されない問題) | キオスク持出タブの持出中アイテムが端末間で共有されない問題 | ✅ 解決済み |
| [KB-221](./frontend.md#kb-221-生産スケジュール納期日機能のui改善カスタムカレンダーui実装) | 生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装） | ✅ 解決済み |
| [KB-223](./frontend.md#kb-223-生産スケジュール備考のモーダル編集化と処理列追加) | 生産スケジュール備考のモーダル編集化と処理列追加 | ✅ 解決済み |
| [KB-225](./frontend.md#kb-225-キオスク入力フィールド保護ルールの実装と実機検証) | キオスク入力フィールド保護ルールの実装と実機検証 | ✅ 実装完了・実機検証完了 |
| [KB-239](./frontend.md#kb-239-キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決react-portal導入) | キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入） | ✅ 解決済み |
| [KB-240](./frontend.md#kb-240-モーダル共通化アクセシビリティ標準化e2eテスト安定化) | モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化 | ✅ 解決済み |
| [KB-241](./frontend.md#kb-241-webrtcビデオ通話の常時接続と着信自動切り替え機能実装) | WebRTCビデオ通話の常時接続と着信自動切り替え機能実装 | ✅ 解決済み |
| [KB-242](./frontend.md#kb-242-生産スケジュール登録製番削除ボタンの進捗連動ui改善) | 生産スケジュール登録製番削除ボタンの進捗連動UI改善 | ✅ 解決済み |
| [KB-243](./frontend.md#kb-243-webrtcビデオ通話の映像不安定問題とエラーダイアログ改善) | WebRTCビデオ通話の映像不安定問題とエラーダイアログ改善 | ✅ 解決済み |
| [KB-244](./frontend.md#kb-244-pi4キオスクの備考欄に日本語入力状態インジケーターを追加) | Pi4キオスクの備考欄に日本語入力状態インジケーターを追加 | ✅ 解決済み |
| [KB-245](./infrastructure/ansible-deployment.md#kb-245-pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とibus設定の永続化) | Pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とIBus設定の永続化 | ✅ 解決済み |
| [KB-247](./frontend.md#kb-247-生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化) | 生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化 | ✅ 解決済み |
| [KB-248](./frontend.md#kb-248-カメラ明るさ閾値チェックの削除雨天照明なし環境での撮影対応) | カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応） | ✅ 解決済み |
| [KB-252](./frontend.md#kb-252-未点検加工機サイネージ設定導線可視化ダッシュボード経由の実装) | 未点検加工機サイネージ設定導線（可視化ダッシュボード経由）の実装 | ✅ 解決済み |
| [KB-254](./frontend.md#kb-254-加工機マスタのメンテナンスページ追加crud機能) | 加工機マスタのメンテナンスページ追加（CRUD機能） | ✅ 解決済み |
| [KB-267](./frontend.md#kb-267-吊具持出画面に吊具情報表示を追加) | 吊具持出画面に吊具情報表示を追加 | ✅ 解決済み |

### インフラ関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-014](./infrastructure/docker-caddy.md#kb-014-caddyのリバースプロキシ設定が不適切) | Caddyのリバースプロキシ設定が不適切 | ✅ 解決済み |
| [KB-015](./infrastructure/docker-caddy.md#kb-015-docker-composeのポート設定が不適切) | Docker Composeのポート設定が不適切 | ✅ 解決済み |
| [KB-018](./infrastructure/miscellaneous.md#kb-018-オフライン耐性の実装) | オフライン耐性の実装 | ✅ 解決済み |
| [KB-019](./infrastructure/miscellaneous.md#kb-019-usb一括登録機能の実装) | USB一括登録機能の実装 | ✅ 解決済み |
| [KB-020](./infrastructure/backup-restore.md#kb-020-バックアップリストア機能の実装) | バックアップ・リストア機能の実装 | ✅ 実装完了 |
| [KB-021](./infrastructure/miscellaneous.md#kb-021-監視アラート機能の実装) | 監視・アラート機能の実装 | ✅ 実装完了 |
| [KB-030](./infrastructure/docker-caddy.md#kb-030-カメラapiがhttp環境で動作しないhttps必須) | カメラAPIがHTTP環境で動作しない（HTTPS必須） | ✅ 解決済み |
| [KB-031](./infrastructure/docker-caddy.md#kb-031-websocket-mixed-content-エラーhttpsページからwsへの接続) | WebSocket Mixed Content エラー（HTTPSページからws://への接続） | ✅ 解決済み |
| [KB-032](./infrastructure/docker-caddy.md#kb-032-caddyfilelocal-のhttpバージョン指定エラー) | Caddyfile.local のHTTPバージョン指定エラー | ✅ 解決済み |
| [KB-033](./infrastructure/docker-caddy.md#kb-033-docker-composeserveryml-のyaml構文エラー手動編集による破壊) | docker-compose.server.yml のYAML構文エラー（手動編集による破壊） | ✅ 解決済み |
| [KB-034](./infrastructure/miscellaneous.md#kb-034-ラズパイのロケール設定euc-jpによる文字化け) | ラズパイのロケール設定（EUC-JP）による文字化け | ✅ 解決済み |
| [KB-039](./infrastructure/miscellaneous.md#kb-039-cpu温度取得のdocker対応sysclassthermalマウント) | CPU温度取得のDocker対応（/sys/class/thermalマウント） | ✅ 解決済み |
| [KB-041](./infrastructure/miscellaneous.md#kb-041-wi-fi変更時のipアドレス設定が手動で再ビルドが必要だった問題環境変数化) | Wi-Fi変更時のIPアドレス設定が手動で再ビルドが必要だった問題（環境変数化） | ✅ 解決済み |
| [KB-042](./infrastructure/miscellaneous.md#kb-042-pdf-popplerがlinuxarm64をサポートしていない問題) | pdf-popplerがLinux（ARM64）をサポートしていない問題 | ✅ 解決済み |
| [KB-050](./infrastructure/miscellaneous.md#kb-050-軽量サイネージクライアントが自己署名証明書で画像を取得できない) | 軽量サイネージクライアントが自己署名証明書で画像を取得できない | ✅ 解決済み |
| [KB-053](./infrastructure/miscellaneous.md#kb-053-サイネージの自動レンダリング画像が更新されないsignage_render_dirのパス不一致) | サイネージの自動レンダリング画像が更新されない（SIGNAGE_RENDER_DIRのパス不一致） | ✅ 解決済み |
| [KB-056](./infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) | 工具スキャンが二重登録される問題（NFCエージェントのキュー処理改善） | ✅ 解決済み |
| [KB-057](./infrastructure/miscellaneous.md#kb-057-ssh接続でホスト名解決が失敗しパスワード認証が通らない問題) | SSH接続でホスト名解決が失敗しパスワード認証が通らない問題 | ✅ 解決済み |
| [KB-058](./infrastructure/ansible-deployment.md#kb-058-ansible接続設定でraspberry-pi-34への接続に失敗する問題ユーザー名ssh鍵サービス存在確認) | Ansible接続設定でRaspberry Pi 3/4への接続に失敗する問題（ユーザー名・SSH鍵・サービス存在確認） | ✅ 解決済み |
| [KB-059](./infrastructure/miscellaneous.md#kb-059-ローカルアラートシステムのdockerコンテナ内からのファイルアクセス問題) | ローカルアラートシステムのDockerコンテナ内からのファイルアクセス問題 | ✅ 解決済み |
| [KB-060](./infrastructure/hardware-nfc.md#kb-060-dockerコンテナ内からnfcリーダーpcscdにアクセスできない問題) | Dockerコンテナ内からNFCリーダー（pcscd）にアクセスできない問題 | ✅ 解決済み |
| [KB-061](./infrastructure/ansible-deployment.md#kb-061-ansible実装後の設定ファイル削除問題と堅牢化対策) | Ansible実装後の設定ファイル削除問題と堅牢化対策 | ✅ 解決済み |
| [KB-062](./infrastructure/ansible-deployment.md#kb-062-ansible設定ファイル管理化の実装systemdサービスアプリケーション設定) | Ansible設定ファイル管理化の実装（systemdサービス・アプリケーション設定） | ✅ 解決済み |
| [KB-063](./infrastructure/docker-caddy.md#kb-063-websocket接続エラー502-caddyの環境変数置換が機能しない) | WebSocket接続エラー（502）: Caddyの環境変数置換が機能しない | ✅ 解決済み |
| [KB-064](./frontend.md#kb-064-pi4キオスクでカメラが起動しない-facingmodeの指定方法の問題) | Pi4キオスクでカメラが起動しない: facingModeの指定方法の問題 | ✅ 解決済み |
| [KB-065](./frontend.md#kb-065-カメラエラーメッセージが表示されない-デバッグログの出力条件が厳しすぎる) | カメラエラーメッセージが表示されない: デバッグログの出力条件が厳しすぎる | ✅ 解決済み |
| [KB-091](./frontend.md#kb-091-nfcカメラ入力のスコープ分離-別ページからのイベント横漏れ防止) | NFC/カメラ入力のスコープ分離: 別ページからのイベント横漏れ防止 | ✅ 解決済み |
| [KB-066](./infrastructure/ansible-deployment.md#kb-066-ラズパイ3でのansibleデプロイ失敗サイネージ稼働中のリソース不足自動再起動401エラー) | ラズパイ3でのAnsibleデプロイ失敗（サイネージ稼働中のリソース不足・自動再起動・401エラー） | ✅ 解決済み |
| [KB-067](./infrastructure/hardware-nfc.md#kb-067-工具スキャンが重複登録される問題nfcエージェントのeventid永続化対策) | 工具スキャンが重複登録される問題（NFCエージェントのeventId永続化対策） | ✅ 解決済み |
| [KB-068](./frontend.md#kb-068-写真撮影持出のサムネイルが真っ黒になる問題輝度チェック対策) | 写真撮影持出のサムネイルが真っ黒になる問題（輝度チェック対策） | ✅ 解決済み |
| [KB-072](./infrastructure/security.md#kb-072-pi5のufw適用とhttpsリダイレクト強化) | Pi5のUFW適用とHTTPSリダイレクト強化 | ✅ 解決済み |
| [KB-073](./infrastructure/security.md#kb-073-caddyアクセスログとfail2bansshhttpの連携) | Caddyアクセスログとfail2ban（SSH/HTTP）の連携 | ✅ 解決済み |
| [KB-074](./infrastructure/security.md#kb-074-pi5のマルウェアスキャン自動化clamavtrivyrkhunter) | Pi5のマルウェアスキャン自動化（ClamAV/Trivy/rkhunter） | ✅ 解決済み |
| [KB-075](./infrastructure/security.md#kb-075-pi4キオスクの軽量マルウェア対策) | Pi4キオスクの軽量マルウェア対策 | ✅ 解決済み |
| [KB-076](./infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー) | fail2ban連携のセキュリティ監視タイマー | ✅ 解決済み |
| [KB-077](./infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化) | マルウェアスキャン結果の自動アラート化 | ✅ 解決済み |
| [KB-069](./infrastructure/ansible-deployment.md#kb-069-ipアドレス管理の変数化ansible-group_varsallyml) | IPアドレス管理の変数化（Ansible group_vars/all.yml） | ✅ 解決済み |
| [KB-070](./infrastructure/miscellaneous.md#kb-070-運用モード可視化ネットワークモード自動検出api) | 運用モード可視化（ネットワークモード自動検出API） | ✅ 解決済み |
| [KB-071](./infrastructure/security.md#kb-071-tailscale導入とssh接続設定) | Tailscale導入とSSH接続設定 | ✅ 解決済み |
| [KB-078](./infrastructure/security.md#kb-078-複数ローカルネットワーク環境でのvnc接続設定) | 複数ローカルネットワーク環境でのVNC接続設定 | ✅ 解決済み |
| [KB-079](./infrastructure/security.md#kb-079-phase7セキュリティテストの実施結果と検証ポイント) | Phase7セキュリティテストの実施結果と検証ポイント | ✅ 解決済み |
| [KB-178](./infrastructure/security.md#kb-178-ログの機密情報保護実装x-client-keyのredacted置換) | ログの機密情報保護実装（x-client-keyの[REDACTED]置換） | ✅ 解決済み（2026-01-18） |
| [KB-259](./infrastructure/security.md#kb-259-本番jwt秘密鍵のfail-fast化とkioskレート制限のredis共有化) | 本番JWT秘密鍵のFail-fast化とkioskレート制限のRedis共有化 | ✅ 解決済み（2026-02-13） |
| [KB-260](./infrastructure/ansible-deployment.md#kb-260-デプロイ後にapiが再起動ループするjwt秘密鍵が弱い値で上書きされる) | デプロイ後にAPIが再起動ループする（JWT秘密鍵が弱い値で上書きされる） | ✅ 解決済み（2026-02-14） |
| [KB-261](./infrastructure/ansible-deployment.md#kb-261-デプロイ時の環境変数検証エラー一時的な失敗だが最終的には成功) | デプロイ時の環境変数検証エラー（一時的な失敗だが最終的には成功） | ✅ 解決済み（2026-02-14） |
| [KB-263](./infrastructure/ansible-deployment.md#kb-263-pi5のみデプロイ時にメンテナンスフラグが残存する問題) | Pi5のみデプロイ時にメンテナンスフラグが残存する問題 | ✅ 解決済み（2026-02-14） |
| [KB-264](./infrastructure/security.md#kb-264-tailscale-acl-grants形式でのポート指定エラーtagserver22形式が無効) | Tailscale ACL grants形式でのポート指定エラー（tag:server:22形式が無効） | ✅ 解決済み（2026-02-17） |
| [KB-265](./infrastructure/security.md#kb-265-tailscaleハードニング段階導入完了横移動面削減) | Tailscaleハードニング段階導入完了（横移動面削減） | ✅ 解決済み（2026-02-17） |
| [KB-266](./infrastructure/security.md#kb-266-nfcストリーム端末分離の実装完了acl維持横漏れ防止) | NFCストリーム端末分離の実装完了（ACL維持・横漏れ防止） | ✅ 解決済み（2026-02-18） |
| [KB-080](./infrastructure/signage.md#kb-080-pi4キオスクがtailscale-url固定でレイアウトが旧状態のままになる) | Pi4キオスクがTailscale URL固定で旧レイアウトのままになる | 🔄 進行中 |
| [KB-081](./infrastructure/signage.md#kb-081-pi3サイネージのpdftools画面が新デザインへ更新されない) | Pi3サイネージが新デザインへ更新されない | 🔄 進行中 |
| [KB-082](./infrastructure/signage.md#kb-082-管理コンソールでsplitを指定してもサイネージapiが常にtoolsを返す) | SPLIT指定でもサイネージAPIがTOOLSを返す | ✅ 解決済み |
| [KB-083](./infrastructure/signage.md#kb-083-サイネージカードレイアウトが崩れる2カラム固定サムネ比率) | サイネージカードレイアウトが崩れる（2カラム固定・サムネ比率） | ✅ 解決済み |
| [KB-084](./infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない) | サイネージSVGレンダラーでカード内テキストが正しい位置に表示されない | ✅ 解決済み |
| [KB-085](./infrastructure/signage.md#kb-085-サイネージtools左ペインを3列化右ペインの更新文言削除) | サイネージTOOLS左ペインを3列化・右ペインの更新文言削除 | ✅ 解決済み |
| [KB-086](./infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題) | Pi3サイネージデプロイ時のsystemdタスクハング問題 | ✅ 解決済み |
| [KB-087](./infrastructure/signage.md#kb-087-pi3-status-agenttimer-再起動時のsudoタイムアウト) | Pi3 status-agent.timer 再起動時のsudoタイムアウト | ✅ 解決済み |
| [KB-088](./infrastructure/signage.md#kb-088-prisma-p3009-signage-migrations-既存型が残存し-migrate-deploy-失敗) | Prisma P3009 (Signage migrations) 既存型が残存し migrate deploy 失敗 | ✅ 解決済み |
| [KB-089](./infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング) | Pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング | ✅ 解決済み |
| [KB-092](./infrastructure/miscellaneous.md#kb-092-pi4キオスクのgpuクラッシュ問題) | Pi4キオスクのGPUクラッシュ問題 | 🔄 一時的解決 |
| [KB-127](./infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) | サイネージUIで自端末の温度表示機能追加とデザイン変更 | ✅ 解決済み |
| [KB-150](./infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了) | サイネージレイアウトとコンテンツの疎結合化実装完了 | ✅ 解決済み |
| [KB-152](./infrastructure/signage.md#kb-152-サイネージページ表示漏れ調査と修正) | サイネージページ表示漏れ調査と修正 | ✅ 解決済み |
| [KB-153](./infrastructure/signage.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足) | Pi3デプロイ失敗（signageロールのテンプレートディレクトリ不足） | ✅ 解決済み |
| [KB-154](./infrastructure/signage.md#kb-154-splitモードで左右別pdf表示に対応) | SPLITモードで左右別PDF表示に対応 | ✅ 解決済み |
| [KB-155](./infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) | CSVダッシュボード可視化機能実装完了 | ✅ 解決済み |
| [KB-156](./infrastructure/signage.md#kb-156-複数スケジュールの順番切り替え機能実装) | 複数スケジュールの順番切り替え機能実装 | ✅ 解決済み |
| [KB-193](./infrastructure/signage.md#kb-193-csvダッシュボードの列幅計算改善フォントサイズ反映全行考慮列名考慮) | CSVダッシュボードの列幅計算改善（フォントサイズ反映・全行考慮・列名考慮） | ✅ 解決済み |
| [KB-228](./infrastructure/signage.md#kb-228-生産スケジュールサイネージデザイン修正タイトルkpi配置パディング統一) | 生産スケジュールサイネージデザイン修正（タイトル・KPI配置・パディング統一） | ✅ 解決済み |
| [KB-231](./infrastructure/signage.md#kb-231-生産スケジュールサイネージアイテム高さの最適化20件表示対応) | 生産スケジュールサイネージアイテム高さの最適化（20件表示対応） | ✅ 解決済み |
| [KB-232](./infrastructure/signage.md#kb-232-サイネージ未完部品表示ロジック改善表示制御正規化動的レイアウト) | サイネージ未完部品表示ロジック改善（表示制御・正規化・動的レイアウト） | ✅ 解決済み |
| [KB-233](./infrastructure/ansible-deployment.md#kb-233-デプロイ時のsudoパスワード問題ansible_connection-localでもmac側から実行される場合) | デプロイ時のsudoパスワード問題（ansible_connection: localでもMac側から実行される場合） | ✅ 解決済み |
| [KB-234](./infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策) | Ansibleデプロイが遅い（段階展開/重複タスク/計測欠如の整理と暫定対策） | 🔄 進行中 |
| [KB-235](./infrastructure/ansible-deployment.md#kb-235-docker-build最適化変更ファイルに基づくbuild判定) | Docker build最適化（変更ファイルに基づくbuild判定） | ✅ 解決済み |
| [KB-237](./infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題) | Pi4キオスクの再起動/シャットダウンボタンが機能しない問題 | ✅ 解決済み |
| [KB-238](./infrastructure/ansible-deployment.md#kb-238-update-all-clientsshでraspberrypi5対象時にraspi_server_host必須チェックを追加) | update-all-clients.shでraspberrypi5対象時にRASPI_SERVER_HOST必須チェックを追加 | ✅ 解決済み |
| [KB-099](./infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題) | Dropbox OAuth 2.0実装時のDocker Compose設定ファイルボリュームの読み書き権限問題 | ✅ 解決済み |
| [KB-100](./infrastructure/ansible-deployment.md#kb-100-ciテストが失敗してもマージが進んでしまう問題再発) | CIテストが失敗してもマージが進んでしまう問題（再発） | ⚠️ 部分解決 |
| [KB-101](./infrastructure/ansible-deployment.md#kb-101-pi5へのssh接続不可問題の原因と解決) | Pi5へのSSH接続不可問題の原因と解決 | ✅ 解決済み |
| [KB-102](./infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) | Ansibleによるクライアント端末バックアップ機能実装時のAnsibleとTailscale連携問題 | ✅ 解決済み |
| [KB-103](./infrastructure/backup-restore.md#kb-103-バックアップ対象ごとのストレージプロバイダー指定機能実装-phase-1-2) | バックアップ対象ごとのストレージプロバイダー指定機能実装（Phase 1-2） | ✅ 解決済み |
| [KB-104](./infrastructure/backup-restore.md#kb-104-バックアップ対象ごとの保持期間設定と自動削除機能実装-phase-3) | バックアップ対象ごとの保持期間設定と自動削除機能実装（Phase 3） | ✅ 解決済み |
| [KB-105](./infrastructure/backup-restore.md#kb-105-dropboxリストアui改善バックアップパス手動入力からドロップダウン選択へ) | DropboxリストアUI改善（バックアップパス手動入力からドロップダウン選択へ） | ✅ 解決済み |
| [KB-106](./infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認) | バックアップスクリプトとの整合性確認 | ✅ 解決済み |
| [KB-107](./infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善) | Dropboxストレージプロバイダーのエラーハンドリング改善 | ✅ 解決済み |
| [KB-108](./infrastructure/backup-restore.md#kb-108-gmail-oauth認証時のtailscale-dns解決問題とetchosts設定) | Gmail OAuth認証時のTailscale DNS解決問題と`/etc/hosts`設定 | ✅ 解決済み |
| [KB-109](./frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) | CSVインポートスケジュールページのUI統一（バックアップペインと同じUI） | ✅ 解決済み |
| [KB-110](./infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた) | デプロイ時の問題（リモートにプッシュしていなかった、標準手順を無視していた） | ✅ 解決済み |
| [KB-128](./infrastructure/ansible-deployment.md#kb-128-apiエンドポイントのhttps化caddy経由) | APIエンドポイントのHTTPS化（Caddy経由） | ✅ 解決済み |
| [KB-129](./infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま) | Pi5サーバー側のstatus-agent設定ファイルが古い設定のまま | ✅ 解決済み |
| [KB-142](./infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時に環境変数が消失する問題slack-webhook-url) | Ansibleで`.env`再生成時に環境変数が消失する問題（Slack Webhook URL） | ✅ 解決済み |
| [KB-143](./infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策) | Ansibleで`.env`再生成時にDropbox設定が消失する問題と恒久対策 | ✅ 解決済み |
| [KB-145](./infrastructure/ansible-deployment.md#kb-145-backupjson新規作成時にgmail設定が消失する問題と健全性チェック追加) | backup.json新規作成時にGmail設定が消失する問題と健全性チェック追加 | ✅ 解決済み |
| [KB-157](./infrastructure/ansible-deployment.md#kb-157-pi3のstatus-agenttimerが無効化されていた問題) | Pi3のstatus-agent.timerが無効化されていた問題 | ✅ 解決済み |
| [KB-158](./infrastructure/miscellaneous.md#kb-158-macのstatus-agent未設定問題とmacos対応) | Macのstatus-agent未設定問題とmacOS対応 | ✅ 解決済み |
| [KB-159](./infrastructure/ansible-deployment.md#kb-159-トークプラザ工場へのマルチサイト対応実装inventory分離プレフィックス命名規則) | トークプラザ工場へのマルチサイト対応実装（inventory分離・プレフィックス命名規則） | ✅ 解決済み |
| [KB-160](./infrastructure/ansible-deployment.md#kb-160-デプロイスクリプトのinventory引数必須化誤デプロイ防止) | デプロイスクリプトのinventory引数必須化（誤デプロイ防止） | ✅ 解決済み |
| [KB-161](./infrastructure/backup-restore.md#kb-161-dropbox-basepathの分離対応拠点別フォルダ分離) | Dropbox basePathの分離対応（拠点別フォルダ分離） | ✅ 解決済み |
| [KB-162](./infrastructure/ansible-deployment.md#kb-162-デプロイスクリプトのinventoryplaybookパス相対パス修正pi5上での実行時) | デプロイスクリプトのinventory/playbookパス相対パス修正（Pi5上での実行時） | ✅ 解決済み |
| [KB-172](./infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) | デプロイ安定化機能の実装（プリフライト・ロック・リソースガード・リトライ・タイムアウト） | ✅ 解決済み |
| [KB-173](./infrastructure/ansible-deployment.md#kb-173-alerts-platform-phase2のdb取り込み実装と空ファイル処理の改善) | Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善 | ✅ 解決済み |
| [KB-174](./infrastructure/ansible-deployment.md#kb-174-alerts-platform-phase2後続実装db版dispatcher-dedupe-retrybackoffの実機検証完了) | Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了 | ✅ 解決済み |
| [KB-175](./infrastructure/ansible-deployment.md#kb-175-alerts-platform-phase2完全移行db中心運用の実機検証完了) | Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了 | ✅ 解決済み |
| [KB-176](./infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) | Slack通知チャンネル分離のデプロイトラブルシューティング（環境変数反映問題） | ✅ 解決済み |
| [KB-179](./infrastructure/backup-restore.md#kb-179-dropbox証明書ピニング問題api-dropboxapi-comの新しい証明書フィンガープリント追加) | Dropbox証明書ピニング問題（api.dropboxapi.comの新しい証明書フィンガープリント追加） | ✅ 解決済み |
| [KB-180](./infrastructure/backup-restore.md#kb-180-バックアップ対象の追加pi5pi4pi3の環境設定ファイル) | バックアップ対象の追加（Pi5/Pi4/Pi3の環境設定ファイル） | ✅ 解決済み |
| [KB-181](./infrastructure/backup-restore.md#kb-181-ui表示問題の修正dropbox設定の新構造対応) | UI表示問題の修正（Dropbox設定の新構造対応） | ✅ 解決済み |
| [KB-182](./infrastructure/ansible-deployment.md#kb-182-pi4デプロイ検証結果デプロイ安定化機能の動作確認) | Pi4デプロイ検証結果（デプロイ安定化機能の動作確認） | ✅ 検証完了 |
| [KB-183](./infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) | Pi4デプロイ時のキオスクメンテナンス画面表示機能の実装 | ✅ 実装完了 |
| [KB-191](./infrastructure/ansible-deployment.md#kb-191-デプロイは成功したのにdbが古いテーブル不存在) | デプロイは成功したのにDBが古い（テーブル不存在） | ✅ 解決済み |
| [KB-192](./infrastructure/ansible-deployment.md#kb-192-node_modulesがroot所有になりdeployshのpnpm-installが失敗する) | node_modulesがroot所有になり、deploy.shのpnpm installが失敗する | ✅ 解決済み |
| [KB-193](./infrastructure/ansible-deployment.md#kb-193-デプロイ標準手順のタイムアウトコンテナ未起動問題の徹底調査結果) | デプロイ標準手順のタイムアウト・コンテナ未起動問題の徹底調査結果 | ✅ 解決済み |
| [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) | デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能 | ✅ 解決済み |
| [KB-203](./infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) | 本番環境でのprisma db seed失敗と直接SQL更新 | ✅ 解決済み |
| [KB-210](./infrastructure/miscellaneous.md#kb-210-pi3pi4でwi-fi認証ダイアログが時々表示される問題) | Pi3/Pi4でWi-Fi認証ダイアログが時々表示される問題 | ✅ 解決済み |
| [KB-211](./infrastructure/miscellaneous.md#kb-211-pi4キオスクでchromiumのサポートされていないコマンドラインフラグ警告メッセージが表示される問題) | Pi4キオスクでChromiumの「サポートされていないコマンドラインフラグ」警告メッセージが表示される問題 | ✅ 解決済み |
| [KB-212](./infrastructure/miscellaneous.md#kb-212-cursorチャットログの安全な削除手順1週間より前のログ削除) | Cursorチャットログの安全な削除手順（1週間より前のログ削除） | ✅ 手順確立済み |
| [KB-216](./infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) | Pi3デプロイ時のpost_tasksでunreachable=1が発生するがサービスは正常動作している | ✅ 調査完了・対応不要 |
| [KB-217](./infrastructure/ansible-deployment.md#kb-217-デプロイプロセスのコード変更検知とdocker再ビルド確実化) | デプロイプロセスのコード変更検知とDocker再ビルド確実化 | ✅ 解決済み |
| [KB-218](./infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行) | SSH接続失敗の原因: fail2banによるIP Ban（存在しないユーザーでの認証試行） | ✅ 解決済み |
| [KB-219](./infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗) | Pi5のGit権限問題: `.git`ディレクトリがroot所有でデタッチ実行が失敗 | ✅ 解決済み |
| [KB-220](./infrastructure/ansible-deployment.md#kb-220-nodesourceリポジトリのgpg署名キー問題sha1が2026-02-01以降拒否される) | NodeSourceリポジトリのGPG署名キー問題: SHA1が2026-02-01以降拒否される | ✅ 解決済み |
| [KB-222](./infrastructure/ansible-deployment.md#kb-222-デプロイ時のinventory混同問題inventory-talkplazaymlとinventoryymlの混同) | デプロイ時のinventory混同問題: inventory-talkplaza.ymlとinventory.ymlの混同 | ✅ 解決済み |
| [KB-224](./infrastructure/ansible-deployment.md#kb-224-デプロイ時のマイグレーション未適用問題) | デプロイ時のマイグレーション未適用問題 | ✅ 解決済み |
| [KB-226](./infrastructure/ansible-deployment.md#kb-226-デプロイ方針の見直しpi5pi4以上はdetach-follow必須) | デプロイ方針の見直し（Pi5+Pi4以上は`--detach --follow`必須） | ✅ 解決済み |
| [KB-227](./infrastructure/ansible-deployment.md#kb-227-web-bundleデプロイ修正コード更新時のdocker再ビルド確実化) | Web bundleデプロイ修正: コード更新時のDocker再ビルド確実化 | ✅ 解決済み |
| [KB-141](./infrastructure/docker-caddy.md#kb-141-caddyがすべてのapi要求にwebsocketアップグレードヘッダーを強制する問題) | CaddyがすべてのAPI要求にWebSocketアップグレードヘッダーを強制する問題 | ✅ 解決済み |

---

## 📝 記録フォーマット

各課題は以下のフォーマットで記録します：

```markdown
### [課題ID] 課題名

**EXEC_PLAN.md参照**: Phase X / Surprises & Discoveries (行番号)
**事象**: 
- 何が起きたか（エラーメッセージ、症状など）

**要因**: 
- なぜ起きたか（根本原因）

**試行した対策**: 
- [試行1] 対策内容 → 結果（成功/失敗）
- [試行2] 対策内容 → 結果（成功/失敗）
- ...

**有効だった対策**: 
- 最終的に有効だった対策

**学んだこと**: 
- この経験から学んだこと、今後同じ問題を避けるための知見

**関連ファイル**: 
- 関連するファイルのパス
```

---

## 📊 統計

| 状態 | 件数 |
|------|------|
| ✅ 解決済み | 144件 |
| ✅ 手順確立済み | 1件 |
| ✅ 実装完了・実機検証完了 | 3件 |
| ✅ 検証完了 | 2件 |
| ✅ 調査完了・対応不要 | 1件 |
| 🔄 進行中 | 5件 |
| **合計** | **161件** |

---

## 📅 更新履歴

- 2025-11-18: 初版作成（KB-001〜KB-004）
- 2025-11-19: KB-005〜KB-017を追加
- 2025-11-20: KB-018〜KB-019を追加
- 2025-11-24: KB-020〜KB-021を追加
- 2025-11-25: EXEC_PLAN.mdのSurprises & Discoveriesから解決済み課題を追加
- 2025-11-26: KB-023〜KB-024を追加
- 2025-11-27: カテゴリ別にファイルを分割（リファクタリング）
- 2025-11-28: KB-030〜KB-036を追加（HTTPS設定、WebSocket Mixed Content、YAML構文エラー、ロケール設定、useEffect重複処理、履歴画面画像表示）
- 2025-11-28: KB-037〜KB-039を追加（カメラプレビューCPU負荷、カメラ撮影CPU100%、CPU温度取得Docker対応）
- 2025-11-28: KB-040を追加（返却一覧の自動更新が不要だった問題）
- 2025-11-28: KB-041を追加（Wi-Fi変更時のIPアドレス設定が手動で再ビルドが必要だった問題）
- 2025-11-28: KB-042を追加（pdf-popplerがLinux（ARM64）をサポートしていない問題）
- 2025-11-28: KB-043を追加（KioskRedirectが/adminパスでも動作してしまい、管理画面にアクセスできない問題）
- 2025-11-28: KB-044を追加（PDFアップロード時のmultipart処理エラー）
- 2025-11-29: KB-045〜KB-046を追加（サイネージのタイムゾーン問題、工具データ表示問題、PDFスライド問題、サムネイルアスペクト比問題）
- 2025-11-29: KB-047を追加（履歴画面のサムネイル拡大表示で401エラーが発生する問題）
- 2025-11-29: KB-048〜KB-049を追加（NFCエージェントのDockerビルドでuvicorn/gccが見つからない問題）
- 2025-11-30: KB-050を追加（軽量サイネージクライアントが自己署名証明書で画像を取得できない問題）
- 2025-11-30: KB-051〜KB-053を追加（サイネージPDFスライドショー、sharp合成エラー、SIGNAGE_RENDER_DIR不一致）
- 2025-11-30: KB-054を追加（サイネージ工具表示で日本語が文字化けする問題）
- 2025-11-30: KB-055を追加（サイネージPDFがトリミングされて表示される問題）
- 2025-11-30: KB-056を追加（工具スキャンが二重登録される問題、NFCエージェントのキュー処理改善）
- 2025-12-01: KB-057を追加（SSH接続でホスト名解決が失敗しパスワード認証が通らない問題）
- 2025-12-01: KB-058を追加（Ansible接続設定でRaspberry Pi 3/4への接続に失敗する問題）
- 2025-12-01: KB-059を追加（ローカルアラートシステムのDockerコンテナ内からのファイルアクセス問題）
- 2025-12-01: KB-060を追加（Dockerコンテナ内からNFCリーダー（pcscd）にアクセスできない問題）
- 2025-12-01: KB-061を追加（Ansible実装後の設定ファイル削除問題と堅牢化対策）
- 2025-12-01: KB-062を追加（Ansible設定ファイル管理化の実装）
- 2025-12-02: KB-063を追加（WebSocket接続エラー502: Caddyの環境変数置換が機能しない）
- 2025-12-02: KB-064を追加（Pi4キオスクでカメラが起動しない: facingModeの指定方法の問題）
- 2025-12-02: KB-065を追加（カメラエラーメッセージが表示されない: デバッグログの出力条件が厳しすぎる）
- 2025-12-02: KB-066を追加（ラズパイ3でのAnsibleデプロイ失敗: サイネージ稼働中のリソース不足・自動再起動・401エラー）
- 2025-12-04: KB-067を追加（工具スキャンが重複登録される問題: NFCエージェントのeventId永続化対策）
- 2025-12-04: KB-068を追加（写真撮影持出のサムネイルが真っ黒になる問題: 輝度チェック対策）
- 2025-12-04: KB-069を追加（IPアドレス管理の変数化: Ansible group_vars/all.yml）
- 2025-12-04: KB-070を追加（運用モード可視化: ネットワークモード自動検出API）
- 2025-12-04: KB-071を追加（Tailscale導入とSSH接続設定）
- 2025-12-05: KB-072を追加（Pi5のUFW適用とHTTPSリダイレクト強化）
- 2025-12-05: KB-073を追加（Caddyアクセスログとfail2banの連携）
- 2025-12-05: KB-074を追加（Pi5のマルウェアスキャン自動化）
- 2025-12-05: KB-075を追加（Pi4キオスクの軽量マルウェア対策）
- 2025-12-05: KB-076を追加（fail2ban連携のセキュリティ監視タイマー）
- 2025-12-05: KB-077を追加（マルウェアスキャン結果の自動アラート化）
- 2025-12-06: KB-084を追加（サイネージSVGレンダラーでカード内テキストが正しい位置に表示されない）、KB-083を解決済みに更新
- 2025-12-11: KB-091を追加（NFC/カメラ入力のスコープ分離: 別ページからのイベント横漏れ防止）
- 2025-12-11: KB-094を追加（サイネージ左ペインで計測機器と工具を視覚的に識別できない）
- 2025-12-16: KB-101を追加（Pi5へのSSH接続不可問題の原因と解決）
- 2025-12-29: KB-109を追加（CSVインポートスケジュールページのUI統一: バックアップペインと同じUI）
- 2025-12-29: KB-110を追加（デプロイ時の問題: リモートにプッシュしていなかった、標準手順を無視していた）
- 2025-12-29: KB-111を追加（CSVインポートスケジュールの表示を人間が読みやすい形式に変更）
- 2026-01-03: KB-124を追加（キオスクSlackサポート機能の実装と実機検証完了）
- 2026-01-03: KB-125を追加（キオスク専用従業員リスト取得エンドポイント追加、キオスクお問い合わせフォームのデザイン変更）
- 2026-01-03: KB-126を追加（キオスクUIで自端末の温度表示機能追加）
- 2026-01-03: KB-127を追加（サイネージUIで自端末の温度表示機能追加とデザイン変更）
- 2026-01-03: KB-128を追加（APIエンドポイントのHTTPS化（Caddy経由））
- 2026-01-04: KB-129を更新（Pi5サーバー側のstatus-agent設定のAnsible管理化実装完了を反映）
- 2026-01-04: KB-130を追加（Pi5のストレージ使用量が異常に高い問題（Docker Build Cacheとsignage-rendered履歴画像の削除））
- 2026-01-04: KB-131を追加（APIコンテナがSLACK_KIOSK_SUPPORT_WEBHOOK_URL環境変数の空文字で再起動ループする問題）
- 2026-01-05: KB-132〜KB-141を追加（WebRTCビデオ通話機能の実装過程で発生した問題と解決策: シグナリングルート問題、@fastify/websocket問題、keepalive対策、cleanup早期実行、recvonlyフォールバック、srcObjectバインディング、WebSocket接続管理、localStorage互換性、CaddyのWebSocketヘッダー問題）
- 2026-01-08: KB-150、KB-152、KB-153、KB-154、KB-155を追加（サイネージレイアウトとコンテンツの疎結合化実装完了、サイネージページ表示漏れ調査と修正、Pi3デプロイ失敗（signageロールのテンプレートディレクトリ不足）、SPLITモードで左右別PDF表示に対応、CSVダッシュボード可視化機能実装完了）
- 2026-01-09: KB-157、KB-158を追加（Pi3のstatus-agent.timerが無効化されていた問題、Macのstatus-agent未設定問題とmacOS対応）
- 2026-01-14: KB-159、KB-160、KB-161、KB-162を追加（トークプラザ工場へのマルチサイト対応実装、デプロイスクリプトのinventory引数必須化、Dropbox basePathの分離対応、デプロイスクリプトのinventory/playbookパス相対パス修正）
- 2026-01-15: KB-163、KB-164、KB-165、KB-166、KB-167、KB-168を追加（git cleanによるbackup.json削除問題と根本的改善、Dropboxからのbackup.json復元方法、Gmail OAuth設定の復元方法、Gmail OAuthルートの新構造対応修正、旧キーと新構造の衝突問題と解決方法）
- 2026-01-18: KB-172を追加（デプロイ安定化機能の実装（プリフライト・ロック・リソースガード・リトライ・タイムアウト））
- 2026-01-18: KB-173を追加（Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善）
- 2026-01-18: KB-174を追加（Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了）
- 2026-01-18: KB-175を追加（Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了）
- 2026-01-19: KB-179、KB-180、KB-181を追加（Dropbox証明書ピニング問題の解決、バックアップ対象の追加、UI表示問題の修正）
- 2026-01-19: KB-182を追加（Pi4デプロイ検証結果：デプロイ安定化機能の動作確認）
- 2026-01-19: KB-183を追加（Pi4デプロイ時のキオスクメンテナンス画面表示機能の実装）
- 2026-01-09: KB-156を追加（複数スケジュールの順番切り替え機能実装）
- 2026-01-23: KB-193を追加（CSVダッシュボードの列幅計算改善：フォントサイズ反映・全行考慮・列名考慮）
- 2026-01-23: KB-194を追加（スケジュール自動実行時にバックアップ履歴が記録されない問題）
- 2026-01-23: KB-195を追加（Dropbox 409 Conflictエラー：labelサニタイズ未実施によるパス不正）
- 2026-01-24: KB-196を追加（旧キー自動削除機能の実装：backup.json保存時の自動クリーンアップ）
- 2026-01-24: KB-197、KB-198を追加（Dropbox選択削除のパス正規化不整合、retention.maxBackupsの仕様/実装差）
- 2026-01-28: KB-199を追加（Dropbox証明書ピニング検証失敗によるバックアップ500エラー）→ 2026-01-28に解決完了・実機検証完了（content.dropboxapi.comの新しい証明書フィンガープリント追加、手動バックアップ成功を確認）
- 2026-02-16: KB-199を更新（Dropbox証明書ピニング検証失敗の再発事例）→ 2026-02-16に解決完了・CI成功・デプロイ完了・実機検証完了（api/content/notify.dropboxapi.comの新しい証明書フィンガープリント追加、2/10以降失敗していたDropboxバックアップが復旧）
- 2026-01-28: KB-210を追加（Pi3/Pi4でWi-Fi認証ダイアログが時々表示される問題）→ 2026-01-28に解決完了（NetworkManager設定追加、キオスクブラウザ環境変数追加）、KB-211を追加（Pi4キオスクでChromiumの「サポートされていないコマンドラインフラグ」警告メッセージが表示される問題）→ 2026-01-28に解決完了（`--test-type`フラグ追加）
- 2026-01-05: KB-142を追加（Ansibleで`.env`再生成時に環境変数が消失する問題（Slack Webhook URL）と恒久対策）
- 2026-01-06: KB-143を追加（Ansibleで`.env`再生成時にDropbox設定が消失する問題と恒久対策、`backup.json`の存在保証と健全性チェック、実機検証完了）、KB-145を追加（backup.json新規作成時にGmail設定が消失する問題と健全性チェック追加）、KB-149を追加（バックアップ履歴ページに用途列を追加（UI改善）、実機検証完了）
- 2026-01-16: KB-171を追加（WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定）問題と解決策）
- 2026-01-XX: KB-184、KB-185、KB-186を追加（生産スケジュールキオスクページ実装、CSVダッシュボードのgmailSubjectPattern設定UI改善、CsvImportSubjectPatternモデル追加による設計統一）
- 2026-01-20: KB-187を追加（CSVインポートスケジュール作成時のID自動生成とNoMatchingMessageErrorハンドリング改善）
- 2026-01-21: KB-188を追加（CSVインポート実行エンドポイントでのApiError statusCode尊重）
- 2026-01-22: KB-189を追加（Gmailに同件名メールが溜まる場合のCSVダッシュボード取り込み仕様）
- 2026-01-22: KB-190を追加（Gmail OAuthのinvalid_grantでCSV取り込みが500になる）
- 2026-01-22: KB-191を追加（デプロイは成功したのにDBが古い（テーブル不存在）・デプロイ検証強化）
- 2026-01-23: KB-192を追加（node_modulesがroot所有になりdeploy.shのpnpm installが失敗する）
- 2026-01-24: KB-193を追加（デプロイ標準手順のタイムアウト・コンテナ未起動問題の徹底調査結果）→ 2026-01-24に改善実装完了（down後回し、中断時復旧、ログ永続化）
- 2026-01-25: KB-200を追加（デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能）→ 2026-01-25に実装完了・実機検証完了（Pi5/Pi4/Pi3へのデプロイ成功）
- 2026-01-26: KB-201、KB-202、KB-203を追加（生産スケジュールCSVダッシュボードの差分ロジック改善とバリデーション追加、生産スケジュールキオスクページの列名変更とFSEIBAN全文表示、本番環境でのprisma db seed失敗と直接SQL更新）→ 2026-01-26に実装完了・実機検証完了
- 2026-01-27: KB-201を更新（FSEIBANバリデーション修正: `********`（8個のアスタリスク）を明示的に許可）、KB-204を追加（CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング）→ 2026-01-27に実装完了・実機検証完了（Gmail経由CSV取り込み成功、`********`も正常に取得）
- 2026-01-26: KB-205、KB-206を追加（生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側・フロントエンド側））→ 2026-01-26に実装完了・CI成功・Mac実機検証完了（Pi4での実機検証は明日実施予定）
- 2026-01-27: KB-207を追加（生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード））→ 2026-01-27に実装完了・CI成功・デプロイ成功・実機検証完了（Mac・Pi4）
- 2026-01-27: KB-208を追加（生産スケジュールUI改良・API拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索））→ 2026-01-27に実装完了・CI成功・デプロイ成功・実機検証完了（Mac・Pi4）
- 2026-01-29: KB-212を追加（生産スケジュール行ごとの備考欄追加機能）→ 2026-01-29に実装完了・CI成功・デプロイ成功・実機検証完了（Pi5/Pi4/Pi3）
- 2026-01-28: KB-209を追加（生産スケジュール検索状態の全キオスク間共有化）→ 2026-01-28に実装完了・CI成功・デプロイ成功・実機検証完了（複数キオスク間での検索状態共有が正常に動作）
- 2026-01-28: KB-205を更新（資源CD単独検索の無効化・Pi4の動作速度改善）→ 2026-01-28に実装完了・CI成功・デプロイ成功・実機検証完了（Pi4で正常に動作、動作速度が改善）
- 2026-01-28: KB-210を追加（生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正）→ 2026-01-28に実装完了・CI成功・デプロイ成功・実機検証完了（端末間共有が正常に動作）
- 2026-01-28: KB-212を追加（Cursorチャットログの安全な削除手順（1週間より前のログ削除））→ 2026-01-28に手順確立済み（バックアップ手順、削除方法、トラブルシューティングを含む完全な手順書を作成）
- 2026-01-28: KB-213を追加（セキュリティ評価の実機検証（2026-01-28））→ 2026-01-28に検証完了（ポート露出・fail2ban・security-monitorは正常動作を確認、バックアップ/復元・USBオフライン運用は再実施が必要）
- 2026-01-28: KB-214を追加（ルーターのデフォルト設定によるポート露出評価の誤解解消）→ 2026-01-28に評価修正完了（IODATA UD-LTA/UEのデフォルト設定を確認し、「外部露出」ではなく「ローカルネットワーク内での待受」と表現を修正）
- 2026-01-29: KB-215を追加（Gmail OAuthリフレッシュトークンの7日間制限問題）→ Google Cloud Consoleでアプリが未検証状態のため7日でトークン失効。GitHub Pagesでプライバシーポリシーを公開し、Googleへ検証リクエスト中
- 2026-01-31: KB-217を追加（デプロイプロセスのコード変更検知とDocker再ビルド確実化）→ 2026-01-31に実装完了・CI成功・デプロイ成功・実機検証完了（コード変更検知とDocker再ビルドが正常に動作、サイネージ可視化ダッシュボード機能も統合）
- 2026-01-31: KB-218を追加（Docker build時のtsbuildinfo問題）→ 2026-01-31に解決完了・CI成功・デプロイ成功・実機検証完了（`.dockerignore`に`tsbuildinfo`除外を追加し、Docker内で常に新しいビルドが実行されるように修正）
- 2026-01-31: KB-218を追加（SSH接続失敗の原因: fail2banによるIP Ban（存在しないユーザーでの認証試行））→ 2026-01-31に解決完了（誤ったユーザー名`tsudatakashi`での認証試行によりfail2banがBan、RealVNC経由でBan解除）、KB-219を追加（Pi5のGit権限問題: `.git`ディレクトリがroot所有でデタッチ実行が失敗）→ 2026-01-31に解決完了（Ansibleの`become: true`により`.git`がroot所有に、所有権を`denkon5sd02`に修正）、KB-183を更新（Pi4メンテナンス画面の修正: `--limit raspberrypi4`以外でも表示されるように改善）
- 2026-02-01: KB-226を更新（デプロイ方針の見直し: リモート実行のデフォルトデタッチ化実装）→ 2026-02-01に実装完了・デプロイ成功・実機検証完了（リモート実行時に自動的にデタッチモードで実行されること、`--foreground`オプションで前景実行可能なこと、`--attach`/`--status`でログ追尾・状態確認が正常に動作することを確認）
- 2026-02-01: KB-220を追加（NodeSourceリポジトリのGPG署名キー問題: SHA1が2026-02-01以降拒否される）→ 2026-02-01に解決完了（Debianセキュリティポリシーの変更によりSHA1が拒否され、NodeSourceリポジトリを削除してデプロイ成功）
- 2026-02-01: KB-221を追加（生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装））→ 2026-02-01に実装完了・CI成功・デプロイ成功・実機検証完了（カスタムカレンダーUI、今日/明日/明後日ボタン、自動確定、月ナビゲーション、React Hooksルール違反修正）
- 2026-02-01: KB-222を追加（デプロイ時のinventory混同問題: inventory-talkplaza.ymlとinventory.ymlの混同）→ 2026-02-01に解決完了（inventory混同によりDNS名でデプロイ試行→失敗、標準手順（Tailscale IP経由）に戻してデプロイ成功）
- 2026-02-01: KB-223を追加（生産スケジュール備考のモーダル編集化と処理列追加）→ 2026-02-01に実装完了・CI成功・デプロイ成功・実機検証完了（備考モーダル編集化、備考2行表示、処理列追加、品番/製造order番号折り返し対応、データ整合性考慮）
- 2026-02-01: KB-224を追加（デプロイ時のマイグレーション未適用問題）→ 2026-02-01に解決完了（デプロイ完了後にマイグレーションが未適用だったため、手動で`pnpm prisma migrate deploy`を実行して適用、デプロイ後チェックリストの徹底を確認）
- 2026-02-02: KB-225を追加（キオスク入力フィールド保護ルールの実装と実機検証）→ 2026-02-02に実装完了・実機検証完了（入力フィールド削除・localStorage無効化・起動時防御・自動復旧機能を実装、IDとAPIキーが編集不可に改善、生産スケジュールの値が表示されることを確認）
- 2026-02-03: KB-211を追加（生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入））→ 2026-02-03に実装完了・CI成功・デプロイ成功・実機検証完了（ETag/If-Matchによる楽観的ロック実装、409 Conflict時の自動再試行、登録製番同期・登録・削除がすべて正常動作、サイネージへの反映も正常動作）
- 2026-02-03: KB-227を追加（Web bundleデプロイ修正: コード更新時のDocker再ビルド確実化）→ 2026-02-03に実装完了・デプロイ成功・実機検証完了（`force_docker_rebuild`フラグ導入、`git pull`前後でHEAD比較、Ansibleへの変数渡し、Docker再ビルドタスクの`when`条件修正、Web bundleが確実に再ビルドされることを確認）
- 2026-02-03: KB-228を追加（生産スケジュールサイネージデザイン修正: タイトル・KPI配置・パディング統一）→ 2026-02-03に実装完了・CI成功・デプロイ成功・実機検証完了（タイトル「生産進捗」に変更、KPIチップ右端配置で重なり防止、サブタイトル削除、カード左右パディング16px統一、視認性向上を確認）
- 2026-02-06: KB-229、KB-230を追加（Gmail認証切れ時のSlack通知機能追加、Gmail認証切れの実機調査と回復）→ 2026-02-06に実装完了・CI成功・デプロイ成功（CSVインポート定期実行時にGmail認証切れを検知してSlack通知、opsチャンネルにルーティング、dedupeで連続通知を抑制、手動実行時は通知しない）
- 2026-02-06: KB-231を追加（生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化）→ 2026-02-06に実装完了・CI成功・デプロイ成功・動作確認完了（API側・フロントエンド側・サイネージ側の上限を20件に統一、サイネージカード高さを半分に最適化、20件表示が正常に動作することを確認）
- 2026-02-06: KB-232を追加（サイネージ未完部品表示ロジック改善）→ 2026-02-06に実装完了・CI成功・デプロイ成功・実機検証完了（データソース側で未完部品を正規化・ソート・制限、レンダラー側で動的行数計算と表示制御、共通ユーティリティ追加、未完部品名が適切に表示され右端で切れないことを確認）
- 2026-02-06: KB-233を追加（デプロイ時のsudoパスワード問題）→ 2026-02-06に解決完了（`ansible_connection: local`でもMac側から実行するとMac側のsudoパスワードが求められる問題を、`RASPI_SERVER_HOST`設定でPi5上でリモート実行することで解決、デプロイ成功を確認）
- 2026-02-07: KB-236を追加（Pi3 signage-lite.serviceのxsetエラーによる起動失敗と再起動ループ）→ 2026-02-07に実装完了・CI成功・デプロイ完了（`signage-display.sh`の`xset`コマンドに`|| true`を追加してエラーで終了しないように変更、エラーが発生した場合は警告ログを出力するが処理は続行、`set -euo pipefail`を使用する場合の必須でないコマンドのエラーハンドリングを改善）
- 2026-02-08: KB-236を更新（Pi3デプロイ時のサービス再起動成功を確認）→ 2026-02-08に実機検証完了（Pi3標準手順に従って`--limit "server:signage"`でデプロイを実行、preflightチェックが正しく実行され、サービス再起動が`Result=success`で完了、xsetエラーが発生しても警告ログが出力されサービスが継続することを確認、runId: `20260208-082138-11782`）
- 2026-02-08: KB-237を追加（Pi4キオスクの再起動/シャットダウンボタンが機能しない問題）→ 2026-02-08に調査・修正・デプロイ完了・実機検証完了（3つの原因を発見・修正: Jinja2テンプレート展開の問題、systemd serviceの実行ユーザー問題、ディレクトリ所有権の問題。`pi5-power-dispatcher.sh.j2`にテンプレート展開ロジック追加、`pi5-power-dispatcher.service.j2`に`User=denkon5sd02`・`WorkingDirectory`・`StandardOutput/StandardError=journal`追加。CI成功、デプロイ成功、Pi4キオスクの再起動ボタンが正常動作することを確認）
- 2026-02-08: KB-238を追加（update-all-clients.shでraspberrypi5対象時にRASPI_SERVER_HOST必須チェックを追加）→ 2026-02-08に実装完了・CI成功（`RASPI_SERVER_HOST`未設定で`raspberrypi5`を対象にした場合、Mac側でローカル実行になりsudoパスワードエラーが発生する問題を解決。`require_remote_host_for_pi5()`関数を追加し、`raspberrypi5`または`server`が対象の場合、`REMOTE_HOST`が必須であることをチェック。未設定時はエラーで停止するように修正。CI全ジョブ成功、修正後の動作確認完了）
- 2026-02-08: KB-239を追加（キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入））→ 2026-02-08に実装完了・CI成功・デプロイ成功・実機検証完了（管理コンソールボタンを歯車アイコンに変更、サイネージプレビューボタン追加、再起動/シャットダウンボタンを電源アイコン1つに統合。CSS `filter`プロパティが`position: fixed`に与える影響をReact Portalで回避。E2Eテストの安定化（`scrollIntoViewIfNeeded`とEscキー操作）も実装）
- 2026-02-08: KB-240を追加（モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化）→ 2026-02-08に実装完了・CI成功・デプロイ成功（共通Dialogコンポーネント作成、キオスク全モーダル統一、サイネージプレビューのFullscreen API対応、ConfirmDialogとuseConfirm実装、管理コンソールのwindow.confirm置換、アクセシビリティ標準化、E2Eテスト安定化。CI修正（import順序、Trivy脆弱性、E2Eテストstrict mode violation）も完了）
- 2026-02-09: KB-241を追加（WebRTCビデオ通話の常時接続と着信自動切り替え機能実装）→ 2026-02-09に実装完了・CI成功・デプロイ成功（`WebRTCCallProvider`と`CallAutoSwitchLayout`を実装し、`/kiosk/*`と`/signage`の全ルートでシグナリング接続を常時維持。着信時に`/kiosk/call`へ自動遷移、通話終了後に元のパスへ自動復帰。Pi3の通話対象除外機能を実装。APIレベルでの動作確認完了、実機検証待ち）
- 2026-02-10: KB-242を追加（生産スケジュール登録製番削除ボタンの進捗連動UI改善）→ 2026-02-10に実装完了・CI成功・デプロイ成功・キオスク動作検証OK（`SeibanProgressService`を新設、`GET /kiosk/production-schedule/history-progress`を追加、`ProductionScheduleDataSource`を共通サービス利用へ切替、`useProductionScheduleHistoryProgress`フックと削除ボタン進捗連動スタイルを実装。Pi5＋Pi4でデプロイ成功、登録製番の進捗表示と削除ボタンの色切替が正常に動作）
- 2026-02-10: KB-243を追加（WebRTCビデオ通話の映像不安定問題とエラーダイアログ改善）→ 2026-02-10に実装完了・CI成功・デプロイ成功・実機検証完了（`useWebRTC`で`localStream`/`remoteStream`をstateで保持し、`ontrack`更新時にUI再描画を確実化。`pc.ontrack`で受信トラックを単一MediaStreamに集約。`disableVideo()`でtrackをstop/removeせず`enabled=false`に変更。`enableVideo()`で既存trackがあれば再有効化、新規は`replaceTrack`使用。`connectionState`/`iceConnectionState`の`disconnected/failed`検知時にICE restartで復旧。`KioskCallPage`で`alert()`を`Dialog`に置換し、`Callee is not connected`等をユーザー向け説明に変換。Pi5＋Pi4でデプロイ成功、通話開始直後に相手映像が表示されること、ビデオON/OFF時の相手側フリーズ回避、無操作時の接続維持、エラーダイアログの改善を確認）
- 2026-02-10: KB-244を追加（Pi4キオスクの備考欄に日本語入力状態インジケーターを追加）→ 2026-02-10に実装完了・デプロイ成功・実機検証完了（`KioskNoteModal.tsx`に`isComposing` stateを追加し、`compositionstart`/`compositionend`イベントで入力モードを検出。インジケーターを追加（日本語入力中: 「あ 日本語」、英字入力中: 「A 英字」）。切り替え方法（Ctrl+Space または Alt+`）を画面下部に表示。IBus設定の永続化も実装（`engines-order`を`['xkb:jp::jpn', 'mozc-jp']`に設定、`hotkey triggers`を`['<Control>space']`に設定）。Pi4再起動ボタンのエラーハンドリング改善も実施。Pi4でデプロイ成功（Run ID: 20260210-123251-3565, 20260210-124817-3570）、インジケーター表示とIBus設定を確認）
- 2026-02-10: KB-245を追加（Pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とIBus設定の永続化）→ 2026-02-10に実装完了・デプロイ成功・実機検証完了（`deploy-staged.yml`の`post_tasks`を修正し、サーバーデプロイ完了フラグが存在しない場合でも、デプロイが成功していればメンテナンスフラグをクリア。IBus設定の永続化も実装（`kiosk/tasks/main.yml`にIBus設定タスクを追加）。Pi4のみのデプロイ（Run ID: 20260210-124817-3570）で、メンテナンスフラグが自動的にクリアされ、IBus設定が正しく適用されることを確認）
- 2026-02-10: KB-201を更新（製造order番号繰り上がりルールの実機検証完了・トラブルシューティング追加）→ 2026-02-10に実装完了・CI成功・デプロイ成功・実機検証完了（同一キーで`ProductNo`が複数ある場合、数字が大きい方のみを有効とするルールを実装。取り込み時と表示時の両方で適用。テスト失敗・SQL正規表現エラー・TypeScriptビルドエラーのトラブルシューティングを実施。実機検証で重複除去機能が正常動作することを確認）
- 2026-02-10: KB-247を追加（生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化）→ 2026-02-10に調査・修正・デプロイ完了（×ボタンの応答性が若干落ちた気がするという報告を受け、KB-242で実装した完未完判定機能の4秒ポーリングが原因と特定。`useKioskProductionScheduleHistoryProgress()`の`refetchInterval`を`4000`→`30000`（30秒）に変更。`useKioskProductionScheduleSearchState()`と`useKioskProductionScheduleSearchHistory()`は4秒のまま維持。CI全ジョブ成功、Pi4キオスクにデプロイ成功（Run ID: 20260210-175259-15669, ok=91, changed=9, failed=0））
- 2026-02-11: KB-248を追加（カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応））→ 2026-02-11に実装完了・CI成功・デプロイ成功・実機検証完了（雨天・照明なし環境で閾値0.1でも「写真が暗すぎます」エラーが発生する問題を調査。ストリーム保持によるPi4の負荷問題を回避するため、フロントエンド・バックエンドの両方で閾値チェックを削除。500ms待機＋5フレーム選択ロジックは維持。どんな明るさでも撮影可能にし、ユーザー体験を向上。Pi5＋Pi4でデプロイ成功、実機検証で正常動作を確認）
- 2026-02-11: KB-255を追加（`/api/kiosk` と `/api/clients` のルート分割・サービス層抽出（互換維持での実機検証））→ 2026-02-11に実装完了・CI成功・デプロイ成功・実機検証完了（`kiosk`/`clients` のモジュール分割とサービス層抽出、GitHub CI全ジョブ通過、Pi5限定デプロイ成功（runId: `20260211-220347-19394`）、主要導線の実機API検証で200系と認可ガードを確認）
- 2026-02-18: KB-267を追加（吊具持出画面に吊具情報表示を追加）→ 2026-02-18に実装完了・CI成功・デプロイ完了・実機検証完了（吊具持出画面に遷移したとき、吊具タグのUIDだけが表示されていた問題を解決し、吊具マスタから取得した詳細情報（名称、管理番号、保管場所、荷重、寸法）を点検見本の右側余白に表示する機能を実装。`riggingTagUid`が設定された時点で`getRiggingGearByTagUid()`を呼び出し、吊具情報をstateに保持。貸出登録時の存在チェックで、既に取得済みの`riggingGear`をref経由で再利用し、API二重呼び出しを回避。CI成功（Run ID `22126971043`）、Pi5とPi4でデプロイ成功（runId `20260218-140619-15371`）、実機検証で正常動作を確認）