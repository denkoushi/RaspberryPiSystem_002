# haizen-agent

Raspberry Pi Zero 2 W などで、**USB HID バーコードリーダー**（キーボードウェッジ）の入力を読み取り、Pi 5 の **`POST /api/mobile-placement/haizen-scans`** に送ります。

## 前提

- Pi 5 API が Tailscale 等で到達可能
- 端末の `ClientDevice` に **`haizenPresetShelfCodeRaw`** が設定済み（`PATCH /api/mobile-placement/haizen-preset-shelf` または DB）
- 推奨: `python3-evdev`（`sudo apt-get install -y python3-evdev`）＋ `HAIZEN_HID_DEVICE=/dev/input/eventN`

## 設定（/etc/raspi-haizen-agent.conf）

`KEY="value"` 形式（`#` 行コメント）。`status-agent` と同様、先頭で指定してください。

| キー | 必須 | 説明 |
|------|------|------|
| `API_BASE_URL` | はい | 例 `https://100.x.x.x`（末尾スラッシュなし） |
| `X_CLIENT_KEY` | はい | `ClientDevice.apiKey` |
| `TLS_SKIP_VERIFY` | いいえ | `1` で自己署名 TLS を検証スキップ |
| `CONFIG_PATH` | いいえ | 既定 `/etc/raspi-haizen-agent.conf` |
| `HAIZEN_HID_DEVICE` | いいえ | `evdev` デバイスパス。未設定時は **標準入力** から1行ずつ読む（手動テスト用） |

## 分配番号 QR

- 値が **1〜999 の整数**のみ（1〜3桁）のスキャンは「次の製造 order 1件用の分配番号」として扱います。
- その直後の製造 order スキャンにだけ `distributionNumber` として付与され、**消費後は未設定に戻ります**。

## 実行

```bash
sudo HAIZEN_HID_DEVICE=/dev/input/eventX python3 -m haizen_agent
# または設定ファイルのみ
python3 -m haizen_agent
```

## systemd 例（別途ユニットファイルを配置）

`ExecStart=/usr/bin/python3 -m haizen_agent`、環境で `CONFIG_PATH` を指定。
