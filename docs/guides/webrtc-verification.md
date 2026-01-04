# WebRTCビデオ通話機能 実機検証手順

最終更新: 2026-01-04

## 概要

本ドキュメントでは、WebRTCビデオ通話機能の実機検証手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI、WebRTCシグナリングサーバー）
- **Raspberry Pi 4**: クライアント（キオスク、通話端末1）
- **Mac**: クライアント（キオスク、通話端末2）
- **Raspberry Pi 3**: サイネージ（通話端末としても使用可能）

## 前提条件

### ネットワーク設定

- Pi5サーバーはTailscale経由でアクセス可能（`100.106.158.2`）
- Pi4、Pi3、Macは同一ローカルネットワーク（`192.168.10.0/24`）またはTailscale経由で接続
- `network_mode: "tailscale"`が設定されていること

**注意**: status-agentはローカルLANのIPアドレスを使用します（TailscaleのIPアドレスは使用しません）。発信先一覧に表示されるIPアドレスはローカルLANのIPアドレスです。

### クライアントキー設定

各端末で以下のクライアントキーが設定されていること：

- Pi4: `client-key-raspberrypi4-kiosk1`
- Pi3: `client-key-raspberrypi3-signage1`
- Pi5: `client-key-raspberrypi5-server`
- Mac: `client-key-mac-kiosk1`（ブラウザのlocalStorageに設定）

### WebRTC機能の有効化確認

```bash
# Pi5で確認
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -E 'WebRTC routes registered|WEBRTC_ENABLED' | tail -5"
```

期待される出力：
```
{"level":30,"msg":"WebRTC routes registration check","webrtcEnabled":true}
{"level":30,"msg":"WebRTC routes registered successfully"}
```

## 検証手順

### 1. 疎通確認

#### 1.1 Pi5サーバーのヘルスチェック

```bash
curl -k https://100.106.158.2/api/system/health
```

期待される結果: `{"status":"ok",...}` または `{"status":"degraded",...}`（メモリ使用率が高い場合）

#### 1.2 発信先一覧APIの確認

```bash
# Pi4のクライアントキーで確認
curl -k -H 'x-client-key: client-key-raspberrypi4-kiosk1' https://100.106.158.2/api/kiosk/call/targets

# Macのクライアントキーで確認
curl -k -H 'x-client-key: client-key-mac-kiosk1' https://100.106.158.2/api/kiosk/call/targets
```

期待される結果: `{"selfClientId":"...","targets":[...]}` 形式のJSONが返る

**注意**: 発信先一覧に表示されるIPアドレスはローカルLANのIPアドレスです（例: `192.168.10.224`）。TailscaleのIPアドレスは表示されません。

#### 1.3 WebRTCシグナリングエンドポイントの確認

```bash
# WebSocket接続テスト（wscatが必要）
# またはブラウザの開発者ツールで確認
```

### 2. Macでのキオスク通話画面の確認

#### 2.1 ブラウザでキオスク通話画面を開く

1. MacのChrome/Safariで `https://100.106.158.2/kiosk/call` を開く
2. 自己署名証明書の警告が出る場合は「詳細設定」→「続行」を選択
3. ブラウザの開発者ツール（F12）を開き、Consoleタブを表示

#### 2.2 クライアントキーとIDの設定確認

1. ブラウザの開発者ツールで以下を実行：
```javascript
localStorage.getItem('kiosk-client-key')
localStorage.getItem('kiosk-client-id')
```

2. 設定されていない場合、以下を実行：
```javascript
localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-mac-kiosk1'))
localStorage.setItem('kiosk-client-id', JSON.stringify('mac-kiosk-1'))
```

**重要**: `useLocalStorage`フックはJSON形式で保存するため、`JSON.stringify()`を使用してください。

3. ページをリロード（Cmd+R）

4. 発信先一覧にPi4が表示されることを確認：
   - `raspberrypi4-kiosk1`（IP: `192.168.10.224`）が表示されること
   - `raspberrypi3-signage1`（IP: `192.168.10.109`）が表示されること
   - `raspberrypi5-server`（IP: `192.168.10.230`）が表示されること

#### 2.3 WebSocket接続の確認

1. Consoleタブで以下のログを確認：
   - `WebRTC signaling connected` が表示されること
   - `WebSocket connection error` が表示されないこと

2. 画面上部に「接続中」→「接続済み」と表示されること

#### 2.4 発信先一覧の表示確認

1. 発信先一覧に以下の端末が表示されること：
   - `raspberrypi5-server`（Pi5サーバー）
   - `raspberrypi3-signage1`（Pi3サイネージ）
   - `raspberrypi4-kiosk1`（Pi4キオスク、自分自身は除外される）

2. 各発信先に「📞 発信」ボタンが表示されること

**注意**: 発信先一覧に表示されるIPアドレスはローカルLANのIPアドレスです（例: `192.168.10.224`）。TailscaleのIPアドレスは表示されません。

