# Slack通知設定 ステップバイステップガイド

最終更新: 2025-12-14

## 概要

セキュリティアラートをSlackに自動通知する設定を行います。設定後、以下のアラートがSlackに送信されます：
- 侵入試行（fail2ban Ban）
- マルウェア検知（ClamAV/Trivy/rkhunter）
- ファイル整合性の異常
- 必須プロセスの欠落
- 許可外ポートの検知
- 権限変更の異常パターン

---

## ステップ1: Slackワークスペースにアクセス

1. **Slackを開く**
   - ブラウザで https://slack.com にアクセス
   - または、Slackアプリを起動

2. **ワークスペースにログイン**
   - 通知を受け取りたいワークスペースにログインしてください

**次のステップ**: Slackにログインできたら「ステップ2」に進んでください。

---

## ステップ2: Incoming Webhookアプリを追加

1. **Slackアプリディレクトリを開く**
   - ブラウザで https://api.slack.com/apps にアクセス
   - または、Slackの「アプリ」メニューから「アプリを追加」を選択

2. **「Incoming Webhooks」を検索**
   - 検索バーに「Incoming Webhooks」と入力

3. **「Incoming Webhooks」をクリック**

4. **「Slackに追加」ボタンをクリック**

**次のステップ**: Incoming Webhooksアプリを追加できたら「ステップ3」に進んでください。

---

## ステップ3: Webhook URLを生成

1. **「Incoming Webhooks」の設定ページで「新しいWebhookを追加」をクリック**

2. **通知を受け取りたいチャンネルを選択**
   - 例: `#セキュリティアラート`、`#システム通知`など
   - 既存のチャンネルを選択するか、新しいチャンネルを作成

3. **「Webhook URLを追加」をクリック**

4. **Webhook URLが表示される**
   - 例: `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`
   - **このURLをコピーしてください**（次のステップで使用します）

**次のステップ**: Webhook URLをコピーできたら「ステップ4」に進んでください。

---

## ステップ4: Pi5にSSH接続

1. **ターミナルを開く**（Macの場合）

2. **Pi5にSSH接続**
   ```bash
   # Tailscale経由の場合
   ssh denkon5sd02@100.106.158.2
   
   # ローカルネットワーク経由の場合
   ssh denkon5sd02@192.168.10.230
   ```

3. **接続が成功したことを確認**
   - プロンプトが表示されたら成功です

**次のステップ**: SSH接続が成功したら「ステップ5」に進んでください。

---

## ステップ5: Ansible設定ファイルを編集

1. **設定ファイルを開く**
   ```bash
   cd /opt/RaspberryPiSystem_002
   sudo nano infrastructure/ansible/group_vars/all.yml
   ```

2. **`alert_webhook_url`を探す**
   - ファイル内で `alert_webhook_url:` を検索（Ctrl+Wで検索）

3. **Webhook URLを設定**
   ```yaml
   alert_webhook_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
   ```
   - `""`の中に、ステップ3でコピーしたWebhook URLを貼り付け

4. **ファイルを保存**
   - `Ctrl+O`で保存、`Enter`で確定、`Ctrl+X`で終了

**次のステップ**: 設定ファイルを保存できたら「ステップ6」に進んでください。

---

## ステップ6: 設定をデプロイ

1. **Ansibleで設定をデプロイ**
   ```bash
   cd /opt/RaspberryPiSystem_002/infrastructure/ansible
   ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
   ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi5
   ```

2. **デプロイが完了するまで待つ**
   - 数分かかる場合があります

**次のステップ**: デプロイが完了したら「ステップ7」に進んでください。

---

## ステップ7: 動作確認（テストアラートを送信）

1. **テストアラートを送信**
   ```bash
   # generate-alert.shを直接実行してテスト
   WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL" \
   WEBHOOK_TIMEOUT_SECONDS=5 \
   /opt/RaspberryPiSystem_002/scripts/generate-alert.sh \
     "test" \
     "テストアラート" \
     "これはSlack通知のテストです"
   ```
   - Webhook URLは実際のURLに置き換えてください

2. **Slackで通知を確認**
   - 指定したチャンネルにメッセージが届いているか確認
   - メッセージが表示されれば成功です

**次のステップ**: Slackに通知が届いたら「ステップ8」に進んでください。

---

## ステップ8: 自動通知の確認

1. **実際のアラートが発生するまで待つ**
   - 侵入試行、マルウェア検知などが発生すると自動的に通知されます

2. **または、手動でアラートを発生させる**
   ```bash
   # fail2banのテスト（実際にBanは発生しませんが、ログに記録されます）
   sudo fail2ban-client set sshd banip 203.0.113.50
   
   # 15分後にsecurity-monitor.shが実行され、アラートが生成されます
   # アラートがSlackに送信されることを確認
   ```

**完了**: Slack通知設定が完了しました！

---

## トラブルシューティング

### Slackに通知が届かない場合

1. **Webhook URLが正しいか確認**
   ```bash
   # 設定ファイルを確認
   grep alert_webhook_url /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml
   ```

2. **Webhook URLが有効か確認**
   - Slackの「Incoming Webhooks」設定ページで、Webhook URLが有効になっているか確認

3. **ネットワーク接続を確認**
   ```bash
   # Pi5からインターネット接続を確認
   curl -I https://hooks.slack.com
   ```

4. **アラートファイルが生成されているか確認**
   ```bash
   # 最新のアラートファイルを確認
   ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
   cat /opt/RaspberryPiSystem_002/alerts/alert-*.json | jq .
   ```

5. **ログを確認**
   ```bash
   # systemdログを確認
   sudo journalctl -u security-monitor.service -n 50
   ```

### Webhook URLを変更したい場合

1. **ステップ5と同じ手順で設定ファイルを編集**
2. **ステップ6でデプロイを実行**

### Webhook通知を無効化したい場合

1. **設定ファイルを編集**
   ```bash
   sudo nano /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml
   ```

2. **`alert_webhook_url`を空文字に設定**
   ```yaml
   alert_webhook_url: ""
   ```

3. **デプロイを実行**（ステップ6と同じ）

---

## 通知の内容

Slackに送信される通知の形式：

```json
{
  "type": "alert-type",
  "message": "Alert message",
  "details": "Additional details",
  "timestamp": "2025-12-14T06:28:21Z"
}
```

**アラートの種類**:
- `fail2ban-ban`: 侵入試行の検知
- `clamav-infected`: ClamAVによるウイルス検知
- `trivy-vulnerability`: Trivyによる脆弱性検知
- `rkhunter-warning`: rkhunterによる異常検知
- `file-integrity`: ファイル整合性の異常
- `process-missing`: 必須プロセスの欠落
- `ports-unexpected`: 許可外ポートの検知
- `role_change`: 権限変更の異常パターン

---

## 次のステップ

Slack通知設定が完了したら、定期的にアラートを確認してください。
- 1日1回、Slackチャンネルを確認することを推奨します
- Critical/Highレベルのアラートはすぐに対応してください
