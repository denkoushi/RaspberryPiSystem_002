# NFC Agent

Sony RC-S300/S1 NFC リーダーから Felica / Mifare の UID を取得し、WebSocket/REST で Raspberry Pi 4 のブラウザへ配信する常駐サービスです。`pcscd` + `pyscard` でリーダーを監視し、検出イベントを WebSocket (`ws://localhost:7071/stream`) へブロードキャスト、同時に SQLite キューへ保存します。`pyscard` で RC-S300 が認識できない場合は、ステータス API にエラーを表示し `AGENT_MODE=mock` でモック動作へ切り替えられます（代替として `nfcpy` や libusb を導入する際のフックにも利用可能）。

## セットアップ

```bash
sudo apt-get install -y pcscd python3-pyscard python3-evdev
sudo systemctl enable --now pcscd

cd clients/nfc-agent
poetry install
cp .env.example .env
# 必要に応じて CLIENT_ID や API_BASE_URL を編集
poetry run python -m nfc_agent
```

`pyscard` がリーダーを認識できない場合は `pcsc_scan` コマンドで接続を確認し、`sudo systemctl restart pcscd` を試してください。それでも認識できない場合は `.env` に `AGENT_MODE=mock` を設定してモックUIDをブラウザへ送り、`nfcpy` など他方式への切り替えを検討してください。

### TS100 (USB/BLE HID) で使う場合
- `.env` で `AGENT_MODE=ts100-hid` を設定。
- HIDデバイスパスを明示する場合は `TS100_HID_DEVICE=/dev/input/by-id/usb-...-event-kbd` を指定（未指定なら「ts100」を含むデバイス名を自動検出）。
- UIDは Enter/改行で確定とみなし WebSocket `/stream` に `{uid, reader: \"ts100-hid\", type: \"rfid-tag\"}` で配信。

## 提供インターフェース

- `GET /api/agent/status`: リーダー接続状況・最後のイベント・キュー数を返す
- `GET /api/agent/queue`: 未送信イベントのプレビュー（最大50件）
- `POST /api/agent/flush`: 現状はローカルキューをクリア（将来はサーバーへ再送）
- `WebSocket /stream`: JSON `{uid, reader, timestamp}` をリアルタイム配信

これらのインターフェースは将来 PDF ビューワーや物流管理機能が端末情報を取得する際にも再利用できるよう設計されています。