### 3. Pi4でのキオスク通話画面の確認

**重要**: Pi4でも通話画面を開いておく必要があります。WebRTC通話は双方向の接続が必要で、発信先もWebSocketシグナリングに接続している必要があります。

#### 3.1 Pi4のキオスクブラウザで通話画面を開く

Pi4のキオスクブラウザは通常 `/kiosk` にアクセスしていますが、通話画面（`/kiosk/call`）にアクセスする必要があります。

**方法1: キオスク画面のナビゲーションから（推奨）**

1. Pi4のキオスクブラウザで現在の画面を確認
2. 画面上部のナビゲーションで「📞 通話」タブをクリック
3. 通話画面（`/kiosk/call`）が表示されることを確認
4. 画面上部に「接続済み」と表示されることを確認

**方法2: 直接URLを入力（キオスクブラウザがフルスクリーンでない場合）**

1. Pi4のキオスクブラウザでアドレスバーに `https://100.106.158.2/kiosk/call` を入力
2. Enterキーを押してアクセス

**方法3: キオスクブラウザを一時的に終了して手動起動**

```bash
# Pi4で実行（VNC接続または直接Pi4で実行）
# キオスクブラウザを一時停止
sudo systemctl stop kiosk-browser.service

# Chromiumを手動で起動（通話画面を開く）
chromium-browser --app="https://100.106.158.2/kiosk/call" \
  --start-maximized \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --disable-translate \
  --overscroll-history-navigation=0 \
  --use-fake-ui-for-media-stream \
  --allow-insecure-localhost \
  --ignore-certificate-errors \
  --unsafely-treat-insecure-origin-as-secure=https://100.106.158.2
```

**注意**: 方法3を使用した場合、検証後に元のキオスクブラウザを再起動してください：
```bash
sudo systemctl start kiosk-browser.service
```

#### 3.2 WebSocket接続の確認

1. Pi4のブラウザで開発者ツールを開く（可能な場合、F12キー）
2. Consoleタブで `WebRTC signaling connected` が表示されることを確認
3. 画面上部に「接続済み」と表示されることを確認

#### 3.3 クライアントキーとIDの確認

Pi4のキオスクブラウザでは、通常以下のクライアントキーとIDが設定されています：
- `kiosk-client-key`: `client-key-raspberrypi4-kiosk1`
- `kiosk-client-id`: `raspberrypi4-kiosk1`（または設定された値）

開発者ツールのConsoleで確認：
```javascript
localStorage.getItem('kiosk-client-key')
localStorage.getItem('kiosk-client-id')
```

### 4. 通話機能の実機検証

#### 4.1 MacからPi4への発信

1. **Mac側**:
   - 発信先一覧から `raspberrypi4-kiosk1` を選択
   - 「📞 発信」ボタンをクリック
   - マイク・カメラの許可を確認（ブラウザの許可ダイアログ）

2. **Pi4側**:
   - 着信モーダルが表示されること
   - 呼び出し音が鳴ること（実装済みの場合）
   - 「受話」ボタンと「拒否」ボタンが表示されること

3. **Pi4側で受話**:
   - 「受話」ボタンをクリック
   - マイク・カメラの許可を確認
   - 通話が開始されること

4. **通話中の確認**:
   - Mac側とPi4側の両方で、ローカルビデオとリモートビデオが表示されること
   - 音声が聞こえること（マイク・スピーカーが接続されている場合）
   - 「📹 ビデオを無効化」ボタンでビデオを切替できること
   - 「📞 切断」ボタンで通話を終了できること

#### 4.2 Pi4からMacへの発信

1. **Pi4側**:
   - 発信先一覧から `mac-kiosk-1`（またはMacのclientId）を選択
   - 「📞 発信」ボタンをクリック

2. **Mac側**:
   - 着信モーダルが表示されること
   - 「受話」ボタンで受話

3. **通話中の確認**: 4.1と同様

#### 4.3 Pi4からPi3への発信

1. **Pi4側**:
   - 発信先一覧から `raspberrypi3-signage1` を選択
   - 「📞 発信」ボタンをクリック

2. **Pi3側**:
   - Pi3のブラウザで `https://100.106.158.2/kiosk/call` を開く
   - 着信モーダルが表示されること
   - 「受話」ボタンで受話

3. **通話中の確認**: 4.1と同様

### 5. エラーケースの確認

#### 5.1 WebSocket接続エラー

1. Pi5サーバーを一時停止：
```bash
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml stop api"
```

2. Macのキオスク画面で以下を確認：
   - 「WebSocket connection error」のアラートが表示されること（3秒に1回以下）
   - 開発者ツールでエラーログが確認できること

3. Pi5サーバーを再起動：
```bash
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml start api"
```

4. 自動再接続が行われることを確認

#### 5.2 発信先がオフラインの場合

