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

## マイク無し端末について（重要）

Pi4など**マイクが未接続 / 無効**な端末でも、通話が即切断にならないよう **受信専用（recvonly）で接続を継続**するフォールバックを実装しています。

- **期待動作**: マイク無し端末が発信/受話しても、相手側の受話後にエラーダイアログ（例: `Could not start audio source`）が出ず、通話が維持される
- **制限**: マイクが無い端末からは送話できません（音声は片方向/受信のみ）

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

4. **通話中の確認（音声のみ）**:
   - Mac側とPi4側の両方で、音声通話が開始されること
   - 音声が聞こえること（マイク・スピーカーが接続されている場合）
   - 画面上に「音声通話中」と表示されること（ビデオは表示されない）
   - 「📞 切断」ボタンで通話を終了できること

5. **ビデオ通話への切替（Mac側から）**:
   - Mac側で「📹 ビデオを有効化」ボタンをクリック
   - カメラの許可を確認（ブラウザの許可ダイアログ）
   - Mac側でローカルビデオ（自分のカメラ映像）が表示されること
   - Pi4側でリモートビデオ（Macのカメラ映像）が表示されること
   - Mac側で「📹 ビデオを無効化」ボタンをクリック
   - ビデオが切れて音声のみに戻ること

6. **ビデオ通話への切替（Pi4側から）**:
   - Pi4側で「📹 ビデオを有効化」ボタンをクリック
   - カメラの許可を確認（ブラウザの許可ダイアログ、Pi4にカメラが接続されている場合）
   - Pi4側でローカルビデオ（自分のカメラ映像）が表示されること
   - Mac側でリモートビデオ（Pi4のカメラ映像）が表示されること
   - Pi4側で「📹 ビデオを無効化」ボタンをクリック
   - ビデオが切れて音声のみに戻ること

