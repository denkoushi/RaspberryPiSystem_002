---
title: ローカル環境対応の通知機能 実機検証手順
tags: [通知, アラート, 実機検証]
audience: [運用者, 開発者]
last-verified: 2025-12-01
related: [local-alerts.md, quick-start-deployment.md]
category: guides
update-frequency: low
---

# ローカル環境対応の通知機能 実機検証手順

最終更新: 2025-12-01

## 検証項目

1. ✅ アラート生成スクリプトの動作確認
2. ✅ 管理画面でのアラート表示確認
3. ✅ アラート確認済み機能の動作確認（2025-12-01 実機テスト完了）
4. ✅ Ansible更新失敗時の自動アラート生成確認

## 事前準備

### 1. MacからRaspberry Pi 5に最新コードをプッシュ

```bash
# Macで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002
git push origin feature/production-deployment-management
```

### 2. Raspberry Pi 5で最新コードを取得

```bash
# Raspberry Pi 5にSSH接続
ssh denkon5sd02@192.168.128.131

# プロジェクトディレクトリに移動
cd /opt/RaspberryPiSystem_002

# 最新コードを取得
git pull origin feature/production-deployment-management
```

### 3. APIサーバーを再起動

```bash
# Docker ComposeでAPIサーバーを再起動
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart api web
```

## 検証手順

### ステップ1: アラート生成スクリプトの動作確認

**Raspberry Pi 5で実行:**

```bash
# アラートディレクトリを作成（存在しない場合）
mkdir -p /opt/RaspberryPiSystem_002/alerts

# アラート生成スクリプトを実行
cd /opt/RaspberryPiSystem_002
./scripts/generate-alert.sh "test-alert" "テストアラート" "これはテストです"

# アラートファイルが生成されたか確認
ls -la alerts/
cat alerts/alert-*.json | jq '.'
```

**期待される結果:**
- `alerts/alert-YYYYMMDD-HHMMSS.json` ファイルが生成される
- JSONファイルに正しい内容が含まれている

### ステップ2: 管理画面でのアラート表示確認

**ブラウザでアクセス:**

```
https://192.168.128.131/admin
```

**確認項目:**
1. ダッシュボードにアラートバナーが表示される
2. 「ファイルベースのアラート」セクションにテストアラートが表示される
3. アラートのタイプ、メッセージ、詳細が正しく表示される

**APIで直接確認:**

```bash
# Raspberry Pi 5で実行
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# アラート情報を取得
curl -X GET http://localhost:8080/api/clients/alerts \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

**期待される結果:**
- `alerts.fileAlerts` が 1以上
- `details.fileAlerts` にテストアラートが含まれる

### ステップ3: アラート確認済み機能の動作確認

**管理画面で確認:**

1. ダッシュボードのアラートバナーで「確認済み」ボタンをクリック
2. アラートが表示から消えることを確認

**実機テスト結果（2025-12-01）:**
- ✅ 「確認済み」ボタンをクリックするとアラートが正常に消えることを確認
- ✅ ブラウザコンソールにエラーなし
- ✅ APIエンドポイント `/api/clients/alerts/:id/acknowledge` が正常に動作

**APIで確認:**

```bash
# アラートIDを取得（最新のアラートファイルから）
ALERT_ID=$(ls -t alerts/alert-*.json | head -1 | sed 's/.*alert-\(.*\)\.json/\1/')

# アラートを確認済みにする
curl -X POST http://localhost:8080/api/clients/alerts/${ALERT_ID}/acknowledge \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# アラート情報を再取得（確認済みアラートは表示されない）
curl -X GET http://localhost:8080/api/clients/alerts \
  -H "Authorization: Bearer $TOKEN" | jq '.alerts.fileAlerts'
```

**期待される結果:**
- `fileAlerts` が 0 になる
- 確認済みアラートは `details.fileAlerts` に含まれない

### ステップ4: Ansible更新失敗時の自動アラート生成確認

**注意**: このテストは実際にAnsible更新を失敗させる必要があります。テスト用の失敗シナリオを作成します。

**テスト用の失敗シナリオ:**

```bash
# Macで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 一時的にinventory.ymlを無効な設定に変更（テスト後は元に戻す）
cp infrastructure/ansible/inventory.yml infrastructure/ansible/inventory.yml.backup
cat > infrastructure/ansible/inventory.yml << 'EOF'
all:
  children:
    clients:
      hosts:
        invalid-host:
          ansible_host: 192.168.255.255  # 存在しないIP
      vars:
        ansible_user: invalid-user
        ansible_ssh_common_args: '-o StrictHostKeyChecking=no'
        ansible_python_interpreter: /usr/bin/python3
EOF

# Ansible更新スクリプトを実行（失敗するはず）
export RASPI_SERVER_HOST="denkon5sd02@192.168.128.131"
# inventory指定が必須（誤デプロイ防止）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# アラートファイルが生成されたか確認（Raspberry Pi 5で）
ssh denkon5sd02@192.168.128.131 "ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5"

# inventory.ymlを元に戻す
mv infrastructure/ansible/inventory.yml.backup infrastructure/ansible/inventory.yml
```

**期待される結果:**
- Ansible更新が失敗する
- `alerts/alert-YYYYMMDD-HHMMSS.json` ファイルが自動生成される
- アラートファイルの `type` が `ansible-update-failed` である

## 検証結果の記録

### 検証結果テンプレート

```markdown
## 検証結果

**検証日時**: YYYY-MM-DD HH:MM:SS
**検証者**: [名前]

### ステップ1: アラート生成スクリプト
- [ ] アラートファイルが生成された
- [ ] JSONファイルの内容が正しい

### ステップ2: 管理画面でのアラート表示
- [ ] ダッシュボードにアラートバナーが表示された
- [ ] ファイルベースのアラートが表示された
- [ ] APIでアラート情報が取得できた

### ステップ3: アラート確認済み機能
- [ ] 「確認済み」ボタンが動作した
- [ ] アラートが表示から消えた
- [ ] APIで確認済みアラートが除外された

### ステップ4: Ansible更新失敗時の自動アラート生成
- [ ] Ansible更新が失敗した
- [ ] アラートファイルが自動生成された
- [ ] アラートファイルの内容が正しい

### 問題点・改善点
[ここに問題点や改善点を記録]
```

## トラブルシューティング

### アラートファイルが生成されない場合

**確認事項:**
1. `alerts/` ディレクトリが存在するか
2. スクリプトに実行権限があるか（`chmod +x scripts/generate-alert.sh`）
3. ディレクトリに書き込み権限があるか

### 管理画面でアラートが表示されない場合

**確認事項:**
1. APIサーバーが再起動されているか
2. `alerts/` ディレクトリがAPIサーバーからアクセス可能か
3. ブラウザのキャッシュをクリア

### APIでアラート情報が取得できない場合

**確認事項:**
1. 認証トークンが正しいか
2. APIサーバーのログを確認（`docker compose logs api`）
3. `alerts/` ディレクトリのパスが正しいか

## 次のステップ

検証が完了したら：
1. 検証結果を記録
2. 問題があれば修正
3. 次の機能実装に進む

