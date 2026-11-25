---
title: 外部連携運用台帳
tags: [外部連携, Dropbox, Gmail, Slack, OAuth, 運用]
audience: [運用者, 管理者, 開発者]
last-verified: 2026-11-25
related: [gmail-setup-guide.md, slack-webhook-setup.md, dropbox-oauth-setup-guide.md, deployment.md]
category: guides
update-frequency: medium
---

# 外部連携運用台帳

最終更新: 2026-11-25

## 概要

本書は、このシステムが使う外部サービスについて、用途、設定の置き場所、運用上の注意を一覧にした台帳です。秘密の値そのものは書かず、どこに置くか(変数名)だけを書きます。

| 連携先 | 用途 | 設定の主な置き場所 |
|---|---|---|
| Dropbox | バックアップ先、CSV 取り込み元 | Ansible Vault と `backup.json` |
| Gmail | バックアップ先、CSV 取り込み元、要領書メール送信 | `backup.json`(OAuth) |
| Slack | 通知(4 系統) | Ansible Vault |
| TypeSafe(JEV) | 画像選択の API | Ansible Vault |
| 社内の LLM サーバー(DGX) | 業務 Hermes とローカル LLM | inventory の設定値 |
| Google Drive / Oracle | 災害復旧用のコピー | Ansible と専用の認証ファイル |

## 目次

