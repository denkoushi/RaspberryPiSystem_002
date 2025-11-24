# ラズパイ更新コマンド（オフライン耐性機能）

最終更新: 2025-11-24

## ラズパイ5（サーバー）の更新

```bash
# 1. リポジトリを更新
cd /opt/RaspberryPiSystem_002
git pull origin main

# 2. 変更内容を確認（オプション）
git log --oneline -5

# 3. Docker Composeで再ビルド・再起動（必要に応じて）
docker compose -f infrastructure/docker/docker-compose.server.yml down
docker compose -f infrastructure/docker/docker-compose.server.yml build
docker compose -f infrastructure/docker/docker-compose.server.yml up -d

# 4. 動作確認
curl http://localhost:8080/api/system/health
```

## ラズパイ4（クライアント/NFCエージェント）の更新

```bash
# 1. リポジトリを更新
cd /opt/RaspberryPiSystem_002
git pull origin main

# 2. NFCエージェントの依存関係を更新（必要に応じて）
cd clients/nfc-agent
poetry install

# 3. 既存のNFCエージェントプロセスを停止
# （実行中の場合は Ctrl+C で停止、または別のターミナルで）
pkill -f "python -m nfc_agent"

# 4. NFCエージェントを再起動
poetry run python -m nfc_agent

# 5. 動作確認
curl http://localhost:7071/api/agent/status
# "queueSize": 0 が表示されればOK
```

## 実機検証手順（オフライン耐性）

### 準備

1. **ラズパイ4でNFCエージェントが起動していることを確認**
   ```bash
   curl http://localhost:7071/api/agent/status
   ```

2. **ブラウザでキオスク画面を開く**
   - `http://<ラズパイ5のIP>:4173/kiosk` にアクセス
   - 持出画面が表示されることを確認

### 検証1: オフライン時の動作確認

1. **ブラウザを閉じる**（WebSocket接続を切断）

2. **NFCカードをかざす**（複数回かざしてもOK）
   - アイテムタグと従業員証を順番にかざす

3. **キューに保存されているか確認**
   ```bash
   curl http://localhost:7071/api/agent/queue
   ```
   - 結果に `"events": [...]` が表示されればOK
   - かざした回数分のイベントが保存されていることを確認

### 検証2: オンライン復帰後の再送確認

1. **ブラウザでキオスク画面を再度開く**（WebSocket接続を再確立）
   - `http://<ラズパイ5のIP>:4173/kiosk` にアクセス

2. **キューが空になることを確認**
   ```bash
   curl http://localhost:7071/api/agent/queue
   ```
   - `"events": []` が表示されればOK
   - イベントが再送されたことを確認

3. **キオスク画面でイベントが処理されることを確認**
   - 持出画面で、かざしたカードのUIDが表示されることを確認
   - 持出が正常に処理されることを確認

## 期待される結果

✅ **成功**: 
- オフライン時にかざしたカードのイベントがキューに保存される
- オンライン復帰後に自動的に再送される
- キオスク画面でイベントが処理される

❌ **失敗**: 
- イベントが失われる
- 再送されない
- キューが空にならない

## トラブルシューティング

### NFCエージェントが起動しない

```bash
# ログを確認
poetry run python -m nfc_agent

# 依存関係を再インストール
poetry install

# Python環境を確認
poetry env info
```

### キューにイベントが保存されない

```bash
# NFCエージェントのログを確認
# エラーメッセージがないか確認

# NFCリーダーが認識されているか確認
curl http://localhost:7071/api/agent/status
# "readerConnected": true が表示されればOK
```

### イベントが再送されない

```bash
# WebSocket接続が確立されているか確認
# ブラウザの開発者ツール（F12）で確認
# Networkタブ → WS → /stream が接続されているか確認

# NFCエージェントのログを確認
# "Resent X queued events" のログが出力されるか確認
```

