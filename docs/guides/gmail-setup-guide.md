---
title: Gmail連携セットアップガイド
tags: [Gmail, OAuth, 設定, PowerAutomate]
audience: [運用者, 開発者]
last-verified: 2026-01-06
related: [powerautomate-gmail-integration.md, csv-import-export.md]
category: guides
update-frequency: medium
---

# Gmail連携セットアップガイド

最終更新: 2026-01-06

## 概要

本ドキュメントでは、PowerAutomateからGmail経由でCSVファイルやJPEGファイルをPi5に送信し、自動的にインポートするためのGmail連携設定手順を説明します。

## 前提条件

- Googleアカウント（Gmail APIを使用するためのアカウント）
- Google Cloud Consoleへのアクセス権限
- Pi5への管理コンソールアクセス権限（ADMINロール）
- Pi5でHTTPSが設定されていること（Gmail APIのプライベートデータスコープ使用時は必須）

## セットアップ手順

### 0. HTTPS設定の確認と証明書の準備

**重要**: Gmail APIのプライベートデータスコープを使用する場合、Google Cloud Consoleは`https://`のリダイレクトURIを要求します。`http://`は使用できません。

#### 0.1 TailscaleのMagicDNSドメインを確認

Pi5のTailscale設定でMagicDNSが有効になっていることを確認し、Pi5のホスト名を確認します：

```bash
# Pi5にSSH接続して実行
tailscale status
```

出力例：
```
100.106.158.2  raspberrypi        raspberrypi.tail7312a3.ts.net
```

この場合、FQDNは`raspberrypi.tail7312a3.ts.net`です。

#### 0.2 自己署名証明書の生成（TailscaleのMagicDNSドメイン用）

Pi5で以下のコマンドを実行して、TailscaleのMagicDNSドメイン用の証明書を生成します：

```bash
# SSH接続（Macのターミナルから）
ssh denkon5sd02@100.106.158.2

# 証明書ディレクトリに移動
cd /opt/RaspberryPiSystem_002/certs

# 既存の証明書をバックアップ（念のため）
sudo cp cert.pem cert.pem.backup.$(date +%Y%m%d) 2>/dev/null || true
sudo cp key.pem key.pem.backup.$(date +%Y%m%d) 2>/dev/null || true

# TailscaleのMagicDNSドメイン用に証明書を生成
# CNには実際のTailscale FQDNを指定（例: raspberrypi.tail7312a3.ts.net）
sudo openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/C=JP/ST=Tokyo/L=Tokyo/O=Factory/CN=raspberrypi.tail7312a3.ts.net"

# 権限設定
sudo chmod 644 cert.pem
sudo chmod 600 key.pem
sudo chown $USER:$USER cert.pem key.pem

# 証明書の内容を確認（CNが正しいことを確認）
openssl x509 -in cert.pem -noout -subject
```

#### 0.3 Caddyコンテナの再起動

証明書を更新したら、Caddyコンテナを再起動します：

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart web
```

#### 0.4 HTTPS接続の確認

Macのブラウザで`https://raspberrypi.tail7312a3.ts.net`にアクセスし、自己署名証明書を信頼してください。初回のみ警告が表示されます。

#### 0.5 OAuth認証時のコールバックURI解決設定（重要）

**問題**: OAuth認証時にGoogleからコールバックURI（`https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback`）にリダイレクトされますが、Macのブラウザが`raspberrypi.tail7312a3.ts.net`を解決できない場合があります。

**解決策**: Macの`/etc/hosts`ファイルに固定レコードを追加します。**この設定は一度行えば永続的に有効**です。

#### 方法1: スクリプトを使用（推奨）

```bash
# Macのターミナルで実行（管理者権限が必要）
cd /Users/tsudatakashi/RaspberryPiSystem_002
./scripts/mac/setup-etc-hosts-for-gmail-oauth.sh 100.106.158.2 raspberrypi.tail7312a3.ts.net
```

スクリプトが以下を自動的に実行します：
- `/etc/hosts`にエントリを追加（既存の場合は上書き確認）
- DNS解決の確認

#### 方法2: 手動で編集

```bash
# Macのターミナルで実行（管理者権限が必要）
sudo nano /etc/hosts
```

以下の行を追加（`100.106.158.2`は実際のPi5のTailscale IPアドレスに置き換えてください）：

```
100.106.158.2 raspberrypi.tail7312a3.ts.net
```

保存して終了（`Ctrl+O` → `Enter` → `Ctrl+X`）。

**確認**:
```bash
# DNS解決を確認
ping -c 1 raspberrypi.tail7312a3.ts.net
```

