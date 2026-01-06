---
title: トラブルシューティングナレッジベース - 索引
tags: [トラブルシューティング, ナレッジベース, 索引]
audience: [開発者, 運用者]
last-verified: 2025-12-01
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
| API関連 | [api.md](./api.md) | 30件 | APIエラー、レート制限、認証、履歴、サイネージ、キオスクサポート、温度表示、環境変数バリデーション、WebRTCシグナリング |
| データベース関連 | [database.md](./database.md) | 3件 | P2002エラー、削除機能、シードデータ |
| CI/CD関連 | [ci-cd.md](./ci-cd.md) | 4件 | CIテスト失敗、E2Eテスト、バックアップ/リストア |
| フロントエンド関連 | [frontend.md](./frontend.md) | 27件 | キオスク接続、XState、UI、カメラ連携、サイネージ、NFCスコープ分離、CSVインポートUI統一、スケジュール表示改善、WebRTC通話 |
| インフラ関連 | [infrastructure.md](./infrastructure.md) | 66件（サブカテゴリ別に分割） | Docker、Caddy、HTTPS設定、オフライン耐性、バックアップ、Ansible、NFCリーダー、Tailscale、IPアドレス管理、ファイアウォール、マルウェア対策、監視、サイネージSVGレンダラー、Dropbox OAuth 2.0、CI必須化、SSH接続、DropboxリストアUI改善、デプロイ標準手順、APIエンドポイントHTTPS化、サイネージ温度表示、WebSocketプロキシ |
| ├─ Docker/Caddy関連 | [infrastructure/docker-caddy.md](./infrastructure/docker-caddy.md) | 9件 | Docker ComposeとCaddyリバースプロキシ、WebSocketプロキシ設定 |
| ├─ バックアップ・リストア関連 | [infrastructure/backup-restore.md](./infrastructure/backup-restore.md) | 14件 | バックアップとリストア機能、Gmail連携、client-directory追加 |
| ├─ Ansible/デプロイ関連 | [infrastructure/ansible-deployment.md](./infrastructure/ansible-deployment.md) | 11件 | Ansibleとデプロイメント、APIエンドポイントHTTPS化、環境変数管理、Dropbox設定管理、backup.json保護 |
| ├─ セキュリティ関連 | [infrastructure/security.md](./infrastructure/security.md) | 8件 | セキュリティ対策と監視 |
| ├─ サイネージ関連 | [infrastructure/signage.md](./infrastructure/signage.md) | 11件 | デジタルサイネージ機能、温度表示、デザイン変更 |
| ├─ NFC/ハードウェア関連 | [infrastructure/hardware-nfc.md](./infrastructure/hardware-nfc.md) | 3件 | NFCリーダーとハードウェア |
| └─ その他 | [infrastructure/miscellaneous.md](./infrastructure/miscellaneous.md) | 17件 | その他のインフラ関連（ストレージ管理含む） |

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
| [KB-009](./ci-cd.md#kb-009-e2eテストのログイン成功後のリダイレクトがci環境で失敗する) | E2Eテストのログイン成功後のリダイレクトがCI環境で失敗する | ✅ 解決済み |
| [KB-023](./ci-cd.md#kb-023-ciでバックアップリストアテストが失敗する) | CIでバックアップ・リストアテストが失敗する | 🔄 進行中 |
| [KB-024](./ci-cd.md#kb-024-ciテストアーキテクチャの設計不足) | CI/テストアーキテクチャの設計不足 | 🔄 進行中 |

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
| ✅ 解決済み | 99件 |
| 🔄 進行中 | 5件 |
| **合計** | **104件** |

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
- 2026-01-05: KB-142を追加（Ansibleで`.env`再生成時に環境変数が消失する問題（Slack Webhook URL）と恒久対策）
- 2026-01-06: KB-143を追加（Ansibleで`.env`再生成時にDropbox設定が消失する問題と恒久対策、`backup.json`の存在保証と健全性チェック、実機検証完了）、KB-145を追加（backup.json新規作成時にGmail設定が消失する問題と健全性チェック追加）