**注意**: Pi4にカメラが接続されていない場合、ビデオ有効化時にエラーが発生する可能性があります。その場合は音声通話のみで継続されます。

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
   - **重要**: WebSocketアップグレードヘッダーは`/api/webrtc/signaling`のみに適用すること（[KB-141](../knowledge-base/infrastructure/docker-caddy.md#kb-141)参照）

2. **APIログの確認**:
```bash
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api --since 10m | grep -E 'signaling|WebRTC|webrtc'"
```

3. **ブラウザのコンソールログ確認**:
   - `WebRTC signaling connected` が表示されること
   - `WebSocket onerror` が表示されないこと

4. **Route not found エラーの場合**:
   - `Route GET:/api/webrtc/webrtc/signaling not found`のようなダブルプレフィックスがないか確認（[KB-132](../knowledge-base/api.md#kb-132)参照）

5. **TypeError: Cannot read properties of undefined エラーの場合**:
   - `@fastify/websocket`の`connection.socket`がundefinedになる場合がある（[KB-133](../knowledge-base/api.md#kb-133)参照）
   - `connection`オブジェクト自体がWebSocketの場合に対応しているか確認

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

5. **デバッグ用URLパラメータ**:
   - クライアントキーの問題を切り分けるため、URLパラメータで一時的に上書き可能
```
https://100.106.158.2/kiosk/call?clientKey=client-key-mac-kiosk1&clientId=mac-kiosk-1
```

### 通話が開始されない / 着信モーダルが表示されない

1. **マイク・カメラの許可確認**:
   - ブラウザの設定でマイク・カメラの許可が確認されていること
   - 他のアプリケーションがマイク・カメラを使用していないこと
   - macOSの場合: システム設定 → プライバシーとセキュリティ → マイク/カメラでChromeを許可

2. **WebRTC接続の確認**:
   - ブラウザの開発者ツールで`RTCPeerConnection`の状態を確認
   - `connectionState: "connected"` になっていること

3. **ファイアウォール設定の確認**:
   - STUN/TURNサーバーが使用されている場合、ポートが開放されていること
   - 現在の実装ではSTUN/TURNサーバーは使用していない（同一LAN内での通話）

4. **着信モーダルが表示されない場合**:
   - コンソールログで`cleanup called`が`incoming`の直後に発生していないか確認
   - 発生している場合は`useWebRTC`フックのコールバック安定化を確認（[KB-136](../knowledge-base/frontend.md#kb-136)参照）

### マイク未接続端末で「Could not start audio source」エラー

1. **原因**: マイクが物理的に接続されていない端末で`getUserMedia(audio)`が失敗

2. **対処**: 
   - 現在の実装では**recvonly（受信専用）モードで通話を継続**するフォールバックあり
   - エラーダイアログが表示されず通話が維持されることを確認

3. **詳細**: [KB-137](../knowledge-base/frontend.md#kb-137)参照

### ビデオを有効化しても黒い画面が表示される

1. **カメラの許可確認**: カメラのLEDが点灯しているか確認

2. **DOM要素へのバインディング**:
   - ビデオ要素が条件付きレンダリングされている場合、`srcObject`のバインドタイミングに注意
   - `useEffect`でストリームとDOM要素の両方が存在する時にバインドする
   - 詳細: [KB-138](../knowledge-base/frontend.md#kb-138)参照

3. **古いJavaScriptが残っている場合**:
   - `docker compose build --no-cache web`でキャッシュを無効化してビルド

### 通話が約5分で切断される

1. **原因**: ネットワーク機器（ルーター、プロキシ等）がアイドル状態のWebSocket接続をタイムアウト

2. **対処**: 
   - WebSocket keepalive機能（30秒間隔のping/pong）が実装済み
   - keepaliveが動作していない場合は、デプロイが最新かどうか確認

3. **ログで確認**:
```bash
# APIログでping/pongを確認
ssh denkon5sd02@100.106.158.2 "docker logs --since 10m docker-api-1 2>&1 | grep -E 'ping|pong'"
```

4. **詳細**: [KB-134](../knowledge-base/api.md#kb-134)参照

### 「Callee is not connected」エラー

1. **原因**: 発信先のクライアントがWebSocketシグナリングサーバーに接続していない

2. **確認事項**:
   - 発信先（Pi4など）で通話画面（`/kiosk/call`）を開いているか
   - 発信先でWebSocket接続が確立されているか（コンソールで`WebRTC signaling connected`を確認）

3. **対処**: 発信先でも通話画面を開いてWebSocket接続を確立する

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

### 基本接続

- [ ] Pi5サーバーのヘルスチェックが正常
- [ ] 発信先一覧APIが正常に動作
- [ ] WebRTCシグナリングルートが登録されている

### キオスク画面

- [ ] Macでキオスク通話画面が表示される
- [ ] MacでWebSocket接続が確立される
- [ ] Macで発信先一覧が表示される（Pi4、Pi3、Pi5が含まれる）
- [ ] Pi4でキオスク通話画面が表示される
- [ ] Pi4でWebSocket接続が確立される

### 音声通話

- [ ] MacからPi4への発信が成功する
- [ ] Pi4からMacへの発信が成功する
- [ ] 通話中に音声が聞こえる（マイク・スピーカー接続時）
- [ ] マイク無し端末（Pi4）でも受話できる（recvonlyモード）
- [ ] 通話の切断が正常に動作する
- [ ] 60秒以上の通話維持ができる

### ビデオ通話

- [ ] Macのみビデオ有効化が動作する
- [ ] Pi4のみビデオ有効化が動作する
- [ ] 両デバイスでビデオ有効化が動作する
- [ ] ビデオの無効化が動作する
- [ ] 60秒以上のビデオ通話維持ができる

### 長時間接続・安定性

- [ ] 5分以上の通話維持ができる（keepalive動作確認）
- [ ] WebSocket接続エラー時の自動再接続が動作する
- [ ] ネットワーク切断後の再接続が動作する

## 実装過程で得た知見

### 1. WebSocket接続の安定性

- **keepalive実装が必須**: ネットワーク機器は5分程度でアイドル接続を切断する
- **30秒間隔のping/pong**で問題解決
- `code: 1006`はネットワークレベルの異常終了（アプリケーションエラーではない）

### 2. Reactフックの依存関係管理

- **コールバック関数は`useRef`で保持**: インライン関数を依存配列に含めると無限ループの原因に
- **`cleanup`関数は空の依存配列で安定化**: アンマウント時のみ実行されるようにする
- **`eslint-disable`コメントは慎重に**: 影響を理解した上で使用

### 3. ハードウェア差異への対応

- **マイク/カメラがない端末でも動作させる**: `getUserMedia`失敗時のフォールバックが重要
- **recvonlyモード**: 受信専用で通話を継続できる
- **カメラ制約は緩めに**: `getVideoStream()`で制約なしにすると互換性向上

### 4. Caddyリバースプロキシ設定

- **WebSocketヘッダーは特定パスのみ**: すべてのAPIに適用すると壊れる
- **`handle`ディレクティブの順序が重要**: 具体的なパスを先に定義

### 5. Fastify WebSocket

- **`connection.socket`が`undefined`の場合がある**: `connection`自体がWebSocketオブジェクトの可能性
- **防御的コーディング**: メソッド存在確認でライブラリ差分を吸収

### 6. localStorage互換性

- **`useLocalStorage`はJSON形式で保存**: 手動設定時も`JSON.stringify()`を使用
- **デバッグ用URLパラメータ**: クライアント識別の問題切り分けに有効

### 7. 条件付きレンダリングとMediaStream

- **`srcObject`は要素存在時に設定**: `useEffect`で両方が利用可能な時にバインド
- **`video.play()`は必ず呼び出す**: autoplay policyへの対応

## 関連ドキュメント

- [デプロイメントガイド](./deployment.md)
- [検証チェックリスト](./verification-checklist.md)

### ナレッジベース（WebRTC関連）

- [KB-132: WebRTCシグナリングルートのダブルプレフィックス問題](../knowledge-base/api.md#kb-132)
- [KB-133: @fastify/websocketのconnection.socket問題](../knowledge-base/api.md#kb-133)
- [KB-134: WebSocket keepalive対策](../knowledge-base/api.md#kb-134)
- [KB-135: キオスク通話候補取得APIエンドポイント](../knowledge-base/api.md#kb-135)
- [KB-136: useWebRTCのcleanup早期実行問題](../knowledge-base/frontend.md#kb-136)
- [KB-137: マイク未接続端末でのrecvonlyフォールバック](../knowledge-base/frontend.md#kb-137)
- [KB-138: ビデオ通話時のsrcObjectバインディング問題](../knowledge-base/frontend.md#kb-138)
- [KB-139: WebSocket接続管理（重複接続防止）](../knowledge-base/frontend.md#kb-139)
- [KB-140: useLocalStorageとの互換性](../knowledge-base/frontend.md#kb-140)
- [KB-141: CaddyのWebSocketアップグレードヘッダー問題](../knowledge-base/infrastructure/docker-caddy.md#kb-141)
