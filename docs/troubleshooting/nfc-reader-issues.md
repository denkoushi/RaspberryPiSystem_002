# NFCリーダーのトラブルシューティング

## 問題: ラズパイ4のキオスクでNFCリーダーからのタグスキャンが機能しない

### 確認手順

#### 1. NFCエージェントの起動確認

ラズパイ4で以下を実行して、NFCエージェントが起動しているか確認してください：

```bash
# NFCエージェントのプロセス確認
ps aux | grep nfc_agent

# または、systemdサービスとして起動している場合
systemctl status nfc-agent
```

#### 2. NFCエージェントの手動起動

NFCエージェントが起動していない場合、以下で手動起動してください：

```bash
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
poetry run python -m nfc_agent
```

#### 3. WebSocket接続の確認

ブラウザの開発者ツール（F12）でコンソールを開き、以下のエラーがないか確認してください：

- `WebSocket connection failed`
- `Failed to connect to ws://localhost:7071/stream`

#### 4. NFCエージェントのステータス確認

ラズパイ4で以下を実行して、NFCエージェントのステータスを確認してください：

```bash
curl http://localhost:7071/api/agent/status
```

期待されるレスポンス：
```json
{
  "readerConnected": true,
  "readerName": "Sony RC-S300/S1",
  "message": "Reader connected",
  "lastError": null,
  "queueSize": 0,
  "lastEvent": {...}
}
```

#### 5. PCSCサービスの確認

NFCリーダーが認識されない場合、PCSCサービスを確認してください：

```bash
# PCSCサービスの状態確認
sudo systemctl status pcscd

# PCSCサービスが停止している場合、起動
sudo systemctl start pcscd

# PCSCサービスの再起動
sudo systemctl restart pcscd

# リーダーの認識確認
pcsc_scan
```

#### 6. 環境変数の確認

Webアプリのビルド時に環境変数が正しく設定されているか確認してください：

```bash
# ラズパイ4でWebアプリのビルド確認
cd /opt/RaspberryPiSystem_002/apps/web
cat .env  # または環境変数ファイルを確認

# VITE_AGENT_WS_URLが設定されているか確認
# デフォルトは ws://localhost:7071/stream
```

#### 7. ブラウザのコンソールログ確認

キオスク画面でブラウザの開発者ツール（F12）を開き、コンソールタブで以下を確認：

- `NFC Event received:` というログが表示されるか
- WebSocket接続エラーが表示されていないか

### よくある原因と解決方法

#### 原因1: NFCエージェントが起動していない

**解決方法**:
```bash
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
poetry run python -m nfc_agent
```

#### 原因2: PCSCサービスが停止している

**解決方法**:
```bash
sudo systemctl restart pcscd
```

#### 原因3: NFCリーダーが認識されていない

**解決方法**:
```bash
# リーダーの認識確認
pcsc_scan

# 認識されない場合、USB接続を確認
lsusb | grep -i sony

# リーダーを再認識させる
sudo systemctl restart pcscd
```

#### 原因4: WebSocket接続がブロックされている

**解決方法**:
- ファイアウォール設定を確認
- ブラウザのセキュリティ設定を確認
- `ws://localhost:7071/stream`への接続が許可されているか確認

#### 原因5: Webアプリのビルドが古い

**解決方法**:
```bash
cd /opt/RaspberryPiSystem_002
git pull origin main
cd apps/web
pnpm build
# Dockerを使用している場合
docker compose -f infrastructure/docker/docker-compose.client.yml up -d --build
```

### デバッグ用コマンド

#### NFCエージェントのログ確認

```bash
# NFCエージェントのログを確認（実行中の場合）
journalctl -u nfc-agent -f

# または、直接実行してログを確認
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
poetry run python -m nfc_agent
```

#### WebSocket接続のテスト

```bash
# WebSocket接続をテスト（wscatが必要）
wscat -c ws://localhost:7071/stream

# または、curlでステータスを確認
curl http://localhost:7071/api/agent/status
```

#### キューイベントの確認

```bash
# 未送信イベントの確認
curl http://localhost:7071/api/agent/queue
```

### ラズパイ5の改修との関係

**結論**: ラズパイ5の改修とは直接関係ありません。

理由：
- NFCエージェントはラズパイ4上で独立して動作するPythonサービス
- WebSocket接続は`ws://localhost:7071/stream`で、ラズパイ4のローカル接続
- ラズパイ5のAPIサーバーとは独立している

ただし、以下の可能性があります：
- Webアプリの再ビルド時に環境変数がリセットされた
- Dockerコンテナの再起動時にNFCエージェントが起動しなくなった
- システムの再起動後にNFCエージェントが自動起動しなくなった

### 次のステップ

1. 上記の確認手順を順番に実行
2. エラーメッセージやログを確認
3. 必要に応じて、NFCエージェントを再起動
4. 問題が解決しない場合、詳細なエラーログを確認

