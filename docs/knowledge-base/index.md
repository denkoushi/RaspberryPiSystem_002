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
| API関連 | [api.md](./api.md) | 17件 | APIエラー、レート制限、認証、履歴、サイネージ |
| データベース関連 | [database.md](./database.md) | 3件 | P2002エラー、削除機能、シードデータ |
| CI/CD関連 | [ci-cd.md](./ci-cd.md) | 4件 | CIテスト失敗、E2Eテスト、バックアップ/リストア |
| フロントエンド関連 | [frontend.md](./frontend.md) | 20件 | キオスク接続、XState、UI、カメラ連携、サイネージ、NFCスコープ分離 |
| インフラ関連 | [infrastructure.md](./infrastructure.md) | 62件（サブカテゴリ別に分割） | Docker、Caddy、HTTPS設定、オフライン耐性、バックアップ、Ansible、NFCリーダー、Tailscale、IPアドレス管理、ファイアウォール、マルウェア対策、監視、サイネージSVGレンダラー、Dropbox OAuth 2.0、CI必須化、SSH接続、DropboxリストアUI改善 |
| ├─ Docker/Caddy関連 | [infrastructure/docker-caddy.md](./infrastructure/docker-caddy.md) | 8件 | Docker ComposeとCaddyリバースプロキシ |
| ├─ バックアップ・リストア関連 | [infrastructure/backup-restore.md](./infrastructure/backup-restore.md) | 10件 | バックアップとリストア機能 |
| ├─ Ansible/デプロイ関連 | [infrastructure/ansible-deployment.md](./infrastructure/ansible-deployment.md) | 7件 | Ansibleとデプロイメント |
| ├─ セキュリティ関連 | [infrastructure/security.md](./infrastructure/security.md) | 8件 | セキュリティ対策と監視 |
| ├─ サイネージ関連 | [infrastructure/signage.md](./infrastructure/signage.md) | 10件 | デジタルサイネージ機能 |
| ├─ NFC/ハードウェア関連 | [infrastructure/hardware-nfc.md](./infrastructure/hardware-nfc.md) | 3件 | NFCリーダーとハードウェア |
| └─ その他 | [infrastructure/miscellaneous.md](./infrastructure/miscellaneous.md) | 16件 | その他のインフラ関連 |

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
| ✅ 解決済み | 82件 |
| 🔄 進行中 | 5件 |
| **合計** | **87件** |

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