**重要**: 
- OAuth認証は**最初の1回だけ**実行します（refresh tokenを取得するため）
- 以後は**自動リフレッシュ**で運用可能です（Gmailの場合、`OAuth2Client`が自動的にトークンをリフレッシュします）
- `/etc/hosts`の設定は一度行えば永続的に有効です（Pi5のTailscale IPが変更されない限り）

**重要（2026-01-06追記）**:
- GmailのOAuthトークンは `backup.json` に保存されますが、**Dropboxのトークンと衝突しないよう**provider別名前空間で分離して保持します：
  - **新構造（推奨）**: `storage.options.gmail.*` 名前空間を使用
    - `storage.options.gmail.accessToken`
    - `storage.options.gmail.refreshToken`
    - `storage.options.gmail.clientId`
    - `storage.options.gmail.clientSecret`
    - `storage.options.gmail.redirectUri`
    - `storage.options.gmail.subjectPattern`
    - `storage.options.gmail.fromEmail`
  - **旧構造（後方互換）**: フラットなキーも読み取り可能（書き込みは新構造へ自動移行）
    - `storage.options.gmailAccessToken` / `storage.options.gmailRefreshToken`
    - `storage.options.clientId` / `storage.options.clientSecret` / `storage.options.redirectUri` など
  - （Dropboxは `storage.options.dropbox.*` 名前空間を使用）

**Tailscale DNSをオフにしても問題ありません**:
- Pi5側はDNS解決に依存していません（IPアドレスで動作）
- Mac側で`/etc/hosts`に固定レコードを追加すれば、OAuth認証時のコールバックURI解決が可能です
- OAuth認証は最初の1回だけなので、`/etc/hosts`の設定は一度行えば十分です

**代替案**: Tailscale DNSをONにする方法もありますが、実運用で毎回ONにするのは非現実的なため、`/etc/hosts`の設定を推奨します。

### 1. Google Cloud Consoleでの設定

#### 1.1 プロジェクトの作成

1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. 新しいプロジェクトを作成（または既存のプロジェクトを選択）
3. プロジェクト名を設定（例: "Pi5 Gmail Integration"）

#### 1.2 Gmail APIの有効化

1. 左メニューから「APIとサービス」→「ライブラリ」を選択
2. 「Gmail API」を検索
3. 「Gmail API」を選択して「有効にする」をクリック

#### 1.3 OAuth 2.0認証情報の作成

1. 左メニューから「APIとサービス」→「認証情報」を選択
2. 「認証情報を作成」→「OAuth クライアント ID」を選択
3. 同意画面の設定（初回の場合）:
   - ユーザータイプ: 「外部」を選択
   - アプリ名: 「Pi5 Gmail Integration」など
   - ユーザーサポートメール: あなたのメールアドレス
   - デベロッパーの連絡先情報: あなたのメールアドレス
   - 「保存して次へ」をクリック
   - スコープ: デフォルトのまま「保存して次へ」
   - テストユーザー: 使用するGmailアカウントを追加
   - 「保存して次へ」→「ダッシュボードに戻る」

4. OAuth クライアント IDの作成:
   - アプリケーションの種類: 「ウェブアプリケーション」を選択
   - 名前: 「Pi5 Gmail Client」など
   - 承認済みのリダイレクト URI:
     - **重要**: Gmail APIのプライベートデータスコープを使用するため、`https://`が必須です
     - TailscaleのMagicDNSドメインを使用する場合:
       ```
       https://<Pi5のTailscale FQDN>/api/gmail/oauth/callback
       ```
       - 例: `https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback`
     - ⚠️ **注意**: ポート番号（`:8080`など）は不要です。CaddyがHTTPS（ポート443）でリバースプロキシします
     - ⚠️ **注意**: URIに空白文字が含まれていないことを確認してください
   - 「作成」をクリック

5. 認証情報の保存:
   - **Client ID**をコピー（後で使用します）
   - **Client Secret**を取得:
     - 方法1: 「ダウンロード」ボタンをクリックしてJSONファイルをダウンロードし、`client_secret`フィールドの値を確認
     - 方法2: 認証情報ページでOAuth 2.0クライアントIDを選択し、「シークレットを表示」をクリック
   - ⚠️ **重要**: Client Secretは一度しか表示されない場合があります。必ず安全な場所に保存してください
   - 📖 **詳細**: Client Secretの取得方法は [Gmail Client Secret取得ガイド](./gmail-client-secret-extraction.md) を参照

### 2. Pi5側の設定

#### 2.1 管理コンソールでの設定

