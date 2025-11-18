# NFC Agent

Sony RC-S300/S1 NFC リーダーから Felica / Mifare の UID を取得し、WebSocket/REST で Raspberry Pi 4 のブラウザへ配信するローカルサービス。Milestone 1 時点では雛形のみで、`pyscard` がリーダーを正しく認識しない場合は `nfcpy` や libusb 直叩きの代替実装を検討すること。

## 仮想環境セットアップ

```bash
poetry install
poetry shell
python -m nfc_agent
```

## 主要予定機能

1. `pcscd` を通じたリーダー検出と接続監視
2. UID 読み取りと JSON イベント生成
3. WebSocket/REST API での公開
4. オフライン時のキューイング（SQLite）
```