1. Pi3のstatus-agentを停止：
```bash
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop status-agent.timer'"
```

2. 数分待ってから、Macのキオスク画面で発信先一覧を確認：
   - Pi3が`stale: true`として表示される、または一覧から除外されること

3. Pi3のstatus-agentを再起動：
```bash
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl start status-agent.timer'"
```

## トラブルシューティング

### WebSocket接続エラーが発生する

1. **Caddy設定の確認**:
   - `infrastructure/docker/Caddyfile.local`でWebSocketプロキシ設定を確認
   - `/api/webrtc/signaling`へのリクエストが正しくプロキシされているか確認

2. **APIログの確認**:
```bash
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api --since 10m | grep -E 'signaling|WebRTC|webrtc'"
```

3. **ブラウザのコンソールログ確認**:
   - `WebSocket onopen` が表示されること
   - `WebSocket onerror` が表示されないこと

### 発信先一覧が表示されない

1. **APIエンドポイントの確認**:
```bash
curl -k -H 'x-client-key: client-key-mac-kiosk1' https://100.106.158.2/api/kiosk/call/targets
```

2. **クライアントキーの確認**:
   - ブラウザのlocalStorageに`kiosk-client-key`が設定されていること
   - 設定されているキーがデータベースに存在すること
   - `useLocalStorage`フックはJSON形式で保存するため、`JSON.stringify()`を使用すること

3. **status-agentの動作確認**:
   - 各端末のstatus-agentが正常に動作していること
   - `ClientStatus`テーブルに最新データが記録されていること

### 発信先一覧にPi4が表示されない

1. **MacのlocalStorage設定を確認**:
```javascript
// ブラウザの開発者ツールで実行
localStorage.getItem('kiosk-client-key')
localStorage.getItem('kiosk-client-id')
```

2. **正しい形式で設定**:
```javascript
// useLocalStorageフックはJSON形式で保存するため、JSON.stringify()を使用
localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-mac-kiosk1'))
localStorage.setItem('kiosk-client-id', JSON.stringify('mac-kiosk-1'))
```

3. **ページをリロード**:
   - 設定後、ページをリロード（Cmd+R）して反映を確認

4. **APIレスポンスの確認**:
   - ブラウザの開発者ツールのNetworkタブで`/api/kiosk/call/targets`のレスポンスを確認
   - Pi4が`targets`配列に含まれていることを確認

### 通話が開始されない

1. **マイク・カメラの許可確認**:
   - ブラウザの設定でマイク・カメラの許可が確認されていること
   - 他のアプリケーションがマイク・カメラを使用していないこと

2. **WebRTC接続の確認**:
   - ブラウザの開発者ツールで`RTCPeerConnection`の状態を確認
   - `connectionState: "connected"` になっていること

3. **ファイアウォール設定の確認**:
   - STUN/TURNサーバーが使用されている場合、ポートが開放されていること
   - 現在の実装ではSTUN/TURNサーバーは使用していない（同一LAN内での通話）

## IPアドレスについて

### ローカルLANのIPアドレスとTailscaleのIPアドレス

- **status-agent**: ローカルLANのIPアドレスを使用します（例: `192.168.10.224`）
- **発信先一覧**: ローカルLANのIPアドレスが表示されます
- **TailscaleのIPアドレス**: 現在は使用していません（将来的にサポートする可能性あり）

### IPアドレスの取得方法

status-agentは以下の方法でIPアドレスを取得します：

1. `8.8.8.8`に接続してローカルIPアドレスを取得
2. 失敗した場合は`hostname -I`で取得
3. それも失敗した場合は`127.0.0.1`を返す

この方法により、ローカルLANのIPアドレスが取得されます。TailscaleのIPアドレスを取得するには、別の方法が必要です。

## 検証チェックリスト

- [ ] Pi5サーバーのヘルスチェックが正常
- [ ] 発信先一覧APIが正常に動作
- [ ] WebRTCシグナリングルートが登録されている
- [ ] Macでキオスク通話画面が表示される
- [ ] MacでWebSocket接続が確立される
- [ ] Macで発信先一覧が表示される（Pi4、Pi3、Pi5が含まれる）
- [ ] Pi4でキオスク通話画面が表示される
- [ ] Pi4でWebSocket接続が確立される
- [ ] MacからPi4への発信が成功する
- [ ] Pi4からMacへの発信が成功する
- [ ] 通話中に音声が聞こえる（マイク・スピーカー接続時）
- [ ] 通話中にビデオが表示される（カメラ接続時）
- [ ] ビデオの有効化/無効化が動作する
- [ ] 通話の切断が正常に動作する
- [ ] WebSocket接続エラー時の自動再接続が動作する

## 関連ドキュメント

- [デプロイメントガイド](./deployment.md)
- [検証チェックリスト](./verification-checklist.md)
- [WebRTC実装のナレッジベース](../knowledge-base/api.md#webrtc)
