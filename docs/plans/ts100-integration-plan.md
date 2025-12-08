# TS100 統合計画 (ExecPlan)

## 目的
TS100 RFIDリーダーを計測機器持出・返却フローに統合し、現場のiPad/Bluetooth運用からRaspberry Piキオスク/エージェント連携へ移行できるようにする。

## 現状と前提
- 公式SDKは Android/iOS/Windows のみ。Linux版なし。
- 公開情報より、USB HIDキーボードエミュレーションは利用可能。BLEはV4.0対応だがSPP対応は不明。
- 現行キオスクは `nfc-agent` (PC/SC) からの WebSocket ストリームを前提。

## 推奨方式
1) **USB HIDキーボードモードを利用し、エッジ側エージェントでUIDを取得して WebSocket 配信する**。
   - Linuxでドライバ不要、安定性が高い。
   - HIDキー入力をアプリが直接受けるとフォーカス依存が発生するため、バックグラウンドでデバイスイベントを読み取り、`nfc-agent`と同じWebSocket (`/ws`) で配信する。
2) **BLEはHIDのみを前提**（SPPは未確認）。BLE接続が必要な場合も、同様にHIDイベントを読む方式を採用。

## 実装方針（最小ステップ）
- `clients/nfc-agent` を拡張し、TS100の HID デバイスから UID を読み取るリーダー実装を追加。
- 入力ソースを設定で切替可能にする（例: `AGENT_MODE=pcsc|ts100-hid|mock`）。
- HIDイベント読み取りは Python の `evdev` または Node.js の `node-hid` で実装する（既存エージェントがPythonのため `evdev` が第一候補）。
- 読み取った文字列をデバウンスし、`{ uid, reader: 'ts100', type: 'rfid-tag', timestamp }` でWebSocket配信。

## タスク分解
1. **デバイス確認**: `lsusb`, `dmesg`, `/dev/input/by-id/` でTS100を特定。BLE利用時は `bluetoothctl` でペアリング。
2. **HID読取PoC**: `evtest` や簡易PythonスクリプトでUIDを取得し、出力フォーマットを確認（改行・タブ終端など）。
3. **エージェント実装**: `nfc-agent` に TS100 HID リーダークラスを追加し、WebSocket送信処理に統合。
4. **設定/サービス化**: `.env` に `AGENT_MODE=ts100-hid` を追加。systemd ユニット更新（`clients/nfc-agent`）。
5. **E2E動作確認**: キオスク `/kiosk/instruments/borrow` でタグUIDが自動選択されること、氏名タグスキャンで自動送信されることを確認。
6. **リカバリ/フォールバック**: HIDが取得できない場合は `mock` モードに戻せるよう維持。

## リスクと対応
- **BLE SPP非対応の可能性**: USB HIDを優先。BLEでのシリアル受信は期待しない。
- **キー入力混在**: バックグラウンドでデバイスを直接読むことでフォーカス依存を排除。
- **UID形式差異**: 末尾改行/タブの除去と大文字化をエージェント側で正規化。

## 検証項目
- USB接続でUIDを安定取得できるか（連続スキャンでデバウンスが効くこと）。
- WebSocket経由でキオスクの選択が自動化されるか。
- 断線/再接続後に自動復旧するか（デバイス再検出）。

## 依存/オープン事項
- ベンダーからBLEプロファイル(SPP可否)情報を入手する（推奨）。
- UID出力フォーマット（プレフィックス有無、終端文字）を実機で確認する。

## ラズパイ側セットアップ手順（ドラフト）
1. 依存インストール: `sudo apt-get install -y python3-evdev pcscd`（PC/SC併用のためpcscdは維持）。
2. デバイス確認: `lsusb`, `dmesg | tail`, `/dev/input/by-id/` で TS100 HID デバイス名を特定。
3. 動作確認: `sudo evtest /dev/input/by-id/<ts100-hid-device>` でスキャンし、UID文字列が出力されることを確認。
4. 環境設定: `clients/nfc-agent/.env` に `AGENT_MODE=ts100-hid` を追加（BLE利用時も HID 前提）。
5. サービス起動: `poetry run python -m nfc_agent` または systemd ユニットで再起動し、`GET /api/agent/status` で最新イベントを確認。
6. キオスク検証: `/kiosk/instruments/borrow` でタグスキャン→計測機器自動選択、氏名タグスキャン→自動送信になることを確認。
