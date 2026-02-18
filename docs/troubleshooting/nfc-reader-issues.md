# NFCリーダーのトラブルシューティング

## NFC WebSocket接続ポリシー（2026-02-18更新）

**重要**: NFCストリームは端末分離ポリシーに基づいて動作します。

- **Pi4キオスク端末**: `localOnly`ポリシーが適用され、`ws://localhost:7071/stream`のみに接続します。Pi5経由の`/stream`プロキシは使用しません。
- **運用Mac**: `disabled`ポリシーが適用され、NFCストリームを購読しません（誤発火防止）。
- **開発環境**: `legacy`ポリシーが適用され、従来互換の動作（HTTPSページでは`wss://<host>/stream`も候補に入る）を維持します。

詳細は [docs/security/tailscale-policy.md](../security/tailscale-policy.md) と [KB-266](../knowledge-base/infrastructure/security.md#kb-266-nfcストリーム端末分離の実装完了acl維持横漏れ防止) を参照してください。

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

# NFC WebSocket の接続先ポリシーを確認
# - kiosk端末（Pi4）の通常運用: `localOnly`ポリシーで`ws://localhost:7071/stream`のみに接続
#   Pi5経由の`/stream`プロキシは使用しない（Caddyfileから削除済み）
# - 運用Mac: `disabled`ポリシーでNFCストリームを購読しない（誤発火防止）
#
# 目安:
# - 正常: `ws://localhost:7071/stream` への接続が確立し、スキャンでイベントが届く
# - 異常: `wss://<Pi5>/stream` へ接続しようとしている（古いbundle/設定の可能性）
#   または、MacでNFCスキャンが発動する（ポリシー未適用の可能性）
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

#### 原因6: Dockerコンテナ内からpcscdにアクセスできない

**症状**: 
- `readerConnected: false`
- `Service not available. (0x8010001D)` エラー
- `Failed to establish context` エラー

**原因**:
- Dockerコンテナ内からホストの`pcscd`デーモンにアクセスするには、`/run/pcscd/pcscd.comm`ソケットファイルへのアクセスが必要
- `docker-compose.client.yml`に`/run/pcscd`のマウントが設定されていない

**解決方法**:

```bash
# 1. docker-compose.client.ymlを確認
cat /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.client.yml

# 2. /run/pcscdのマウントが設定されているか確認
# 以下のような設定が必要:
# volumes:
#   - /run/pcscd:/run/pcscd:ro

# 3. 設定されていない場合、docker-compose.client.ymlを編集
cd /opt/RaspberryPiSystem_002
# volumesセクションに以下を追加:
#   - /run/pcscd:/run/pcscd:ro

# 4. コンテナを再作成
docker compose -f infrastructure/docker/docker-compose.client.yml down nfc-agent
docker compose -f infrastructure/docker/docker-compose.client.yml up -d nfc-agent

# 5. コンテナ内からpcscdにアクセスできるか確認
docker exec docker-nfc-agent-1 ls -la /run/pcscd/
# pcscd.comm が表示されればOK

# 6. コンテナ内からリーダーが認識されるか確認
docker exec docker-nfc-agent-1 python -c "from smartcard.System import readers; print(list(readers()))"
# ['SONY FeliCa RC-S300/S (1469193) 00 00'] が表示されればOK
```

#### 原因7: polkit設定ファイルが削除された

**症状**:
- `Access denied` エラー
- `pcsc_scan`はrootで動作するが、一般ユーザーでは動作しない
- Dockerコンテナ内から`pcscd`にアクセスできない

**原因**:
- `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`が削除された（`git clean`など）
- polkitが`pcscd`へのアクセスを拒否している

**解決方法**:

```bash
# 1. polkit設定ディレクトリの確認
ls -la /etc/polkit-1/rules.d/

# 2. polkit設定ファイルが存在しない場合、作成
sudo mkdir -p /etc/polkit-1/rules.d/
sudo tee /etc/polkit-1/rules.d/50-pcscd-allow-all.rules > /dev/null <<'EOF'
polkit.addRule(function(action, subject) {
    if (action.id == "org.debian.pcsc-lite.access_pcsc" || 
        action.id == "org.debian.pcsc-lite.access_card") {
        return polkit.Result.YES;
    }
});
EOF

# 3. ファイルの権限を設定
sudo chmod 644 /etc/polkit-1/rules.d/50-pcscd-allow-all.rules

# 4. pcscdを再起動
sudo systemctl restart pcscd

# 5. 一般ユーザーでpcsc_scanを実行して確認
pcsc_scan
# リーダーが認識されればOK
```

#### 原因8: ポート7071が既に使用されている

**症状**:
- `address already in use` エラー
- NFCエージェントが起動しない

**解決方法**:

```bash
# 1. ポート7071を使用しているプロセスを確認
sudo lsof -i :7071

# 2. 古いプロセスを停止
sudo pkill -9 -f nfc_agent

# 3. Dockerコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.client.yml restart nfc-agent
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

