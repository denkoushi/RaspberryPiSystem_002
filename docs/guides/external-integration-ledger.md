---
title: 外部連携運用台帳
tags: [外部連携, Dropbox, Gmail, Slack, OAuth, 運用]
audience: [運用者, 管理者, 開発者]
last-verified: 2026-01-06
related: [gmail-setup-guide.md, slack-webhook-setup.md, dropbox-setup-guide.md, deployment.md]
category: guides
update-frequency: medium
---

# 外部連携運用台帳

最終更新: 2026-01-06

## 概要

本ドキュメントは、Raspberry Pi System 002で使用する外部サービス連携（Dropbox、Gmail、Slack）の設定・運用情報を一元管理する運用台帳です。

各外部サービスの設定場所、管理方法、トラブルシューティング情報をまとめています。

## 目次

- [Dropbox連携](#dropbox連携)
- [Gmail連携](#gmail連携)
- [Slack連携](#slack連携)
- [共通の運用注意事項](#共通の運用注意事項)
- [設定の永続化とAnsible管理](#設定の永続化とansible管理)
- [ヘルスチェックと監視](#ヘルスチェックと監視)

---

## Dropbox連携

### 用途

- **バックアップ先ストレージ**: データベース、ファイル、CSV、画像などのバックアップをDropboxに保存
- **リストア元**: Dropboxからバックアップを復元

### 設定場所

#### 1. Ansible Vault（推奨・永続化）

**ファイル**: `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`

**設定項目**:
```yaml
vault_dropbox_app_key: "1k8mig5my0zk0ms"  # Dropbox App Key
vault_dropbox_app_secret: "es8m5ngz2vzxlbh"  # Dropbox App Secret
vault_dropbox_refresh_token: "..."  # Dropbox Refresh Token（OAuth取得後）
```

**管理方法**: Ansibleテンプレート（`infrastructure/ansible/templates/docker.env.j2`）で環境変数として注入

**永続化**: ✅ Ansibleで管理されるため、`.env`再生成時も維持される

#### 2. backup.json（OAuthトークン）

**ファイル**: `/opt/RaspberryPiSystem_002/config/backup.json`

**設定項目**（新構造・推奨）:
```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "dropbox": {
        "appKey": "${DROPBOX_APP_KEY}",
        "appSecret": "${DROPBOX_APP_SECRET}",
        "accessToken": "...",
        "refreshToken": "${DROPBOX_REFRESH_TOKEN}"
      }
    }
  }
}
```

**管理方法**: OAuthコールバック/refresh時に自動更新

**永続化**: ✅ `backup.json`はAnsibleで存在保証と健全性チェックが実施される（KB-143）

### 設定手順

詳細は [Dropbox OAuth設定ガイド](./dropbox-oauth-setup-guide.md) を参照。

**主な手順**:
1. Dropbox App Consoleでアプリを作成
2. App Key/Secretを取得
3. Ansible Vaultに設定（`vault.yml`）
4. OAuth認証を実行してRefresh Tokenを取得
5. Refresh TokenをAnsible Vaultに設定

### トークン管理

- **アクセストークン**: OAuthで取得、`backup.json`に保存
- **リフレッシュトークン**: OAuthで取得、Ansible Vaultと`backup.json`の両方に保存
- **自動リフレッシュ**: Dropbox SDKには自動リフレッシュ機能がないため、401エラー時に手動リフレッシュが必要
- **手動リフレッシュ**: `POST /api/backup/oauth/refresh` エンドポイントを使用

### トラブルシューティング

- **KB-142**: Slack Webhook URLの恒久対策（Ansible管理化）
- **KB-143**: Dropbox設定の恒久対策（Ansible管理化）
- **KB-146**: Gmail OAuthがDropboxトークンを上書きする問題（トークン分離）
- **KB-147**: backup.jsonのprovider別名前空間化（構造的再発防止策）

---

## Gmail連携

### 用途

- **CSVインポート**: PowerAutomateからGmail経由でCSVファイルを送信し、自動的にインポート
- **スケジュールインポート**: cron形式でGmailを定期検索し、CSVファイルを自動取得

### 設定場所

#### 1. backup.json（OAuth設定・トークン）

**ファイル**: `/opt/RaspberryPiSystem_002/config/backup.json`

**設定項目**（新構造・推奨）:
```json
{
  "storage": {
    "options": {
      "gmail": {
        "clientId": "...",
        "clientSecret": "...",
        "redirectUri": "https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback",
        "accessToken": "...",
        "refreshToken": "...",
        "subjectPattern": "[Pi5 CSV Import]",
        "fromEmail": "powerautomate@example.com"
      }
    }
  }
}
```

**管理方法**: 管理コンソール（`/admin/gmail/config`）で設定、OAuthコールバック/refresh時に自動更新

**永続化**: ✅ `backup.json`はAnsibleで存在保証と健全性チェックが実施される（KB-145）

### 設定手順

詳細は [Gmail連携セットアップガイド](./gmail-setup-guide.md) を参照。

**主な手順**:
1. Google Cloud Consoleでプロジェクトを作成
2. Gmail APIを有効化
3. OAuth 2.0認証情報を作成（Client ID/Secret）
4. リダイレクトURIを設定（`https://<Pi5のTailscale FQDN>/api/gmail/oauth/callback`）
5. 管理コンソールでClient ID/Secretを設定
6. OAuth認証を実行してトークンを取得

### トークン管理

- **アクセストークン**: OAuthで取得、`backup.json`の`options.gmail.accessToken`に保存
- **リフレッシュトークン**: OAuthで取得、`backup.json`の`options.gmail.refreshToken`に保存
- **自動リフレッシュ**: `OAuth2Client`が自動的にトークンをリフレッシュ（手動リフレッシュは通常不要）
- **手動リフレッシュ**: `POST /api/gmail/oauth/refresh` エンドポイントを使用（エラー時のみ）

### トラブルシューティング

- **KB-145**: Gmail設定の恒久対策（backup.json存在保証と健全性チェック）
- **KB-146**: Gmail OAuthがDropboxトークンを上書きする問題（トークン分離）
- **KB-147**: backup.jsonのprovider別名前空間化（構造的再発防止策）

---

## Slack連携

### 用途

- **キオスクサポート通知**: キオスク画面の「お問い合わせ」ボタンから送信されたメッセージをSlackチャンネルに通知

### 設定場所

#### 1. Ansible Vault（推奨・永続化）

**ファイル**: `infrastructure/ansible/host_vars/raspberrypi5/vault.yml`

**設定項目**:
```yaml
vault_slack_kiosk_support_webhook_url: "https://hooks.slack.com/services/..."  # Slack Webhook URL
```

**管理方法**: Ansibleテンプレート（`infrastructure/ansible/templates/docker.env.j2`）で環境変数として注入

**永続化**: ✅ Ansibleで管理されるため、`.env`再生成時も維持される

#### 2. 環境変数（非推奨・一時的）

**ファイル**: `/opt/RaspberryPiSystem_002/infrastructure/docker/.env`

**設定項目**:
```bash
SLACK_KIOSK_SUPPORT_WEBHOOK_URL=https://hooks.slack.com/services/...
```

**管理方法**: 手動編集（**非推奨**: Ansibleで`.env`再生成時に消失する可能性がある）

**永続化**: ❌ Ansibleで`.env`再生成時に消失する（KB-142）

### 設定手順

詳細は [Slack Incoming Webhook設定ガイド](./slack-webhook-setup.md) を参照。

**主な手順**:
1. SlackワークスペースでIncoming Webhooksアプリを追加
2. Webhook URLを取得
3. Ansible Vaultに設定（`vault.yml`）
4. Ansibleを実行して`.env`を再生成
5. APIコンテナを再起動

### トラブルシューティング

- **KB-142**: Slack Webhook URLの恒久対策（Ansible管理化）

---

## 共通の運用注意事項

### 1. 設定の永続化

**重要**: 以下の設定は**Ansibleで管理**する必要があります。手動で`.env`や`backup.json`に設定した場合、Ansible実行時に消失する可能性があります。

- ✅ **Ansible Vaultで管理**: Dropbox App Key/Secret/Refresh Token、Slack Webhook URL
- ✅ **backup.jsonで管理**: Gmail Client ID/Secret、Dropbox/Gmail OAuthトークン
- ❌ **手動設定（非推奨）**: `.env`への直接編集（Ansible再実行時に消失）

### 2. トークンの衝突防止

**重要**: `backup.json`の`storage.options`は**provider別名前空間**で管理されています。

- **新構造（推奨）**: `options.dropbox.*` / `options.gmail.*`
- **旧構造（後方互換）**: フラットなキーも読み取り可能（書き込みは新構造へ自動移行）

詳細は [KB-147](./knowledge-base/infrastructure/backup-restore.md#kb-147-backupjsonのprovider別名前空間化構造的再発防止策) を参照。

### 3. OAuth認証の再実行

**Gmail**:
- 通常は自動リフレッシュで運用可能
- エラー時のみ手動リフレッシュ（`POST /api/gmail/oauth/refresh`）

**Dropbox**:
- 401エラー（`expired_access_token`）時に手動リフレッシュが必要
- リフレッシュエンドポイント: `POST /api/backup/oauth/refresh`

### 4. ネットワーク環境の変更

**LAN変更時の注意**:
- Ansibleで`.env`再生成が実行される場合、**Ansible Vaultで管理されていない設定は消失**する
- 事前にAnsible Vaultに設定を移行しておくこと

詳細は [KB-142](./knowledge-base/infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時にslack-webhook-urlが消失する問題と恒久対策) を参照。

---

## 設定の永続化とAnsible管理

### Ansible管理の対象

以下の設定は**Ansible Vault**で管理し、`.env`再生成時も維持されます：

| 設定項目 | Vault変数名 | テンプレート変数名 | ファイル |
|---------|------------|-----------------|---------|
| Dropbox App Key | `vault_dropbox_app_key` | `DROPBOX_APP_KEY` | `docker.env.j2` |
| Dropbox App Secret | `vault_dropbox_app_secret` | `DROPBOX_APP_SECRET` | `docker.env.j2` |
| Dropbox Refresh Token | `vault_dropbox_refresh_token` | `DROPBOX_REFRESH_TOKEN` | `docker.env.j2` |
| Slack Webhook URL | `vault_slack_kiosk_support_webhook_url` | `SLACK_KIOSK_SUPPORT_WEBHOOK_URL` | `docker.env.j2` |

### backup.jsonの保護

`backup.json`は以下の方法で保護されています：

1. **存在保証**: Ansibleでファイルが存在しない場合、最小限のスケルトンを自動作成
2. **健全性チェック**: JSONパース可能性と必須設定の存在をチェック
3. **上書き防止**: 既存の`backup.json`は上書きしない（存在する場合はそのまま維持）

詳細は [KB-143](./knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策) / [KB-145](./knowledge-base/infrastructure/ansible-deployment.md#kb-145-gmail設定の恒久対策backupjson存在保証と健全性チェック) を参照。

---

## ヘルスチェックと監視

### バックアップ設定のヘルスチェック

**エンドポイント**: `GET /api/backup/config/health`

**機能**:
- 設定値の衝突検出（旧キーと新構造の両方に値がある場合）
- 環境変数と設定ファイル間のドリフト検出
- 必須設定の欠落チェック

**UI統合**: 管理コンソールのバックアップ設定ページ（`/admin/backup/targets`）に表示

**自動更新**: 1分ごとに自動更新（React Queryの`refetchInterval`）

詳細は [KB-148](./knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装) を参照。

### 監視項目

以下の項目を定期的に確認してください：

1. **ヘルスチェック結果**: 管理コンソールのバックアップ設定ページで警告/エラーがないか確認
2. **バックアップ実行ログ**: APIログでバックアップの成功/失敗を確認
3. **トークンの有効期限**: Gmail/Dropboxのトークンが有効か確認（エラー時はリフレッシュ）

---

## 関連ドキュメント

### セットアップガイド

- [Gmail連携セットアップガイド](./gmail-setup-guide.md)
- [Slack Incoming Webhook設定ガイド](./slack-webhook-setup.md)
- [Dropbox OAuth設定ガイド](./dropbox-oauth-setup-guide.md)
- [Dropbox連携セットアップガイド](./dropbox-setup-guide.md)

### ナレッジベース

- [KB-142: Slack Webhook URLの恒久対策](./knowledge-base/infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時にslack-webhook-urlが消失する問題と恒久対策)
- [KB-143: Dropbox設定の恒久対策](./knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策)
- [KB-145: Gmail設定の恒久対策](./knowledge-base/infrastructure/ansible-deployment.md#kb-145-gmail設定の恒久対策backupjson存在保証と健全性チェック)
- [KB-146: Gmail OAuthがDropboxトークンを上書きする問題](./knowledge-base/infrastructure/backup-restore.md#kb-146-gmail-oauthがdropboxトークンを上書きしdropboxバックアップが失敗するトークン分離で恒久対策)
- [KB-147: backup.jsonのprovider別名前空間化](./knowledge-base/infrastructure/backup-restore.md#kb-147-backupjsonのprovider別名前空間化構造的再発防止策)
- [KB-148: バックアップ設定の衝突・ドリフト検出の自動化](./knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装)

### APIドキュメント

- [バックアップAPI](./api/backup.md)

### デプロイメントガイド

- [デプロイメントガイド](./deployment.md)

