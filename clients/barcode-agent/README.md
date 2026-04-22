# barcode-agent

Pi4 キオスク上で `/dev/ttyACM*` 等のシリアル（CDC ACM）バーコードリーダーを読み取り、`ws://localhost:<port>/stream` へ JSON イベントを配信する常駐エージェントです。運用は `nfc-agent` と同様に Docker Compose + Ansible で管理します。

## 環境変数

| 変数 | 説明 | 既定 |
|------|------|------|
| `REST_HOST` | HTTP/WS バインド | `0.0.0.0` |
| `REST_PORT` | ポート（7072 推奨、7071 は nfc-agent） | `7072` |
| `SERIAL_DEVICE` | デバイスパス | `/dev/ttyACM0` |
| `SERIAL_BAUD` | ボーレート | `9600` |
| `LOG_LEVEL` | ログレベル | `INFO` |

## ローカル実行（開発）

```bash
cd clients/barcode-agent
cp .env.example .env
poetry install
poetry run python -m barcode_agent
```

## API

- `GET /api/agent/status` — シリアル接続状態・最終スキャン等
- `WS /stream` — スキャンイベント（`type: barcodeScan`, `text`, `timestamp`, `eventId`）