1. Pi5の管理コンソールにログイン（ADMINロールが必要）
2. 左メニューから「Gmail設定」を選択
3. 「新規設定」ボタンをクリック
4. 以下の情報を入力:
   - **Client ID**: Google Cloud Consoleで取得したClient ID
   - **Client Secret**: Google Cloud Consoleで取得したClient Secret
   - **件名パターン**（任意）: メール検索時に使用する件名パターン
     - 例: `[Pi5 CSV Import]`
     - Gmail検索クエリ形式で指定（例: `subject:"[Pi5 CSV Import]"`）
   - **送信元メールアドレス**（任意）: メール検索時に使用する送信元アドレス
     - 例: `powerautomate@example.com`
     - 指定しない場合はすべてのメールを検索
   - **リダイレクトURI**: Google Cloud Consoleで設定したリダイレクトURIと一致させる
     - TailscaleのMagicDNSドメインを使用する場合:
       ```
       https://<Pi5のTailscale FQDN>/api/gmail/oauth/callback
       ```
       - 例: `https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback`
     - ⚠️ **注意**: `https://`を使用し、ポート番号は不要です
5. 「保存」をクリック

#### 2.2 OAuth認証の実行

1. 「OAuth認証」ボタンをクリック
2. 新しいウィンドウが開き、Googleの認証画面が表示されます
3. 使用するGmailアカウントを選択
4. 「許可」をクリックして、Pi5がGmailにアクセスすることを承認
5. 認証が完了すると、自動的にコールバックURLにリダイレクトされます
6. 認証成功メッセージが表示されます

#### 2.3 設定の確認

1. Gmail設定画面で以下の情報が表示されることを確認:
   - ✓ Client IDが設定されている
   - ✓ Client Secretがマスクされて表示されている（例: `***1234`）
   - ✓ アクセストークン: ✓ 設定済み
   - ✓ リフレッシュトークン: ✓ 設定済み

### 3. CSVインポートスケジュールの設定

1. 左メニューから「CSVインポート」を選択
2. 「新規作成」ボタンをクリック
3. 以下の情報を入力:
   - **ID**: スケジュールの一意なID（例: `gmail-daily-import`）
   - **名前**: スケジュールの名前（例: `Gmail経由日次インポート`）
   - **プロバイダー**: `gmail`を選択
   - **従業員CSVパス**: Gmail検索用の件名パターン（例: `[Pi5 CSV Import] employees`）
   - **アイテムCSVパス**: Gmail検索用の件名パターン（例: `[Pi5 CSV Import] items`）
   - **スケジュール**: cron形式（例: `0 2 * * *` = 毎日午前2時）
   - **有効**: チェックを入れる
   - **既存データを置き換え**: 必要に応じてチェック
   - **リトライ設定**（任意）:
     - 最大リトライ回数: `3`（デフォルト）
     - リトライ間隔（秒）: `60`（デフォルト）
     - 指数バックオフ: チェック（推奨）
4. 「保存」をクリック

### 4. ゴミ箱自動削除（深夜1回）

CSVダッシュボード取り込みで処理済みメールをゴミ箱へ移動した場合、以下のルールで自動削除されます。

- 削除対象: アプリがゴミ箱へ移動したメール（`rps_processed` ラベル付き）
- 実行タイミング: 毎日深夜（デフォルト: `0 3 * * *` / Asia/Tokyo）
- 削除条件: `older_than:30m`（30分より古いメール）
- 削除方式: ゴミ箱から完全削除（復元不可）

必要に応じて環境変数で調整できます。

- `GMAIL_TRASH_CLEANUP_ENABLED`（`true`/`false`、デフォルト: `true`）
- `GMAIL_TRASH_CLEANUP_CRON`（デフォルト: `0 3 * * *`）
- `GMAIL_TRASH_CLEANUP_LABEL`（デフォルト: `rps_processed`）
- `GMAIL_TRASH_CLEANUP_MIN_AGE`（デフォルト: `older_than:30m`）

## トラブルシューティング

### OAuth認証が失敗する

**症状**: OAuth認証ボタンをクリックしても認証画面が表示されない、またはエラーが発生する

**原因と対処法**:
1. **リダイレクトURIの不一致**
   - Google Cloud Consoleで設定したリダイレクトURIとPi5側の設定が一致しているか確認
   - **重要**: Gmail APIのプライベートデータスコープを使用する場合、`https://`が必須です。`http://`は使用できません
   - ポート番号（`:8080`など）が含まれていないか確認（Caddy経由の場合は不要）
   - URIに空白文字が含まれていないか確認

2. **テストユーザーが追加されていない**
   - Google Cloud Consoleの「OAuth同意画面」で、使用するGmailアカウントをテストユーザーとして追加

3. **Gmail APIが有効化されていない**
   - Google Cloud Consoleで「Gmail API」が有効化されているか確認