- [Dropbox連携](#dropbox連携)
- [Gmail連携](#gmail連携)
- [Slack連携](#slack連携)
- [その他の連携](#その他の連携)
- [共通の運用注意事項](#共通の運用注意事項)
- [設定の永続化とAnsible管理](#設定の永続化とansible管理)
- [ヘルスチェックと監視](#ヘルスチェックと監視)

---

## Dropbox連携

### 用途

- **バックアップ先ストレージ**: データベース、ファイル、CSV、画像などのバックアップを保存する。
- **リストア元**: Dropbox のバックアップから復元する。
- **CSV の取り込み元**: マスターやスケジュールの取り込みで、取得元に Dropbox を選べる(`/imports/master/from-dropbox` など)。

根拠: `apps/api/src/routes/backup/`、`apps/api/src/routes/imports/`

### 設定場所

#### 1. Ansible Vault(推奨・永続化)

次の変数を Vault に置き、`templates/docker.env.j2` が API の環境変数として配ります。

- `DROPBOX_APP_KEY`、`DROPBOX_APP_SECRET`、`DROPBOX_REFRESH_TOKEN`、`DROPBOX_ACCESS_TOKEN`、`DROPBOX_BASE_PATH`

Vault 管理にすると、配備で環境ファイルを作り直しても設定が消えません。経緯は [KB-143](../knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策) を参照してください。

#### 2. backup.json(OAuth トークン)

- 置き場所: Pi5 のリポジトリ直下 `config/backup.json`(コンテナ内では `/app/config/backup.json`。環境変数 `BACKUP_CONFIG_PATH` で変更可)。
- Dropbox の設定は `options.dropbox.*` に入ります。以前の平らなキー(`options.accessToken` など)は後方互換のために読み込まれます。
- 管理画面の OAuth 操作で保存されます。OAuth の入口は `/api/backup/oauth/authorize`、`/callback`、`/refresh` です。

### 設定手順

1. [Dropbox OAuth設定ガイド](./dropbox-oauth-setup-guide.md) に沿って Dropbox アプリを用意する。
2. アプリのキーとシークレットを Vault に登録する。
3. 管理画面の「バックアップ」の対象設定(`/admin/backup/targets`)で OAuth 認証を実行する。
4. リフレッシュトークンを Vault にも反映し、配備後も保たれるようにする。

OAuth の戻り先(リダイレクト URI)には、実際に使うアクセス先の URL を Dropbox アプリ側に登録します。URL は環境ごとの値なので、本書には書きません。

### トークン管理

- アクセストークンはリフレッシュトークンから更新されます(`/api/backup/oauth/refresh`)。
- Gmail のトークンとは別の場所に保存され、互いに上書きしません([KB-146](../knowledge-base/infrastructure/backup-restore.md#kb-146-gmail-oauthがdropboxトークンを上書きしdropboxバックアップが失敗するトークン分離で恒久対策))。

### トラブルシューティング

- バックアップが認証エラーで失敗する: 管理画面のヘルスチェックで警告を確認し、OAuth を再実行する。
- 配備のあとに設定が消えた: Vault の変数が空になっていないか確認する。
- 古い手順は [Dropbox連携セットアップガイド(アーカイブ)](../archive/guides/dropbox-setup-guide.md) にあります。現行の手順は上の OAuth 設定ガイドです。

---

## Gmail連携

### 用途

- **バックアップ先**: バックアップの保存先として使う。
- **CSV の取り込み**: 指定した送信元のメールに付いた CSV を取り込む(取り込み元の種類は dropbox / gmail)。送信元ドメインは設定で制限しています。
- **要領書のメール送信**: 組立要領書のメールを送る(`assembly_procedure_mail_domain` で宛先ドメインを設定)。

根拠: `apps/api/src/routes/gmail/`、`apps/api/src/services/assembly/procedure-manual-mail.service.ts`

### 設定場所

#### 1. backup.json(OAuth 設定・トークン)

- Gmail の設定は `options.gmail.*` に入ります。旧キーは後方互換で読まれます。
- API: `/api/gmail/oauth/authorize`、`/callback`、`/refresh`、`/api/gmail/config`(取得・更新・削除。管理者のみ)。
- 管理画面: `/admin/gmail/config`。

### 設定手順

1. [Gmail連携セットアップガイド](./gmail-setup-guide.md) に沿って OAuth クライアントを用意する。
2. 管理画面の `/admin/gmail/config` で認証を実行する。

### トークン管理

- リフレッシュは `/api/gmail/oauth/refresh` で行います。Dropbox のトークンとは分離されています。

### トラブルシューティング

- 取り込みが動かない: トークンの期限と、送信元が許可対象かを確認する。
- 認証画面から戻れない: 登録した戻り先 URL と、実際のアクセス先が一致しているか確認する。

---

## Slack連携

### 用途

通知を 4 系統(deploy / ops / support / security)に分け、それぞれの Slack チャンネルへ送ります。キオスクのサポート通知用の Webhook も別にあります。

根拠: `apps/api/src/services/alerts/alerts-config.ts`、`apps/api/src/services/notifications/`

### 設定場所

#### 1. Ansible Vault(推奨・永続化)

- `ALERTS_SLACK_WEBHOOK_DEPLOY`、`ALERTS_SLACK_WEBHOOK_OPS`、`ALERTS_SLACK_WEBHOOK_SUPPORT`、`ALERTS_SLACK_WEBHOOK_SECURITY`
- `SLACK_KIOSK_SUPPORT_WEBHOOK_URL`

`templates/docker.env.j2` が環境変数として配ります。経緯は [KB-142](../knowledge-base/infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時に環境変数が消失する問題slack-webhook-url) を参照してください。

#### 2. 環境変数(非推奨・一時的)

サーバー上で手で設定した値は、配備で環境ファイルが作り直されると消えます。試験以外では使いません。

### 設定手順

[Slack Incoming Webhook設定ガイド](./slack-webhook-setup.md) に沿って Webhook を取得し、Vault に登録して配備します。

### トラブルシューティング

- 通知が届かない: Vault の変数が空でないか、Webhook が無効化されていないかを確認する。

---

## その他の連携

- **TypeSafe(JEV)**: 画像選択の API(`https://api.typesafe.ai/v1/systemone`、モデル `jev-1.13.0`)。API キーは Vault の `hermes_search_typesafe_api_key` で管理します。送信してよい範囲の取り決めがあるため、新しい種類のデータを送る場合は事前に確認してください。根拠: `apps/api/src/services/typesafe/jev-choice-client.ts`
- **社内 LLM サーバー(DGX)**: 業務 Hermes とローカル LLM の接続先は inventory の設定値(`api_local_llm_base_url` など)で指定します。アドレスは本書に書きません。参照: [../runbooks/dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)
- **JPCERT などの脆弱性情報**: 定期取得のタイマーがあり、人の対応が必要なものだけ通知します。関連: [KB-438](../knowledge-base/KB-438-os-security-weekly-update.md)
- **Google Drive / Oracle の災害復旧コピー**: [../runbooks/google-drive-disaster-recovery.md](../runbooks/google-drive-disaster-recovery.md) を参照。
- **モバイル向けの入口**: Pi5 の Tailscale serve が HTTPS の別ポートで公開します(接続先の名前は環境ごとの値で、本書には書きません)。

---

## 共通の運用注意事項

### 1. 設定の永続化

秘密の値は Ansible Vault に置きます。サーバー上のファイルを直接編集すると、次の配備で上書きされることがあります。

### 2. トークンの衝突防止

Dropbox と Gmail のトークンは `options.dropbox.*` と `options.gmail.*` に分かれています。旧キーに値が残っていると衝突として警告されます([KB-147](../knowledge-base/infrastructure/backup-restore.md#kb-147-backupjsonのprovider別名前空間化構造的再発防止策))。

### 3. OAuth認証の再実行

トークンが失効した場合は、管理画面から OAuth を再実行し、Dropbox のリフレッシュトークンは Vault にも反映します。

### 4. ネットワーク環境の変更

アクセス先の URL を変えたときは、各 OAuth アプリに登録した戻り先 URL も更新します。

---

## 設定の永続化とAnsible管理

### Ansible管理の対象

- Vault の変数から環境ファイル(`docker.env.j2`)を生成する。
- `manage-app-configs.yml` が、サーバーに対して設定ファイルの用意と確認を行う。

### backup.jsonの保護

- `config/backup.json` が無いときだけ、ローカル保存のみの最小設定を作ります。既存のファイルは作り直さず、内容の健全性チェックだけを行います([KB-145](../knowledge-base/infrastructure/ansible-deployment.md#kb-145-backupjson新規作成時にgmail設定が消失する問題と健全性チェック追加))。
- 保存先の暗号化に使う鍵(`BACKUP_ENCRYPTION_KEY`)は Vault で管理します。

根拠: `infrastructure/ansible/playbooks/manage-app-configs.yml`、`infrastructure/ansible/templates/docker.env.j2`

---

## ヘルスチェックと監視

### バックアップ設定のヘルスチェック

**エンドポイント**: `GET /api/backup/config/health`

- 設定値の衝突検出(旧キーと新構造の両方に値がある場合)
- 環境変数と設定ファイルのずれの検出
- 必須設定の欠落チェック

管理画面のバックアップ設定ページ(`/admin/backup/targets`)に表示されます。詳細は [KB-148](../knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装) を参照してください。

### 監視項目

1. ヘルスチェック結果: 管理画面のバックアップ設定ページで警告やエラーがないか。
2. バックアップの実行履歴: 管理画面の履歴(`/admin/backup/history`)で成否を確認。
3. トークンの有効期限: Gmail と Dropbox のトークンが有効か。エラー時はリフレッシュ。

---

## 確認できていない事項

- TypeSafe の契約条件や送信可否の取り決めの詳細(コードからは確認できません)。
- 災害復旧コピー(Oracle 側)が本番で有効かどうか。条件付きで有効になる仕組みだけを確認しています。

## 関連ドキュメント

### セットアップガイド

- [Gmail連携セットアップガイド](./gmail-setup-guide.md)
- [Slack Incoming Webhook設定ガイド](./slack-webhook-setup.md)
- [Dropbox OAuth設定ガイド](./dropbox-oauth-setup-guide.md)
- [Dropbox連携セットアップガイド(アーカイブ)](../archive/guides/dropbox-setup-guide.md)

### ナレッジベース

- [KB-142](../knowledge-base/infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時に環境変数が消失する問題slack-webhook-url)
- [KB-143](../knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策)
- [KB-145](../knowledge-base/infrastructure/ansible-deployment.md#kb-145-backupjson新規作成時にgmail設定が消失する問題と健全性チェック追加)
- [KB-146](../knowledge-base/infrastructure/backup-restore.md#kb-146-gmail-oauthがdropboxトークンを上書きしdropboxバックアップが失敗するトークン分離で恒久対策)
- [KB-147](../knowledge-base/infrastructure/backup-restore.md#kb-147-backupjsonのprovider別名前空間化構造的再発防止策)
- [KB-148](../knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装)

### APIドキュメント

- [バックアップAPI](../api/backup.md)

### デプロイメントガイド

- [デプロイメントガイド](./deployment.md)