### メールが見つからない

**症状**: CSVインポートが実行されても、メールが見つからないエラーが発生する

**原因と対処法**:
1. **件名パターンが一致していない**
   - PowerAutomate側で送信するメールの件名が、Pi5側で設定した件名パターンと一致しているか確認
   - 大文字・小文字は区別されませんが、スペースや記号は正確に一致させる必要があります

2. **送信元メールアドレスが一致していない**
   - PowerAutomate側で送信するメールの送信元アドレスが、Pi5側で設定した送信元アドレスと一致しているか確認
   - 送信元アドレスを設定していない場合は、すべてのメールを検索します

3. **メールが既にアーカイブされている**
   - GmailStorageProviderは、処理済みのメールを自動的にアーカイブします
   - テスト用のメールを再送信するか、Gmailの「すべてのメール」フォルダから検索対象のメールを確認

### トークンの有効期限切れ

**症状**: しばらく使用していないと、Gmail APIへのアクセスが失敗する

**原因と対処法**:
1. **リフレッシュトークンが設定されているか確認**
   - Gmail設定画面で「リフレッシュトークン: ✓ 設定済み」が表示されているか確認
   - 表示されていない場合は、OAuth認証を再実行

2. **自動リフレッシュについて**
   - **Gmailの場合**: `OAuth2Client`が自動的にトークンをリフレッシュします
   - アクセストークンの有効期限（約1時間）が切れても、API呼び出し時に自動的にリフレッシュされます
   - **手動リフレッシュは通常不要**です
   - エラーが発生した場合のみ、Gmail設定画面で「トークン更新」ボタンをクリックして手動でリフレッシュできます

3. **Dropboxとの違い**
   - **Dropbox**: SDKに自動リフレッシュ機能がないため、エラー発生時に手動でリフレッシュが必要です
   - **Gmail**: `OAuth2Client`が自動リフレッシュするため、手動リフレッシュは通常不要です

### リフレッシュトークンが約7日で期限切れになる（未検証アプリの制限）

**症状**: OAuth認証が約1週間で切れてしまい、毎週手動で再認証が必要になる

**原因**: Google Cloud Consoleでアプリが「**未検証**」状態になっている

**仕様（Googleの制限）**:
| アプリの状態 | リフレッシュトークン有効期間 |
|---|---|
| 未検証（テストモードまたは本番モード） | **7日間** |
| 検証済み（本番モード） | **無期限**（6ヶ月間未使用で失効） |

**対処法（検証を完了する）**:
1. **Google Cloud Console** → **Google Auth Platform** → **ブランディング** にアクセス
2. 以下の情報を入力:
   - **アプリケーションのホームページ**: 公開可能なURL（例: GitHub Pagesで作成）
   - **プライバシーポリシーリンク**: プライバシーポリシーを記載した公開URL
   - **承認済みドメイン**: ホームページのドメインを追加
3. 「保存」をクリック
4. **検証センター** → 検証をリクエスト
5. Googleの審査を待つ（数日〜数週間）
6. 検証完了後、管理コンソール → Gmail設定 → 「OAuth認証」を1回実行

**GitHub Pagesでプライバシーポリシーを公開する方法**:
- このリポジトリには `docs/index.html`（ホームページ）と `docs/privacy-policy.html`（プライバシーポリシー）が含まれています
- GitHubリポジトリ → **Settings** → **Pages** で `main` ブランチの `/docs` フォルダを選択して公開

**詳細**: [KB-215: Gmail OAuthリフレッシュトークンの7日間制限問題](../knowledge-base/api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ)

### CSVインポートが失敗する

**症状**: CSVインポートスケジュールが実行されても、エラーが発生する

**原因と対処法**:
1. **添付ファイルが存在しない**
   - PowerAutomate側で送信するメールに、CSVファイルが添付されているか確認
   - 複数の添付ファイルがある場合、最初の添付ファイルが使用されます

2. **CSVファイルの形式が正しくない**
   - CSVファイルがUTF-8エンコーディングで保存されているか確認
   - ヘッダー行が正しいか確認（`employeeCode,displayName`など）

3. **リトライ設定の確認**
   - 一時的なネットワークエラーの場合、リトライ機能が自動的に再試行します
   - リトライ設定で最大リトライ回数やリトライ間隔を調整できます

## 関連ドキュメント

- [PowerAutomate Gmail連携仕様](./powerautomate-gmail-integration.md): PowerAutomate側の設定仕様
- [CSVインポート・エクスポート](./csv-import-export.md): CSVインポート機能の詳細
- [バックアップ・リストア手順](./backup-and-restore.md): バックアップ設定の詳細

